use crate::database::{Database, EpisodeSummary};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::AsyncBufReadExt;
use tokio::io::BufReader;
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::ProgressUpdate;

/// Message sent to the transcribe task
#[allow(dead_code)]
pub struct TranscribeJob {
    pub episode_id: i64,
    pub episode_summary: EpisodeSummary,
    pub audio_path: String,
    pub duration: Option<f64>,
}

/// Result from a transcribe task
pub struct TranscribeResult {
    pub episode_id: i64,
    pub result: Result<PathBuf, String>,
    pub duration_seconds: Option<f64>,
}

/// Run the transcribe task loop
pub async fn transcribe_task(
    db: Arc<Database>,
    whisper_cli_path: PathBuf,
    models_path: PathBuf,
    transcripts_path: PathBuf,
    mut rx: mpsc::Receiver<TranscribeJob>,
    result_tx: mpsc::Sender<TranscribeResult>,
    progress_tx: mpsc::Sender<ProgressUpdate>,
    cancel: CancellationToken,
) {
    log::info!("Transcribe task started");

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                log::info!("Transcribe task cancelled");
                break;
            }
            job = rx.recv() => {
                match job {
                    Some(job) => {
                        let episode_id = job.episode_id;
                        let start = std::time::Instant::now();
                        let result = transcribe_with_progress(
                            &db,
                            &whisper_cli_path,
                            &models_path,
                            &transcripts_path,
                            &job,
                            &progress_tx,
                            &cancel,
                        ).await;
                        let duration_seconds = if result.is_ok() { Some(start.elapsed().as_secs_f64()) } else { None };
                        let _ = result_tx.send(TranscribeResult {
                            episode_id,
                            result,
                            duration_seconds,
                        }).await;
                    }
                    None => {
                        log::info!("Transcribe task channel closed");
                        break;
                    }
                }
            }
        }
    }
}

/// Transcribe with real-time progress tracking
async fn transcribe_with_progress(
    db: &Database,
    whisper_cli_path: &PathBuf,
    models_path: &PathBuf,
    transcripts_path: &PathBuf,
    job: &TranscribeJob,
    progress_tx: &mpsc::Sender<ProgressUpdate>,
    cancel: &CancellationToken,
) -> Result<PathBuf, String> {
    let audio_path = PathBuf::from(&job.audio_path);
    if !audio_path.exists() {
        return Err(format!("Audio file not found: {:?}", audio_path));
    }

    // Create output path
    let output_base = transcripts_path.join(
        audio_path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
    );

    // Get model from database setting
    let model = db
        .get_setting("transcription_model")
        .unwrap_or(None)
        .unwrap_or_else(|| "large-v3".to_string());

    let model_path = models_path.join(format!("ggml-{}.bin", model));

    if !model_path.exists() {
        return Err(format!("Model not found: {:?}", model_path));
    }

    if cancel.is_cancelled() {
        return Err("Transcription cancelled".to_string());
    }

    log::info!(
        "Running whisper-cli with progress tracking: {:?}",
        audio_path
    );

    // Spawn whisper-cli
    let mut child = Command::new(whisper_cli_path)
        .args([
            "-m",
            model_path.to_str().unwrap(),
            "-f",
            audio_path.to_str().unwrap(),
            "-oj",
            "-otxt",
            "-osrt",
            "-of",
            output_base.to_str().unwrap(),
            "-pp",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn whisper-cli: {}", e))?;

    // Read stderr for progress updates
    let stderr = child.stderr.take().expect("Failed to get stderr");
    let mut reader = BufReader::new(stderr).lines();

    let start_time = chrono::Utc::now();

    // Process stderr line by line
    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                log::info!("Killing transcription subprocess");
                let _ = child.kill().await;
                return Err("Transcription cancelled".to_string());
            }
            line = reader.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        if let Some(progress) = parse_progress(&line) {
                            let elapsed = chrono::Utc::now()
                                .signed_duration_since(start_time)
                                .num_seconds();
                            let remaining = if progress > 0 {
                                ((elapsed as f64 / progress as f64 * 100.0) as i64 - elapsed).max(0)
                            } else {
                                0
                            };

                            let _ = progress_tx.send(ProgressUpdate {
                                episode_id: job.episode_id,
                                stage: "transcribing".to_string(),
                                progress: Some(progress),
                                estimated_remaining: Some(remaining),
                            }).await;
                        }
                    }
                    Ok(None) => break, // EOF
                    Err(_) => break,
                }
            }
        }
    }

    // Wait for process to complete
    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for whisper-cli: {}", e))?;

    if !status.success() {
        return Err(format!("whisper-cli failed with status: {}", status));
    }

    let transcript_path = output_base.with_extension("json");
    log::info!("Transcription output saved to: {:?}", transcript_path);

    Ok(transcript_path)
}

/// Parse progress percentage from whisper-cli output
fn parse_progress(line: &str) -> Option<i32> {
    if line.contains("progress") {
        for part in line.split_whitespace() {
            if let Some(num_str) = part.strip_suffix('%') {
                if let Ok(num) = num_str.parse::<i32>() {
                    return Some(num.clamp(0, 100));
                }
            }
            if let Ok(num) = part.parse::<i32>() {
                if (0..=100).contains(&num) {
                    return Some(num);
                }
            }
        }
    }
    None
}
