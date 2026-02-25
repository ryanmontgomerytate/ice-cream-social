use crate::database::models::{PipelineError, PipelineHealth};
use crate::database::{AppStats, Database, PipelineStatsResponse};
use crate::error::AppError;
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

/// GET /api/v2/stats -> get_stats command
#[tauri::command]
pub async fn get_stats(db: State<'_, Arc<Database>>) -> Result<AppStats, AppError> {
    db.get_stats().map_err(AppError::from)
}

#[tauri::command]
pub async fn get_pipeline_stats(
    db: State<'_, Arc<Database>>,
    limit: Option<i64>,
) -> Result<PipelineStatsResponse, AppError> {
    let timing = db.get_pipeline_timing_stats()?;
    let recent = db.get_recently_completed_episodes(limit.unwrap_or(20))?;
    Ok(PipelineStatsResponse { timing, recent })
}

#[tauri::command]
pub async fn get_pipeline_health(
    db: State<'_, Arc<Database>>,
) -> Result<PipelineHealth, AppError> {
    db.get_pipeline_health_stats().map_err(AppError::from)
}

#[tauri::command]
pub async fn get_recent_errors(
    db: State<'_, Arc<Database>>,
    limit: Option<i64>,
) -> Result<Vec<PipelineError>, AppError> {
    db.get_recent_pipeline_errors(limit.unwrap_or(20))
        .map_err(AppError::from)
}

#[derive(Debug, Serialize)]
pub struct QueueEpisodeItem {
    pub id: i64,
    pub title: String,
    pub episode_number: Option<i64>,
    pub added_date: String,
    pub is_downloaded: bool,
    pub embedding_backend_override: Option<String>,
    pub priority: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct QueueEpisodeLists {
    pub transcribe: Vec<QueueEpisodeItem>,
    pub diarize: Vec<QueueEpisodeItem>,
}

#[tauri::command]
pub async fn get_queue_episode_lists(
    db: State<'_, Arc<Database>>,
) -> Result<QueueEpisodeLists, AppError> {
    let (transcribe, diarize) = db.get_queue_episode_lists().map_err(AppError::from)?;
    Ok(QueueEpisodeLists {
        transcribe: transcribe.into_iter().map(|(id, title, episode_number, added_date, is_downloaded)| {
            QueueEpisodeItem {
                id,
                title,
                episode_number,
                added_date,
                is_downloaded,
                embedding_backend_override: None,
                priority: None,
            }
        }).collect(),
        diarize: diarize.into_iter().map(|(id, title, episode_number, added_date, embedding_backend_override, priority)| {
            QueueEpisodeItem {
                id,
                title,
                episode_number,
                added_date,
                is_downloaded: true,
                embedding_backend_override,
                priority: Some(priority),
            }
        }).collect(),
    })
}
