use crate::error::AppError;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tauri::State;

/// Global error log - stores recent errors for diagnostics
#[allow(dead_code)]
pub struct ErrorLog {
    errors: Mutex<VecDeque<ErrorEntry>>,
    max_entries: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorEntry {
    pub timestamp: String,
    pub command: String,
    pub error: String,
    pub context: Option<String>,
}

impl ErrorLog {
    pub fn new(max_entries: usize) -> Self {
        Self {
            errors: Mutex::new(VecDeque::new()),
            max_entries,
        }
    }

    #[allow(dead_code)]
    pub fn log_error(&self, command: &str, error: &str, context: Option<&str>) {
        let entry = ErrorEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            command: command.to_string(),
            error: error.to_string(),
            context: context.map(|s| s.to_string()),
        };

        log::error!("[{}] {}: {}", entry.timestamp, command, error);

        let mut errors = self.errors.lock().unwrap();
        if errors.len() >= self.max_entries {
            errors.pop_front();
        }
        errors.push_back(entry);
    }

    pub fn get_errors(&self) -> Vec<ErrorEntry> {
        self.errors.lock().unwrap().iter().cloned().collect()
    }

    pub fn clear(&self) {
        self.errors.lock().unwrap().clear();
    }
}

#[derive(Debug, Serialize)]
pub struct DiagnosticsReport {
    pub app_version: String,
    pub database_status: String,
    pub database_path: String,
    pub episode_count: i64,
    pub transcribed_count: i64,
    pub queue_count: i64,
    pub worker_status: String,
    pub recent_errors: Vec<ErrorEntry>,
    pub config_status: String,
    pub whisper_cli_exists: bool,
    pub model_exists: bool,
}

/// Get diagnostics report including recent errors
#[tauri::command]
pub async fn get_diagnostics(
    error_log: State<'_, Arc<ErrorLog>>,
) -> Result<DiagnosticsReport, AppError> {
    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let project_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app");

    // Check database
    let db_path = project_dir.join("data").join("ice_cream_social.db");
    let db_status = if db_path.exists() { "OK" } else { "NOT FOUND" };

    // Get counts from database
    let (episode_count, transcribed_count, queue_count) = if db_path.exists() {
        match rusqlite::Connection::open(&db_path) {
            Ok(conn) => {
                let episodes: i64 = conn
                    .query_row("SELECT COUNT(*) FROM episodes", [], |r| r.get(0))
                    .unwrap_or(0);
                let transcribed: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM episodes WHERE is_transcribed = 1",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                let queue: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM transcription_queue WHERE status = 'pending'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                (episodes, transcribed, queue)
            }
            Err(_) => (0, 0, 0),
        }
    } else {
        (0, 0, 0)
    };

    // Check config
    let config_path = project_dir.join("config.yaml");
    let config_status = if config_path.exists() { "OK" } else { "NOT FOUND" };

    // Check whisper-cli
    let whisper_cli_path = home_dir
        .join("bin")
        .join("whisper-cpp")
        .join("whisper.cpp")
        .join("build")
        .join("bin")
        .join("whisper-cli");
    let whisper_cli_exists = whisper_cli_path.exists();

    // Check model
    let model_path = home_dir
        .join("bin")
        .join("whisper-cpp")
        .join("whisper.cpp")
        .join("models")
        .join("ggml-medium.bin");
    let model_exists = model_path.exists();

    Ok(DiagnosticsReport {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        database_status: db_status.to_string(),
        database_path: db_path.to_string_lossy().to_string(),
        episode_count,
        transcribed_count,
        queue_count,
        worker_status: "Running".to_string(),
        recent_errors: error_log.get_errors(),
        config_status: config_status.to_string(),
        whisper_cli_exists,
        model_exists,
    })
}

/// Clear error log
#[tauri::command]
pub async fn clear_errors(error_log: State<'_, Arc<ErrorLog>>) -> Result<(), AppError> {
    error_log.clear();
    Ok(())
}
