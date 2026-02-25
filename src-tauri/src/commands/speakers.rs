use crate::database::{Database, Speaker, SpeakerStats, EpisodeSpeakerAssignment};
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, State};

const EMBEDDING_BACKEND_ECAPA: &str = "ecapa-tdnn";
const EMBEDDING_BACKEND_PYANNOTE: &str = "pyannote";
const HF_HUB_OFFLINE_SETTING: &str = "hf_hub_offline";

fn normalize_embedding_backend(raw: Option<String>) -> String {
    match raw.as_deref() {
        Some(EMBEDDING_BACKEND_ECAPA) => EMBEDDING_BACKEND_ECAPA.to_string(),
        Some(EMBEDDING_BACKEND_PYANNOTE) => EMBEDDING_BACKEND_PYANNOTE.to_string(),
        _ => EMBEDDING_BACKEND_PYANNOTE.to_string(),
    }
}

fn configured_embedding_backend(db: &Arc<Database>) -> String {
    normalize_embedding_backend(db.get_setting("embedding_model").unwrap_or(None))
}

fn hf_hub_offline_enabled(db: &Arc<Database>) -> bool {
    db.get_setting(HF_HUB_OFFLINE_SETTING)
        .ok()
        .flatten()
        .map(|v| v == "true")
        .unwrap_or(false)
}

fn should_force_hf_offline(db: &Arc<Database>, force_offline: bool) -> bool {
    force_offline || hf_hub_offline_enabled(db)
}

fn apply_hf_runtime_env_std(
    cmd: &mut std::process::Command,
    db: &Arc<Database>,
    force_offline: bool,
) {
    cmd.env("HF_HUB_DISABLE_TELEMETRY", "1");
    if should_force_hf_offline(db, force_offline) {
        cmd.env("HF_HUB_OFFLINE", "1");
        cmd.env("TRANSFORMERS_OFFLINE", "1");
    }
}

fn apply_hf_runtime_env_tokio(
    cmd: &mut tokio::process::Command,
    db: &Arc<Database>,
    force_offline: bool,
) {
    cmd.env("HF_HUB_DISABLE_TELEMETRY", "1");
    if should_force_hf_offline(db, force_offline) {
        cmd.env("HF_HUB_OFFLINE", "1");
        cmd.env("TRANSFORMERS_OFFLINE", "1");
    }
}

fn looks_like_hf_network_failure(raw: &str) -> bool {
    let text = raw.to_lowercase();
    text.contains("huggingface.co")
        && (text.contains("failed to resolve")
            || text.contains("name or service not known")
            || text.contains("temporary failure in name resolution")
            || text.contains("dns")
            || text.contains("connection timed out")
            || text.contains("read timed out")
            || text.contains("max retries exceeded")
            || text.contains("proxyerror")
            || text.contains("connection error"))
}

fn parse_episode_date_for_voice(iso: Option<String>) -> Option<String> {
    iso.map(|s| s.chars().take(10).collect::<String>())
        .filter(|s| s.len() == 10)
}

/// Get all speakers
#[tauri::command]
pub async fn get_speakers(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Speaker>, AppError> {
    db.get_speakers().map_err(AppError::from)
}

/// Create a new speaker
#[tauri::command]
pub async fn create_speaker(
    db: State<'_, Arc<Database>>,
    name: String,
    short_name: Option<String>,
    is_host: bool,
    is_guest: Option<bool>,
    is_scoop: Option<bool>,
) -> Result<i64, AppError> {
    log::info!("Creating speaker: {} (short: {:?}, host: {})", name, short_name, is_host);
    db.create_speaker(&name, short_name.as_deref(), is_host, is_guest.unwrap_or(false), is_scoop.unwrap_or(false))
        .map_err(AppError::from)
}

/// Update a speaker
#[tauri::command]
pub async fn update_speaker(
    db: State<'_, Arc<Database>>,
    id: i64,
    name: String,
    short_name: Option<String>,
    is_host: bool,
    is_guest: Option<bool>,
    is_scoop: Option<bool>,
) -> Result<(), AppError> {
    log::info!("Updating speaker {}: {} (short: {:?}, host: {})", id, name, short_name, is_host);
    db.update_speaker(id, &name, short_name.as_deref(), is_host, is_guest.unwrap_or(false), is_scoop.unwrap_or(false))
        .map_err(AppError::from)
}

/// Delete a speaker
#[tauri::command]
pub async fn delete_speaker(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), AppError> {
    log::info!("Deleting speaker {}", id);
    db.delete_speaker(id).map_err(AppError::from)
}

/// Get speaker statistics
#[tauri::command]
pub async fn get_speaker_stats(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<SpeakerStats>, AppError> {
    db.get_speaker_stats().map_err(AppError::from)
}

/// Link a diarization label to a known speaker for an episode
#[tauri::command]
pub async fn link_episode_speaker(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    diarization_label: String,
    speaker_id: i64,
) -> Result<(), AppError> {
    log::info!("Linking episode {} speaker {} to speaker_id {}", episode_id, diarization_label, speaker_id);
    db.link_episode_speaker(episode_id, &diarization_label, speaker_id)
        .map_err(AppError::from)
}

/// Link a diarization label to an audio drop for an episode
#[tauri::command]
pub async fn link_episode_audio_drop(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    diarization_label: String,
    audio_drop_id: i64,
) -> Result<(), AppError> {
    log::info!("Linking episode {} label {} to audio_drop_id {}", episode_id, diarization_label, audio_drop_id);
    db.link_episode_audio_drop(episode_id, &diarization_label, audio_drop_id)
        .map_err(AppError::from)
}

/// Unlink a diarization label (clear both speaker and drop assignment)
#[tauri::command]
pub async fn unlink_episode_speaker(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    diarization_label: String,
) -> Result<(), AppError> {
    log::info!("Unlinking episode {} label {}", episode_id, diarization_label);
    db.unlink_episode_speaker(episode_id, &diarization_label)
        .map_err(AppError::from)
}

/// Get all speaker/drop assignments for an episode
#[tauri::command]
pub async fn get_episode_speaker_assignments(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Vec<EpisodeSpeakerAssignment>, AppError> {
    db.get_episode_speaker_assignments(episode_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_embedding_model(
    db: State<'_, Arc<Database>>,
) -> Result<String, AppError> {
    Ok(configured_embedding_backend(db.inner()))
}

#[tauri::command]
pub async fn set_embedding_model(
    backend: String,
    db: State<'_, Arc<Database>>,
) -> Result<(), AppError> {
    if backend != EMBEDDING_BACKEND_ECAPA && backend != EMBEDDING_BACKEND_PYANNOTE {
        return Err(AppError::from("Invalid embedding backend. Use 'ecapa-tdnn' or 'pyannote'."));
    }
    db.set_setting("embedding_model", &backend).map_err(AppError::from)
}

/// Voice library speaker info
#[derive(Debug, Serialize)]
pub struct VoiceLibrarySpeaker {
    pub name: String,
    pub short_name: String,
    pub sample_count: i32,
    pub sample_file: Option<String>,
    pub file_count: i32,
    pub episode_count: i32,
    /// True if a voice print (embedding) exists for this speaker in embeddings.json.
    /// False means sample files exist on disk but Rebuild Voice Prints hasn't been run yet.
    pub has_embedding: bool,
}

/// Get voice library information
#[tauri::command]
pub async fn get_voice_library(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<VoiceLibrarySpeaker>, AppError> {
    purge_legacy_filesystem_samples(db.inner())?;
    let backend = configured_embedding_backend(db.inner());
    let episode_counts = db.get_speaker_episode_counts().unwrap_or_default();
    log::info!("get_voice_library called");

    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let project_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app");

    let voice_library_script = project_dir.join("scripts").join("voice_library.py");
    let venv_python = project_dir.join("venv").join("bin").join("python");

    let samples_dir = project_dir.join("scripts").join("voice_library").join("samples");
    let sound_bites_dir = project_dir.join("scripts").join("voice_library").join("sound_bites");

    let mut speakers: Vec<VoiceLibrarySpeaker> = Vec::new();
    let mut embedded_names: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Step 1: parse embedded speakers from voice_library.py info
    // (best-effort — if the script fails, we fall through to filesystem scan)
    if venv_python.exists() && voice_library_script.exists() {
        if let Ok(output) = std::process::Command::new(&venv_python)
            .args([voice_library_script.to_str().unwrap(), "info", "--backend", &backend])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Ok(data) = serde_json::from_str::<serde_json::Value>(&stdout) {
                    if let Some(arr) = data.get("speakers").and_then(|s| s.as_array()) {
                        for s in arr {
                            if let Some(name) = s.get("name").and_then(|n| n.as_str()) {
                                embedded_names.insert(name.to_string());
                                let file_count = count_audio_files_for(name, &samples_dir, &sound_bites_dir);
                                let episode_count = *episode_counts.get(name).unwrap_or(&0);
                                let short_name = s.get("short_name")
                                    .and_then(|f| f.as_str())
                                    .unwrap_or_else(|| name.split_whitespace().next().unwrap_or(name))
                                    .to_string();
                                speakers.push(VoiceLibrarySpeaker {
                                    name: name.to_string(),
                                    short_name,
                                    sample_count: s.get("sample_count").and_then(|c| c.as_i64()).unwrap_or(1) as i32,
                                    sample_file: s.get("sample_file").and_then(|f| f.as_str()).map(|s| s.to_string()),
                                    file_count,
                                    episode_count,
                                    has_embedding: true,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // Step 2: scan voice_library/samples/ for speaker subdirs not yet in embeddings.json
    // These have audio files on disk but haven't been trained yet — shown as "needs Rebuild"
    if samples_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&samples_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() { continue; }
                let dir_name = entry.file_name().to_string_lossy().to_string();
                // Skip hidden dirs and non-speaker dirs
                if dir_name.starts_with('.') { continue; }
                let speaker_name = dir_name.replace('_', " ");
                if embedded_names.contains(&speaker_name) { continue; }

                let file_count = count_audio_files_for(&speaker_name, &samples_dir, &sound_bites_dir);
                if file_count == 0 { continue; }

                let short_name = speaker_name.split_whitespace().next().unwrap_or(&speaker_name).to_string();
                let episode_count = *episode_counts.get(&speaker_name).unwrap_or(&0);
                speakers.push(VoiceLibrarySpeaker {
                    name: speaker_name,
                    short_name,
                    sample_count: 0,
                    sample_file: None,
                    file_count,
                    episode_count,
                    has_embedding: false,
                });
            }
        }
    }

    Ok(speakers)
}

fn purge_legacy_filesystem_samples(db: &Arc<Database>) -> Result<(), AppError> {
    let source = "filesystem";
    let files = db
        .get_voice_sample_files_by_source(source)
        .map_err(AppError::from)?;

    if files.is_empty() {
        return Ok(());
    }

    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let voice_lib_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app")
        .join("scripts")
        .join("voice_library");
    let canonical_voice_lib = voice_lib_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve voice library path: {}", e))?;

    for file in &files {
        let p = PathBuf::from(file);
        if !p.exists() {
            continue;
        }
        if let Ok(cp) = p.canonicalize() {
            if cp.starts_with(&canonical_voice_lib) {
                let _ = std::fs::remove_file(cp);
            }
        }
    }

    let deleted = db
        .delete_voice_samples_by_source(source)
        .map_err(AppError::from)?;
    log::info!(
        "Purged {} legacy '{}' voice_samples rows and attempted file cleanup",
        deleted,
        source
    );
    Ok(())
}

/// Individual voice sample file info (returned by get_voice_samples)
#[derive(Debug, Serialize)]
pub struct VoiceSampleFile {
    pub id: Option<i64>,
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub created: Option<String>,
    // DB-backed fields (None for filesystem-only samples)
    pub episode_id: Option<i64>,
    pub episode_number: Option<String>,
    pub segment_idx: Option<i64>,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    pub transcript_text: Option<String>,
    pub rating: Option<i32>,
    pub episode_title: Option<String>,
    pub source: Option<String>,
}

/// Get all individual voice sample files for a speaker or sound bite
/// Now DB-backed with filesystem fallback for legacy samples
#[tauri::command]
pub async fn get_voice_samples(
    db: State<'_, Arc<Database>>,
    speaker_name: String,
) -> Result<Vec<VoiceSampleFile>, AppError> {
    // Legacy filesystem-only compatibility has been removed.
    // Audio ID shows DB-backed samples only (manual/harvest/auto).
    let db_samples = db.get_voice_samples_for_speaker(&speaker_name)
        .unwrap_or_default();

    let mut samples: Vec<VoiceSampleFile> = Vec::new();

    for record in &db_samples {
        if record.source.as_deref() == Some("filesystem") {
            continue;
        }
        let path = std::path::Path::new(&record.file_path);
        let file_size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        // Skip records whose files have been deleted from disk
        if file_size == 0 && !path.exists() {
            continue;
        }
        samples.push(VoiceSampleFile {
            id: Some(record.id),
            file_path: record.file_path.clone(),
            file_name: path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
            file_size,
            created: record.created_at.clone(),
            episode_id: record.episode_id,
            episode_number: record.episode_number.clone(),
            segment_idx: record.segment_idx,
            start_time: Some(record.start_time),
            end_time: Some(record.end_time),
            transcript_text: record.transcript_text.clone(),
            rating: Some(record.rating),
            episode_title: record.episode_title.clone(),
            source: record.source.clone(),
        });
    }

    Ok(samples)
}

/// Update rating for a voice sample
#[tauri::command]
pub async fn update_voice_sample_rating(
    db: State<'_, Arc<Database>>,
    id: i64,
    rating: i32,
) -> Result<(), AppError> {
    log::info!("Updating voice sample {} rating to {}", id, rating);
    db.update_voice_sample_rating(id, rating)
        .map_err(AppError::from)
}

fn is_audio_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".wav") || lower.ends_with(".mp3") || lower.ends_with(".m4a") || lower.ends_with(".ogg") || lower.ends_with(".flac")
}

/// Delete a specific voice sample file (by file_path or by DB id)
#[tauri::command]
pub async fn delete_voice_sample(
    db: State<'_, Arc<Database>>,
    speaker_name: String,
    file_path: Option<String>,
    sample_id: Option<i64>,
) -> Result<(), AppError> {
    let backend = configured_embedding_backend(db.inner());
    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let voice_lib_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app")
        .join("scripts")
        .join("voice_library");

    // Determine the file to delete
    let target_path = if let Some(id) = sample_id {
        // Delete by DB id — get path from DB record and delete record
        let path = db.delete_voice_sample_record(id)
            .map_err(AppError::from)?;
        path.or(file_path.clone())
    } else {
        file_path.clone()
    };

    if let Some(ref path) = target_path {
        // Security: ensure the path is within voice_library/
        let canonical_voice_lib = voice_lib_dir.canonicalize().map_err(|e| format!("Failed to resolve voice library path: {}", e))?;
        if let Ok(canonical_file) = std::path::Path::new(path).canonicalize() {
            if canonical_file.starts_with(&canonical_voice_lib) {
                std::fs::remove_file(&canonical_file)
                    .map_err(|e| format!("Failed to delete file: {}", e))?;
                log::info!("Deleted voice sample for '{}': {}", speaker_name, path);
            } else {
                return Err(AppError::from("Path is outside voice library directory"));
            }
        }
    }

    // If we had a file_path but no sample_id, try to find and delete the DB record by path
    if sample_id.is_none() {
        if let Some(ref path) = file_path {
            // Best-effort: delete any DB record that matches this file_path
            let samples = db.get_voice_samples_for_speaker(&speaker_name).unwrap_or_default();
            for s in samples {
                if s.file_path == *path {
                    let _ = db.delete_voice_sample_record(s.id);
                    break;
                }
            }
        }
    }

    // Retrain only this speaker's voice print from remaining samples (best-effort)
    let project_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app");
    let venv_python = project_dir.join("venv").join("bin").join("python");
    let voice_library_script = project_dir.join("scripts").join("voice_library.py");

    if venv_python.exists() && voice_library_script.exists() {
        let mut cmd = std::process::Command::new(&venv_python);
        cmd.args([
                voice_library_script.to_str().unwrap(),
                "rebuild-speaker",
                &speaker_name,
                "--backend",
                &backend,
            ]);
        apply_hf_runtime_env_std(&mut cmd, db.inner(), false);
        let _ = cmd.output();
    }

    Ok(())
}

/// Delete a speaker's voice print (embeddings) from the voice library.
/// This removes the trained embedding from embeddings.json so the speaker
/// can be re-trained from scratch. Audio sample files are NOT deleted.
#[tauri::command]
pub async fn delete_voice_print(
    speaker_name: String,
    db: State<'_, Arc<Database>>,
) -> Result<(), AppError> {
    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let project_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app");
    let venv_python = project_dir.join("venv").join("bin").join("python");
    let voice_library_script = project_dir.join("scripts").join("voice_library.py");

    if !venv_python.exists() {
        return Err(AppError::from("Python venv not found"));
    }
    if !voice_library_script.exists() {
        return Err(AppError::from("voice_library.py not found"));
    }

    let backend = configured_embedding_backend(db.inner());

    let mut cmd = std::process::Command::new(&venv_python);
    cmd.args([
            voice_library_script.to_str().unwrap(),
            "remove",
            &speaker_name,
            "--backend",
            &backend,
        ]);
    apply_hf_runtime_env_std(&mut cmd, db.inner(), false);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run voice_library.py: {}", e))?;

    if output.status.success() {
        log::info!("Deleted voice print for '{}'", speaker_name);
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(AppError::from(format!("Failed to delete voice print: {}", stderr)))
    }
}

/// Rebuild a single speaker's voice print from their remaining samples.
#[tauri::command]
pub async fn rebuild_voice_print_for_speaker(
    speaker_name: String,
    db: State<'_, Arc<Database>>,
) -> Result<(), AppError> {
    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let project_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app");
    let venv_python = project_dir.join("venv").join("bin").join("python");
    let voice_library_script = project_dir.join("scripts").join("voice_library.py");

    if !venv_python.exists() {
        return Err(AppError::from("Python venv not found"));
    }
    if !voice_library_script.exists() {
        return Err(AppError::from("voice_library.py not found"));
    }

    let backend = configured_embedding_backend(db.inner());

    let mut cmd = std::process::Command::new(&venv_python);
    cmd.args([
            voice_library_script.to_str().unwrap(),
            "rebuild-speaker",
            &speaker_name,
            "--backend",
            &backend,
        ]);
    apply_hf_runtime_env_std(&mut cmd, db.inner(), false);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run voice_library.py: {}", e))?;

    if output.status.success() {
        log::info!("Rebuilt voice print for '{}'", speaker_name);
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(AppError::from(format!("Failed to rebuild voice print: {}", stderr)))
    }
}

/// Count actual audio files for a speaker/sound bite
fn count_audio_files_for(name: &str, samples_dir: &std::path::Path, sound_bites_dir: &std::path::Path) -> i32 {
    let mut count = 0;
    let normalized = name.replace(' ', "_");

    // Check samples/ for name-prefixed flat files
    if samples_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(samples_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.starts_with(&normalized) && is_audio_file(&fname) {
                    count += 1;
                }
            }
        }
    }

    // Check samples/{Speaker_Name}/ subdirectory (new structure)
    let speaker_subdir = samples_dir.join(&normalized);
    if speaker_subdir.exists() && speaker_subdir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&speaker_subdir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if is_audio_file(&fname) {
                    count += 1;
                }
            }
        }
    }

    // Check sound_bites/{clean_name}/
    let clean = name.trim_start_matches("🔊 ").trim_start_matches("🔊");
    let bite_dir = sound_bites_dir.join(clean);
    if bite_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&bite_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if is_audio_file(&fname) {
                    count += 1;
                }
            }
        }
    }

    count
}

/// Get path to voice library samples directory
#[tauri::command]
pub async fn get_voice_sample_path(speaker_name: String) -> Result<Option<String>, AppError> {
    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let samples_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app")
        .join("scripts")
        .join("voice_library")
        .join("samples");

    // Look for sample files for this speaker
    if samples_dir.exists() {
        for entry in std::fs::read_dir(&samples_dir).map_err(AppError::from)? {
            let entry = entry.map_err(AppError::from)?;
            let file_name = entry.file_name().to_string_lossy().to_string();
            // Sample files are named like "Matt_Donnelly_sample.wav"
            let normalized_name = speaker_name.replace(' ', "_");
            if file_name.starts_with(&normalized_name) && (file_name.ends_with(".wav") || file_name.ends_with(".mp3")) {
                return Ok(Some(entry.path().to_string_lossy().to_string()));
            }
        }
    }

    // Also check speaker_clips directory for extracted clips
    let clips_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app")
        .join("scripts")
        .join("speaker_clips");

    if clips_dir.exists() {
        for entry in std::fs::read_dir(&clips_dir).map_err(AppError::from)? {
            let entry = entry.map_err(AppError::from)?;
            if entry.path().is_dir() {
                // Look in subdirectories for clips
                for clip_entry in std::fs::read_dir(entry.path()).map_err(AppError::from)? {
                    let clip_entry = clip_entry.map_err(AppError::from)?;
                    let clip_name = clip_entry.file_name().to_string_lossy().to_string();
                    if clip_name.ends_with(".wav") || clip_name.ends_with(".mp3") {
                        // Return first clip found in any directory
                        // In practice we'd want to match by speaker name
                        return Ok(Some(clip_entry.path().to_string_lossy().to_string()));
                    }
                }
            }
        }
    }

    Ok(None)
}

/// Result from rebuild_voice_library
#[derive(Debug, Serialize, Deserialize)]
pub struct RebuildResult {
    pub status: String,
    pub rebuilt: i64,
    pub skipped: i64,
    pub errors: i64,
    pub speaker_count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PurgeVoiceLibraryEntryResult {
    pub status: String,
    pub speaker_name: String,
    pub deleted_files: i64,
    pub deleted_db_records: i64,
}

fn is_placeholder_speaker_name(name: &str) -> bool {
    if name.starts_with("SPEAKER_") {
        return true;
    }
    let compact = name
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '_', '-'], "");
    compact.starts_with("speaker")
        && compact
            .chars()
            .skip("speaker".len())
            .all(|c| c.is_ascii_digit())
}

fn delete_audio_files_in_dir(dir: &std::path::Path, deleted_files: &mut i64) {
    if !dir.exists() || !dir.is_dir() {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default();
                if is_audio_file(name) && std::fs::remove_file(&p).is_ok() {
                    *deleted_files += 1;
                }
            }
        }
    }
    // best-effort cleanup of empty directory
    let _ = std::fs::remove_dir(dir);
}

/// Purge an unlinked voice-library entry:
/// - removes embedding for this backend
/// - deletes sample files from voice_library/samples and sound_bites
/// - deletes matching voice_samples DB rows
#[tauri::command]
pub async fn purge_voice_library_entry(
    db: State<'_, Arc<Database>>,
    speaker_name: String,
) -> Result<PurgeVoiceLibraryEntryResult, AppError> {
    if !is_placeholder_speaker_name(&speaker_name) {
        log::info!("Purging non-placeholder voice library entry '{}'", speaker_name);
    }
    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let project_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app");
    let venv_python = project_dir.join("venv").join("bin").join("python");
    let voice_library_script = project_dir.join("scripts").join("voice_library.py");
    let voice_library_dir = project_dir.join("scripts").join("voice_library");

    let backend = configured_embedding_backend(db.inner());
    let mut deleted_files: i64 = 0;
    let mut deleted_db_records: i64 = 0;

    // Remove embedding (best-effort; doesn't fail purge if missing)
    if venv_python.exists() && voice_library_script.exists() {
        let mut cmd = std::process::Command::new(&venv_python);
        cmd.args([
            voice_library_script.to_str().unwrap(),
            "remove",
            &speaker_name,
            "--backend",
            &backend,
        ]);
        apply_hf_runtime_env_std(&mut cmd, db.inner(), false);
        let _ = cmd.output();
    }

    // Remove DB-backed sample files + rows
    let db_samples = db.get_voice_samples_for_speaker(&speaker_name).unwrap_or_default();
    for sample in db_samples {
        if std::path::Path::new(&sample.file_path).exists()
            && std::fs::remove_file(&sample.file_path).is_ok()
        {
            deleted_files += 1;
        }
        let _ = db.delete_voice_sample_record(sample.id);
        deleted_db_records += 1;
    }

    // Remove filesystem-only sample files (best-effort)
    let normalized = speaker_name.replace(' ', "_");
    delete_audio_files_in_dir(&voice_library_dir.join("samples").join(&normalized), &mut deleted_files);

    // Legacy flat sample naming: samples/Speaker_Name_*.wav
    let flat_samples = voice_library_dir.join("samples");
    if flat_samples.exists() {
        if let Ok(entries) = std::fs::read_dir(&flat_samples) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_file() {
                    continue;
                }
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default();
                if name.starts_with(&normalized) && is_audio_file(name) && std::fs::remove_file(&p).is_ok() {
                    deleted_files += 1;
                }
            }
        }
    }

    // Sound bite dir variant
    delete_audio_files_in_dir(
        &voice_library_dir
            .join("sound_bites")
            .join(speaker_name.trim_start_matches("🔊 ").trim_start_matches("🔊")),
        &mut deleted_files,
    );

    // If a speaker row exists with this exact name, remove it too so the expandable
    // card does not linger after purge.
    if let Ok(existing) = db.get_speakers() {
        if let Some(s) = existing.into_iter().find(|s| s.name == speaker_name) {
            let _ = db.delete_speaker(s.id);
        }
    }

    Ok(PurgeVoiceLibraryEntryResult {
        status: "success".to_string(),
        speaker_name,
        deleted_files,
        deleted_db_records,
    })
}

/// Rebuild voice embeddings from all samples on disk.
/// Spawns voice_library.py rebuild and emits voice_library_progress events.
#[tauri::command]
pub async fn rebuild_voice_library(
    app_handle: tauri::AppHandle,
    db: State<'_, Arc<Database>>,
    backend: Option<String>,
) -> Result<RebuildResult, AppError> {
    let backend = normalize_embedding_backend(backend.or_else(|| db.get_setting("embedding_model").unwrap_or(None)));
    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let project_dir = home_dir.join("Desktop").join("Projects").join("ice-cream-social-app");
    let venv_python = project_dir.join("venv").join("bin").join("python");
    let script = project_dir.join("scripts").join("voice_library.py");

    if !venv_python.exists() {
        return Err(AppError::from("Python venv not found"));
    }

    let mut cmd = tokio::process::Command::new(&venv_python);
    cmd.args([script.to_str().unwrap(), "rebuild", "--backend", &backend])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    apply_hf_runtime_env_tokio(&mut cmd, db.inner(), false);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn voice_library.py rebuild: {}", e))?;

    let stdout = child.stdout.take().expect("stdout");
    let mut reader = tokio::io::BufReader::new(stdout).lines();

    use tokio::io::AsyncBufReadExt;
    let mut last_line = String::new();
    loop {
        match reader.next_line().await {
            Ok(Some(line)) => {
                if line.starts_with("REBUILD_PROGRESS:") {
                    if let Some(n) = line.split(':').nth(1) {
                        let _ = app_handle.emit("voice_library_progress", n.trim().parse::<i32>().unwrap_or(0));
                    }
                } else if !line.is_empty() {
                    last_line = line;
                }
            }
            Ok(None) => break,
            Err(_) => break,
        }
    }

    let output = child.wait_with_output().await
        .map_err(|e| format!("Failed to wait for rebuild: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::from(format!("Rebuild failed: {}", stderr)));
    }

    // Parse the JSON result from last line
    let result: RebuildResult = serde_json::from_str(&last_line)
        .unwrap_or(RebuildResult { status: "success".into(), rebuilt: 0, skipped: 0, errors: 0, speaker_count: 0 });

    Ok(result)
}

/// Result from run_voice_harvest
#[derive(Debug, Serialize, Deserialize)]
pub struct HarvestResult {
    pub status: String,
    pub episodes_processed: i64,
    pub samples_added: i64,
    pub skipped: i64,
}

/// Harvest voice samples from all reviewed/diarized episodes.
/// Spawns harvest_voice_samples.py and emits harvest_progress events.
#[tauri::command]
pub async fn run_voice_harvest(
    app_handle: tauri::AppHandle,
    db: State<'_, Arc<Database>>,
    min_secs: Option<f64>,
    max_per_speaker: Option<i32>,
) -> Result<HarvestResult, AppError> {
    let backend = configured_embedding_backend(db.inner());
    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let project_dir = home_dir.join("Desktop").join("Projects").join("ice-cream-social-app");
    let venv_python = project_dir.join("venv").join("bin").join("python");
    let script = project_dir.join("scripts").join("harvest_voice_samples.py");

    if !venv_python.exists() {
        return Err(AppError::from("Python venv not found"));
    }
    if !script.exists() {
        return Err(AppError::from("harvest_voice_samples.py not found"));
    }

    let min_secs_str = min_secs.unwrap_or(4.0).to_string();
    let max_per_str = max_per_speaker.unwrap_or(5).to_string();
    let db_path = project_dir.join("data").join("ice_cream_social.db");
    let library_dir = project_dir.join("scripts").join("voice_library");
    let audio_base = project_dir.join("scripts").join("episodes");

    let mut child = tokio::process::Command::new(&venv_python)
        .args([
            script.to_str().unwrap(),
            "--db-path", db_path.to_str().unwrap(),
            "--library-dir", library_dir.to_str().unwrap(),
            "--audio-base", audio_base.to_str().unwrap(),
            "--min-secs", &min_secs_str,
            "--max-per-speaker-per-episode", &max_per_str,
            "--backend", &backend,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn harvest_voice_samples.py: {}", e))?;

    let stdout = child.stdout.take().expect("stdout");
    let mut reader = tokio::io::BufReader::new(stdout).lines();

    use tokio::io::AsyncBufReadExt;
    let mut last_line = String::new();
    loop {
        match reader.next_line().await {
            Ok(Some(line)) => {
                if line.starts_with("HARVEST_PROGRESS:") {
                    let _ = app_handle.emit("harvest_progress", line.trim_start_matches("HARVEST_PROGRESS:").trim());
                } else if !line.is_empty() {
                    last_line = line;
                }
            }
            Ok(None) => break,
            Err(_) => break,
        }
    }

    let output = child.wait_with_output().await
        .map_err(|e| format!("Failed to wait for harvest: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::from(format!("Harvest failed: {}", stderr)));
    }

    let result: HarvestResult = serde_json::from_str(&last_line)
        .unwrap_or(HarvestResult { status: "success".into(), episodes_processed: 0, samples_added: 0, skipped: 0 });

    Ok(result)
}

/// Extract a single voice sample clip from an episode segment and add it to the voice library.
/// Fire-and-forget: caller doesn't need to wait for this.
#[tauri::command]
pub async fn extract_voice_sample_from_segment(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    segment_idx: i64,
    speaker_name: String,
) -> Result<(), AppError> {
    if is_placeholder_speaker_name(&speaker_name) {
        log::info!(
            "Skipping sample extraction for placeholder speaker name '{}'",
            speaker_name
        );
        return Ok(());
    }
    let backend = configured_embedding_backend(db.inner());
    // Get episode audio path and published_date
    let audio_path = match db.get_episode_audio_path(episode_id)? {
        Some(p) if !p.is_empty() => p,
        _ => return Ok(()), // No audio path — silently skip
    };

    let published_date = db.get_episode_published_date(episode_id).unwrap_or(None);

    // Get segment start/end times and text
    let (start_time, end_time, transcript_text) = match db.get_segment_times(episode_id, segment_idx)? {
        Some(t) => t,
        None => return Ok(()),
    };

    let duration = end_time - start_time;
    if duration < 4.0 {
        return Ok(()); // Too short to be useful
    }

    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let project_dir = home_dir.join("Desktop").join("Projects").join("ice-cream-social-app");
    let venv_python = project_dir.join("venv").join("bin").join("python");
    let script = project_dir.join("scripts").join("extract_voice_sample.py");
    let db_path = project_dir.join("data").join("ice_cream_social.db");

    if !venv_python.exists() || !script.exists() {
        return Ok(());
    }

    let mut args = vec![
        script.to_str().unwrap().to_string(),
        "--audio-file".to_string(), audio_path,
        "--start".to_string(), start_time.to_string(),
        "--end".to_string(), end_time.to_string(),
        "--speaker-name".to_string(), speaker_name,
        "--episode-id".to_string(), episode_id.to_string(),
        "--segment-idx".to_string(), segment_idx.to_string(),
        "--db-path".to_string(), db_path.to_str().unwrap().to_string(),
        "--backend".to_string(), backend,
    ];
    if let Some(date) = published_date {
        args.push("--sample-date".to_string());
        args.push(date);
    }
    if let Some(text) = transcript_text {
        args.push("--transcript-text".to_string());
        args.push(text);
    }

    // Fire-and-forget — spawn but don't await
    let _ = tokio::process::Command::new(&venv_python)
        .args(&args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();

    Ok(())
}

#[tauri::command]
pub async fn compare_embedding_backends(
    episode_id: i64,
    db: State<'_, Arc<Database>>,
) -> Result<serde_json::Value, AppError> {
    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let project_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app");
    let venv_python = project_dir.join("venv").join("bin").join("python");
    let script = project_dir.join("scripts").join("voice_library.py");

    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(AppError::from)?
        .ok_or("Episode not found")?;

    let transcript_path = episode
        .transcript_path
        .clone()
        .ok_or("Episode has no transcript path")?;
    let audio_path = episode
        .audio_file_path
        .clone()
        .ok_or("Episode has no audio file path")?;

    let base = PathBuf::from(&transcript_path);
    let diarized = base.with_file_name(format!(
        "{}_with_speakers.json",
        base.file_stem().and_then(|s| s.to_str()).unwrap_or("transcript")
    ));
    let diarization_json = if diarized.exists() { diarized } else { base };
    if !diarization_json.exists() {
        return Err(AppError::from("No diarization JSON found for episode"));
    }

    let episode_date = parse_episode_date_for_voice(episode.published_date.clone());

    let run_compare_once = |force_offline: bool| -> Result<std::process::Output, AppError> {
        let mut cmd = std::process::Command::new(&venv_python);
        cmd.args([
            script.to_str().unwrap(),
            "compare",
            "--diarization-json",
            diarization_json.to_str().unwrap(),
            "--audio",
            &audio_path,
        ]);
        if let Some(ref date) = episode_date {
            cmd.args(["--episode-date", date]);
        }
        apply_hf_runtime_env_std(&mut cmd, db.inner(), force_offline);
        cmd.output()
            .map_err(|e| AppError::from(format!("Failed to run voice_library compare: {}", e)))
    };

    let initial_offline = hf_hub_offline_enabled(db.inner());
    let mut output = run_compare_once(initial_offline)?;

    if !output.status.success() && !initial_offline {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if looks_like_hf_network_failure(&stderr) {
            log::warn!("compare_embedding_backends: retrying in HF offline mode after network failure");
            output = run_compare_once(true)?;
        }
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::from(format!("Compare failed: {}", stderr)));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    match serde_json::from_str::<serde_json::Value>(&stdout) {
        Ok(parsed) => Ok(parsed),
        Err(first_err) => {
            if !initial_offline {
                // One retry in offline mode if stdout was polluted due upstream warnings.
                let retry = run_compare_once(true)?;
                if retry.status.success() {
                    let retry_stdout = String::from_utf8_lossy(&retry.stdout);
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&retry_stdout) {
                        return Ok(parsed);
                    }
                }
            }
            Err(AppError::from(format!("Failed to parse compare JSON: {}", first_err)))
        }
    }
}
