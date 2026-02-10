use crate::database::EpisodeSummary;
use crate::worker::WorkerState;
use serde::Serialize;
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;

#[derive(Debug, Serialize)]
pub struct WorkerStatus {
    pub status: String, // "idle" | "processing"
    pub stage: String,  // "idle" | "transcribing" | "diarizing" | "saving"
    pub current_episode: Option<EpisodeSummary>,
    pub progress: Option<i32>,
    pub elapsed_seconds: Option<i64>,
    pub estimated_remaining_seconds: Option<i64>,
    pub last_activity: Option<String>,
    pub next_check_seconds: Option<i32>,
    pub worker_info: WorkerInfo,
}

#[derive(Debug, Serialize)]
pub struct WorkerInfo {
    pub model: String,
    pub memory_mb: Option<f64>,
    pub memory_percent: Option<f64>,
    pub processed_today: Option<i32>,
}

/// GET /api/v2/worker/status -> get_worker_status command
#[tauri::command]
pub async fn get_worker_status(
    worker_state: State<'_, Arc<RwLock<WorkerState>>>,
) -> Result<WorkerStatus, String> {
    let state = worker_state.read().await;

    let memory_info = get_memory_info();

    Ok(WorkerStatus {
        status: if state.is_processing {
            "processing".to_string()
        } else {
            "idle".to_string()
        },
        stage: state.stage.clone(),
        current_episode: state.current_episode.clone(),
        progress: state.progress,
        elapsed_seconds: state.started_at.map(|t| {
            chrono::Utc::now()
                .signed_duration_since(t)
                .num_seconds()
        }),
        estimated_remaining_seconds: state.estimated_remaining,
        last_activity: state.last_activity.map(|t| t.to_rfc3339()),
        next_check_seconds: Some(10),
        worker_info: WorkerInfo {
            model: state.model.clone(),
            memory_mb: memory_info.0,
            memory_percent: memory_info.1,
            processed_today: Some(state.processed_today),
        },
    })
}

/// POST /api/v2/queue/stop-current -> stop_current_transcription command
#[tauri::command]
pub async fn stop_current_transcription(
    worker_state: State<'_, Arc<RwLock<WorkerState>>>,
) -> Result<(), String> {
    let mut state = worker_state.write().await;
    state.cancel_requested = true;
    Ok(())
}

fn get_memory_info() -> (Option<f64>, Option<f64>) {
    use sysinfo::System;

    let mut sys = System::new();
    sys.refresh_memory();

    let used_mb = sys.used_memory() as f64 / 1024.0 / 1024.0;
    let total_mb = sys.total_memory() as f64 / 1024.0 / 1024.0;
    let percent = if total_mb > 0.0 {
        (used_mb / total_mb) * 100.0
    } else {
        0.0
    };

    (Some(used_mb), Some(percent))
}
