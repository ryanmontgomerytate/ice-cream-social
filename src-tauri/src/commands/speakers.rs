use crate::database::{Database, Speaker, SpeakerStats, EpisodeSpeakerAssignment};
use crate::error::AppError;
use serde::Serialize;
use std::sync::Arc;
use std::path::PathBuf;
use tauri::State;

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
) -> Result<i64, AppError> {
    log::info!("Creating speaker: {} (short: {:?}, host: {})", name, short_name, is_host);
    db.create_speaker(&name, short_name.as_deref(), is_host)
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
) -> Result<(), AppError> {
    log::info!("Updating speaker {}: {} (short: {:?}, host: {})", id, name, short_name, is_host);
    db.update_speaker(id, &name, short_name.as_deref(), is_host)
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

/// Voice library speaker info
#[derive(Debug, Serialize)]
pub struct VoiceLibrarySpeaker {
    pub name: String,
    pub short_name: String,
    pub sample_count: i32,
    pub sample_file: Option<String>,
    pub file_count: i32,
}

/// Get voice library information
#[tauri::command]
pub async fn get_voice_library() -> Result<Vec<VoiceLibrarySpeaker>, AppError> {
    log::info!("get_voice_library called");

    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let project_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app");

    let voice_library_script = project_dir.join("scripts").join("voice_library.py");
    let venv_python = project_dir.join("venv").join("bin").join("python");

    let output = std::process::Command::new(&venv_python)
        .args([voice_library_script.to_str().unwrap(), "info"])
        .output()
        .map_err(|e| format!("Failed to run voice library script: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Voice library script failed: {}", stderr).into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let data: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse voice library output: {}", e))?;

    let samples_dir = project_dir.join("scripts").join("voice_library").join("samples");
    let sound_bites_dir = project_dir.join("scripts").join("voice_library").join("sound_bites");

    let speakers = data
        .get("speakers")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    let name = s.get("name")?.as_str()?.to_string();
                    let file_count = count_audio_files_for(&name, &samples_dir, &sound_bites_dir);
                    Some(VoiceLibrarySpeaker {
                        name,
                        short_name: s.get("short_name")?.as_str()?.to_string(),
                        sample_count: s.get("sample_count")?.as_i64()? as i32,
                        sample_file: s.get("sample_file").and_then(|f| f.as_str()).map(|s| s.to_string()),
                        file_count,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(speakers)
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
    pub segment_idx: Option<i64>,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    pub transcript_text: Option<String>,
    pub rating: Option<i32>,
    pub episode_title: Option<String>,
}

/// Get all individual voice sample files for a speaker or sound bite
/// Now DB-backed with filesystem fallback for legacy samples
#[tauri::command]
pub async fn get_voice_samples(
    db: State<'_, Arc<Database>>,
    speaker_name: String,
) -> Result<Vec<VoiceSampleFile>, AppError> {
    // First: try to get DB-backed samples
    let db_samples = db.get_voice_samples_for_speaker(&speaker_name)
        .unwrap_or_default();

    let mut samples: Vec<VoiceSampleFile> = Vec::new();
    let mut db_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

    for record in &db_samples {
        db_paths.insert(record.file_path.clone());
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
            segment_idx: record.segment_idx,
            start_time: Some(record.start_time),
            end_time: Some(record.end_time),
            transcript_text: record.transcript_text.clone(),
            rating: Some(record.rating),
            episode_title: record.episode_title.clone(),
        });
    }

    // Fallback: scan filesystem for samples not in DB
    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let voice_lib_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app")
        .join("scripts")
        .join("voice_library");

    let normalized_name = speaker_name.replace(' ', "_");

    // Check samples/{Speaker_Name}/ directory (new structure)
    let speaker_samples_dir = voice_lib_dir.join("samples").join(&normalized_name);
    if speaker_samples_dir.exists() {
        collect_all_from_dir_filtered(&speaker_samples_dir, &db_paths, &mut samples)?;
    }

    // Check samples/ directory for name-prefixed files (legacy flat structure)
    let samples_dir = voice_lib_dir.join("samples");
    if samples_dir.exists() {
        collect_samples_from_dir_filtered(&samples_dir, &normalized_name, &db_paths, &mut samples)?;
    }

    // Check sound_bites/{name}/ directory
    let clean_name = speaker_name.trim_start_matches("🔊 ").trim_start_matches("🔊");
    let sound_bite_dir = voice_lib_dir.join("sound_bites").join(clean_name);
    if sound_bite_dir.exists() {
        collect_all_from_dir_filtered(&sound_bite_dir, &db_paths, &mut samples)?;
    }

    if clean_name != speaker_name {
        let sound_bite_dir2 = voice_lib_dir.join("sound_bites").join(&speaker_name);
        if sound_bite_dir2.exists() {
            collect_all_from_dir_filtered(&sound_bite_dir2, &db_paths, &mut samples)?;
        }
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

fn collect_samples_from_dir_filtered(dir: &PathBuf, name_prefix: &str, exclude: &std::collections::HashSet<String>, samples: &mut Vec<VoiceSampleFile>) -> Result<(), AppError> {
    for entry in std::fs::read_dir(dir).map_err(AppError::from)? {
        let entry = entry.map_err(AppError::from)?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        // Skip subdirectories (new per-speaker dirs)
        if entry.path().is_dir() { continue; }
        if file_name.starts_with(name_prefix) && is_audio_file(&file_name) {
            let path_str = entry.path().to_string_lossy().to_string();
            if !exclude.contains(&path_str) {
                if let Ok(sample) = make_voice_sample(&entry) {
                    samples.push(sample);
                }
            }
        }
    }
    Ok(())
}

fn collect_all_from_dir_filtered(dir: &PathBuf, exclude: &std::collections::HashSet<String>, samples: &mut Vec<VoiceSampleFile>) -> Result<(), AppError> {
    for entry in std::fs::read_dir(dir).map_err(AppError::from)? {
        let entry = entry.map_err(AppError::from)?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if is_audio_file(&file_name) {
            let path_str = entry.path().to_string_lossy().to_string();
            if !exclude.contains(&path_str) {
                if let Ok(sample) = make_voice_sample(&entry) {
                    samples.push(sample);
                }
            }
        }
    }
    Ok(())
}

fn is_audio_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".wav") || lower.ends_with(".mp3") || lower.ends_with(".m4a") || lower.ends_with(".ogg") || lower.ends_with(".flac")
}

fn make_voice_sample(entry: &std::fs::DirEntry) -> Result<VoiceSampleFile, AppError> {
    let metadata = entry.metadata().map_err(AppError::from)?;
    let created = metadata.created().ok().map(|t| {
        let dt: chrono::DateTime<chrono::Local> = t.into();
        dt.format("%Y-%m-%d %H:%M").to_string()
    });
    Ok(VoiceSampleFile {
        id: None,
        file_path: entry.path().to_string_lossy().to_string(),
        file_name: entry.file_name().to_string_lossy().to_string(),
        file_size: metadata.len(),
        created,
        episode_id: None,
        segment_idx: None,
        start_time: None,
        end_time: None,
        transcript_text: None,
        rating: None,
        episode_title: None,
    })
}

/// Delete a specific voice sample file (by file_path or by DB id)
#[tauri::command]
pub async fn delete_voice_sample(
    db: State<'_, Arc<Database>>,
    speaker_name: String,
    file_path: Option<String>,
    sample_id: Option<i64>,
) -> Result<(), AppError> {
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

    // Rebuild embeddings by calling voice_library.py rebuild (best-effort)
    let project_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app");
    let venv_python = project_dir.join("venv").join("bin").join("python");
    let voice_library_script = project_dir.join("scripts").join("voice_library.py");

    if venv_python.exists() && voice_library_script.exists() {
        let _ = std::process::Command::new(&venv_python)
            .args([voice_library_script.to_str().unwrap(), "rebuild"])
            .output();
    }

    Ok(())
}

/// Delete a speaker's voice print (embeddings) from the voice library.
/// This removes the trained embedding from embeddings.json so the speaker
/// can be re-trained from scratch. Audio sample files are NOT deleted.
#[tauri::command]
pub async fn delete_voice_print(speaker_name: String) -> Result<(), AppError> {
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

    let output = std::process::Command::new(&venv_python)
        .args([voice_library_script.to_str().unwrap(), "remove", &speaker_name])
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
