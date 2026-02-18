use thiserror::Error;

/// Typed application error hierarchy for all Tauri IPC commands.
///
/// Serializes as a plain string (backward-compatible with the frontend's
/// `error.message` convention) while giving Rust code typed variants
/// that can be matched or propagated with `?`.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Database(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("{0}")]
    Io(String),

    #[error("{0}")]
    Json(String),

    #[error("{0}")]
    Other(String),
}

/// Serialize as a plain string so the Tauri frontend receives the same
/// `"error message"` string it already expects — no breaking change.
impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

// ── From impls ─────────────────────────────────────────────────────────────

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Database(e.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Database(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Json(e.to_string())
    }
}

/// Allows `.map_err(|e| format!("…", e))?` and `ok_or_else(|| format!(…))?`
/// to coerce into AppError without changing the call sites.
impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Other(s)
    }
}

/// Allows `.ok_or("literal string")?` to coerce into AppError.
impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Other(s.to_string())
    }
}
