use crate::database::{Database, models::{ChapterType, EpisodeChapter, Character, Sponsor, FlaggedSegment, CharacterAppearance, AudioDrop, AudioDropInstance}, SearchResult, TranscriptSegment, DetectedContent, DetectedContentWithEpisode};
use std::sync::Arc;
use tauri::State;
use serde::{Deserialize, Serialize};

// ============================================================================
// Chapter Types Commands
// ============================================================================

#[tauri::command]
pub async fn get_chapter_types(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<ChapterType>, String> {
    db.get_chapter_types().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_chapter_type(
    db: State<'_, Arc<Database>>,
    name: String,
    description: Option<String>,
    color: String,
    icon: Option<String>,
) -> Result<i64, String> {
    log::info!("Creating chapter type: {}", name);
    db.create_chapter_type(&name, description.as_deref(), &color, icon.as_deref())
        .map_err(|e| e.to_string())
}

// ============================================================================
// Episode Chapters Commands
// ============================================================================

#[tauri::command]
pub async fn get_episode_chapters(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Vec<EpisodeChapter>, String> {
    db.get_episode_chapters(episode_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_episode_chapter(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    chapter_type_id: i64,
    title: Option<String>,
    start_time: f64,
    end_time: Option<f64>,
    start_segment_idx: Option<i32>,
    end_segment_idx: Option<i32>,
) -> Result<i64, String> {
    log::info!("Creating chapter for episode {}: type={}, start={}", episode_id, chapter_type_id, start_time);
    db.create_episode_chapter(
        episode_id, chapter_type_id, title.as_deref(),
        start_time, end_time, start_segment_idx, end_segment_idx
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_episode_chapter(
    db: State<'_, Arc<Database>>,
    chapter_id: i64,
) -> Result<(), String> {
    log::info!("Deleting chapter: {}", chapter_id);
    db.delete_episode_chapter(chapter_id).map_err(|e| e.to_string())
}

// ============================================================================
// Characters Commands
// ============================================================================

#[tauri::command]
pub async fn get_characters(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Character>, String> {
    db.get_characters().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_character(
    db: State<'_, Arc<Database>>,
    name: String,
    short_name: Option<String>,
    description: Option<String>,
    catchphrase: Option<String>,
) -> Result<i64, String> {
    log::info!("Creating character: {}", name);
    db.create_character(&name, short_name.as_deref(), description.as_deref(), catchphrase.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_character(
    db: State<'_, Arc<Database>>,
    id: i64,
    name: String,
    short_name: Option<String>,
    description: Option<String>,
    catchphrase: Option<String>,
) -> Result<(), String> {
    log::info!("Updating character {}: {}", id, name);
    db.update_character(id, &name, short_name.as_deref(), description.as_deref(), catchphrase.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_character(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), String> {
    log::info!("Deleting character: {}", id);
    db.delete_character(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_character_appearance(
    db: State<'_, Arc<Database>>,
    character_id: i64,
    episode_id: i64,
    start_time: Option<f64>,
    end_time: Option<f64>,
    segment_idx: Option<i32>,
) -> Result<i64, String> {
    log::info!("Adding character {} appearance in episode {}", character_id, episode_id);
    db.add_character_appearance(character_id, episode_id, start_time, end_time, segment_idx)
        .map_err(|e| e.to_string())
}

// ============================================================================
// Sponsors Commands
// ============================================================================

#[tauri::command]
pub async fn get_sponsors(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Sponsor>, String> {
    db.get_sponsors().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_sponsor(
    db: State<'_, Arc<Database>>,
    name: String,
    tagline: Option<String>,
    description: Option<String>,
    is_real: bool,
) -> Result<i64, String> {
    log::info!("Creating sponsor: {} (real: {})", name, is_real);
    db.create_sponsor(&name, tagline.as_deref(), description.as_deref(), is_real)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_sponsor(
    db: State<'_, Arc<Database>>,
    id: i64,
    name: String,
    tagline: Option<String>,
    description: Option<String>,
    is_real: bool,
) -> Result<(), String> {
    log::info!("Updating sponsor {}: {}", id, name);
    db.update_sponsor(id, &name, tagline.as_deref(), description.as_deref(), is_real)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_sponsor(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), String> {
    log::info!("Deleting sponsor: {}", id);
    db.delete_sponsor(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_sponsor_mention(
    db: State<'_, Arc<Database>>,
    sponsor_id: i64,
    episode_id: i64,
    start_time: Option<f64>,
    end_time: Option<f64>,
    segment_idx: Option<i32>,
) -> Result<i64, String> {
    log::info!("Adding sponsor {} mention in episode {}", sponsor_id, episode_id);
    db.add_sponsor_mention(sponsor_id, episode_id, start_time, end_time, segment_idx)
        .map_err(|e| e.to_string())
}

// ============================================================================
// Search Commands
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub total: i64,
    pub query: String,
}

#[tauri::command]
pub async fn search_transcripts(
    db: State<'_, Arc<Database>>,
    query: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<SearchResponse, String> {
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);

    log::info!("Searching transcripts for: '{}' (limit={}, offset={})", query, limit, offset);

    // Clean up the query for FTS5
    let clean_query = query.trim();
    if clean_query.is_empty() {
        return Ok(SearchResponse {
            results: vec![],
            total: 0,
            query: query.clone(),
        });
    }

    let results = db.search_transcripts(clean_query, limit, offset)
        .map_err(|e| e.to_string())?;
    let total = db.count_search_results(clean_query)
        .map_err(|e| e.to_string())?;

    Ok(SearchResponse {
        results,
        total,
        query,
    })
}

#[tauri::command]
pub async fn get_search_stats(
    db: State<'_, Arc<Database>>,
) -> Result<SearchStats, String> {
    let indexed_segments = db.get_indexed_segment_count()
        .map_err(|e| e.to_string())?;
    let unindexed_episodes = db.get_unindexed_episodes()
        .map_err(|e| e.to_string())?;

    Ok(SearchStats {
        indexed_segments,
        unindexed_episode_count: unindexed_episodes.len() as i64,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchStats {
    pub indexed_segments: i64,
    pub unindexed_episode_count: i64,
}

#[tauri::command]
pub async fn index_episode_transcript(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    segments: Vec<TranscriptSegmentInput>,
) -> Result<(), String> {
    log::info!("Indexing {} segments for episode {}", segments.len(), episode_id);

    let segments: Vec<TranscriptSegment> = segments.into_iter().map(|s| TranscriptSegment {
        speaker: s.speaker,
        text: s.text,
        start_time: s.start_time,
        end_time: s.end_time,
    }).collect();

    db.index_transcript_segments(episode_id, &segments)
        .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct TranscriptSegmentInput {
    pub speaker: Option<String>,
    pub text: String,
    pub start_time: f64,
    pub end_time: Option<f64>,
}

/// Index all unindexed transcripts from JSON files
#[tauri::command]
pub async fn index_all_transcripts(
    db: State<'_, Arc<Database>>,
    app_handle: tauri::AppHandle,
) -> Result<IndexingResult, String> {
    use tauri::Emitter;

    log::info!("Starting bulk transcript indexing");

    // Get all unindexed episodes
    let episodes = db.get_unindexed_episodes()
        .map_err(|e| e.to_string())?;

    let total = episodes.len();
    log::info!("Found {} episodes to index", total);

    if total == 0 {
        return Ok(IndexingResult {
            indexed: 0,
            failed: 0,
            total: 0,
        });
    }

    let mut indexed = 0;
    let mut failed = 0;

    for (i, episode) in episodes.iter().enumerate() {
        // Emit progress
        let _ = app_handle.emit("indexing_progress", serde_json::json!({
            "current": i + 1,
            "total": total,
            "episode_title": &episode.title,
        }));

        // Get transcript path
        let transcript_path = match &episode.transcript_path {
            Some(p) => p,
            None => {
                log::warn!("Episode {} has no transcript path", episode.id);
                failed += 1;
                continue;
            }
        };

        // Read and parse transcript file
        let content = match std::fs::read_to_string(transcript_path) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("Failed to read transcript for episode {}: {}", episode.id, e);
                failed += 1;
                continue;
            }
        };

        // Parse segments from JSON
        let segments = match parse_transcript_segments(&content) {
            Some(s) if !s.is_empty() => s,
            _ => {
                log::warn!("No segments found in transcript for episode {}", episode.id);
                failed += 1;
                continue;
            }
        };

        // Index segments
        match db.index_transcript_segments(episode.id, &segments) {
            Ok(_) => {
                log::info!("Indexed {} segments for episode {}: {}", segments.len(), episode.id, episode.title);
                indexed += 1;
            }
            Err(e) => {
                log::error!("Failed to index episode {}: {}", episode.id, e);
                failed += 1;
            }
        }
    }

    // Emit completion
    let _ = app_handle.emit("indexing_complete", serde_json::json!({
        "indexed": indexed,
        "failed": failed,
        "total": total,
    }));

    log::info!("Bulk indexing complete: {} indexed, {} failed, {} total", indexed, failed, total);

    Ok(IndexingResult {
        indexed,
        failed,
        total: total as i64,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IndexingResult {
    pub indexed: i64,
    pub failed: i64,
    pub total: i64,
}

/// Parse segments from transcript JSON content
fn parse_transcript_segments(content: &str) -> Option<Vec<TranscriptSegment>> {
    let json: serde_json::Value = serde_json::from_str(content).ok()?;

    // Try "segments" array (faster-whisper format)
    if let Some(segments) = json.get("segments").and_then(|v| v.as_array()) {
        let result: Vec<TranscriptSegment> = segments
            .iter()
            .filter_map(|seg| {
                let text = seg.get("text").and_then(|t| t.as_str())?.trim().to_string();
                if text.is_empty() {
                    return None;
                }

                let start_time = seg.get("start").and_then(|v| v.as_f64())
                    .or_else(|| seg.get("timestamps").and_then(|t| t.get(0)).and_then(|v| v.as_f64()))?;
                let end_time = seg.get("end").and_then(|v| v.as_f64())
                    .or_else(|| seg.get("timestamps").and_then(|t| t.get(1)).and_then(|v| v.as_f64()));
                let speaker = seg.get("speaker").and_then(|s| s.as_str()).map(|s| s.to_string());

                Some(TranscriptSegment {
                    speaker,
                    text,
                    start_time,
                    end_time,
                })
            })
            .collect();

        if !result.is_empty() {
            return Some(result);
        }
    }

    // Try "transcription" array (whisper-cli format)
    if let Some(transcription) = json.get("transcription").and_then(|v| v.as_array()) {
        let result: Vec<TranscriptSegment> = transcription
            .iter()
            .filter_map(|seg| {
                let text = seg.get("text").and_then(|t| t.as_str())?.trim().to_string();
                if text.is_empty() {
                    return None;
                }

                // whisper-cli uses "timestamps" array or "offsets" object
                let start_time = seg.get("timestamps").and_then(|t| t.get("from")).and_then(|v| v.as_str())
                    .and_then(|s| parse_timestamp_str(s))
                    .or_else(|| seg.get("offsets").and_then(|o| o.get("from")).and_then(|v| v.as_f64()).map(|ms| ms / 1000.0))?;
                let end_time = seg.get("timestamps").and_then(|t| t.get("to")).and_then(|v| v.as_str())
                    .and_then(|s| parse_timestamp_str(s))
                    .or_else(|| seg.get("offsets").and_then(|o| o.get("to")).and_then(|v| v.as_f64()).map(|ms| ms / 1000.0));
                let speaker = seg.get("speaker").and_then(|s| s.as_str()).map(|s| s.to_string());

                Some(TranscriptSegment {
                    speaker,
                    text,
                    start_time,
                    end_time,
                })
            })
            .collect();

        if !result.is_empty() {
            return Some(result);
        }
    }

    None
}

/// Parse timestamp string like "00:01:23.456" to seconds
pub fn parse_timestamp_str(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.split(':').collect();
    match parts.len() {
        3 => {
            let hours: f64 = parts[0].parse().ok()?;
            let minutes: f64 = parts[1].parse().ok()?;
            let seconds: f64 = parts[2].parse().ok()?;
            Some(hours * 3600.0 + minutes * 60.0 + seconds)
        }
        2 => {
            let minutes: f64 = parts[0].parse().ok()?;
            let seconds: f64 = parts[1].parse().ok()?;
            Some(minutes * 60.0 + seconds)
        }
        _ => None,
    }
}

// ============================================================================
// Detected Content Commands
// ============================================================================

#[tauri::command]
pub async fn get_detected_content(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Vec<DetectedContent>, String> {
    db.get_detected_content(episode_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_detected_content_by_type(
    db: State<'_, Arc<Database>>,
    content_type: String,
) -> Result<Vec<DetectedContentWithEpisode>, String> {
    db.get_detected_content_by_type(&content_type).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_detected_content(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    content_type: String,
    name: String,
    description: Option<String>,
    start_time: Option<f64>,
    end_time: Option<f64>,
    segment_idx: Option<i32>,
    confidence: Option<f64>,
    raw_text: Option<String>,
) -> Result<i64, String> {
    log::info!("Adding detected {} '{}' in episode {}", content_type, name, episode_id);
    db.add_detected_content(
        episode_id,
        &content_type,
        &name,
        description.as_deref(),
        start_time,
        end_time,
        segment_idx,
        confidence.unwrap_or(1.0),
        raw_text.as_deref(),
    ).map_err(|e| e.to_string())
}

// ============================================================================
// Flagged Segments Commands (Review Workflow)
// ============================================================================

#[tauri::command]
pub async fn create_flagged_segment(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    segment_idx: i32,
    flag_type: String,
    corrected_speaker: Option<String>,
    character_id: Option<i64>,
    notes: Option<String>,
    speaker_ids: Option<String>,
) -> Result<i64, String> {
    log::info!("Creating flagged segment for episode {} segment {}: type={}", episode_id, segment_idx, flag_type);
    db.create_flagged_segment(
        episode_id,
        segment_idx,
        &flag_type,
        corrected_speaker.as_deref(),
        character_id,
        notes.as_deref(),
        speaker_ids.as_deref(),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_flagged_segments(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Vec<FlaggedSegment>, String> {
    db.get_flagged_segments_for_episode(episode_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_flagged_segment(
    db: State<'_, Arc<Database>>,
    id: i64,
    flag_type: Option<String>,
    corrected_speaker: Option<String>,
    character_id: Option<i64>,
    notes: Option<String>,
    speaker_ids: Option<String>,
    resolved: Option<bool>,
) -> Result<(), String> {
    log::info!("Updating flagged segment {}", id);
    db.update_flagged_segment(
        id,
        flag_type.as_deref(),
        corrected_speaker.as_deref(),
        character_id,
        notes.as_deref(),
        speaker_ids.as_deref(),
        resolved,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_flagged_segment(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), String> {
    log::info!("Deleting flagged segment {}", id);
    db.delete_flagged_segment(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_unresolved_flag_count(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<i64, String> {
    db.get_unresolved_flag_count(episode_id).map_err(|e| e.to_string())
}

// ============================================================================
// Character Appearances Commands (additional)
// ============================================================================

#[tauri::command]
pub async fn get_character_appearances_for_episode(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Vec<CharacterAppearance>, String> {
    db.get_character_appearances_for_episode(episode_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_character_appearance(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), String> {
    log::info!("Deleting character appearance {}", id);
    db.delete_character_appearance(id).map_err(|e| e.to_string())
}

// ============================================================================
// Audio Drops Commands
// ============================================================================

#[tauri::command]
pub async fn get_audio_drops(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<AudioDrop>, String> {
    db.get_audio_drops().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_audio_drop(
    db: State<'_, Arc<Database>>,
    name: String,
    transcript_text: Option<String>,
    description: Option<String>,
    category: Option<String>,
) -> Result<i64, String> {
    log::info!("Creating audio drop: {}", name);
    db.create_audio_drop(&name, transcript_text.as_deref(), description.as_deref(), category.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_audio_drop(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), String> {
    log::info!("Deleting audio drop: {}", id);
    db.delete_audio_drop(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_audio_drop_instance(
    db: State<'_, Arc<Database>>,
    audio_drop_id: i64,
    episode_id: i64,
    segment_idx: Option<i32>,
    start_time: Option<f64>,
    end_time: Option<f64>,
    notes: Option<String>,
) -> Result<i64, String> {
    log::info!("Adding audio drop {} instance in episode {}", audio_drop_id, episode_id);
    db.add_audio_drop_instance(audio_drop_id, episode_id, segment_idx, start_time, end_time, notes.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_audio_drop_instances(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Vec<AudioDropInstance>, String> {
    db.get_audio_drop_instances_for_episode(episode_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_audio_drop_instance(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), String> {
    log::info!("Deleting audio drop instance {}", id);
    db.delete_audio_drop_instance(id).map_err(|e| e.to_string())
}
