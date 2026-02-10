mod commands;
mod database;
mod ollama;
mod worker;

use commands::ErrorLog;
use database::Database;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;
use worker::{TranscriptionWorker, WorkerState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Setup logging
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Get paths
            let home_dir = dirs::home_dir().expect("Failed to get home directory");
            let project_dir = home_dir
                .join("Desktop")
                .join("Projects")
                .join("ice-cream-social-app");

            // Initialize database
            let db_path = project_dir.join("data").join("ice_cream_social.db");

            // Ensure data directory exists
            std::fs::create_dir_all(db_path.parent().unwrap()).ok();

            let db = Database::new(&db_path).expect("Failed to initialize database");
            let db = Arc::new(db);

            // Initialize worker state
            let worker_state = Arc::new(RwLock::new(WorkerState::default()));

            // Initialize error log for diagnostics
            let error_log = Arc::new(ErrorLog::new(100)); // Keep last 100 errors

            // Store state
            app.manage(db.clone());
            app.manage(worker_state.clone());
            app.manage(error_log);

            // Start background worker
            let whisper_cli_path = home_dir
                .join("bin")
                .join("whisper-cpp")
                .join("whisper.cpp")
                .join("build")
                .join("bin")
                .join("whisper-cli");

            let models_path = home_dir
                .join("bin")
                .join("whisper-cpp")
                .join("whisper.cpp")
                .join("models");

            let transcripts_path = project_dir.join("scripts").join("transcripts");
            let episodes_path = project_dir.join("scripts").join("episodes");

            // Ensure directories exist
            std::fs::create_dir_all(&transcripts_path).ok();
            std::fs::create_dir_all(&episodes_path).ok();

            // Diarization paths
            let venv_python_path = project_dir.join("venv").join("bin").join("python");
            let diarization_script_path = project_dir.join("scripts").join("speaker_diarization.py");

            // Load HuggingFace token from config (optional)
            let huggingface_token = load_huggingface_token(&project_dir);

            let worker = TranscriptionWorker::new(
                db.clone(),
                worker_state.clone(),
                whisper_cli_path,
                models_path,
                transcripts_path,
                episodes_path,
                venv_python_path,
                diarization_script_path,
                huggingface_token,
            );

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                worker.run(app_handle).await;
            });

            log::info!("Ice Cream Social app initialized");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Episodes commands
            commands::get_episodes,
            commands::get_episode,
            commands::get_feed_sources,
            commands::refresh_feed,
            commands::get_transcript,
            commands::download_episode,
            commands::update_speaker_names,
            commands::save_transcript_edits,
            commands::get_audio_path,
            commands::retry_diarization,
            commands::reprocess_diarization,
            commands::save_voice_samples,
            commands::analyze_episode_content,
            // Queue commands
            commands::get_queue,
            commands::get_queue_status,
            commands::add_to_queue,
            commands::remove_from_queue,
            commands::retry_transcription,
            // Stats commands
            commands::get_stats,
            // Worker commands
            commands::get_worker_status,
            commands::stop_current_transcription,
            // Diagnostics commands
            commands::get_diagnostics,
            commands::clear_errors,
            // Settings commands
            commands::get_setting,
            commands::set_setting,
            commands::get_all_settings,
            // Speakers commands
            commands::get_speakers,
            commands::create_speaker,
            commands::update_speaker,
            commands::delete_speaker,
            commands::get_speaker_stats,
            commands::link_episode_speaker,
            commands::get_voice_library,
            commands::get_voice_sample_path,
            // Content commands (chapters, characters, sponsors)
            commands::get_chapter_types,
            commands::create_chapter_type,
            commands::get_episode_chapters,
            commands::create_episode_chapter,
            commands::delete_episode_chapter,
            commands::get_characters,
            commands::create_character,
            commands::update_character,
            commands::delete_character,
            commands::add_character_appearance,
            commands::get_sponsors,
            commands::create_sponsor,
            commands::update_sponsor,
            commands::delete_sponsor,
            commands::add_sponsor_mention,
            // Search commands
            commands::search_transcripts,
            commands::get_search_stats,
            commands::index_episode_transcript,
            commands::index_all_transcripts,
            // Detected content commands
            commands::get_detected_content,
            commands::get_detected_content_by_type,
            commands::add_detected_content,
            // Flagged segments commands (review workflow)
            commands::create_flagged_segment,
            commands::get_flagged_segments,
            commands::update_flagged_segment,
            commands::delete_flagged_segment,
            commands::get_unresolved_flag_count,
            // Character appearances commands
            commands::get_character_appearances_for_episode,
            commands::delete_character_appearance,
            // Audio drops commands
            commands::get_audio_drops,
            commands::create_audio_drop,
            commands::delete_audio_drop,
            commands::add_audio_drop_instance,
            commands::get_audio_drop_instances,
            commands::delete_audio_drop_instance,
            // Extraction commands (Ollama/LLM)
            commands::get_ollama_status,
            commands::get_extraction_prompts,
            commands::get_extraction_prompt,
            commands::create_extraction_prompt,
            commands::update_extraction_prompt,
            commands::delete_extraction_prompt,
            commands::run_extraction,
            commands::test_extraction_prompt,
            commands::get_extraction_runs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Load HuggingFace token from .env file (preferred) or config.yaml (fallback)
fn load_huggingface_token(project_dir: &std::path::Path) -> Option<String> {
    // First try .env file (preferred for secrets)
    let env_path = project_dir.join(".env");
    if let Ok(content) = std::fs::read_to_string(&env_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("HUGGINGFACE_TOKEN=") {
                let value = trimmed
                    .trim_start_matches("HUGGINGFACE_TOKEN=")
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'');

                if !value.is_empty() && value.starts_with("hf_") {
                    log::info!("HuggingFace token loaded from .env");
                    return Some(value.to_string());
                }
            }
        }
    }

    // Fallback: try config.yaml (deprecated for secrets)
    let config_path = project_dir.join("config.yaml");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("huggingface_token:") {
                let mut value = trimmed
                    .trim_start_matches("huggingface_token:")
                    .trim();

                // Remove inline comments
                if let Some(comment_pos) = value.find('#') {
                    value = value[..comment_pos].trim();
                }

                let value = value.trim_matches('"').trim_matches('\'');

                if !value.is_empty() && value.starts_with("hf_") {
                    log::warn!("HuggingFace token loaded from config.yaml - consider moving to .env");
                    return Some(value.to_string());
                }
            }
        }
    }

    log::info!("No HuggingFace token configured - diarization disabled");
    None
}
