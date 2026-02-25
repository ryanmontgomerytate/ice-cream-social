use crate::database::Database;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::AsyncBufReadExt;
use tokio::io::BufReader;
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::ProgressUpdate;

/// Message sent to the diarize task
pub struct DiarizeJob {
    pub episode_id: i64,
    pub audio_path: String,
    pub transcript_path: PathBuf,
    pub hints_path: Option<PathBuf>,
    pub embedding_backend_override: Option<String>,
    /// ISO date (YYYY-MM-DD) of the episode, for era-aware voice matching
    pub episode_date: Option<String>,
    pub db: Arc<Database>,
}

/// Result from a diarize task
pub struct DiarizeResult {
    pub episode_id: i64,
    pub result: Result<i32, String>, // num_speakers or error
    pub duration_seconds: Option<f64>,
}

/// Run the diarize task loop
pub async fn diarize_task(
    venv_python_path: PathBuf,
    diarization_script_path: PathBuf,
    huggingface_token: String,
    mut rx: mpsc::Receiver<DiarizeJob>,
    result_tx: mpsc::Sender<DiarizeResult>,
    progress_tx: mpsc::Sender<ProgressUpdate>,
    cancel: CancellationToken,
) {
    log::info!("Diarize task started");

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                log::info!("Diarize task cancelled");
                break;
            }
            job = rx.recv() => {
                match job {
                    Some(job) => {
                        let episode_id = job.episode_id;
                        let start = std::time::Instant::now();
                        let result = diarize_with_progress(
                            &venv_python_path,
                            &diarization_script_path,
                            &huggingface_token,
                            &job,
                            &progress_tx,
                            &cancel,
                        ).await;
                        let duration_seconds = if result.is_ok() { Some(start.elapsed().as_secs_f64()) } else { None };
                        let _ = result_tx.send(DiarizeResult {
                            episode_id,
                            result,
                            duration_seconds,
                        }).await;
                    }
                    None => {
                        log::info!("Diarize task channel closed");
                        break;
                    }
                }
            }
        }
    }
}

/// Run speaker diarization with progress tracking
async fn diarize_with_progress(
    venv_python_path: &PathBuf,
    diarization_script_path: &PathBuf,
    token: &str,
    job: &DiarizeJob,
    progress_tx: &mpsc::Sender<ProgressUpdate>,
    cancel: &CancellationToken,
) -> Result<i32, String> {
    log::info!("Running speaker diarization on: {}", job.audio_path);

    if cancel.is_cancelled() {
        return Err("Diarization cancelled".to_string());
    }

    // Build command args
    let mut args = vec![
        diarization_script_path.to_str().unwrap().to_string(),
        job.audio_path.clone(),
        job.transcript_path.to_str().unwrap().to_string(),
        "--token".to_string(),
        token.to_string(),
    ];

    let embedding_backend = job
        .embedding_backend_override
        .clone()
        .or_else(|| job.db.get_setting("embedding_model").unwrap_or(None))
        .filter(|v| v == "ecapa-tdnn" || v == "pyannote")
        .unwrap_or_else(|| "pyannote".to_string());
    args.push("--embedding-backend".to_string());
    args.push(embedding_backend);

    // Pass hints file if available
    if let Some(hints_path) = &job.hints_path {
        log::info!("Passing diarization hints: {:?}", hints_path);
        args.push("--hints-file".to_string());
        args.push(hints_path.to_str().unwrap().to_string());

        // Parse hints to get num_speakers_hint
        if let Ok(content) = std::fs::read_to_string(hints_path) {
            if let Ok(hints) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(num) = hints.get("num_speakers_hint").and_then(|v| v.as_i64()) {
                    args.push("--speakers".to_string());
                    args.push(num.to_string());
                }
            }
        }
    }

    // Pass episode date for era-aware voice matching
    if let Some(ref date) = job.episode_date {
        args.push("--episode-date".to_string());
        args.push(date.clone());
    }

    // Run Python diarization script
    let mut child = Command::new(venv_python_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn diarization: {}", e))?;

    // Read stdout for progress updates
    let stdout = child.stdout.take().expect("Failed to get stdout");
    let mut reader = BufReader::new(stdout).lines();

    // Process stdout line by line for progress
    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                log::info!("Killing diarization subprocess");
                let _ = child.kill().await;
                return Err("Diarization cancelled".to_string());
            }
            line = reader.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        if line.starts_with("DIARIZATION_PROGRESS:") {
                            if let Some(progress_str) = line.split(':').nth(1) {
                                if let Ok(progress) = progress_str.trim().parse::<i32>() {
                                    let _ = progress_tx.send(ProgressUpdate {
                                        episode_id: job.episode_id,
                                        stage: "diarizing".to_string(),
                                        progress: Some(progress),
                                        estimated_remaining: None,
                                    }).await;
                                }
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        }
    }

    // Wait for process to complete and capture stderr
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("Failed to wait for diarization: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("Diarization stderr: {}", stderr);
        return Err(format!("Diarization failed: {}", stderr));
    }

    // Read the _with_speakers.json file to get number of speakers
    let with_speakers_path = job.transcript_path.with_file_name(format!(
        "{}_with_speakers.json",
        job.transcript_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("transcript")
    ));

    let num_speakers = if with_speakers_path.exists() {
        match std::fs::read_to_string(&with_speakers_path) {
            Ok(content) => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    // Auto-assign speakers identified with >= 0.75 confidence
                    if let Some(names) = json.get("speaker_names").and_then(|v| v.as_object()) {
                        let confidence_map = json.get("speaker_confidence")
                            .and_then(|v| v.as_object())
                            .cloned()
                            .unwrap_or_default();

                        for (label, name_val) in names {
                            if let Some(speaker_name) = name_val.as_str() {
                                let confidence = confidence_map.get(label)
                                    .and_then(|c| c.as_f64())
                                    .unwrap_or(0.0);

                                if confidence >= 0.75 {
                                    if let Err(e) = job.db.link_episode_speaker_auto(
                                        job.episode_id, label, speaker_name, confidence
                                    ) {
                                        log::warn!("Auto-assign speaker failed for {}: {}", label, e);
                                    } else {
                                        log::info!(
                                            "Auto-assigned {} → {} (confidence: {:.2})",
                                            label, speaker_name, confidence
                                        );
                                    }
                                }
                            }
                        }
                    }

                    json.get("diarization")
                        .and_then(|d| d.get("num_speakers"))
                        .and_then(|n| n.as_i64())
                        .map(|n| n as i32)
                        .unwrap_or(0)
                } else {
                    0
                }
            }
            Err(_) => 0,
        }
    } else {
        0
    };

    // Clean up hints file after diarization
    if let Some(hints_path) = &job.hints_path {
        let _ = std::fs::remove_file(hints_path);
    }

    log::info!(
        "Diarization complete for episode {}, {} speakers",
        job.episode_id,
        num_speakers
    );
    Ok(num_speakers)
}
