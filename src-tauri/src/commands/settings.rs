use crate::database::Database;
use crate::error::AppError;
use std::sync::Arc;
use tauri::State;

/// Get a setting value
#[tauri::command]
pub async fn get_setting(
    db: State<'_, Arc<Database>>,
    key: String,
) -> Result<Option<String>, AppError> {
    db.get_setting(&key).map_err(AppError::from)
}

/// Set a setting value
#[tauri::command]
pub async fn set_setting(
    db: State<'_, Arc<Database>>,
    key: String,
    value: String,
) -> Result<(), AppError> {
    log::info!("Setting {} = {}", key, value);
    db.set_setting(&key, &value).map_err(AppError::from)
}

/// Get all settings
#[tauri::command]
pub async fn get_all_settings(
    db: State<'_, Arc<Database>>,
) -> Result<std::collections::HashMap<String, String>, AppError> {
    db.get_all_settings().map_err(AppError::from)
}
