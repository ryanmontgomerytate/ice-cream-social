use crate::database::{Database, Speaker, SpeakerStats};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

/// Get all speakers
#[tauri::command]
pub async fn get_speakers(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Speaker>, String> {
    db.get_speakers().map_err(|e| e.to_string())
}

/// Create a new speaker
#[tauri::command]
pub async fn create_speaker(
    db: State<'_, Arc<Database>>,
    name: String,
    short_name: Option<String>,
    is_host: bool,
) -> Result<i64, String> {
    log::info!("Creating speaker: {} (short: {:?}, host: {})", name, short_name, is_host);
    db.create_speaker(&name, short_name.as_deref(), is_host)
        .map_err(|e| e.to_string())
}

/// Update a speaker
#[tauri::command]
pub async fn update_speaker(
    db: State<'_, Arc<Database>>,
    id: i64,
    name: String,
    short_name: Option<String>,
    is_host: bool,
) -> Result<(), String> {
    log::info!("Updating speaker {}: {} (short: {:?}, host: {})", id, name, short_name, is_host);
    db.update_speaker(id, &name, short_name.as_deref(), is_host)
        .map_err(|e| e.to_string())
}

/// Delete a speaker
#[tauri::command]
pub async fn delete_speaker(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), String> {
    log::info!("Deleting speaker {}", id);
    db.delete_speaker(id).map_err(|e| e.to_string())
}

/// Get speaker statistics
#[tauri::command]
pub async fn get_speaker_stats(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<SpeakerStats>, String> {
    db.get_speaker_stats().map_err(|e| e.to_string())
}

/// Link a diarization label to a known speaker for an episode
#[tauri::command]
pub async fn link_episode_speaker(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    diarization_label: String,
    speaker_id: i64,
) -> Result<(), String> {
    log::info!("Linking episode {} speaker {} to speaker_id {}", episode_id, diarization_label, speaker_id);
    db.link_episode_speaker(episode_id, &diarization_label, speaker_id)
        .map_err(|e| e.to_string())
}

/// Voice library speaker info
#[derive(Debug, Serialize)]
pub struct VoiceLibrarySpeaker {
    pub name: String,
    pub short_name: String,
    pub sample_count: i32,
    pub sample_file: Option<String>,
}

/// Get voice library information
#[tauri::command]
pub async fn get_voice_library() -> Result<Vec<VoiceLibrarySpeaker>, String> {
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
        return Err(format!("Voice library script failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let data: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse voice library output: {}", e))?;

    let speakers = data
        .get("speakers")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    Some(VoiceLibrarySpeaker {
                        name: s.get("name")?.as_str()?.to_string(),
                        short_name: s.get("short_name")?.as_str()?.to_string(),
                        sample_count: s.get("sample_count")?.as_i64()? as i32,
                        sample_file: s.get("sample_file").and_then(|f| f.as_str()).map(|s| s.to_string()),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(speakers)
}

/// Get path to voice library samples directory
#[tauri::command]
pub async fn get_voice_sample_path(speaker_name: String) -> Result<Option<String>, String> {
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
        for entry in std::fs::read_dir(&samples_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
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
        for entry in std::fs::read_dir(&clips_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.path().is_dir() {
                // Look in subdirectories for clips
                for clip_entry in std::fs::read_dir(entry.path()).map_err(|e| e.to_string())? {
                    let clip_entry = clip_entry.map_err(|e| e.to_string())?;
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
