use crate::database::{Database, models::{ChapterType, EpisodeChapter, ChapterLabelRule, Character, Sponsor, FlaggedSegment, CharacterAppearance, AudioDrop, AudioDropInstance, SegmentClassification, TranscriptCorrection}, SearchResult, TranscriptSegment, DetectedContent, DetectedContentWithEpisode};
use crate::error::AppError;
use crate::ollama::OllamaClient;
use std::sync::Arc;
use tauri::State;
use serde::{Deserialize, Serialize};

// ============================================================================
// Chapter Types Commands
// ============================================================================

#[tauri::command]
pub async fn get_chapter_types(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<ChapterType>, AppError> {
    db.get_chapter_types().map_err(AppError::from)
}

#[tauri::command]
pub async fn create_chapter_type(
    db: State<'_, Arc<Database>>,
    name: String,
    description: Option<String>,
    color: String,
    icon: Option<String>,
) -> Result<i64, AppError> {
    log::info!("Creating chapter type: {}", name);
    db.create_chapter_type(&name, description.as_deref(), &color, icon.as_deref())
        .map_err(AppError::from)
}

// ============================================================================
// Episode Chapters Commands
// ============================================================================

#[tauri::command]
pub async fn get_episode_chapters(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Vec<EpisodeChapter>, AppError> {
    db.get_episode_chapters(episode_id).map_err(AppError::from)
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
) -> Result<i64, AppError> {
    log::info!("Creating chapter for episode {}: type={}, start={}", episode_id, chapter_type_id, start_time);
    db.create_episode_chapter(
        episode_id, chapter_type_id, title.as_deref(),
        start_time, end_time, start_segment_idx, end_segment_idx
    ).map_err(AppError::from)
}

#[tauri::command]
pub async fn delete_episode_chapter(
    db: State<'_, Arc<Database>>,
    chapter_id: i64,
) -> Result<(), AppError> {
    log::info!("Deleting chapter: {}", chapter_id);
    db.delete_episode_chapter(chapter_id).map_err(AppError::from)
}

// ============================================================================
// Characters Commands
// ============================================================================

#[tauri::command]
pub async fn get_characters(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Character>, AppError> {
    db.get_characters().map_err(AppError::from)
}

#[tauri::command]
pub async fn create_character(
    db: State<'_, Arc<Database>>,
    name: String,
    short_name: Option<String>,
    description: Option<String>,
    catchphrase: Option<String>,
    speaker_id: Option<i64>,
) -> Result<i64, AppError> {
    log::info!("Creating character: {}", name);
    db.create_character(&name, short_name.as_deref(), description.as_deref(), catchphrase.as_deref(), speaker_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn update_character(
    db: State<'_, Arc<Database>>,
    id: i64,
    name: String,
    short_name: Option<String>,
    description: Option<String>,
    catchphrase: Option<String>,
    speaker_id: Option<i64>,
) -> Result<(), AppError> {
    log::info!("Updating character {}: {}", id, name);
    db.update_character(id, &name, short_name.as_deref(), description.as_deref(), catchphrase.as_deref(), speaker_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn delete_character(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), AppError> {
    log::info!("Deleting character: {}", id);
    db.delete_character(id).map_err(AppError::from)
}

#[tauri::command]
pub async fn add_character_appearance(
    db: State<'_, Arc<Database>>,
    character_id: i64,
    episode_id: i64,
    start_time: Option<f64>,
    end_time: Option<f64>,
    segment_idx: Option<i32>,
) -> Result<i64, AppError> {
    log::info!("Adding character {} appearance in episode {}", character_id, episode_id);
    db.add_character_appearance(character_id, episode_id, start_time, end_time, segment_idx)
        .map_err(AppError::from)
}

// ============================================================================
// Sponsors Commands
// ============================================================================

#[tauri::command]
pub async fn get_sponsors(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Sponsor>, AppError> {
    db.get_sponsors().map_err(AppError::from)
}

#[tauri::command]
pub async fn create_sponsor(
    db: State<'_, Arc<Database>>,
    name: String,
    tagline: Option<String>,
    description: Option<String>,
    is_real: bool,
) -> Result<i64, AppError> {
    log::info!("Creating sponsor: {} (real: {})", name, is_real);
    db.create_sponsor(&name, tagline.as_deref(), description.as_deref(), is_real)
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn update_sponsor(
    db: State<'_, Arc<Database>>,
    id: i64,
    name: String,
    tagline: Option<String>,
    description: Option<String>,
    is_real: bool,
) -> Result<(), AppError> {
    log::info!("Updating sponsor {}: {}", id, name);
    db.update_sponsor(id, &name, tagline.as_deref(), description.as_deref(), is_real)
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn delete_sponsor(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), AppError> {
    log::info!("Deleting sponsor: {}", id);
    db.delete_sponsor(id).map_err(AppError::from)
}

#[tauri::command]
pub async fn add_sponsor_mention(
    db: State<'_, Arc<Database>>,
    sponsor_id: i64,
    episode_id: i64,
    start_time: Option<f64>,
    end_time: Option<f64>,
    segment_idx: Option<i32>,
) -> Result<i64, AppError> {
    log::info!("Adding sponsor {} mention in episode {}", sponsor_id, episode_id);
    db.add_sponsor_mention(sponsor_id, episode_id, start_time, end_time, segment_idx)
        .map_err(AppError::from)
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
) -> Result<SearchResponse, AppError> {
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
        .map_err(AppError::from)?;
    let total = db.count_search_results(clean_query)
        .map_err(AppError::from)?;

    Ok(SearchResponse {
        results,
        total,
        query,
    })
}

#[tauri::command]
pub async fn get_search_stats(
    db: State<'_, Arc<Database>>,
) -> Result<SearchStats, AppError> {
    let indexed_segments = db.get_indexed_segment_count()
        .map_err(AppError::from)?;
    let unindexed_episodes = db.get_unindexed_episodes()
        .map_err(AppError::from)?;

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
) -> Result<(), AppError> {
    log::info!("Indexing {} segments for episode {}", segments.len(), episode_id);

    let segments: Vec<TranscriptSegment> = segments.into_iter().map(|s| TranscriptSegment {
        speaker: s.speaker,
        text: s.text,
        start_time: s.start_time,
        end_time: s.end_time,
    }).collect();

    db.index_transcript_segments(episode_id, &segments)
        .map_err(AppError::from)
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
) -> Result<IndexingResult, AppError> {
    use tauri::Emitter;

    log::info!("Starting bulk transcript indexing");

    // Get all unindexed episodes
    let episodes = db.get_unindexed_episodes()
        .map_err(AppError::from)?;

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

/// Re-index ALL transcribed episodes, resolving SPEAKER_XX labels to real
/// speaker names from the episode_speakers table.  This is the backfill path
/// for episodes that were indexed before speaker names were assigned.
#[tauri::command]
pub async fn reindex_all_with_speakers(
    db: State<'_, Arc<Database>>,
    app_handle: tauri::AppHandle,
) -> Result<IndexingResult, AppError> {
    use tauri::Emitter;

    log::info!("Starting reindex-with-speakers backfill");

    let episodes = db.get_all_transcribed_episode_ids()
        .map_err(AppError::from)?;

    let total = episodes.len();
    log::info!("Found {} transcribed episodes to reindex", total);

    if total == 0 {
        return Ok(IndexingResult { indexed: 0, failed: 0, total: 0 });
    }

    let mut indexed = 0i64;
    let mut failed = 0i64;

    for (i, (episode_id, title)) in episodes.iter().enumerate() {
        let _ = app_handle.emit("indexing_progress", serde_json::json!({
            "current": i + 1,
            "total": total,
            "episode_title": title,
        }));

        match db.index_episode_from_file(*episode_id) {
            Ok(0) => {
                log::warn!("No segments indexed for episode {} ({})", episode_id, title);
                failed += 1;
            }
            Ok(n) => {
                log::info!("Reindexed {} segments for episode {} ({})", n, episode_id, title);
                indexed += 1;
            }
            Err(e) => {
                log::error!("Failed to reindex episode {} ({}): {}", episode_id, title, e);
                failed += 1;
            }
        }
    }

    let _ = app_handle.emit("indexing_complete", serde_json::json!({
        "indexed": indexed,
        "failed": failed,
        "total": total,
    }));

    log::info!("Reindex-with-speakers complete: {} indexed, {} failed, {} total", indexed, failed, total);

    Ok(IndexingResult {
        indexed,
        failed,
        total: total as i64,
    })
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
) -> Result<Vec<DetectedContent>, AppError> {
    db.get_detected_content(episode_id).map_err(AppError::from)
}

#[tauri::command]
pub async fn get_detected_content_by_type(
    db: State<'_, Arc<Database>>,
    content_type: String,
) -> Result<Vec<DetectedContentWithEpisode>, AppError> {
    db.get_detected_content_by_type(&content_type).map_err(AppError::from)
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
) -> Result<i64, AppError> {
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
    ).map_err(AppError::from)
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
) -> Result<i64, AppError> {
    log::info!("Creating flagged segment for episode {} segment {}: type={}", episode_id, segment_idx, flag_type);
    db.create_flagged_segment(
        episode_id,
        segment_idx,
        &flag_type,
        corrected_speaker.as_deref(),
        character_id,
        notes.as_deref(),
        speaker_ids.as_deref(),
    ).map_err(AppError::from)
}

#[tauri::command]
pub async fn get_flagged_segments(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Vec<FlaggedSegment>, AppError> {
    db.get_flagged_segments_for_episode(episode_id).map_err(AppError::from)
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
) -> Result<(), AppError> {
    log::info!("Updating flagged segment {}", id);
    db.update_flagged_segment(
        id,
        flag_type.as_deref(),
        corrected_speaker.as_deref(),
        character_id,
        notes.as_deref(),
        speaker_ids.as_deref(),
        resolved,
    ).map_err(AppError::from)
}

#[tauri::command]
pub async fn delete_flagged_segment(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), AppError> {
    log::info!("Deleting flagged segment {}", id);
    db.delete_flagged_segment(id).map_err(AppError::from)
}

#[tauri::command]
pub async fn get_unresolved_flag_count(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<i64, AppError> {
    db.get_unresolved_flag_count(episode_id).map_err(AppError::from)
}

// ============================================================================
// Character Appearances Commands (additional)
// ============================================================================

#[tauri::command]
pub async fn get_character_appearances_for_episode(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Vec<CharacterAppearance>, AppError> {
    db.get_character_appearances_for_episode(episode_id).map_err(AppError::from)
}

#[tauri::command]
pub async fn get_character_appearances_for_character(
    db: State<'_, Arc<Database>>,
    character_id: i64,
) -> Result<Vec<CharacterAppearance>, AppError> {
    db.get_character_appearances_for_character(character_id).map_err(AppError::from)
}

#[tauri::command]
pub async fn delete_character_appearance(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), AppError> {
    log::info!("Deleting character appearance {}", id);
    db.delete_character_appearance(id).map_err(AppError::from)
}

// ============================================================================
// Audio Drops Commands
// ============================================================================

#[tauri::command]
pub async fn get_audio_drops(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<AudioDrop>, AppError> {
    db.get_audio_drops().map_err(AppError::from)
}

#[tauri::command]
pub async fn create_audio_drop(
    db: State<'_, Arc<Database>>,
    name: String,
    transcript_text: Option<String>,
    description: Option<String>,
    category: Option<String>,
) -> Result<i64, AppError> {
    log::info!("Creating audio drop: {}", name);
    db.create_audio_drop(&name, transcript_text.as_deref(), description.as_deref(), category.as_deref())
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn update_audio_drop_transcript(
    db: State<'_, Arc<Database>>,
    drop_id: i64,
    text: String,
) -> Result<(), AppError> {
    db.update_audio_drop_transcript(drop_id, &text).map_err(AppError::from)
}

#[tauri::command]
pub async fn delete_audio_drop(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), AppError> {
    log::info!("Deleting audio drop: {}", id);
    db.delete_audio_drop(id).map_err(AppError::from)
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
) -> Result<i64, AppError> {
    log::info!("Adding audio drop {} instance in episode {}", audio_drop_id, episode_id);
    db.add_audio_drop_instance(audio_drop_id, episode_id, segment_idx, start_time, end_time, notes.as_deref())
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_audio_drop_instances(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Vec<AudioDropInstance>, AppError> {
    db.get_audio_drop_instances_for_episode(episode_id).map_err(AppError::from)
}

#[tauri::command]
pub async fn delete_audio_drop_instance(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), AppError> {
    log::info!("Deleting audio drop instance {}", id);
    db.delete_audio_drop_instance(id).map_err(AppError::from)
}

// ============================================================================
// Chapter Label Rules Commands
// ============================================================================

#[tauri::command]
pub async fn get_chapter_label_rules(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<ChapterLabelRule>, AppError> {
    db.get_chapter_label_rules().map_err(AppError::from)
}

#[tauri::command]
pub async fn save_chapter_label_rule(
    db: State<'_, Arc<Database>>,
    id: Option<i64>,
    chapter_type_id: i64,
    pattern: String,
    match_type: String,
    priority: i32,
    enabled: bool,
) -> Result<i64, AppError> {
    db.save_chapter_label_rule(id, chapter_type_id, &pattern, &match_type, priority, enabled)
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn delete_chapter_label_rule(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), AppError> {
    db.delete_chapter_label_rule(id).map_err(AppError::from)
}

/// Run auto-labeling for an episode using chapter_label_rules.
/// Returns the number of chapters created.
#[tauri::command]
pub async fn auto_label_chapters(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    overwrite: bool,
) -> Result<i64, AppError> {
    use regex::Regex;

    let rules = db.get_chapter_label_rules().map_err(AppError::from)?;
    let enabled_rules: Vec<_> = rules.into_iter().filter(|r| r.enabled).collect();
    if enabled_rules.is_empty() {
        return Ok(0);
    }

    // Determine which chapter_type_ids already have chapters for this episode
    let existing = db.get_episode_chapters(episode_id).map_err(AppError::from)?;
    let existing_type_ids: std::collections::HashSet<i64> = if overwrite {
        std::collections::HashSet::new()
    } else {
        existing.iter().map(|c| c.chapter_type_id).collect()
    };

    // Load transcript segments
    let segments = db.get_transcript_segments_for_episode(episode_id).map_err(AppError::from)?;
    if segments.is_empty() {
        return Err(AppError::Other("No transcript segments indexed for this episode — run FTS index first".into()));
    }

    let mut created: i64 = 0;

    for rule in &enabled_rules {
        if existing_type_ids.contains(&rule.chapter_type_id) {
            continue;
        }

        let matched = segments.iter().find(|(_, text, _)| {
            let t = text.to_lowercase();
            let p = rule.pattern.to_lowercase();
            match rule.match_type.as_str() {
                "starts_with" => t.starts_with(&p),
                "regex" => Regex::new(&rule.pattern).map(|re| re.is_match(text)).unwrap_or(false),
                _ => t.contains(&p), // "contains"
            }
        });

        if let Some((seg_idx, _, start_time)) = matched {
            db.create_episode_chapter(
                episode_id, rule.chapter_type_id, None,
                *start_time, None, Some(*seg_idx), None,
            ).map_err(AppError::from)?;
            log::info!("Auto-labeled chapter type {} at segment {} for episode {}", rule.chapter_type_id, seg_idx, episode_id);
            created += 1;
        }
    }

    Ok(created)
}

// ============================================================================
// AI Chapter Detection
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiChapterSuggestion {
    pub chapter_type_id: Option<i64>,
    pub chapter_type_name: Option<String>,
    pub start_segment_idx: i32,
    pub end_segment_idx: i32,
    pub start_time: f64,
    pub end_time: f64,
    pub confidence: Option<f64>,
    pub reason: Option<String>,
}

#[tauri::command]
pub async fn run_ai_chapter_detection(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Vec<AiChapterSuggestion>, AppError> {
    let chapter_types = db.get_chapter_types().map_err(AppError::from)?;
    if chapter_types.is_empty() {
        return Err(AppError::Other("No chapter types configured".into()));
    }

    let segments = db.get_transcript_segments_for_episode_full(episode_id).map_err(AppError::from)?;
    if segments.is_empty() {
        return Err(AppError::Other("No transcript segments indexed for this episode".into()));
    }

    let total = segments.len().max(1) as f64;
    let mut lines = String::new();
    for (idx, text, start_time, _) in &segments {
        let pct = (*idx as f64 / (total - 1.0).max(1.0) * 100.0).round();
        let snippet = text.replace('\n', " ");
        lines.push_str(&format!(
            "#{idx} ({pct:.0}% @ {start_time:.1}s): {snippet}\n"
        ));
        if lines.len() > 18000 {
            break;
        }
    }

    let type_list = chapter_types
        .iter()
        .map(|t| format!("- {} (id: {})", t.name, t.id))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        "You are labeling podcast chapters. Use ONLY the chapter types listed below.\n\
Return JSON array of objects with keys: chapter_type, start_segment_idx, end_segment_idx, confidence, reason.\n\
chapter_type must match a listed name exactly.\n\n\
CHAPTER TYPES:\n{type_list}\n\n\
Respond with JSON only."
    );

    let client = OllamaClient::new();
    let response = client
        .extract_content(&lines, &prompt, Some("You are a careful labeling assistant. Output JSON only."))
        .await
        .map_err(AppError::Other)?;

    let json = response.parsed_json.ok_or_else(|| AppError::Other("AI response did not contain valid JSON".into()))?;
    let arr = json.as_array().cloned().unwrap_or_else(|| {
        json.get("chapters").and_then(|v| v.as_array()).cloned().unwrap_or_default()
    });

    let mut type_map = std::collections::HashMap::new();
    for t in &chapter_types {
        type_map.insert(t.name.to_lowercase(), (t.id, t.name.clone()));
    }

    let mut suggestions = Vec::new();
    for item in arr {
        let obj = match item.as_object() {
            Some(o) => o,
            None => continue,
        };
        let chapter_type_name = obj
            .get("chapter_type")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string());
        let (chapter_type_id, resolved_name) = chapter_type_name
            .as_ref()
            .and_then(|n| type_map.get(&n.to_lowercase()).cloned())
            .map(|(id, name)| (Some(id), Some(name)))
            .unwrap_or((None, chapter_type_name.clone()));

        let start_idx = obj
            .get("start_segment_idx")
            .and_then(|v| v.as_i64())
            .or_else(|| obj.get("start_segment").and_then(|v| v.as_i64()))
            .unwrap_or(0) as i32;
        let end_idx = obj
            .get("end_segment_idx")
            .and_then(|v| v.as_i64())
            .or_else(|| obj.get("end_segment").and_then(|v| v.as_i64()))
            .unwrap_or(start_idx as i64) as i32;

        let confidence = obj.get("confidence").and_then(|v| v.as_f64());
        let reason = obj.get("reason").and_then(|v| v.as_str()).map(|s| s.to_string());

        let get_time = |idx: i32| -> (f64, f64) {
            let idx_usize = idx.max(0) as usize;
            let (start, end_opt) = segments
                .get(idx_usize)
                .map(|(_, _, s, e)| (*s, *e))
                .unwrap_or((0.0, None));
            let end = end_opt.or_else(|| {
                segments.get(idx_usize + 1).map(|(_, _, s, _)| *s)
            }).unwrap_or(start + 10.0);
            (start, end)
        };

        let (start_time, _) = get_time(start_idx);
        let (_, end_time) = get_time(end_idx);

        suggestions.push(AiChapterSuggestion {
            chapter_type_id,
            chapter_type_name: resolved_name,
            start_segment_idx: start_idx,
            end_segment_idx: end_idx,
            start_time,
            end_time,
            confidence,
            reason,
        });
    }

    Ok(suggestions)
}

// ============================================================================
// Sponsor Clip Export
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSponsorClipResult {
    pub output_path: String,
}

#[tauri::command]
pub async fn export_sponsor_clip(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    start_time: f64,
    end_time: f64,
    sponsor_name: String,
) -> Result<ExportSponsorClipResult, AppError> {
    let episode = db.get_episode_by_id(episode_id).map_err(AppError::from)?
        .ok_or_else(|| AppError::Other("Episode not found".into()))?;
    let audio_path_raw = episode.audio_file_path.clone()
        .ok_or_else(|| AppError::Other("Episode audio not downloaded".into()))?;

    let mut duration = end_time - start_time;
    if duration <= 0.1 {
        duration = 15.0;
    }

    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let project_dir = home_dir.join("Desktop").join("Projects").join("ice-cream-social-app");
    let export_dir = project_dir.join("exports").join("sponsor_clips");
    std::fs::create_dir_all(&export_dir).ok();

    let safe_name = sponsor_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>();
    let output_path = export_dir.join(format!("ep{}_{}.mp4", episode_id, safe_name));

    let episode_num = episode.episode_number.clone().unwrap_or_default();
    let clean_num = episode_num
        .chars()
        .filter(|c: &char| c.is_ascii_digit())
        .collect::<String>();
    let image_url = if !clean_num.is_empty() {
        Some(format!("https://heyscoops.fandom.com/wiki/Special:FilePath/ICS_{}.png", clean_num))
    } else {
        None
    };

    // Download episode art (best-effort)
    let mut image_path: Option<std::path::PathBuf> = None;
    if let Some(url) = image_url {
        if let Ok(resp) = reqwest::get(url).await {
            if let Ok(bytes) = resp.bytes().await {
                let tmp = std::env::temp_dir().join(format!("ics_ep{}_art.png", episode_id));
                if std::fs::write(&tmp, &bytes).is_ok() {
                    image_path = Some(tmp);
                }
            }
        }
    }

    // Build transcript snippet from segments within range
    let segments = db.get_transcript_segments_for_episode_full(episode_id).map_err(AppError::from)?;
    let mut snippet = String::new();
    for (_, text, s, e) in &segments {
        let seg_end = e.unwrap_or(*s + 5.0);
        if *s >= start_time && seg_end <= end_time {
            if !snippet.is_empty() {
                snippet.push(' ');
            }
            snippet.push_str(text.trim());
        }
        if snippet.len() > 160 {
            snippet.truncate(160);
            snippet.push_str("…");
            break;
        }
    }
    if snippet.is_empty() {
        snippet = "Sponsor clip".to_string();
    }

    let sponsor_text = format!("Sponsor: {}", sponsor_name);
    let episode_text = episode.title.clone();

    let sponsor_file = std::env::temp_dir().join(format!("ics_ep{}_sponsor.txt", episode_id));
    let episode_file = std::env::temp_dir().join(format!("ics_ep{}_title.txt", episode_id));
    let snippet_file = std::env::temp_dir().join(format!("ics_ep{}_snippet.txt", episode_id));
    let _ = std::fs::write(&sponsor_file, sponsor_text);
    let _ = std::fs::write(&episode_file, episode_text);
    let _ = std::fs::write(&snippet_file, snippet);

    let mut cmd = std::process::Command::new("ffmpeg");
    cmd.arg("-y");

    if let Some(img) = &image_path {
        cmd.args(["-loop", "1", "-i"]).arg(img);
    } else {
        cmd.args(["-f", "lavfi", "-i", "color=c=black:s=1280x720"]);
    }

    let mut audio_path = std::path::PathBuf::from(&audio_path_raw);
    if !audio_path.is_absolute() {
        audio_path = project_dir.join(audio_path);
    }

    cmd.args(["-ss", &start_time.to_string(), "-t", &duration.to_string(), "-i"])
        .arg(&audio_path);

    let filter = format!(
        "scale=1280:720,format=yuv420p,\
drawbox=x=40:y=40:w=1200:h=120:color=black@0.35:t=fill,\
drawtext=textfile={}:fontcolor=white:fontsize=36:x=60:y=60,\
drawbox=x=40:y=520:w=1200:h=160:color=black@0.35:t=fill,\
drawtext=textfile={}:fontcolor=white:fontsize=28:x=60:y=540,\
drawtext=textfile={}:fontcolor=white:fontsize=22:x=60:y=590",
        sponsor_file.to_string_lossy(),
        episode_file.to_string_lossy(),
        snippet_file.to_string_lossy()
    );

    cmd.args(["-filter_complex", &filter, "-shortest", "-map", "0:v", "-map", "1:a"])
        .arg(&output_path);

    let output = cmd.output().map_err(|e| format!("Failed to run ffmpeg: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Other(format!("ffmpeg failed: {}", stderr)));
    }

    Ok(ExportSponsorClipResult {
        output_path: output_path.to_string_lossy().to_string(),
    })
}

// ============================================================================
// Qwen Segment Classification Commands
// ============================================================================

/// Run Qwen2.5-Omni-3B classification on specific segments.
/// Spawns Python subprocess, streams QWEN_PROGRESS events, saves pending results.
#[tauri::command]
pub async fn run_qwen_classification(
    db: State<'_, Arc<Database>>,
    app: tauri::AppHandle,
    episode_id: i64,
    segment_indices: Vec<i32>,
) -> Result<(), AppError> {
    use tauri::Emitter;
    use tokio::io::AsyncBufReadExt;

    log::info!(
        "run_qwen_classification: episode={} segments={:?}",
        episode_id,
        segment_indices
    );

    if segment_indices.is_empty() {
        return Err(AppError::Other("No segment indices provided".into()));
    }

    // Resolve project paths
    let home_dir = dirs::home_dir().ok_or_else(|| AppError::Other("Failed to get home dir".into()))?;
    let project_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app");
    let venv_python = project_dir.join("venv").join("bin").join("python");
    let classify_script = project_dir.join("scripts").join("qwen_classify_segments.py");

    if !venv_python.exists() {
        return Err(AppError::Other(format!("venv python not found at {:?}", venv_python)));
    }
    if !classify_script.exists() {
        return Err(AppError::Other(format!("classify script not found at {:?}", classify_script)));
    }

    // Fetch episode audio path from DB
    let audio_path = db.get_episode_audio_path(episode_id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Other(format!(
            "Episode {} has no downloaded audio file — download it first", episode_id
        )))?;

    // Fetch segment start/end times from DB
    let all_segments = db.get_transcript_segments_for_episode(episode_id)
        .map_err(AppError::from)?;

    let idx_set: std::collections::HashSet<i32> = segment_indices.iter().cloned().collect();
    // Build target_segments — use next segment's start_time as natural end_time
    let target_segments: Vec<serde_json::Value> = {
        let mut result = Vec::new();
        for (pos, (idx, _, start_time)) in all_segments.iter().enumerate() {
            if idx_set.contains(idx) {
                let end_time = all_segments
                    .get(pos + 1)
                    .map(|(_, _, next_start)| *next_start)
                    .unwrap_or(start_time + 30.0);
                result.push(serde_json::json!({
                    "segment_idx": idx,
                    "start": start_time,
                    "end": end_time,
                }));
            }
        }
        result
    };

    if target_segments.is_empty() {
        return Err(AppError::Other(
            "None of the requested segment indices are indexed in the FTS table. Run FTS index first.".into()
        ));
    }

    // Fetch all characters for context prompt
    let characters = db.get_characters().map_err(AppError::from)?;
    let char_json: Vec<serde_json::Value> = characters
        .iter()
        .map(|c| serde_json::json!({
            "name": c.name,
            "catchphrase": c.catchphrase,
        }))
        .collect();

    let segments_json = serde_json::to_string(&target_segments)
        .map_err(|e| AppError::Other(e.to_string()))?;
    let characters_json = serde_json::to_string(&char_json)
        .map_err(|e| AppError::Other(e.to_string()))?;

    // Spawn Python subprocess
    let mut child = tokio::process::Command::new(&venv_python)
        .args([
            classify_script.to_str().unwrap(),
            "--audio-file", &audio_path,
            "--segments", &segments_json,
            "--characters", &characters_json,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Other(format!("Failed to spawn qwen classify: {}", e)))?;

    let stdout = child.stdout.take().expect("Failed to get stdout");
    let stderr = child.stderr.take().expect("Failed to get stderr");
    let mut reader = tokio::io::BufReader::new(stdout).lines();

    let mut all_stdout_lines: Vec<String> = Vec::new();

    // Stream stdout, watch for QWEN_PROGRESS lines and collect all output
    while let Ok(Some(line)) = reader.next_line().await {
        if line.starts_with("QWEN_PROGRESS:") {
            if let Some(pct_str) = line.split(':').nth(1) {
                if let Ok(pct) = pct_str.trim().parse::<i32>() {
                    let _ = app.emit("qwen_progress", serde_json::json!({
                        "episode_id": episode_id,
                        "progress": pct,
                    }));
                }
            }
        }
        all_stdout_lines.push(line);
    }

    // Collect stderr asynchronously
    let mut err_reader = tokio::io::BufReader::new(stderr).lines();
    let mut stderr_lines: Vec<String> = Vec::new();
    while let Ok(Some(line)) = err_reader.next_line().await {
        stderr_lines.push(line);
    }

    // Wait for process exit status
    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Other(format!("Failed to wait for qwen process: {}", e)))?;

    if !status.success() {
        let stderr_text = stderr_lines.join("\n");
        log::error!("Qwen classify stderr: {}", stderr_text);
        return Err(AppError::Other(format!("Qwen classification failed: {}", stderr_text)));
    }

    // Find the JSON line in stdout (last line starting with '{')
    let json_str = all_stdout_lines
        .iter()
        .rev()
        .find(|l| l.trim_start().starts_with('{'))
        .cloned()
        .ok_or_else(|| AppError::Other(format!(
            "No JSON output from qwen script. stdout: {}",
            all_stdout_lines.join("\n")
        )))?;

    let result: serde_json::Value = serde_json::from_str(json_str.trim())
        .map_err(|e| AppError::Other(format!("Failed to parse qwen output JSON: {} — raw: {}", e, &json_str[..json_str.len().min(300)])))?;

    if result.get("status").and_then(|v| v.as_str()) == Some("error") {
        let msg = result.get("message").and_then(|v| v.as_str()).unwrap_or("unknown error");
        return Err(AppError::Other(format!("Qwen script error: {}", msg)));
    }

    let results = result.get("results")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::Other("Qwen output missing 'results' array".into()))?;

    let elapsed = result.get("elapsed_secs").and_then(|v| v.as_f64()).unwrap_or(0.0);
    log::info!(
        "Qwen classification complete: {} results in {:.1}s",
        results.len(),
        elapsed
    );

    // Save pending classifications to DB
    db.save_segment_classifications(episode_id, results)
        .map_err(AppError::from)?;

    // Emit completion event
    let _ = app.emit("qwen_complete", serde_json::json!({
        "episode_id": episode_id,
        "result_count": results.len(),
        "elapsed_secs": elapsed,
    }));

    Ok(())
}

/// Get all segment classifications for an episode (includes pending, approved, rejected).
#[tauri::command]
pub async fn get_segment_classifications(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Vec<SegmentClassification>, AppError> {
    db.get_segment_classifications(episode_id).map_err(AppError::from)
}

/// Approve a segment classification: writes is_performance_bit + optional character_appearance.
#[tauri::command]
pub async fn approve_segment_classification(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), AppError> {
    log::info!("Approving segment classification {}", id);
    db.approve_segment_classification(id).map_err(AppError::from)
}

/// Reject a segment classification: sets approved=-1, no DB writes to segments.
#[tauri::command]
pub async fn reject_segment_classification(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), AppError> {
    log::info!("Rejecting segment classification {}", id);
    db.reject_segment_classification(id).map_err(AppError::from)
}

// ============================================================================
// Scoop Polish Commands (transcript text correction + multi-speaker detection)
// ============================================================================

/// Run Qwen2.5-Omni-3B in "polish" mode on specific segments.
/// Corrects misheared words and detects brief second-speaker moments.
#[tauri::command]
pub async fn run_qwen_polish(
    db: State<'_, Arc<Database>>,
    app: tauri::AppHandle,
    episode_id: i64,
    segment_indices: Vec<i32>,
) -> Result<(), AppError> {
    use tauri::Emitter;
    use tokio::io::AsyncBufReadExt;

    log::info!(
        "run_qwen_polish: episode={} segments={:?}",
        episode_id,
        segment_indices
    );

    if segment_indices.is_empty() {
        return Err(AppError::Other("No segment indices provided".into()));
    }

    // Resolve project paths
    let home_dir = dirs::home_dir().ok_or_else(|| AppError::Other("Failed to get home dir".into()))?;
    let project_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app");
    let venv_python = project_dir.join("venv").join("bin").join("python");
    let classify_script = project_dir.join("scripts").join("qwen_classify_segments.py");

    if !venv_python.exists() {
        return Err(AppError::Other(format!("venv python not found at {:?}", venv_python)));
    }
    if !classify_script.exists() {
        return Err(AppError::Other(format!("classify script not found at {:?}", classify_script)));
    }

    // Fetch episode audio path from DB
    let audio_path = db.get_episode_audio_path(episode_id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Other(format!(
            "Episode {} has no downloaded audio file — download it first", episode_id
        )))?;

    // Fetch segment start/end times from DB
    let all_segments = db.get_transcript_segments_for_episode(episode_id)
        .map_err(AppError::from)?;

    let idx_set: std::collections::HashSet<i32> = segment_indices.iter().cloned().collect();

    // Build target_segments and segment_texts map
    let mut segment_texts_map = serde_json::Map::new();
    let target_segments: Vec<serde_json::Value> = {
        let mut result = Vec::new();
        for (pos, (idx, text, start_time)) in all_segments.iter().enumerate() {
            if idx_set.contains(idx) {
                let end_time = all_segments
                    .get(pos + 1)
                    .map(|(_, _, next_start)| *next_start)
                    .unwrap_or(start_time + 30.0);
                result.push(serde_json::json!({
                    "segment_idx": idx,
                    "start": start_time,
                    "end": end_time,
                }));
                segment_texts_map.insert(idx.to_string(), serde_json::Value::String(text.clone()));
            }
        }
        result
    };

    if target_segments.is_empty() {
        return Err(AppError::Other(
            "None of the requested segment indices are indexed in the FTS table. Run FTS index first.".into()
        ));
    }

    let segments_json = serde_json::to_string(&target_segments)
        .map_err(|e| AppError::Other(e.to_string()))?;
    let segment_texts_json = serde_json::to_string(&serde_json::Value::Object(segment_texts_map))
        .map_err(|e| AppError::Other(e.to_string()))?;

    // Spawn Python subprocess in polish mode
    let mut child = tokio::process::Command::new(&venv_python)
        .args([
            classify_script.to_str().unwrap(),
            "--audio-file", &audio_path,
            "--segments", &segments_json,
            "--mode", "polish",
            "--segment-texts", &segment_texts_json,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Other(format!("Failed to spawn qwen polish: {}", e)))?;

    let stdout = child.stdout.take().expect("Failed to get stdout");
    let stderr = child.stderr.take().expect("Failed to get stderr");
    let mut reader = tokio::io::BufReader::new(stdout).lines();

    let mut all_stdout_lines: Vec<String> = Vec::new();

    // Stream stdout, watch for QWEN_PROGRESS lines
    while let Ok(Some(line)) = reader.next_line().await {
        if line.starts_with("QWEN_PROGRESS:") {
            if let Some(pct_str) = line.split(':').nth(1) {
                if let Ok(pct) = pct_str.trim().parse::<i32>() {
                    let _ = app.emit("polish_progress", serde_json::json!({
                        "episode_id": episode_id,
                        "progress": pct,
                    }));
                }
            }
        }
        all_stdout_lines.push(line);
    }

    // Collect stderr
    let mut err_reader = tokio::io::BufReader::new(stderr).lines();
    let mut stderr_lines: Vec<String> = Vec::new();
    while let Ok(Some(line)) = err_reader.next_line().await {
        stderr_lines.push(line);
    }

    // Wait for process exit
    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Other(format!("Failed to wait for qwen polish process: {}", e)))?;

    if !status.success() {
        let stderr_text = stderr_lines.join("\n");
        log::error!("Qwen polish stderr: {}", stderr_text);
        return Err(AppError::Other(format!("Qwen polish failed: {}", stderr_text)));
    }

    // Find JSON line in stdout
    let json_str = all_stdout_lines
        .iter()
        .rev()
        .find(|l| l.trim_start().starts_with('{'))
        .cloned()
        .ok_or_else(|| AppError::Other(format!(
            "No JSON output from qwen polish script. stdout: {}",
            all_stdout_lines.join("\n")
        )))?;

    let result: serde_json::Value = serde_json::from_str(json_str.trim())
        .map_err(|e| AppError::Other(format!("Failed to parse qwen polish output: {} — raw: {}", e, &json_str[..json_str.len().min(300)])))?;

    if result.get("status").and_then(|v| v.as_str()) == Some("error") {
        let msg = result.get("message").and_then(|v| v.as_str()).unwrap_or("unknown error");
        return Err(AppError::Other(format!("Qwen polish script error: {}", msg)));
    }

    let results = result.get("results")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::Other("Qwen polish output missing 'results' array".into()))?;

    let elapsed = result.get("elapsed_secs").and_then(|v| v.as_f64()).unwrap_or(0.0);
    log::info!(
        "Qwen polish complete: {} results in {:.1}s",
        results.len(),
        elapsed
    );

    // Save pending corrections to DB
    db.save_transcript_corrections(episode_id, results)
        .map_err(AppError::from)?;

    // Emit completion event
    let _ = app.emit("polish_complete", serde_json::json!({
        "episode_id": episode_id,
        "result_count": results.len(),
        "elapsed_secs": elapsed,
    }));

    Ok(())
}

/// Get all transcript corrections for an episode (pending, approved, and rejected).
#[tauri::command]
pub async fn get_transcript_corrections(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Vec<TranscriptCorrection>, AppError> {
    db.get_transcript_corrections(episode_id).map_err(AppError::from)
}

/// Approve a transcript correction: sets approved=1.
/// The frontend is responsible for calling save_transcript_edits to write the text to disk.
#[tauri::command]
pub async fn approve_transcript_correction(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), AppError> {
    log::info!("Approving transcript correction {}", id);
    db.approve_transcript_correction(id).map_err(AppError::from)
}

/// Reject a transcript correction: sets approved=-1.
#[tauri::command]
pub async fn reject_transcript_correction(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), AppError> {
    log::info!("Rejecting transcript correction {}", id);
    db.reject_transcript_correction(id).map_err(AppError::from)
}
