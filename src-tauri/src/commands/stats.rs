use crate::database::models::{PipelineError, PipelineHealth};
use crate::database::{AppStats, Database, PipelineStatsResponse};
use crate::error::AppError;
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
