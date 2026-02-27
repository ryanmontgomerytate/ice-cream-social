//! LLM extraction commands
//!
//! Commands for managing extraction prompts and running LLM-based content extraction.

use crate::database::{Database, ExtractionPrompt, ExtractionRun};
use crate::error::AppError;
use crate::ollama::OllamaClient;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;
use tauri::State;

// ============================================================================
// Ollama Status
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaStatusResponse {
    pub running: bool,
    pub model: String,
    pub model_available: bool,
    pub available_models: Vec<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn get_ollama_status() -> Result<OllamaStatusResponse, AppError> {
    log::info!("Checking Ollama status");
    let client = OllamaClient::new();

    match client.health_check().await {
        Ok(status) => Ok(OllamaStatusResponse {
            running: status.running,
            model: status.model,
            model_available: status.model_available,
            available_models: status.available_models,
            error: None,
        }),
        Err(e) => Ok(OllamaStatusResponse {
            running: false,
            model: "llama3.2:3b".to_string(),
            model_available: false,
            available_models: vec![],
            error: Some(e),
        }),
    }
}

// ============================================================================
// Extraction Prompts CRUD
// ============================================================================

#[tauri::command]
pub async fn get_extraction_prompts(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<ExtractionPrompt>, AppError> {
    log::info!("Getting extraction prompts");
    db.get_extraction_prompts().map_err(AppError::from)
}

#[tauri::command]
pub async fn get_extraction_prompt(
    db: State<'_, Arc<Database>>,
    prompt_id: i64,
) -> Result<Option<ExtractionPrompt>, AppError> {
    log::info!("Getting extraction prompt: {}", prompt_id);
    db.get_extraction_prompt(prompt_id).map_err(AppError::from)
}

#[tauri::command]
pub async fn create_extraction_prompt(
    db: State<'_, Arc<Database>>,
    name: String,
    description: Option<String>,
    content_type: String,
    prompt_text: String,
    system_prompt: Option<String>,
    output_schema: Option<String>,
) -> Result<i64, AppError> {
    log::info!("Creating extraction prompt: {}", name);
    db.create_extraction_prompt(
        &name,
        description.as_deref(),
        &content_type,
        &prompt_text,
        system_prompt.as_deref(),
        output_schema.as_deref(),
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn update_extraction_prompt(
    db: State<'_, Arc<Database>>,
    prompt_id: i64,
    name: String,
    description: Option<String>,
    content_type: String,
    prompt_text: String,
    system_prompt: Option<String>,
    output_schema: Option<String>,
    is_active: bool,
) -> Result<(), AppError> {
    log::info!("Updating extraction prompt: {}", prompt_id);
    db.update_extraction_prompt(
        prompt_id,
        &name,
        description.as_deref(),
        &content_type,
        &prompt_text,
        system_prompt.as_deref(),
        output_schema.as_deref(),
        is_active,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn delete_extraction_prompt(
    db: State<'_, Arc<Database>>,
    prompt_id: i64,
) -> Result<(), AppError> {
    log::info!("Deleting extraction prompt: {}", prompt_id);
    db.delete_extraction_prompt(prompt_id)
        .map_err(AppError::from)
}

// ============================================================================
// Run Extraction
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionRunResult {
    pub run_id: i64,
    pub status: String,
    pub raw_response: String,
    pub parsed_json: Option<serde_json::Value>,
    pub items_extracted: i32,
    pub duration_ms: i64,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn run_extraction(
    db: State<'_, Arc<Database>>,
    app_handle: tauri::AppHandle,
    prompt_id: i64,
    episode_id: i64,
) -> Result<ExtractionRunResult, AppError> {
    use tauri::Emitter;

    log::info!(
        "Running extraction: prompt={}, episode={}",
        prompt_id,
        episode_id
    );

    // Get the prompt
    let prompt = db
        .get_extraction_prompt(prompt_id)?
        .ok_or("Prompt not found")?;

    // Get the transcript
    let transcript = db
        .get_transcript(episode_id)?
        .ok_or("Transcript not found")?;

    // Limit transcript length to avoid token limits (roughly 4000 words)
    let transcript_text = if transcript.full_text.len() > 20000 {
        format!(
            "{}...\n\n[Transcript truncated]",
            &transcript.full_text[..20000]
        )
    } else {
        transcript.full_text.clone()
    };

    // Create extraction run record
    let run_id = db.create_extraction_run(prompt_id, episode_id, &transcript_text)?;

    // Emit event that extraction started
    let _ = app_handle.emit(
        "extraction_started",
        serde_json::json!({
            "run_id": run_id,
            "prompt_name": prompt.name,
            "episode_id": episode_id,
        }),
    );

    let start = Instant::now();

    // Run the extraction
    let client = OllamaClient::new();
    let result = client
        .extract_content(
            &transcript_text,
            &prompt.prompt_text,
            prompt.system_prompt.as_deref(),
        )
        .await;

    let duration_ms = start.elapsed().as_millis() as i64;

    match result {
        Ok(extraction) => {
            let items_extracted = extraction
                .parsed_json
                .as_ref()
                .map(|j| {
                    if let Some(arr) = j.as_array() {
                        arr.len() as i32
                    } else {
                        1
                    }
                })
                .unwrap_or(0);

            // Update run record
            let parsed_str = extraction.parsed_json.as_ref().map(|j| j.to_string());
            db.complete_extraction_run(
                run_id,
                &extraction.raw_response,
                parsed_str.as_deref(),
                items_extracted,
                duration_ms,
            )?;

            // Emit completion event
            let _ = app_handle.emit(
                "extraction_completed",
                serde_json::json!({
                    "run_id": run_id,
                    "items_extracted": items_extracted,
                    "duration_ms": duration_ms,
                }),
            );

            Ok(ExtractionRunResult {
                run_id,
                status: "completed".to_string(),
                raw_response: extraction.raw_response,
                parsed_json: extraction.parsed_json,
                items_extracted,
                duration_ms,
                error: None,
            })
        }
        Err(e) => {
            // Update run record with failure
            db.fail_extraction_run(run_id, &e, duration_ms)
                .map_err(|err| err.to_string())?;

            // Emit failure event
            let _ = app_handle.emit(
                "extraction_failed",
                serde_json::json!({
                    "run_id": run_id,
                    "error": e,
                }),
            );

            Ok(ExtractionRunResult {
                run_id,
                status: "failed".to_string(),
                raw_response: String::new(),
                parsed_json: None,
                items_extracted: 0,
                duration_ms,
                error: Some(e),
            })
        }
    }
}

/// Test a prompt with sample text (doesn't save to database)
#[tauri::command]
pub async fn test_extraction_prompt(
    prompt_text: String,
    system_prompt: Option<String>,
    sample_text: String,
) -> Result<ExtractionRunResult, AppError> {
    log::info!("Testing extraction prompt");

    let start = Instant::now();
    let client = OllamaClient::new();

    let result = client
        .extract_content(&sample_text, &prompt_text, system_prompt.as_deref())
        .await;

    let duration_ms = start.elapsed().as_millis() as i64;

    match result {
        Ok(extraction) => {
            let items_extracted = extraction
                .parsed_json
                .as_ref()
                .map(|j| {
                    if let Some(arr) = j.as_array() {
                        arr.len() as i32
                    } else {
                        1
                    }
                })
                .unwrap_or(0);

            Ok(ExtractionRunResult {
                run_id: 0,
                status: "completed".to_string(),
                raw_response: extraction.raw_response,
                parsed_json: extraction.parsed_json,
                items_extracted,
                duration_ms,
                error: None,
            })
        }
        Err(e) => Ok(ExtractionRunResult {
            run_id: 0,
            status: "failed".to_string(),
            raw_response: String::new(),
            parsed_json: None,
            items_extracted: 0,
            duration_ms,
            error: Some(e),
        }),
    }
}

// ============================================================================
// Extraction History
// ============================================================================

#[tauri::command]
pub async fn get_extraction_runs(
    db: State<'_, Arc<Database>>,
    episode_id: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<ExtractionRun>, AppError> {
    if let Some(ep_id) = episode_id {
        log::info!("Getting extraction runs for episode: {}", ep_id);
        db.get_extraction_runs_for_episode(ep_id)
            .map_err(AppError::from)
    } else {
        log::info!("Getting recent extraction runs");
        db.get_recent_extraction_runs(limit.unwrap_or(50))
            .map_err(AppError::from)
    }
}
