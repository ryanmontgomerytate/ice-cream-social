mod commands;
mod database;
pub mod error;
mod ollama;
mod worker;

use commands::{CaffeinateProcess, ErrorLog};
use database::Database;
use std::sync::{Arc, Mutex};
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

            // Clean up any variant episodes that were queued before cross-feed linking
            match db.purge_variant_queue_items() {
                Ok(count) if count > 0 => log::info!("Startup cleanup: removed {} variant episodes from queue", count),
                Ok(_) => {},
                Err(e) => log::warn!("Failed to purge variant queue items: {}", e),
            }

            let db = Arc::new(db);

            // Initialize worker state, reading model from DB settings
            let mut initial_worker_state = WorkerState::default();
            if let Ok(Some(model)) = db.get_setting("transcription_model") {
                initial_worker_state.model = model;
            }
            let worker_state = Arc::new(RwLock::new(initial_worker_state));

            // Initialize error log for diagnostics
            let error_log = Arc::new(ErrorLog::new(100)); // Keep last 100 errors

            // Initialize caffeinate holder
            let caffeinate = CaffeinateProcess(Mutex::new(None));

            // Store state
            app.manage(db.clone());
            app.manage(worker_state.clone());
            app.manage(error_log);
            app.manage(caffeinate);

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
            let harvest_script_path = project_dir.join("scripts").join("harvest_voice_samples.py");

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
                harvest_script_path,
                huggingface_token,
            );

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                worker.run(app_handle).await;
            });

            // Spawn daily feed sync scheduler (runs at 1:00 AM)
            let sync_db = db.clone();
            let sync_app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                feed_sync_scheduler(sync_db, sync_app_handle).await;
            });

            // S1: Quality scan agent (every 6 hours)
            let db_s1 = db.clone();
            let ah_s1 = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                worker::subagents::quality_scan_agent(db_s1, ah_s1).await;
            });

            // S2: Extraction coordinator agent (every 2 hours)
            let db_s2 = db.clone();
            let ah_s2 = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                worker::subagents::extraction_coordinator_agent(db_s2, ah_s2).await;
            });

            // S3: Wiki sync agent (daily at 3:00 AM)
            let db_s3 = db.clone();
            let ah_s3 = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                worker::subagents::wiki_sync_agent(db_s3, ah_s3).await;
            });

            // S4: Hints prefetch agent (every 1 hour)
            let db_s4 = db.clone();
            let ah_s4 = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                worker::subagents::hints_prefetch_agent(db_s4, ah_s4).await;
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
            // Category commands
            commands::get_category_rules,
            commands::add_category_rule,
            commands::update_category_rule,
            commands::delete_category_rule,
            commands::test_category_rule,
            commands::recategorize_all_episodes,
            commands::link_cross_feed_episodes,
            commands::get_episode_variants,
            // Queue commands
            commands::get_queue,
            commands::get_queue_status,
            commands::add_to_queue,
            commands::remove_from_queue,
            commands::retry_transcription,
            // Stats commands
            commands::get_stats,
            commands::get_pipeline_stats,
            commands::get_pipeline_health,
            commands::get_recent_errors,
            commands::get_queue_episode_lists,
            // Worker commands
            commands::get_worker_status,
            commands::stop_current_transcription,
            commands::set_prevent_sleep,
            commands::get_prevent_sleep,
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
            commands::link_episode_audio_drop,
            commands::unlink_episode_speaker,
            commands::get_episode_speaker_assignments,
            commands::get_voice_library,
            commands::get_embedding_model,
            commands::set_embedding_model,
            commands::compare_embedding_backends,
            commands::get_voice_sample_path,
            commands::get_voice_samples,
            commands::delete_voice_sample,
            commands::delete_voice_print,
            commands::purge_voice_library_entry,
            commands::rebuild_voice_print_for_speaker,
            commands::update_voice_sample_rating,
            commands::rebuild_voice_library,
            commands::run_voice_harvest,
            commands::extract_voice_sample_from_segment,
            // Content commands (chapters, characters, sponsors)
            commands::get_chapter_types,
            commands::create_chapter_type,
            commands::get_episode_chapters,
            commands::create_episode_chapter,
            commands::delete_episode_chapter,
            commands::export_sponsor_clip,
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
            commands::reindex_all_with_speakers,
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
            commands::get_character_appearances_for_character,
            commands::delete_character_appearance,
            // Audio drops commands
            commands::get_audio_drops,
            commands::create_audio_drop,
            commands::update_audio_drop_transcript,
            commands::delete_audio_drop,
            commands::add_audio_drop_instance,
            commands::get_audio_drop_instances,
            commands::delete_audio_drop_instance,
            // Chapter label rules commands
            commands::get_chapter_label_rules,
            commands::save_chapter_label_rule,
            commands::delete_chapter_label_rule,
            commands::auto_label_chapters,
            commands::run_ai_chapter_detection,
            // Wiki lore commands
            commands::sync_wiki_episode,
            commands::get_wiki_episode_meta,
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
            // Qwen segment classification commands
            commands::run_qwen_classification,
            commands::get_segment_classifications,
            commands::approve_segment_classification,
            commands::reject_segment_classification,
            // Scoop Polish commands (transcript correction + multi-speaker detection)
            commands::run_qwen_polish,
            commands::get_transcript_corrections,
            commands::approve_transcript_correction,
            commands::reject_transcript_correction,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Load a value from the .env file by key name
pub fn load_env_value(project_dir: &std::path::Path, key: &str) -> Option<String> {
    let env_path = project_dir.join(".env");
    let prefix = format!("{}=", key);
    if let Ok(content) = std::fs::read_to_string(&env_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with(&prefix) {
                let value = trimmed[prefix.len()..]
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'');
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

/// Daily feed sync scheduler — syncs all feeds at 1:00 AM local time
async fn feed_sync_scheduler(db: Arc<Database>, app_handle: tauri::AppHandle) {
    use chrono::Local;
    use tauri::Emitter;

    log::info!("Feed sync scheduler started (daily at 1:00 AM)");

    loop {
        // Calculate time until next 1:00 AM
        let now = Local::now();
        let target_hour = 1u32;
        let today_target = now
            .date_naive()
            .and_hms_opt(target_hour, 0, 0)
            .unwrap();

        let next_run = if now.naive_local() < today_target {
            today_target
        } else {
            // Already past 1 AM today, schedule for tomorrow
            today_target + chrono::Duration::days(1)
        };

        let wait_duration = (next_run - now.naive_local())
            .to_std()
            .unwrap_or(std::time::Duration::from_secs(3600));

        log::info!(
            "Next feed sync scheduled for {} (in {:.1} hours)",
            next_run.format("%Y-%m-%d %H:%M"),
            wait_duration.as_secs_f64() / 3600.0
        );

        tokio::time::sleep(wait_duration).await;

        log::info!("Running scheduled feed sync...");

        for source in &["patreon", "apple"] {
            match commands::sync_feed(&db, source).await {
                Ok(result) => {
                    log::info!(
                        "Scheduled sync [{}]: {} added, {} updated",
                        source,
                        result.added,
                        result.updated
                    );
                    if result.added > 0 {
                        let _ = app_handle.emit("stats_update", ());
                    }
                }
                Err(e) => {
                    log::error!("Scheduled sync [{}] failed: {}", source, e);
                }
            }
        }

        let _ = app_handle.emit("stats_update", ());
    }
}

/// Load HuggingFace token from .env file (preferred) or config.yaml (fallback)
fn load_huggingface_token(project_dir: &std::path::Path) -> Option<String> {
    // Try HF_TOKEN first, then HUGGINGFACE_TOKEN
    if let Some(token) = load_env_value(project_dir, "HF_TOKEN") {
        if token.starts_with("hf_") {
            log::info!("HuggingFace token loaded from .env (HF_TOKEN)");
            return Some(token);
        }
    }
    if let Some(token) = load_env_value(project_dir, "HUGGINGFACE_TOKEN") {
        if token.starts_with("hf_") {
            log::info!("HuggingFace token loaded from .env (HUGGINGFACE_TOKEN)");
            return Some(token);
        }
    }

    log::info!("No HuggingFace token configured - diarization disabled");
    None
}
