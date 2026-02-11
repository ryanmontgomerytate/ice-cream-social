use std::path::PathBuf;
use std::process::Stdio;
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
}

/// Result from a diarize task
pub struct DiarizeResult {
    pub episode_id: i64,
    pub result: Result<i32, String>, // num_speakers or error
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
                        let result = diarize_with_progress(
                            &venv_python_path,
                            &diarization_script_path,
                            &huggingface_token,
                            &job,
                            &progress_tx,
                            &cancel,
                        ).await;
                        let _ = result_tx.send(DiarizeResult {
                            episode_id,
                            result,
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
