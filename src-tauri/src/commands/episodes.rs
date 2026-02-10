use crate::database::{Database, Episode, FeedSource, TranscriptData};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Deserialize)]
pub struct EpisodeFilters {
    pub feed_source: Option<String>,
    pub transcribed_only: Option<bool>,
    pub in_queue_only: Option<bool>,
    pub sort_by: Option<String>,
    pub sort_desc: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub search: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EpisodesResponse {
    pub episodes: Vec<Episode>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
    pub has_more: bool,
}

#[derive(Debug, Serialize)]
pub struct RefreshResult {
    pub added: i64,
    pub updated: i64,
    pub total: i64,
}

/// GET /api/v2/episodes -> get_episodes command
#[tauri::command]
pub async fn get_episodes(
    db: State<'_, Arc<Database>>,
    filters: Option<EpisodeFilters>,
) -> Result<EpisodesResponse, String> {
    log::info!("get_episodes called with filters: {:?}", filters);

    let filters = filters.unwrap_or(EpisodeFilters {
        feed_source: None,
        transcribed_only: None,
        in_queue_only: None,
        sort_by: None,
        sort_desc: None,
        limit: None,
        offset: None,
        search: None,
    });

    let limit = filters.limit.unwrap_or(50);
    let offset = filters.offset.unwrap_or(0);
    let sort_desc = filters.sort_desc.unwrap_or(true);

    let (episodes, total) = db
        .get_episodes(
            filters.feed_source.as_deref(),
            filters.transcribed_only.unwrap_or(false),
            filters.in_queue_only.unwrap_or(false),
            filters.sort_by.as_deref(),
            sort_desc,
            filters.search.as_deref(),
            limit,
            offset,
        )
        .map_err(|e| e.to_string())?;

    log::info!("get_episodes returning {} episodes, total: {}", episodes.len(), total);

    Ok(EpisodesResponse {
        has_more: offset + (episodes.len() as i64) < total,
        episodes,
        total,
        limit,
        offset,
    })
}

/// Refresh feed from RSS
#[tauri::command]
pub async fn refresh_feed(
    db: State<'_, Arc<Database>>,
    source: String,
    _force: bool,
) -> Result<RefreshResult, String> {
    log::info!("refresh_feed called for source: {}", source);

    // Get RSS feed URL from config
    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let config_path = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app")
        .join("config.yaml");

    let config_content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    // Parse RSS URL from config based on source
    // Look for the specific feed URL in the feeds section
    let rss_url = parse_feed_url(&config_content, &source)
        .ok_or_else(|| format!("RSS feed URL not found for source: {}", source))?;

    log::info!("Fetching RSS from: {}", rss_url);

    // Fetch and parse RSS feed
    let response = reqwest::get(&rss_url)
        .await
        .map_err(|e| format!("Failed to fetch RSS: {}", e))?;

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read RSS body: {}", e))?;

    let feed = feed_rs::parser::parse(body.as_bytes())
        .map_err(|e| format!("Failed to parse RSS: {}", e))?;

    log::info!("Parsed {} entries from RSS feed", feed.entries.len());

    let mut added = 0i64;
    let mut updated = 0i64;

    for entry in feed.entries {
        // Get audio URL from enclosure
        let audio_url = entry
            .media
            .first()
            .and_then(|m| m.content.first())
            .and_then(|c| c.url.as_ref())
            .map(|u| u.to_string())
            .or_else(|| {
                entry.links.iter()
                    .find(|l| l.media_type.as_deref() == Some("audio/mpeg"))
                    .map(|l| l.href.clone())
            });

        let audio_url = match audio_url {
            Some(url) => url,
            None => continue, // Skip entries without audio
        };

        let title = entry.title.map(|t| t.content).unwrap_or_default();
        let description = entry.summary.map(|s| s.content);
        let published_date = entry.published.map(|d| d.to_rfc3339());

        // Extract episode number from title (e.g., "Episode 123:" or "#123")
        let episode_number = extract_episode_number(&title);

        // Get duration from media content if available
        let duration = entry
            .media
            .first()
            .and_then(|m| m.content.first())
            .and_then(|c| c.duration.map(|d| d.as_secs() as f64));

        let (_, is_new) = db
            .upsert_episode(
                episode_number.as_deref(),
                &title,
                description.as_deref(),
                &audio_url,
                duration,
                None, // file_size
                published_date.as_deref(),
                &source,
            )
            .map_err(|e| e.to_string())?;

        if is_new {
            added += 1;
        } else {
            updated += 1;
        }
    }

    log::info!("refresh_feed completed: {} added, {} updated", added, updated);

    Ok(RefreshResult {
        added,
        updated,
        total: added + updated,
    })
}

/// Get transcript for an episode
#[tauri::command]
pub async fn get_transcript(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<TranscriptData, String> {
    log::info!("get_transcript called for episode: {}", episode_id);

    // First try to get from database
    if let Ok(Some(transcript)) = db.get_transcript(episode_id) {
        return Ok(transcript);
    }

    // If not in database, try to read from file
    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(|e| e.to_string())?
        .ok_or("Episode not found")?;

    if let Some(transcript_path) = &episode.transcript_path {
        // Check for _with_speakers.json file first (has diarization data)
        let path = std::path::Path::new(transcript_path);
        let with_speakers_path = path.with_file_name(format!(
            "{}_with_speakers.json",
            path.file_stem().and_then(|s| s.to_str()).unwrap_or("transcript")
        ));

        let (content, actual_path) = if with_speakers_path.exists() {
            log::info!("Using diarized transcript: {:?}", with_speakers_path);
            (
                std::fs::read_to_string(&with_speakers_path)
                    .map_err(|e| format!("Failed to read diarized transcript: {}", e))?,
                with_speakers_path.to_string_lossy().to_string(),
            )
        } else {
            (
                std::fs::read_to_string(transcript_path)
                    .map_err(|e| format!("Failed to read transcript file: {}", e))?,
                transcript_path.clone(),
            )
        };

        // Parse the JSON transcript file to extract text and diarization info
        let parsed = parse_transcript_json(&content);

        return Ok(TranscriptData {
            full_text: parsed.full_text,
            segments_json: parsed.segments_json,
            language: parsed.language,
            model_used: None,
            created_date: episode.transcribed_date,
            episode_title: episode.title,
            episode_number: episode.episode_number,
            transcript_path: Some(actual_path),
            has_diarization: parsed.has_diarization,
            num_speakers: parsed.num_speakers,
            diarization_method: parsed.diarization_method,
            speaker_names: parsed.speaker_names,
        });
    }

    Err("Transcript not found".to_string())
}

/// Parsed transcript information
struct ParsedTranscript {
    full_text: String,
    language: Option<String>,
    segments_json: Option<String>,
    has_diarization: bool,
    num_speakers: Option<i32>,
    diarization_method: Option<String>,
    speaker_names: Option<std::collections::HashMap<String, String>>,
}

/// Parse transcript JSON file and extract full text, segments, and diarization info
fn parse_transcript_json(content: &str) -> ParsedTranscript {
    // Try to parse as JSON
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(content) {
        let language = json.get("language")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Extract diarization info
        let (has_diarization, num_speakers, diarization_method) =
            if let Some(diarization) = json.get("diarization") {
                let num = diarization.get("num_speakers")
                    .and_then(|v| v.as_i64())
                    .map(|n| n as i32);
                let method = diarization.get("method")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                (num.map(|n| n > 0).unwrap_or(false), num, method)
            } else {
                (false, None, None)
            };

        // Extract speaker names mapping - check both top-level and diarization.identified_speakers
        let speaker_names = json.get("speaker_names")
            .and_then(|v| v.as_object())
            .map(|obj| {
                obj.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect::<std::collections::HashMap<String, String>>()
            })
            .or_else(|| {
                // Fallback: check diarization.identified_speakers (from voice library)
                json.get("diarization")
                    .and_then(|d| d.get("identified_speakers"))
                    .and_then(|v| v.as_object())
                    .map(|obj| {
                        obj.iter()
                            .filter_map(|(k, v)| {
                                // Only include non-null values
                                v.as_str().map(|s| (k.clone(), s.to_string()))
                            })
                            .collect::<std::collections::HashMap<String, String>>()
                    })
            });

        // Extract text from segments (faster-whisper format)
        if let Some(segments) = json.get("segments").and_then(|v| v.as_array()) {
            let full_text: String = segments
                .iter()
                .filter_map(|seg| seg.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join(" ")
                .trim()
                .to_string();

            let segments_json = serde_json::to_string(segments).ok();

            return ParsedTranscript {
                full_text,
                language,
                segments_json,
                has_diarization,
                num_speakers,
                diarization_method,
                speaker_names,
            };
        }

        // Fallback: whisper-cli format uses "transcription" array
        if let Some(transcription) = json.get("transcription").and_then(|v| v.as_array()) {
            let full_text: String = transcription
                .iter()
                .filter_map(|seg| seg.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join(" ")
                .trim()
                .to_string();

            let segments_json = serde_json::to_string(transcription).ok();

            return ParsedTranscript {
                full_text,
                language,
                segments_json,
                has_diarization,
                num_speakers,
                diarization_method,
                speaker_names,
            };
        }

        // Fallback: check for "text" field directly
        if let Some(text) = json.get("text").and_then(|v| v.as_str()) {
            return ParsedTranscript {
                full_text: text.to_string(),
                language,
                segments_json: None,
                has_diarization,
                num_speakers,
                diarization_method,
                speaker_names,
            };
        }
    }

    // If not JSON or parsing failed, return as-is (might be plain text)
    ParsedTranscript {
        full_text: content.to_string(),
        language: Some("en".to_string()),
        segments_json: None,
        has_diarization: false,
        num_speakers: None,
        diarization_method: None,
        speaker_names: None,
    }
}

fn extract_episode_number(title: &str) -> Option<String> {
    // Try patterns like "Episode 123", "#123", "Ep. 123", "Ep 123"
    let patterns = [
        r"Episode\s*(\d+)",
        r"#(\d+)",
        r"Ep\.?\s*(\d+)",
        r"^\s*(\d+)\s*[-:.]",
    ];

    for pattern in patterns {
        if let Ok(re) = regex::Regex::new(pattern) {
            if let Some(caps) = re.captures(title) {
                if let Some(num) = caps.get(1) {
                    return Some(num.as_str().to_string());
                }
            }
        }
    }
    None
}

fn parse_duration(duration_str: &str) -> Option<f64> {
    // Parse formats like "1:23:45" or "5432" (seconds)
    if duration_str.contains(':') {
        let parts: Vec<&str> = duration_str.split(':').collect();
        match parts.len() {
            2 => {
                let mins: f64 = parts[0].parse().ok()?;
                let secs: f64 = parts[1].parse().ok()?;
                Some(mins * 60.0 + secs)
            }
            3 => {
                let hours: f64 = parts[0].parse().ok()?;
                let mins: f64 = parts[1].parse().ok()?;
                let secs: f64 = parts[2].parse().ok()?;
                Some(hours * 3600.0 + mins * 60.0 + secs)
            }
            _ => None,
        }
    } else {
        duration_str.parse().ok()
    }
}

/// Parse feed URL from config.yaml based on source
fn parse_feed_url(config_content: &str, source: &str) -> Option<String> {
    // Simple approach: look for the pattern "source:\n...url: VALUE"
    let source_pattern = format!("{}:", source);
    let lines: Vec<&str> = config_content.lines().collect();

    let mut found_source = false;

    for line in &lines {
        let trimmed = line.trim();

        // Look for "patreon:" or "apple:"
        if trimmed == source_pattern {
            found_source = true;
            log::info!("Found source section: {}", source);
            continue;
        }

        // Once in source section, look for url:
        if found_source {
            if trimmed.starts_with("url:") {
                // Extract everything after "url:"
                let url_part = &trimmed[4..]; // Skip "url:"
                let url = url_part.trim().trim_matches('"').trim_matches('\'');
                log::info!("Found URL for {}: {}", source, url);
                return Some(url.to_string());
            }

            // If we hit another source section (ends with : but isn't url/name/enabled), stop
            if trimmed.ends_with(':') && !trimmed.starts_with("url")
                && !trimmed.starts_with("name") && !trimmed.starts_with("enabled") {
                found_source = false;
            }
        }
    }

    // Fallback for patreon: try rss_feed_url
    if source == "patreon" {
        for line in &lines {
            let trimmed = line.trim();
            if trimmed.starts_with("rss_feed_url:") {
                let url_part = &trimmed[13..]; // Skip "rss_feed_url:"
                let url = url_part.trim().trim_matches('"').trim_matches('\'');
                if !url.is_empty() {
                    log::info!("Using fallback rss_feed_url for patreon: {}", url);
                    return Some(url.to_string());
                }
            }
        }
    }

    log::warn!("No URL found for source: {}", source);
    None
}

/// GET /api/v2/episodes/:id -> get_episode command
#[tauri::command]
pub async fn get_episode(db: State<'_, Arc<Database>>, id: i64) -> Result<Episode, String> {
    db.get_episode_by_id(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Episode not found".to_string())
}

/// Download episode audio file with streaming and timeouts
#[tauri::command]
pub async fn download_episode(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<String, String> {
    log::info!("download_episode called for episode: {}", episode_id);

    // Get episode from database
    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(|e| e.to_string())?
        .ok_or("Episode not found")?;

    // Check if already downloaded
    if episode.is_downloaded && episode.audio_file_path.is_some() {
        log::info!("Episode already downloaded: {:?}", episode.audio_file_path);
        return Ok(episode.audio_file_path.unwrap());
    }

    // Get episodes directory
    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let episodes_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app")
        .join("scripts")
        .join("episodes");

    // Create episodes directory if it doesn't exist
    std::fs::create_dir_all(&episodes_dir)
        .map_err(|e| format!("Failed to create episodes directory: {}", e))?;

    // Generate filename from title
    let safe_title: String = episode
        .title
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let filename = format!("{}.mp3", safe_title.trim());
    let file_path = episodes_dir.join(&filename);

    log::info!("Downloading to: {:?}", file_path);

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&episode.audio_url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let content_length = response.content_length();
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&file_path)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;
    let mut downloaded: u64 = 0;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Error reading download stream: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write chunk: {}", e))?;
        downloaded += chunk.len() as u64;
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush file: {}", e))?;

    // Validate file size against Content-Length
    if let Some(expected) = content_length {
        if downloaded != expected {
            // Delete partial file
            let _ = tokio::fs::remove_file(&file_path).await;
            return Err(format!(
                "Download incomplete: got {} bytes, expected {}",
                downloaded, expected
            ));
        }
    }

    let file_path_str = file_path.to_string_lossy().to_string();

    log::info!("Download complete: {} bytes", downloaded);

    // Update database
    db.mark_downloaded(episode_id, &file_path_str)
        .map_err(|e| e.to_string())?;

    db.update_episode_file_size(episode_id, downloaded as i64)
        .map_err(|e| e.to_string())?;

    Ok(file_path_str)
}

/// GET /api/v2/feeds/sources -> get_feed_sources command
#[tauri::command]
pub fn get_feed_sources() -> Vec<FeedSource> {
    vec![
        FeedSource {
            id: "patreon".to_string(),
            name: "Patreon (Premium)".to_string(),
            icon: "💎".to_string(),
            enabled: true,
        },
        FeedSource {
            id: "apple".to_string(),
            name: "Apple Podcasts".to_string(),
            icon: "🎙️".to_string(),
            enabled: true,
        },
    ]
}

/// Update speaker names for a transcript
#[tauri::command]
pub async fn update_speaker_names(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    speaker_names: std::collections::HashMap<String, String>,
) -> Result<(), String> {
    log::info!("update_speaker_names called for episode: {}, names: {:?}", episode_id, speaker_names);

    // Get episode to find transcript path
    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(|e| e.to_string())?
        .ok_or("Episode not found")?;

    let transcript_path = episode.transcript_path.ok_or("No transcript path")?;

    // Check for _with_speakers.json file
    let path = std::path::Path::new(&transcript_path);
    let with_speakers_path = path.with_file_name(format!(
        "{}_with_speakers.json",
        path.file_stem().and_then(|s| s.to_str()).unwrap_or("transcript")
    ));

    // Use _with_speakers.json if it exists, otherwise use the base transcript
    let actual_path = if with_speakers_path.exists() {
        with_speakers_path
    } else {
        path.to_path_buf()
    };

    // Read current JSON
    let content = std::fs::read_to_string(&actual_path)
        .map_err(|e| format!("Failed to read transcript: {}", e))?;

    // Parse JSON
    let mut json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse transcript JSON: {}", e))?;

    // Update speaker_names
    let names_json = serde_json::to_value(&speaker_names)
        .map_err(|e| format!("Failed to serialize speaker names: {}", e))?;
    json["speaker_names"] = names_json;

    // Write back
    let updated_content = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))?;

    std::fs::write(&actual_path, updated_content)
        .map_err(|e| format!("Failed to write transcript: {}", e))?;

    log::info!("Speaker names updated for episode {}", episode_id);
    Ok(())
}

/// Save transcript edits (speaker assignments and text changes)
#[tauri::command]
pub async fn save_transcript_edits(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    edits: std::collections::HashMap<usize, serde_json::Value>,
) -> Result<(), String> {
    log::info!("save_transcript_edits called for episode: {}", episode_id);

    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(|e| e.to_string())?
        .ok_or("Episode not found")?;

    let transcript_path = episode.transcript_path.ok_or("No transcript path")?;

    // Check for _with_speakers.json file
    let path = std::path::Path::new(&transcript_path);
    let with_speakers_path = path.with_file_name(format!(
        "{}_with_speakers.json",
        path.file_stem().and_then(|s| s.to_str()).unwrap_or("transcript")
    ));

    let actual_path = if with_speakers_path.exists() {
        with_speakers_path
    } else {
        path.to_path_buf()
    };

    // Read current JSON
    let content = std::fs::read_to_string(&actual_path)
        .map_err(|e| format!("Failed to read transcript: {}", e))?;

    let mut json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse transcript JSON: {}", e))?;

    // Get the transcription array
    let segments = json.get_mut("transcription")
        .and_then(|t| t.as_array_mut())
        .ok_or("No transcription segments found")?;

    // Apply edits
    for (idx_str, edit) in edits {
        if idx_str < segments.len() {
            if let Some(new_speaker) = edit.get("speaker").and_then(|s| s.as_str()) {
                segments[idx_str]["speaker"] = serde_json::Value::String(new_speaker.to_string());
            }
            if let Some(new_text) = edit.get("text").and_then(|t| t.as_str()) {
                segments[idx_str]["text"] = serde_json::Value::String(new_text.to_string());
            }
        }
    }

    // Write back
    let updated_content = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))?;

    std::fs::write(&actual_path, updated_content)
        .map_err(|e| format!("Failed to write transcript: {}", e))?;

    log::info!("Transcript edits saved for episode {}", episode_id);
    Ok(())
}

/// Get audio file path for an episode
#[tauri::command]
pub async fn get_audio_path(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Option<String>, String> {
    log::info!("get_audio_path called for episode: {}", episode_id);

    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(|e| e.to_string())?
        .ok_or("Episode not found")?;

    Ok(episode.audio_file_path)
}

/// Retry diarization for an episode
#[tauri::command]
pub async fn retry_diarization(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<(), String> {
    log::info!("retry_diarization called for episode: {}", episode_id);

    // Reset diarization status so worker will re-process
    db.update_diarization(episode_id, 0)
        .map_err(|e| format!("Failed to reset diarization: {}", e))?;

    // Add to queue with high priority for re-diarization
    // The worker will detect it has transcript but no diarization and run diarization only
    db.add_to_queue(episode_id, 100)
        .map_err(|e| format!("Failed to add to queue: {}", e))?;

    log::info!("Episode {} queued for re-diarization", episode_id);
    Ok(())
}

/// Reprocess diarization with human correction hints
#[tauri::command]
pub async fn reprocess_diarization(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<(), String> {
    log::info!("reprocess_diarization called for episode: {}", episode_id);

    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(|e| e.to_string())?
        .ok_or("Episode not found")?;

    let transcript_path = episode.transcript_path.ok_or("No transcript for this episode")?;

    // Get all unresolved speaker-related flags
    let flags = db.get_unresolved_speaker_flags(episode_id)
        .map_err(|e| e.to_string())?;

    // Build hints JSON
    let mut corrections = Vec::new();
    let mut multiple_speakers_segments = Vec::new();
    let mut all_speakers = std::collections::HashSet::new();

    for flag in &flags {
        match flag.flag_type.as_str() {
            "wrong_speaker" => {
                if let Some(ref corrected) = flag.corrected_speaker {
                    corrections.push(serde_json::json!({
                        "segment_idx": flag.segment_idx,
                        "corrected_speaker": corrected,
                    }));
                    all_speakers.insert(corrected.clone());
                }
            }
            "multiple_speakers" => {
                let speaker_ids_parsed: Vec<String> = flag.speaker_ids.as_ref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or_default();
                for sid in &speaker_ids_parsed {
                    all_speakers.insert(sid.clone());
                }
                multiple_speakers_segments.push(serde_json::json!({
                    "segment_idx": flag.segment_idx,
                    "speaker_ids": speaker_ids_parsed,
                }));
            }
            _ => {}
        }
    }

    // Also count existing speakers from diarization
    if let Some(num) = episode.num_speakers {
        for i in 0..num {
            all_speakers.insert(format!("SPEAKER_{:02}", i));
        }
    }

    let num_speakers_hint = if all_speakers.len() > 1 { Some(all_speakers.len()) } else { None };

    let hints = serde_json::json!({
        "corrections": corrections,
        "multiple_speakers_segments": multiple_speakers_segments,
        "num_speakers_hint": num_speakers_hint,
    });

    // Write hints file next to transcript
    let transcript_dir = std::path::Path::new(&transcript_path).parent()
        .ok_or("Invalid transcript path")?;
    let hints_path = transcript_dir.join(format!("{}_hints.json", episode_id));
    std::fs::write(&hints_path, serde_json::to_string_pretty(&hints).unwrap())
        .map_err(|e| format!("Failed to write hints file: {}", e))?;

    log::info!("Wrote diarization hints to: {:?} ({} corrections, {} multi-speaker segments)",
        hints_path, corrections.len(), multiple_speakers_segments.len());

    // Reset diarization status
    db.update_diarization(episode_id, 0)
        .map_err(|e| format!("Failed to reset diarization: {}", e))?;

    // Add to queue with high priority
    db.add_to_queue(episode_id, 100)
        .map_err(|e| format!("Failed to add to queue: {}", e))?;

    log::info!("Episode {} queued for re-diarization with hints", episode_id);
    Ok(())
}

/// Voice sample data from frontend
#[derive(Debug, Deserialize)]
pub struct VoiceSample {
    pub speaker: String,
    #[serde(rename = "speakerName")]
    pub speaker_name: String,
    #[serde(rename = "startTime")]
    pub start_time: f64,
    #[serde(rename = "endTime")]
    pub end_time: f64,
    pub text: String,
}

/// Save voice samples to the voice library
#[tauri::command]
pub async fn save_voice_samples(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    samples: Vec<VoiceSample>,
) -> Result<i32, String> {
    log::info!("save_voice_samples called for episode: {}, {} samples", episode_id, samples.len());

    // Get episode to find audio path
    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(|e| e.to_string())?
        .ok_or("Episode not found")?;

    let audio_path = episode.audio_file_path.ok_or("No audio file for this episode")?;

    // Get project directory
    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let project_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app");

    let voice_library_script = project_dir.join("scripts").join("voice_library.py");
    let venv_python = project_dir.join("venv").join("bin").join("python");

    let mut saved_count = 0;

    for sample in samples {
        // Skip if speaker name is still a SPEAKER_XX label
        if sample.speaker_name.starts_with("SPEAKER_") {
            log::warn!("Skipping sample with unnamed speaker: {}", sample.speaker_name);
            continue;
        }

        log::info!(
            "Extracting voice sample for '{}': {:.2}s - {:.2}s",
            sample.speaker_name,
            sample.start_time,
            sample.end_time
        );

        // Use Python script to extract and add to voice library
        let output = std::process::Command::new(&venv_python)
            .args([
                voice_library_script.to_str().unwrap(),
                "add",
                &sample.speaker_name,
                audio_path.as_str(),
                &format!("{:.3}", sample.start_time),
                &format!("{:.3}", sample.end_time),
            ])
            .output()
            .map_err(|e| format!("Failed to run voice library script: {}", e))?;

        if output.status.success() {
            saved_count += 1;
            log::info!("Added voice sample for '{}'", sample.speaker_name);
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::error!("Failed to add voice sample for '{}': {}", sample.speaker_name, stderr);
        }
    }

    log::info!("Saved {} voice samples", saved_count);
    Ok(saved_count)
}

/// Response from content analysis
#[derive(Debug, Serialize, Deserialize)]
pub struct ContentAnalysisResult {
    pub characters: Vec<DetectedItem>,
    pub commercials: Vec<DetectedItem>,
    pub bits: Vec<DetectedItem>,
    pub segments_analyzed: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DetectedItem {
    pub name: String,
    pub description: Option<String>,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    pub segment_idx: Option<i32>,
    pub confidence: f64,
    pub raw_text: Option<String>,
    pub detection_method: Option<String>,
}

/// Analyze episode content for characters, commercials, and bits
#[tauri::command]
pub async fn analyze_episode_content(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    use_llm: Option<bool>,
) -> Result<ContentAnalysisResult, String> {
    log::info!("analyze_episode_content called for episode: {}", episode_id);

    // Get episode
    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(|e| e.to_string())?
        .ok_or("Episode not found")?;

    let transcript_path = episode.transcript_path.ok_or("No transcript for this episode")?;

    // Get project directory
    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let project_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app");

    let analyzer_script = project_dir.join("scripts").join("content_analyzer.py");
    let venv_python = project_dir.join("venv").join("bin").join("python");
    let db_path = project_dir.join("data").join("ice_cream_social.db");

    // Build command args
    let mut args = vec![
        analyzer_script.to_str().unwrap().to_string(),
        transcript_path.clone(),
        "--episode-id".to_string(),
        episode_id.to_string(),
        "--db".to_string(),
        db_path.to_str().unwrap().to_string(),
    ];

    if use_llm == Some(false) {
        args.push("--no-llm".to_string());
    }

    log::info!("Running content analyzer: {:?}", args);

    // Run the analyzer
    let output = std::process::Command::new(&venv_python)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run content analyzer: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("Content analyzer failed: {}", stderr);
        return Err(format!("Content analyzer failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    log::info!("Content analyzer output: {}", stdout);

    // Parse the JSON output
    let analysis: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse analyzer output: {}", e))?;

    let results = analysis.get("results").ok_or("No results in output")?;

    // Convert to our response type
    let characters: Vec<DetectedItem> = results
        .get("characters")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let commercials: Vec<DetectedItem> = results
        .get("commercials")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let bits: Vec<DetectedItem> = results
        .get("bits")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let segments_analyzed = results
        .get("segments_analyzed")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;

    log::info!(
        "Content analysis complete: {} characters, {} commercials, {} bits",
        characters.len(),
        commercials.len(),
        bits.len()
    );

    Ok(ContentAnalysisResult {
        characters,
        commercials,
        bits,
        segments_analyzed,
    })
}
