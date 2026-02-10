use crate::database::Database;
use std::sync::Arc;
use tauri::State;

/// Get a setting value
#[tauri::command]
pub async fn get_setting(
    db: State<'_, Arc<Database>>,
    key: String,
) -> Result<Option<String>, String> {
    db.get_setting(&key).map_err(|e| e.to_string())
}

/// Set a setting value
#[tauri::command]
pub async fn set_setting(
    db: State<'_, Arc<Database>>,
    key: String,
    value: String,
) -> Result<(), String> {
    log::info!("Setting {} = {}", key, value);
    db.set_setting(&key, &value).map_err(|e| e.to_string())
}

/// Get all settings
#[tauri::command]
pub async fn get_all_settings(
    db: State<'_, Arc<Database>>,
) -> Result<std::collections::HashMap<String, String>, String> {
    db.get_all_settings().map_err(|e| e.to_string())
}
