use crate::database::{Database, EpisodeSummary, QueueItemWithEpisode};
use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::RwLock;

/// Shared worker state for status reporting
#[derive(Debug, Clone)]
pub struct WorkerState {
    pub is_processing: bool,
    pub current_episode: Option<EpisodeSummary>,
    pub progress: Option<i32>,
    pub stage: String, // "downloading", "transcribing", "saving"
    pub started_at: Option<DateTime<Utc>>,
    pub estimated_remaining: Option<i64>,
    pub last_activity: Option<DateTime<Utc>>,
    pub model: String,
    pub processed_today: i32,
    pub cancel_requested: bool,
}

impl Default for WorkerState {
    fn default() -> Self {
        Self {
            is_processing: false,
            current_episode: None,
            progress: None,
            stage: "idle".to_string(),
            started_at: None,
            estimated_remaining: None,
            last_activity: Some(Utc::now()),
            model: "large-v3".to_string(),
            processed_today: 0,
            cancel_requested: false,
        }
    }
}

pub struct TranscriptionWorker {
    db: Arc<Database>,
    state: Arc<RwLock<WorkerState>>,
    whisper_cli_path: PathBuf,
    models_path: PathBuf,
    transcripts_path: PathBuf,
    episodes_path: PathBuf,
    // Diarization config
    venv_python_path: PathBuf,
    diarization_script_path: PathBuf,
    huggingface_token: Option<String>,
}

impl TranscriptionWorker {
    pub fn new(
        db: Arc<Database>,
        state: Arc<RwLock<WorkerState>>,
        whisper_cli_path: PathBuf,
        models_path: PathBuf,
        transcripts_path: PathBuf,
        episodes_path: PathBuf,
        venv_python_path: PathBuf,
        diarization_script_path: PathBuf,
        huggingface_token: Option<String>,
    ) -> Self {
        Self {
            db,
            state,
            whisper_cli_path,
            models_path,
            transcripts_path,
            episodes_path,
            venv_python_path,
            diarization_script_path,
            huggingface_token,
        }
    }

    /// Start the background worker loop
    pub async fn run(&self, app_handle: tauri::AppHandle) {
        log::info!("Transcription worker started");

        // Reset any stuck "processing" items from previous runs
        if let Err(e) = self.db.reset_stuck_processing() {
            log::warn!("Failed to reset stuck processing items: {}", e);
        }

        // Retry previously failed downloads
        if let Err(e) = self.db.retry_failed_downloads() {
            log::warn!("Failed to retry failed downloads: {}", e);
        }

        loop {
            // Check if we should stop
            {
                let state = self.state.read().await;
                if state.cancel_requested {
                    break;
                }
            }

            // Check for next item in queue
            match self.db.get_next_queue_item() {
                Ok(Some(mut item)) => {
                    log::info!("Processing episode: {}", item.episode.title);

                    // Update state - starting
                    {
                        let mut state = self.state.write().await;
                        state.is_processing = true;
                        state.current_episode = Some(EpisodeSummary {
                            id: item.episode.id,
                            title: item.episode.title.clone(),
                            duration: item.episode.duration,
                            episode_number: item.episode.episode_number.clone(),
                        });
                        state.started_at = Some(Utc::now());
                        state.progress = Some(0);
                        state.stage = "downloading".to_string();
                        state.cancel_requested = false;
                    }

                    // Mark as processing in DB
                    if let Err(e) = self.db.mark_processing(item.episode.id) {
                        log::error!("Failed to mark episode as processing: {}", e);
                    }

                    // Emit status event
                    let _ = app_handle.emit("status_update", ());

                    // Auto-download if needed
                    let needs_download = item.episode.audio_file_path.is_none()
                        || item.episode.audio_file_path.as_ref().map(|p| !std::path::Path::new(p).exists()).unwrap_or(true);

                    if needs_download {
                        log::info!("Downloading episode: {}", item.episode.title);
                        match self.download_episode(&item.episode, &app_handle).await {
                            Ok(file_path) => {
                                log::info!("Download completed: {}", file_path);
                                // Update the item with the new path
                                item.episode.audio_file_path = Some(file_path);
                                item.episode.is_downloaded = true;
                            }
                            Err(e) => {
                                log::error!("Download failed: {}", e);
                                if let Err(db_err) = self.db.mark_failed(item.episode.id, &format!("Download failed: {}", e)) {
                                    log::error!("Failed to mark episode as failed: {}", db_err);
                                }
                                // Reset state and continue to next item
                                {
                                    let mut state = self.state.write().await;
                                    state.is_processing = false;
                                    state.current_episode = None;
                                    state.progress = None;
                                    state.stage = "idle".to_string();
                                }
                                let _ = app_handle.emit("queue_update", ());
                                continue;
                            }
                        }
                    }

                    // Skip transcription if already transcribed (e.g., re-diarization only)
                    let transcript_result = if item.episode.is_transcribed && item.episode.transcript_path.is_some() {
                        log::info!("Episode already transcribed, skipping to diarization: {}", item.episode.title);
                        Ok(PathBuf::from(item.episode.transcript_path.as_ref().unwrap()))
                    } else {
                        // Update stage to transcribing
                        {
                            let mut state = self.state.write().await;
                            state.stage = "transcribing".to_string();
                            state.progress = Some(0);
                        }
                        let _ = app_handle.emit("status_update", ());

                        // Process transcription with progress tracking
                        self.transcribe_with_progress(&item, &app_handle).await
                    };

                    match transcript_result {
                        Ok(transcript_path) => {
                            log::info!("Transcript ready: {}", item.episode.title);

                            // Run diarization if HuggingFace token is configured
                            if self.huggingface_token.is_some() {
                                // Update stage to diarizing
                                {
                                    let mut state = self.state.write().await;
                                    state.stage = "diarizing".to_string();
                                    state.progress = Some(0);
                                }
                                let _ = app_handle.emit("status_update", ());

                                if let Some(audio_path) = &item.episode.audio_file_path {
                                    // Check for hints file (from reprocess_diarization)
                                    let hints_path = self.transcripts_path
                                        .join(format!("{}_hints.json", item.episode.id));
                                    let hints = if hints_path.exists() {
                                        Some(hints_path.clone())
                                    } else {
                                        None
                                    };

                                    match self.diarize_with_progress(
                                        &PathBuf::from(audio_path),
                                        &transcript_path,
                                        &app_handle,
                                        hints.as_ref(),
                                    ).await {
                                        Ok(num_speakers) => {
                                            log::info!("Diarization completed: {}, {} speakers", item.episode.title, num_speakers);
                                            // Update database with diarization info
                                            if num_speakers > 0 {
                                                if let Err(e) = self.db.update_diarization(item.episode.id, num_speakers) {
                                                    log::error!("Failed to update diarization status: {}", e);
                                                }
                                            }
                                        }
                                        Err(e) => {
                                            log::warn!("Diarization failed (continuing anyway): {}", e);
                                        }
                                    }

                                    // Clean up hints file after diarization
                                    if let Some(ref hp) = hints {
                                        let _ = std::fs::remove_file(hp);
                                    }
                                }
                            }

                            // Update stage to saving
                            {
                                let mut state = self.state.write().await;
                                state.stage = "saving".to_string();
                                state.progress = Some(100);
                            }
                            let _ = app_handle.emit("status_update", ());

                            if let Err(e) = self.db.mark_completed(
                                item.episode.id,
                                transcript_path.to_str(),
                            ) {
                                log::error!("Failed to mark episode as completed: {}", e);
                            }

                            // Update state
                            {
                                let mut state = self.state.write().await;
                                state.processed_today += 1;
                            }

                            // Emit completion event
                            let _ = app_handle.emit("transcription_complete", item.episode.id);
                        }
                        Err(e) => {
                            log::error!("Transcription failed: {}", e);
                            if let Err(db_err) =
                                self.db.mark_failed(item.episode.id, &e.to_string())
                            {
                                log::error!("Failed to mark episode as failed: {}", db_err);
                            }

                            // Emit failure event
                            let _ = app_handle
                                .emit("transcription_failed", (item.episode.id, e.to_string()));
                        }
                    }

                    // Reset state
                    {
                        let mut state = self.state.write().await;
                        state.is_processing = false;
                        state.current_episode = None;
                        state.progress = None;
                        state.stage = "idle".to_string();
                        state.started_at = None;
                        state.last_activity = Some(Utc::now());
                    }

                    // Emit queue update
                    let _ = app_handle.emit("queue_update", ());
                    let _ = app_handle.emit("status_update", ());
                }
                Ok(None) => {
                    // No items in queue - check if auto-transcribe is enabled
                    let auto_transcribe = self.db.get_setting("auto_transcribe")
                        .unwrap_or(None)
                        .map(|v| v == "true")
                        .unwrap_or(false);

                    if auto_transcribe {
                        // Find next untranscribed episode and add to queue
                        if let Ok(Some(episode)) = self.db.get_next_untranscribed_episode() {
                            log::info!("Auto-transcribe: adding episode {} to queue", episode.title);
                            if let Err(e) = self.db.add_to_queue(episode.id, 0) {
                                log::error!("Failed to auto-add episode to queue: {}", e);
                            } else {
                                let _ = app_handle.emit("queue_update", ());
                                // Don't sleep, process immediately
                                continue;
                            }
                        }
                    }

                    // Wait before checking again
                    tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                }
                Err(e) => {
                    log::error!("Failed to get next queue item: {}", e);
                    tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                }
            }
        }

        log::info!("Transcription worker stopped");
    }

    /// Transcribe with real-time progress tracking
    /// Returns the path to the JSON transcript file
    async fn transcribe_with_progress(
        &self,
        item: &QueueItemWithEpisode,
        app_handle: &tauri::AppHandle,
    ) -> anyhow::Result<PathBuf> {
        let audio_path = item
            .episode
            .audio_file_path
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No audio file path"))?;

        let audio_path = PathBuf::from(audio_path);
        if !audio_path.exists() {
            return Err(anyhow::anyhow!("Audio file not found: {:?}", audio_path));
        }

        // Create output path
        let output_base = self.transcripts_path.join(
            audio_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
        );

        // Get model from database setting (falls back to large-v3 if not set)
        let model = self.db.get_setting("transcription_model")
            .unwrap_or(None)
            .unwrap_or_else(|| "large-v3".to_string());

        // Update state with current model
        {
            let mut state = self.state.write().await;
            state.model = model.clone();
        }

        let model_path = self.models_path.join(format!("ggml-{}.bin", model));

        if !model_path.exists() {
            return Err(anyhow::anyhow!("Model not found: {:?}", model_path));
        }

        // Get episode duration for progress estimation
        let duration = item.episode.duration.unwrap_or(3600.0); // Default 1 hour

        log::info!(
            "Running whisper-cli with progress tracking: {:?}",
            audio_path
        );

        // Spawn whisper-cli with piped stderr for progress
        // Note: stdout must be null to prevent pipe buffer deadlock
        let mut child = Command::new(&self.whisper_cli_path)
            .args([
                "-m",
                model_path.to_str().unwrap(),
                "-f",
                audio_path.to_str().unwrap(),
                "-oj",  // Output JSON
                "-otxt", // Output TXT
                "-osrt", // Output SRT
                "-of",
                output_base.to_str().unwrap(),
                "-pp", // Print progress to stderr
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()?;

        // Read stderr for progress updates
        let stderr = child.stderr.take().expect("Failed to get stderr");
        let mut reader = BufReader::new(stderr).lines();

        let state = self.state.clone();
        let app_handle = app_handle.clone();
        let start_time = Utc::now();

        // Process stderr line by line
        while let Ok(Some(line)) = reader.next_line().await {
            // Parse progress from whisper-cli output
            if let Some(progress) = parse_progress(&line) {
                let elapsed = Utc::now().signed_duration_since(start_time).num_seconds();
                let estimated_total = if progress > 0 {
                    (elapsed as f64 / progress as f64 * 100.0) as i64
                } else {
                    0
                };
                let remaining = estimated_total - elapsed;

                // Update state
                {
                    let mut s = state.write().await;
                    s.progress = Some(progress);
                    s.estimated_remaining = Some(remaining.max(0));
                }

                // Emit progress event
                let _ = app_handle.emit("status_update", ());

                log::debug!("Transcription progress: {}% ({}s elapsed, ~{}s remaining)",
                    progress, elapsed, remaining);
            }
        }

        // Wait for process to complete
        let status = child.wait().await?;

        if !status.success() {
            return Err(anyhow::anyhow!("whisper-cli failed with status: {}", status));
        }

        let transcript_path = output_base.with_extension("json");
        log::info!("Transcription output saved to: {:?}", transcript_path);

        Ok(transcript_path)
    }

    /// Run speaker diarization with progress tracking
    async fn diarize_with_progress(
        &self,
        audio_path: &PathBuf,
        transcript_path: &PathBuf,
        app_handle: &tauri::AppHandle,
        hints_file: Option<&PathBuf>,
    ) -> anyhow::Result<i32> {
        let token = self.huggingface_token.as_ref()
            .ok_or_else(|| anyhow::anyhow!("HuggingFace token not configured"))?;

        log::info!("Running speaker diarization on: {:?}", audio_path);

        // Build command args
        let mut args = vec![
            self.diarization_script_path.to_str().unwrap().to_string(),
            audio_path.to_str().unwrap().to_string(),
            transcript_path.to_str().unwrap().to_string(),
            "--token".to_string(),
            token.clone(),
        ];

        // Pass hints file if available
        if let Some(hints_path) = hints_file {
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
        let mut child = Command::new(&self.venv_python_path)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()) // Capture errors for debugging
            .spawn()?;

        // Read stdout for progress updates
        let stdout = child.stdout.take().expect("Failed to get stdout");
        let mut reader = BufReader::new(stdout).lines();

        let state = self.state.clone();
        let app_handle = app_handle.clone();

        // Process stdout line by line for progress
        while let Ok(Some(line)) = reader.next_line().await {
            // Parse progress from diarization output: "DIARIZATION_PROGRESS: 45"
            if line.starts_with("DIARIZATION_PROGRESS:") {
                if let Some(progress_str) = line.split(':').nth(1) {
                    if let Ok(progress) = progress_str.trim().parse::<i32>() {
                        // Update state
                        {
                            let mut s = state.write().await;
                            s.progress = Some(progress);
                        }
                        // Emit progress event
                        let _ = app_handle.emit("status_update", ());
                        log::debug!("Diarization progress: {}%", progress);
                    }
                }
            }
        }

        // Wait for process to complete and capture stderr
        let output = child.wait_with_output().await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::error!("Diarization stderr: {}", stderr);
            return Err(anyhow::anyhow!("Diarization failed: {}", stderr));
        }

        // Read the _with_speakers.json file to get number of speakers
        let with_speakers_path = transcript_path.with_file_name(format!(
            "{}_with_speakers.json",
            transcript_path.file_stem().and_then(|s| s.to_str()).unwrap_or("transcript")
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

        log::info!("Diarization complete for: {:?}, {} speakers", audio_path, num_speakers);
        Ok(num_speakers)
    }

    /// Download episode audio file with streaming, timeouts, and automatic retry
    async fn download_episode(
        &self,
        episode: &crate::database::Episode,
        app_handle: &tauri::AppHandle,
    ) -> anyhow::Result<String> {
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
        let file_path = self.episodes_path.join(&filename);

        let backoff_delays = [2u64, 8, 30];

        for attempt in 0..3usize {
            match self
                .try_download(episode, &file_path, app_handle)
                .await
            {
                Ok(file_size) => {
                    let file_path_str = file_path.to_string_lossy().to_string();

                    // Update database
                    self.db.mark_downloaded(episode.id, &file_path_str)?;
                    self.db.update_episode_file_size(episode.id, file_size)?;

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
                        return Err(anyhow::anyhow!(
                            "Download failed after 3 attempts: {}",
                            e
                        ));
                    }
                }
            }
        }

        unreachable!()
    }

    /// Single download attempt with streaming and validation
    async fn try_download(
        &self,
        episode: &crate::database::Episode,
        file_path: &PathBuf,
        app_handle: &tauri::AppHandle,
    ) -> anyhow::Result<i64> {
        log::info!("Downloading to: {:?}", file_path);

        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            .timeout(std::time::Duration::from_secs(600))
            .build()?;

        let response = client
            .get(&episode.audio_url)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to start download: {}", e))?;

        if !response.status().is_success() {
            return Err(anyhow::anyhow!(
                "Download failed with status: {}",
                response.status()
            ));
        }

        let content_length = response.content_length();
        let mut stream = response.bytes_stream();
        let mut file = tokio::fs::File::create(&file_path).await?;
        let mut downloaded: u64 = 0;
        let mut last_progress: i32 = -1;

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result
                .map_err(|e| anyhow::anyhow!("Error reading download stream: {}", e))?;
            file.write_all(&chunk).await?;
            downloaded += chunk.len() as u64;

            // Emit progress if we know the total size
            if let Some(total) = content_length {
                let progress = ((downloaded as f64 / total as f64) * 100.0) as i32;
                if progress != last_progress {
                    last_progress = progress;
                    {
                        let mut state = self.state.write().await;
                        state.progress = Some(progress);
                    }
                    let _ = app_handle.emit("status_update", ());
                }
            }
        }

        file.flush().await?;

        // Validate file size against Content-Length
        if let Some(expected) = content_length {
            if downloaded != expected {
                return Err(anyhow::anyhow!(
                    "Download incomplete: got {} bytes, expected {}",
                    downloaded,
                    expected
                ));
            }
        }

        log::info!("Download complete: {} bytes", downloaded);
        Ok(downloaded as i64)
    }
}

/// Parse progress percentage from whisper-cli output
fn parse_progress(line: &str) -> Option<i32> {
    // whisper-cli outputs: "progress = 45%" or similar
    if line.contains("progress") {
        // Try to find a percentage
        for part in line.split_whitespace() {
            if let Some(num_str) = part.strip_suffix('%') {
                if let Ok(num) = num_str.parse::<i32>() {
                    return Some(num.clamp(0, 100));
                }
            }
            // Also try parsing just numbers
            if let Ok(num) = part.parse::<i32>() {
                if num >= 0 && num <= 100 {
                    return Some(num);
                }
            }
        }
    }

    // Alternative: parse timestamp progress like "[00:05:30 --> 00:05:35]"
    // This indicates progress through the audio
    if line.starts_with('[') && line.contains("-->") {
        if let Some(time_str) = line.split("-->").next() {
            if let Some(seconds) = parse_timestamp(time_str.trim_matches(|c| c == '[' || c == ' ')) {
                // Return progress as percentage (assuming we don't know total, estimate based on line)
                // This is a fallback - real progress from -pp flag is better
                return None; // Don't use timestamp for now
            }
        }
    }

    None
}

/// Parse timestamp like "00:05:30" to seconds
fn parse_timestamp(ts: &str) -> Option<f64> {
    let parts: Vec<&str> = ts.split(':').collect();
    match parts.len() {
        2 => {
            let mins: f64 = parts[0].parse().ok()?;
            let secs: f64 = parts[1].parse().ok()?;
            Some(mins * 60.0 + secs)
        }
        3 => {
            let hours: f64 = parts[0].parse().ok()?;
            let mins: f64 = parts[1].parse().ok()?;
            let secs: f64 = parts[2].parse().ok()?;
            Some(hours * 3600.0 + mins * 60.0 + secs)
        }
        _ => None,
    }
}
