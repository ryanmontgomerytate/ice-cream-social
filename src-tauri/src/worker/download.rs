use crate::database::{Database, Episode};
use futures_util::StreamExt;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// Message sent to the download task
pub struct DownloadJob {
    pub episode: Episode,
    pub episodes_path: PathBuf,
}

/// Result from a download task
pub struct DownloadResult {
    pub episode_id: i64,
    pub result: Result<String, String>,
    pub duration_seconds: Option<f64>,
}

/// Run the download task loop, receiving jobs and sending results
pub async fn download_task(
    db: Arc<Database>,
    mut rx: mpsc::Receiver<DownloadJob>,
    result_tx: mpsc::Sender<DownloadResult>,
    cancel: CancellationToken,
) {
    log::info!("Download task started");

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                log::info!("Download task cancelled");
                break;
            }
            job = rx.recv() => {
                match job {
                    Some(job) => {
                        let episode_id = job.episode.id;
                        let start = std::time::Instant::now();
                        let result = download_episode(&db, &job.episode, &job.episodes_path, &cancel).await;
                        let duration_seconds = if result.is_ok() { Some(start.elapsed().as_secs_f64()) } else { None };
                        let _ = result_tx.send(DownloadResult {
                            episode_id,
                            result,
                            duration_seconds,
                        }).await;
                    }
                    None => {
                        log::info!("Download task channel closed");
                        break;
                    }
                }
            }
        }
    }
}

/// Download episode audio file with streaming, timeouts, and automatic retry
async fn download_episode(
    db: &Database,
    episode: &Episode,
    episodes_path: &PathBuf,
    cancel: &CancellationToken,
) -> Result<String, String> {
    // Generate filename from title
    let safe_title: String = episode
        .title
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let filename = format!("{}.mp3", safe_title.trim());
    let file_path = episodes_path.join(&filename);

    let backoff_delays = [2u64, 8, 30];

    for attempt in 0..3usize {
        if cancel.is_cancelled() {
            return Err("Download cancelled".to_string());
        }

        match try_download(episode, &file_path).await {
            Ok(file_size) => {
                let file_path_str = file_path.to_string_lossy().to_string();

                // Update database
                db.mark_downloaded(episode.id, &file_path_str)
                    .map_err(|e| e.to_string())?;
                db.update_episode_file_size(episode.id, file_size)
                    .map_err(|e| e.to_string())?;

                return Ok(file_path_str);
            }
            Err(e) => {
                // Clean up partial file
                let _ = tokio::fs::remove_file(&file_path).await;

                if attempt < 2 {
                    let delay = backoff_delays[attempt];
                    log::warn!(
                        "Download attempt {} failed, retrying in {}s: {}",
                        attempt + 1,
                        delay,
                        e
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
                } else {
                    return Err(format!("Download failed after 3 attempts: {}", e));
                }
            }
        }
    }

    unreachable!()
}

/// Single download attempt with streaming and validation
async fn try_download(
    episode: &Episode,
    file_path: &PathBuf,
) -> Result<i64, String> {
    log::info!("Downloading to: {:?}", file_path);

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&episode.audio_url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let content_length = response.content_length();
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&file_path)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;
    let mut downloaded: u64 = 0;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result
            .map_err(|e| format!("Error reading download stream: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write chunk: {}", e))?;
        downloaded += chunk.len() as u64;
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush file: {}", e))?;

    // Validate file size against Content-Length
    if let Some(expected) = content_length {
        if downloaded != expected {
            return Err(format!(
                "Download incomplete: got {} bytes, expected {}",
                downloaded, expected
            ));
        }
    }

    log::info!("Download complete: {} bytes", downloaded);
    Ok(downloaded as i64)
}
