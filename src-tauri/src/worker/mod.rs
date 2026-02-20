pub mod diarize;
pub mod download;
pub mod subagents;
pub mod transcribe;

use crate::database::{Database, EpisodeSummary};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::{mpsc, RwLock};
use tokio_util::sync::CancellationToken;

use diarize::{DiarizeJob, DiarizeResult};
use download::{DownloadJob, DownloadResult};
use transcribe::{TranscribeJob, TranscribeResult};

/// Progress update from any pipeline stage
pub struct ProgressUpdate {
    pub episode_id: i64,
    pub stage: String,
    pub progress: Option<i32>,
    pub estimated_remaining: Option<i64>,
}

/// A single active pipeline slot
#[derive(Debug, Clone, Serialize)]
pub struct PipelineSlot {
    pub episode: EpisodeSummary,
    pub stage: String, // "downloading" | "transcribing" | "diarizing"
    pub progress: Option<i32>,
    pub estimated_remaining: Option<i64>,
    pub started_at: DateTime<Utc>,
}

/// Shared worker state for status reporting
#[derive(Debug, Clone)]
pub struct WorkerState {
    pub slots: Vec<PipelineSlot>,
    pub model: String,
    pub processed_today: i32,
    pub last_activity: Option<DateTime<Utc>>,
    pub cancel_requested: bool,
}

impl Default for WorkerState {
    fn default() -> Self {
        Self {
            slots: Vec::new(),
            model: "medium".to_string(),
            processed_today: 0,
            last_activity: Some(Utc::now()),
            cancel_requested: false,
        }
    }
}

impl WorkerState {
    /// Get the "primary" slot for backward compatibility
    /// Priority: transcribing > diarizing > downloading
    pub fn primary_slot(&self) -> Option<&PipelineSlot> {
        self.slots
            .iter()
            .find(|s| s.stage == "transcribing")
            .or_else(|| self.slots.iter().find(|s| s.stage == "diarizing"))
            .or_else(|| self.slots.iter().find(|s| s.stage == "downloading"))
    }

    pub fn is_processing(&self) -> bool {
        !self.slots.is_empty()
    }
}

/// Tracks what stage each episode is in within the pipeline
struct PipelineEntry {
    episode: EpisodeSummary,
    audio_path: Option<String>,
    transcript_path: Option<PathBuf>,
    stage: String,
    queue_type: String, // "full" or "diarize_only"
    entered_pipeline_at: std::time::Instant,
    stage_started_at: DateTime<Utc>, // When the current stage started
    download_duration: Option<f64>,
    transcribe_duration: Option<f64>,
}

pub struct TranscriptionWorker {
    db: Arc<Database>,
    state: Arc<RwLock<WorkerState>>,
    whisper_cli_path: PathBuf,
    models_path: PathBuf,
    transcripts_path: PathBuf,
    episodes_path: PathBuf,
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

    /// Start the pipeline scheduler
    pub async fn run(&self, app_handle: tauri::AppHandle) {
        log::info!("Pipeline worker started");

        // Reset any stuck "processing" items from previous runs
        if let Err(e) = self.db.reset_stuck_processing() {
            log::warn!("Failed to reset stuck processing items: {}", e);
        }
        if let Err(e) = self.db.retry_failed_downloads() {
            log::warn!("Failed to retry failed downloads: {}", e);
        }

        // Create cancellation token
        let cancel = CancellationToken::new();

        // Create channels
        let (download_tx, download_rx) = mpsc::channel::<DownloadJob>(4);
        let (transcribe_tx, transcribe_rx) = mpsc::channel::<TranscribeJob>(4);
        let (diarize_tx, diarize_rx) = mpsc::channel::<DiarizeJob>(4);

        // Event channels (all tasks send results back to scheduler)
        let (event_tx, mut event_rx) = mpsc::channel::<PipelineEvent>(16);
        let (progress_tx, mut progress_rx) = mpsc::channel::<ProgressUpdate>(32);

        // Spawn download task
        let download_event_tx = event_tx.clone();
        let download_db = self.db.clone();
        let download_cancel = cancel.clone();
        tokio::spawn(async move {
            let (result_tx, mut result_rx) = mpsc::channel::<DownloadResult>(4);
            let task_handle = tokio::spawn(download::download_task(
                download_db,
                download_rx,
                result_tx,
                download_cancel,
            ));
            // Forward results to scheduler
            while let Some(result) = result_rx.recv().await {
                let _ = download_event_tx
                    .send(PipelineEvent::DownloadComplete(result))
                    .await;
            }
            let _ = task_handle.await;
        });

        // Spawn transcribe task
        let transcribe_event_tx = event_tx.clone();
        let transcribe_db = self.db.clone();
        let whisper_cli = self.whisper_cli_path.clone();
        let models = self.models_path.clone();
        let transcripts = self.transcripts_path.clone();
        let transcribe_cancel = cancel.clone();
        let transcribe_progress_tx = progress_tx.clone();
        tokio::spawn(async move {
            let (result_tx, mut result_rx) = mpsc::channel::<TranscribeResult>(4);
            let task_handle = tokio::spawn(transcribe::transcribe_task(
                transcribe_db,
                whisper_cli,
                models,
                transcripts,
                transcribe_rx,
                result_tx,
                transcribe_progress_tx,
                transcribe_cancel,
            ));
            while let Some(result) = result_rx.recv().await {
                let _ = transcribe_event_tx
                    .send(PipelineEvent::TranscribeComplete(result))
                    .await;
            }
            let _ = task_handle.await;
        });

        // Spawn diarize task (only if HF token is set)
        let has_diarization = self.huggingface_token.is_some();
        if let Some(ref token) = self.huggingface_token {
            let diarize_event_tx = event_tx.clone();
            let venv_python = self.venv_python_path.clone();
            let diarize_script = self.diarization_script_path.clone();
            let hf_token = token.clone();
            let diarize_cancel = cancel.clone();
            let diarize_progress_tx = progress_tx.clone();
            tokio::spawn(async move {
                let (result_tx, mut result_rx) = mpsc::channel::<DiarizeResult>(4);
                let task_handle = tokio::spawn(diarize::diarize_task(
                    venv_python,
                    diarize_script,
                    hf_token,
                    diarize_rx,
                    result_tx,
                    diarize_progress_tx,
                    diarize_cancel,
                ));
                while let Some(result) = result_rx.recv().await {
                    let _ = diarize_event_tx
                        .send(PipelineEvent::DiarizeComplete(result))
                        .await;
                }
                let _ = task_handle.await;
            });
        }

        // Scheduler state
        let mut active: HashMap<i64, PipelineEntry> = HashMap::new();
        let mut download_busy = false;
        let mut transcribe_busy = false;
        let mut diarize_busy = false;

        // On startup: auto-queue transcribed episodes that lack diarization
        if has_diarization {
            match self.db.count_undiarized_transcribed() {
                Ok(count) if count > 0 => {
                    log::info!("Found {} transcribed episodes without diarization, auto-queuing", count);
                    if let Err(e) = self.db.queue_undiarized_transcribed() {
                        log::error!("Failed to auto-queue undiarized episodes: {}", e);
                    }
                }
                Ok(_) => {}
                Err(e) => log::error!("Failed to check undiarized episodes: {}", e),
            }
        }

        // Scheduler loop
        loop {
            // Check cancellation from user
            {
                let ws = self.state.read().await;
                if ws.cancel_requested {
                    log::info!("Cancel requested, shutting down pipeline");
                    cancel.cancel();
                    break;
                }
            }

            // Try to fill slots from the queue
            self.try_fill_slots(
                &mut active,
                &mut download_busy,
                &mut transcribe_busy,
                &mut diarize_busy,
                &download_tx,
                &transcribe_tx,
                &diarize_tx,
                has_diarization,
                &app_handle,
            )
            .await;

            // Update shared state for UI
            self.sync_state(&active).await;
            let _ = app_handle.emit("status_update", ());

            // Wait for events or timeout
            tokio::select! {
                event = event_rx.recv() => {
                    match event {
                        Some(PipelineEvent::DownloadComplete(result)) => {
                            download_busy = false;
                            self.handle_download_complete(
                                result,
                                &mut active,
                                &mut transcribe_busy,
                                &transcribe_tx,
                                has_diarization,
                                &mut diarize_busy,
                                &diarize_tx,
                                &app_handle,
                            ).await;
                        }
                        Some(PipelineEvent::TranscribeComplete(result)) => {
                            transcribe_busy = false;
                            self.handle_transcribe_complete(
                                result,
                                &mut active,
                                has_diarization,
                                &mut diarize_busy,
                                &diarize_tx,
                                &app_handle,
                            ).await;
                        }
                        Some(PipelineEvent::DiarizeComplete(result)) => {
                            diarize_busy = false;
                            self.handle_diarize_complete(result, &mut active, &app_handle).await;
                        }
                        None => {
                            log::info!("All event channels closed");
                            break;
                        }
                    }
                }
                progress = progress_rx.recv() => {
                    if let Some(update) = progress {
                        // Update the slot's progress
                        if let Some(entry) = active.get_mut(&update.episode_id) {
                            entry.stage = update.stage.clone();
                        }
                        // Update shared state
                        {
                            let mut ws = self.state.write().await;
                            for slot in &mut ws.slots {
                                if slot.episode.id == update.episode_id {
                                    slot.progress = update.progress;
                                    slot.estimated_remaining = update.estimated_remaining;
                                    slot.stage = update.stage.clone();
                                }
                            }
                        }
                        let _ = app_handle.emit("status_update", ());
                    }
                }
                _ = tokio::time::sleep(std::time::Duration::from_secs(10)) => {
                    // Periodic poll — try to fill empty slots and check auto-transcribe
                    self.check_auto_transcribe(&app_handle).await;
                }
            }
        }

        log::info!("Pipeline worker stopped");
    }

    /// Try to fill empty pipeline slots from the queue
    async fn try_fill_slots(
        &self,
        active: &mut HashMap<i64, PipelineEntry>,
        download_busy: &mut bool,
        transcribe_busy: &mut bool,
        diarize_busy: &mut bool,
        download_tx: &mpsc::Sender<DownloadJob>,
        transcribe_tx: &mpsc::Sender<TranscribeJob>,
        diarize_tx: &mpsc::Sender<DiarizeJob>,
        has_diarization: bool,
        app_handle: &tauri::AppHandle,
    ) {
        // If transcribe slot is free, look for a ready item
        if !*transcribe_busy {
            // First check active entries that have been downloaded but not yet transcribed
            let ready_id = active
                .iter()
                .find(|(_, entry)| {
                    entry.stage == "downloaded"
                        && entry.audio_path.is_some()
                        && entry.queue_type == "full"
                })
                .map(|(id, _)| *id);

            if let Some(episode_id) = ready_id {
                if let Some(entry) = active.get_mut(&episode_id) {
                    entry.stage = "transcribing".to_string();
                    entry.stage_started_at = Utc::now();
                    *transcribe_busy = true;
                    let _ = transcribe_tx
                        .send(TranscribeJob {
                            episode_id,
                            episode_summary: entry.episode.clone(),
                            audio_path: entry.audio_path.clone().unwrap(),
                            duration: entry.episode.duration,
                        })
                        .await;
                }
            } else {
                // Pull from DB queue
                if let Ok(Some(item)) = self.db.get_next_queue_item() {
                    let episode_id = item.episode.id;

                    // Skip if already active in pipeline
                    if active.contains_key(&episode_id) {
                        return;
                    }

                    // Mark processing in DB
                    if let Err(e) = self.db.mark_processing(episode_id) {
                        log::error!("Failed to mark episode as processing: {}", e);
                        return;
                    }

                    let queue_type = self
                        .db
                        .get_queue_type(episode_id)
                        .unwrap_or(None)
                        .unwrap_or_else(|| "full".to_string());

                    let summary = EpisodeSummary {
                        id: item.episode.id,
                        title: item.episode.title.clone(),
                        duration: item.episode.duration,
                        episode_number: item.episode.episode_number.clone(),
                    };

                    // Check if this is diarize-only and already has transcript
                    if queue_type == "diarize_only"
                        && item.episode.is_transcribed
                        && item.episode.transcript_path.is_some()
                    {
                        // Skip straight to diarization
                        if has_diarization && !*diarize_busy {
                            let audio_path = item.episode.audio_file_path.clone();
                            let transcript_path =
                                PathBuf::from(item.episode.transcript_path.as_ref().unwrap());

                            // Check for hints file
                            let hints_path = self
                                .transcripts_path
                                .join(format!("{}_hints.json", episode_id));
                            let hints = if hints_path.exists() {
                                Some(hints_path)
                            } else {
                                None
                            };

                            active.insert(
                                episode_id,
                                PipelineEntry {
                                    episode: summary,
                                    audio_path,
                                    transcript_path: Some(transcript_path.clone()),
                                    stage: "diarizing".to_string(),
                                    queue_type,
                                    entered_pipeline_at: std::time::Instant::now(),
                                    stage_started_at: Utc::now(),
                                    download_duration: None,
                                    transcribe_duration: None,
                                },
                            );

                            *diarize_busy = true;
                            let _ = diarize_tx
                                .send(DiarizeJob {
                                    episode_id,
                                    audio_path: item
                                        .episode
                                        .audio_file_path
                                        .unwrap_or_default(),
                                    transcript_path,
                                    hints_path: hints,
                                })
                                .await;

                            let _ = app_handle.emit("status_update", ());
                            return;
                        }
                        // Diarize slot is busy, don't take this item yet — leave it pending
                        if let Err(e) = self.db.reset_to_pending(episode_id) {
                            log::error!("Failed to reset episode to pending: {}", e);
                        }
                        return;
                    }

                    // Full pipeline: check if audio needs downloading
                    let needs_download = item.episode.audio_file_path.is_none()
                        || item
                            .episode
                            .audio_file_path
                            .as_ref()
                            .map(|p| !std::path::Path::new(p).exists())
                            .unwrap_or(true);

                    if needs_download {
                        if !*download_busy {
                            active.insert(
                                episode_id,
                                PipelineEntry {
                                    episode: summary,
                                    audio_path: None,
                                    transcript_path: None,
                                    stage: "downloading".to_string(),
                                    queue_type,
                                    entered_pipeline_at: std::time::Instant::now(),
                                    stage_started_at: Utc::now(),
                                    download_duration: None,
                                    transcribe_duration: None,
                                },
                            );
                            *download_busy = true;
                            let _ = download_tx
                                .send(DownloadJob {
                                    episode: item.episode,
                                    episodes_path: self.episodes_path.clone(),
                                })
                                .await;
                        } else {
                            // Download slot busy, reset to pending
                            if let Err(e) = self.db.reset_to_pending(episode_id) {
                                log::error!("Failed to reset episode to pending: {}", e);
                            }
                        }
                    } else {
                        // Audio ready, go straight to transcription
                        let audio_path = item.episode.audio_file_path.clone();
                        active.insert(
                            episode_id,
                            PipelineEntry {
                                episode: summary.clone(),
                                audio_path: audio_path.clone(),
                                transcript_path: None,
                                stage: "transcribing".to_string(),
                                queue_type,
                                entered_pipeline_at: std::time::Instant::now(),
                                stage_started_at: Utc::now(),
                                download_duration: None,
                                transcribe_duration: None,
                            },
                        );
                        *transcribe_busy = true;
                        let _ = transcribe_tx
                            .send(TranscribeJob {
                                episode_id,
                                episode_summary: summary,
                                audio_path: audio_path.unwrap(),
                                duration: item.episode.duration,
                            })
                            .await;
                    }

                    let _ = app_handle.emit("status_update", ());
                }
            }
        }

        // If diarize slot is free, check for diarize_only items independently of transcribe slot
        if !*diarize_busy && has_diarization {
            // First check active entries that are downloaded diarize_only items
            let diarize_ready_id = active
                .iter()
                .find(|(_, entry)| {
                    entry.queue_type == "diarize_only"
                        && (entry.stage == "downloaded" || entry.stage == "waiting_diarize")
                        && entry.transcript_path.is_some()
                })
                .map(|(id, _)| *id);

            if let Some(episode_id) = diarize_ready_id {
                if let Some(entry) = active.get_mut(&episode_id) {
                    entry.stage = "diarizing".to_string();
                    entry.stage_started_at = Utc::now();
                    *diarize_busy = true;
                    let hints_path = self
                        .transcripts_path
                        .join(format!("{}_hints.json", episode_id));
                    let _ = diarize_tx
                        .send(DiarizeJob {
                            episode_id,
                            audio_path: entry.audio_path.clone().unwrap_or_default(),
                            transcript_path: entry.transcript_path.clone().unwrap(),
                            hints_path: if hints_path.exists() {
                                Some(hints_path)
                            } else {
                                None
                            },
                        })
                        .await;
                    let _ = app_handle.emit("status_update", ());
                }
            } else {
                // Pull diarize_only items from DB queue (independent of transcribe slot)
                if let Ok(Some(item)) = self.db.get_next_diarize_only_item() {
                    let episode_id = item.episode.id;

                    if !active.contains_key(&episode_id) {
                        if let Err(e) = self.db.mark_processing(episode_id) {
                            log::error!("Failed to mark diarize-only episode as processing: {}", e);
                        } else if item.episode.is_transcribed
                            && item.episode.transcript_path.is_some()
                        {
                            let summary = EpisodeSummary {
                                id: item.episode.id,
                                title: item.episode.title.clone(),
                                duration: item.episode.duration,
                                episode_number: item.episode.episode_number.clone(),
                            };
                            let transcript_path =
                                PathBuf::from(item.episode.transcript_path.as_ref().unwrap());
                            let hints_path = self
                                .transcripts_path
                                .join(format!("{}_hints.json", episode_id));
                            let hints = if hints_path.exists() {
                                Some(hints_path)
                            } else {
                                None
                            };

                            // Check if audio is available for diarization
                            let audio_available = item
                                .episode
                                .audio_file_path
                                .as_ref()
                                .map(|p| std::path::Path::new(p).exists())
                                .unwrap_or(false);

                            if audio_available {
                                active.insert(
                                    episode_id,
                                    PipelineEntry {
                                        episode: summary,
                                        audio_path: item.episode.audio_file_path.clone(),
                                        transcript_path: Some(transcript_path.clone()),
                                        stage: "diarizing".to_string(),
                                        queue_type: "diarize_only".to_string(),
                                        entered_pipeline_at: std::time::Instant::now(),
                                        stage_started_at: Utc::now(),
                                        download_duration: None,
                                        transcribe_duration: None,
                                    },
                                );
                                *diarize_busy = true;
                                let _ = diarize_tx
                                    .send(DiarizeJob {
                                        episode_id,
                                        audio_path: item
                                            .episode
                                            .audio_file_path
                                            .unwrap_or_default(),
                                        transcript_path,
                                        hints_path: hints,
                                    })
                                    .await;
                                let _ = app_handle.emit("status_update", ());
                            } else if !*download_busy {
                                // Need to download audio first
                                active.insert(
                                    episode_id,
                                    PipelineEntry {
                                        episode: summary,
                                        audio_path: None,
                                        transcript_path: Some(transcript_path),
                                        stage: "downloading".to_string(),
                                        queue_type: "diarize_only".to_string(),
                                        entered_pipeline_at: std::time::Instant::now(),
                                        stage_started_at: Utc::now(),
                                        download_duration: None,
                                        transcribe_duration: None,
                                    },
                                );
                                *download_busy = true;
                                let _ = download_tx
                                    .send(DownloadJob {
                                        episode: item.episode,
                                        episodes_path: self.episodes_path.clone(),
                                    })
                                    .await;
                                let _ = app_handle.emit("status_update", ());
                            } else {
                                // Both download and diarize busy, reset
                                if let Err(e) = self.db.reset_to_pending(episode_id) {
                                    log::error!("Failed to reset diarize-only to pending: {}", e);
                                }
                            }
                        } else {
                            // Not transcribed yet, can't diarize-only — reset
                            log::warn!("Diarize-only item {} has no transcript, resetting", episode_id);
                            if let Err(e) = self.db.reset_to_pending(episode_id) {
                                log::error!("Failed to reset: {}", e);
                            }
                        }
                    }
                }
            }
        }

        // Pre-fetch: if download slot is idle and other slots are busy, pre-download next
        if !*download_busy && (*transcribe_busy || *diarize_busy) {
            if let Ok(undownloaded) = self.db.get_upcoming_undownloaded(1) {
                if let Some(item) = undownloaded.into_iter().next() {
                    let episode_id = item.episode.id;
                    if !active.contains_key(&episode_id) {
                        let summary = EpisodeSummary {
                            id: item.episode.id,
                            title: item.episode.title.clone(),
                            duration: item.episode.duration,
                            episode_number: item.episode.episode_number.clone(),
                        };
                        active.insert(
                            episode_id,
                            PipelineEntry {
                                episode: summary,
                                audio_path: None,
                                transcript_path: None,
                                stage: "downloading".to_string(),
                                queue_type: "full".to_string(),
                                entered_pipeline_at: std::time::Instant::now(),
                                stage_started_at: Utc::now(),
                                download_duration: None,
                                transcribe_duration: None,
                            },
                        );
                        *download_busy = true;
                        let _ = download_tx
                            .send(DownloadJob {
                                episode: item.episode,
                                episodes_path: self.episodes_path.clone(),
                            })
                            .await;
                    }
                }
            }
        }
    }

    async fn handle_download_complete(
        &self,
        result: DownloadResult,
        active: &mut HashMap<i64, PipelineEntry>,
        transcribe_busy: &mut bool,
        transcribe_tx: &mpsc::Sender<TranscribeJob>,
        has_diarization: bool,
        diarize_busy: &mut bool,
        diarize_tx: &mpsc::Sender<DiarizeJob>,
        app_handle: &tauri::AppHandle,
    ) {
        let episode_id = result.episode_id;

        match result.result {
            Ok(file_path) => {
                log::info!("Download completed for episode {}: {}", episode_id, file_path);
                // Save download duration to DB
                if let Some(dur) = result.duration_seconds {
                    if let Err(e) = self.db.update_download_duration(episode_id, dur) {
                        log::warn!("Failed to save download duration: {}", e);
                    }
                }
                if let Some(entry) = active.get_mut(&episode_id) {
                    entry.audio_path = Some(file_path.clone());
                    entry.download_duration = result.duration_seconds;
                    entry.stage = "downloaded".to_string();

                    // If transcribe slot is free, send immediately
                    if !*transcribe_busy && entry.queue_type == "full" {
                        entry.stage = "transcribing".to_string();
                        entry.stage_started_at = Utc::now();
                        *transcribe_busy = true;
                        let _ = transcribe_tx
                            .send(TranscribeJob {
                                episode_id,
                                episode_summary: entry.episode.clone(),
                                audio_path: file_path.clone(),
                                duration: entry.episode.duration,
                            })
                            .await;
                    } else if entry.queue_type == "diarize_only" && has_diarization && !*diarize_busy
                    {
                        // Diarize-only with download done
                        if let Some(tp) = &entry.transcript_path {
                            entry.stage = "diarizing".to_string();
                            entry.stage_started_at = Utc::now();
                            *diarize_busy = true;
                            let hints_path = self
                                .transcripts_path
                                .join(format!("{}_hints.json", episode_id));
                            let _ = diarize_tx
                                .send(DiarizeJob {
                                    episode_id,
                                    audio_path: file_path,
                                    transcript_path: tp.clone(),
                                    hints_path: if hints_path.exists() {
                                        Some(hints_path)
                                    } else {
                                        None
                                    },
                                })
                                .await;
                        }
                    }
                    // Otherwise it stays as "downloaded" and will be picked up later
                }
            }
            Err(e) => {
                log::error!("Download failed for episode {}: {}", episode_id, e);
                if let Err(db_err) = self.db.mark_failed(episode_id, &format!("Download failed: {}", e)) {
                    log::error!("Failed to mark episode as failed: {}", db_err);
                }
                if let Err(log_err) = self.db.log_pipeline_error("download", Some(episode_id), "DownloadFailed", &e, 0) {
                    log::warn!("Failed to log pipeline error: {}", log_err);
                }
                active.remove(&episode_id);
                let _ = app_handle.emit("queue_update", ());
            }
        }
    }

    async fn handle_transcribe_complete(
        &self,
        result: TranscribeResult,
        active: &mut HashMap<i64, PipelineEntry>,
        has_diarization: bool,
        diarize_busy: &mut bool,
        diarize_tx: &mpsc::Sender<DiarizeJob>,
        app_handle: &tauri::AppHandle,
    ) {
        let episode_id = result.episode_id;

        match result.result {
            Ok(transcript_path) => {
                log::info!("Transcription completed for episode {}", episode_id);
                // Save transcribe duration to DB and entry
                if let Some(dur) = result.duration_seconds {
                    if let Err(e) = self.db.update_transcribe_duration(episode_id, dur) {
                        log::warn!("Failed to save transcribe duration: {}", e);
                    }
                    if let Some(entry) = active.get_mut(&episode_id) {
                        entry.transcribe_duration = result.duration_seconds;
                    }
                }

                if has_diarization && !*diarize_busy {
                    // Send to diarization
                    if let Some(entry) = active.get_mut(&episode_id) {
                        entry.transcript_path = Some(transcript_path.clone());
                        entry.stage = "diarizing".to_string();
                        entry.stage_started_at = Utc::now();

                        let hints_path = self
                            .transcripts_path
                            .join(format!("{}_hints.json", episode_id));

                        *diarize_busy = true;
                        let _ = diarize_tx
                            .send(DiarizeJob {
                                episode_id,
                                audio_path: entry.audio_path.clone().unwrap_or_default(),
                                transcript_path: transcript_path.clone(),
                                hints_path: if hints_path.exists() {
                                    Some(hints_path)
                                } else {
                                    None
                                },
                            })
                            .await;
                    }
                } else if has_diarization {
                    // Diarize slot is busy; mark as waiting
                    if let Some(entry) = active.get_mut(&episode_id) {
                        entry.transcript_path = Some(transcript_path);
                        entry.stage = "waiting_diarize".to_string();
                    }
                } else {
                    // No diarization — mark as completed
                    self.finish_episode(episode_id, &transcript_path, active, app_handle)
                        .await;
                }
            }
            Err(e) => {
                log::error!("Transcription failed for episode {}: {}", episode_id, e);
                if let Err(db_err) = self.db.mark_failed(episode_id, &e) {
                    log::error!("Failed to mark episode as failed: {}", db_err);
                }
                if let Err(log_err) = self.db.log_pipeline_error("transcribe", Some(episode_id), "TranscribeFailed", &e, 0) {
                    log::warn!("Failed to log pipeline error: {}", log_err);
                }
                active.remove(&episode_id);
                let _ = app_handle.emit("transcription_failed", (episode_id, e));
                let _ = app_handle.emit("queue_update", ());
            }
        }
    }

    async fn handle_diarize_complete(
        &self,
        result: DiarizeResult,
        active: &mut HashMap<i64, PipelineEntry>,
        app_handle: &tauri::AppHandle,
    ) {
        let episode_id = result.episode_id;

        match result.result {
            Ok(num_speakers) => {
                log::info!(
                    "Diarization completed for episode {}: {} speakers",
                    episode_id,
                    num_speakers
                );
                // Save diarize duration to DB
                if let Some(dur) = result.duration_seconds {
                    if let Err(e) = self.db.update_diarize_duration(episode_id, dur) {
                        log::warn!("Failed to save diarize duration: {}", e);
                    }
                }
                if num_speakers > 0 {
                    if let Err(e) = self.db.update_diarization(episode_id, num_speakers) {
                        log::error!("Failed to update diarization status: {}", e);
                    }
                }

                // Mark speaker-correction flags as resolved — they've been applied
                match self.db.resolve_speaker_flags_for_episode(episode_id) {
                    Ok(0) => {}
                    Ok(n) => log::info!("Resolved {} speaker-correction flags for episode {}", n, episode_id),
                    Err(e) => log::warn!("Failed to resolve speaker flags for episode {}: {}", episode_id, e),
                }

                // Get transcript path from entry
                let transcript_path = active
                    .get(&episode_id)
                    .and_then(|e| e.transcript_path.clone());

                if let Some(tp) = transcript_path {
                    self.finish_episode(episode_id, &tp, active, app_handle)
                        .await;
                } else {
                    // Shouldn't happen, but clean up
                    active.remove(&episode_id);
                }
            }
            Err(e) => {
                log::warn!("Diarization failed for episode {} (completing anyway): {}", episode_id, e);
                if let Err(log_err) = self.db.log_pipeline_error("diarize", Some(episode_id), "DiarizeFailed", &e, 0) {
                    log::warn!("Failed to log pipeline error: {}", log_err);
                }

                // Still complete the episode — diarization failure is non-fatal
                let transcript_path = active
                    .get(&episode_id)
                    .and_then(|e| e.transcript_path.clone());

                if let Some(tp) = transcript_path {
                    self.finish_episode(episode_id, &tp, active, app_handle)
                        .await;
                } else {
                    active.remove(&episode_id);
                }
            }
        }

        // Check if any entries are waiting for diarize slot
        // (will be picked up in next try_fill_slots cycle via the scheduler loop)
    }

    async fn finish_episode(
        &self,
        episode_id: i64,
        transcript_path: &PathBuf,
        active: &mut HashMap<i64, PipelineEntry>,
        app_handle: &tauri::AppHandle,
    ) {
        // Save total pipeline processing time
        if let Some(entry) = active.get(&episode_id) {
            let total_seconds = entry.entered_pipeline_at.elapsed().as_secs_f64();
            if let Err(e) = self.db.update_pipeline_duration(episode_id, total_seconds) {
                log::warn!("Failed to save pipeline duration: {}", e);
            }
            log::info!(
                "Episode {} total pipeline time: {:.1}s (download: {:?}s, transcribe: {:?}s)",
                episode_id,
                total_seconds,
                entry.download_duration,
                entry.transcribe_duration,
            );
        }

        if let Err(e) = self.db.mark_completed(episode_id, transcript_path.to_str()) {
            log::error!("Failed to mark episode as completed: {}", e);
        }

        // Mark any prior errors for this episode as resolved
        if let Err(e) = self.db.mark_pipeline_errors_resolved(episode_id) {
            log::warn!("Failed to mark pipeline errors resolved for episode {}: {}", episode_id, e);
        }

        // Auto-index FTS5 with speaker names resolved (non-fatal)
        match self.db.index_episode_from_file(episode_id) {
            Ok(0) => log::debug!("FTS index skipped for episode {} (no segments found)", episode_id),
            Ok(n) => log::info!("FTS auto-indexed {} segments for episode {}", n, episode_id),
            Err(e) => log::warn!("FTS auto-index failed for episode {}: {}", episode_id, e),
        }

        {
            let mut ws = self.state.write().await;
            ws.processed_today += 1;
            ws.last_activity = Some(Utc::now());
        }

        active.remove(&episode_id);
        let _ = app_handle.emit("transcription_complete", episode_id);
        let _ = app_handle.emit("queue_update", ());
        let _ = app_handle.emit("stats_update", ());
    }

    /// Sync the active pipeline entries to the shared WorkerState
    /// Preserves progress and estimated_remaining from existing slots
    async fn sync_state(&self, active: &HashMap<i64, PipelineEntry>) {
        let mut ws = self.state.write().await;
        // Build a lookup of existing slot progress to preserve it
        let existing: HashMap<i64, (Option<i32>, Option<i64>)> = ws
            .slots
            .iter()
            .map(|s| (s.episode.id, (s.progress, s.estimated_remaining)))
            .collect();

        ws.slots = active
            .values()
            .filter(|e| e.stage != "downloaded" && e.stage != "waiting_diarize")
            .map(|e| {
                let (progress, estimated_remaining) = existing
                    .get(&e.episode.id)
                    .copied()
                    .unwrap_or((None, None));
                PipelineSlot {
                    episode: e.episode.clone(),
                    stage: e.stage.clone(),
                    progress,
                    estimated_remaining,
                    started_at: e.stage_started_at,
                }
            })
            .collect();
    }

    /// Check auto-transcribe setting and add episodes if enabled
    async fn check_auto_transcribe(&self, app_handle: &tauri::AppHandle) {
        let auto_transcribe = self
            .db
            .get_setting("auto_transcribe")
            .unwrap_or(None)
            .map(|v| v == "true")
            .unwrap_or(false);

        if auto_transcribe {
            if let Ok(Some(episode)) = self.db.get_next_untranscribed_episode() {
                log::info!(
                    "Auto-transcribe: adding episode {} to queue",
                    episode.title
                );
                if let Err(e) = self.db.add_to_queue(episode.id, 0) {
                    log::error!("Failed to auto-add episode to queue: {}", e);
                } else {
                    let _ = app_handle.emit("queue_update", ());
                }
            }
        }
    }
}

/// Events sent from task workers back to the scheduler
enum PipelineEvent {
    DownloadComplete(DownloadResult),
    TranscribeComplete(TranscribeResult),
    DiarizeComplete(DiarizeResult),
}
