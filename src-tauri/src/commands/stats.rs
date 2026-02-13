use crate::database::{AppStats, Database, PipelineStatsResponse};
use std::sync::Arc;
use tauri::State;

/// GET /api/v2/stats -> get_stats command
#[tauri::command]
pub async fn get_stats(db: State<'_, Arc<Database>>) -> Result<AppStats, String> {
    db.get_stats().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_pipeline_stats(
    db: State<'_, Arc<Database>>,
    limit: Option<i64>,
) -> Result<PipelineStatsResponse, String> {
    let timing = db.get_pipeline_timing_stats().map_err(|e| e.to_string())?;
    let recent = db
        .get_recently_completed_episodes(limit.unwrap_or(20))
        .map_err(|e| e.to_string())?;
    Ok(PipelineStatsResponse { timing, recent })
}
