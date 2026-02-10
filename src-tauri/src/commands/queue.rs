use crate::database::{Database, QueueItemWithEpisode};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct QueueResponse {
    pub queue: QueueData,
}

#[derive(Debug, Serialize)]
pub struct QueueData {
    pub pending: Vec<QueueItemWithEpisode>,
    pub processing: Vec<QueueItemWithEpisode>,
    pub completed: Vec<QueueItemWithEpisode>,
    pub failed: Vec<QueueItemWithEpisode>,
}

#[derive(Debug, Serialize)]
pub struct QueueStatus {
    pub pending: i64,
    pub processing: i64,
    pub completed: i64,
    pub failed: i64,
    pub total: i64,
}

/// GET /api/v2/queue -> get_queue command
#[tauri::command]
pub async fn get_queue(db: State<'_, Arc<Database>>) -> Result<QueueResponse, String> {
    let (pending, processing, completed, failed) = db.get_queue().map_err(|e| e.to_string())?;

    Ok(QueueResponse {
        queue: QueueData {
            pending,
            processing,
            completed,
            failed,
        },
    })
}

/// GET /api/v2/queue/status -> get_queue_status command
#[tauri::command]
pub async fn get_queue_status(db: State<'_, Arc<Database>>) -> Result<QueueStatus, String> {
    let (pending, processing, completed, failed) = db.get_queue().map_err(|e| e.to_string())?;

    Ok(QueueStatus {
        pending: pending.len() as i64,
        processing: processing.len() as i64,
        completed: completed.len() as i64,
        failed: failed.len() as i64,
        total: (pending.len() + processing.len() + completed.len() + failed.len()) as i64,
    })
}

/// POST /api/v2/queue/add -> add_to_queue command
#[tauri::command]
pub async fn add_to_queue(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    priority: Option<i32>,
) -> Result<(), String> {
    db.add_to_queue(episode_id, priority.unwrap_or(0))
        .map_err(|e| e.to_string())
}

/// DELETE /api/v2/queue/remove/:id -> remove_from_queue command
#[tauri::command]
pub async fn remove_from_queue(db: State<'_, Arc<Database>>, episode_id: i64) -> Result<(), String> {
    db.remove_from_queue(episode_id).map_err(|e| e.to_string())
}

/// POST /api/v2/queue/retry/:id -> retry_transcription command
#[tauri::command]
pub async fn retry_transcription(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<(), String> {
    // Reset the queue item status to pending
    db.add_to_queue(episode_id, 0).map_err(|e| e.to_string())
}
