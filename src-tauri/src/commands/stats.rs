use crate::database::{AppStats, Database};
use std::sync::Arc;
use tauri::State;

/// GET /api/v2/stats -> get_stats command
#[tauri::command]
pub async fn get_stats(db: State<'_, Arc<Database>>) -> Result<AppStats, String> {
    db.get_stats().map_err(|e| e.to_string())
}
