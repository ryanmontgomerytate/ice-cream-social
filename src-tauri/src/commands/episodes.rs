use crate::database::{Database, Episode, FeedSource, TranscriptData};
use crate::error::AppError;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{Emitter, State};
use tokio::io::AsyncWriteExt;

#[derive(Debug, Deserialize)]
pub struct EpisodeFilters {
    pub feed_source: Option<String>,
    pub transcribed_only: Option<bool>,
    pub in_queue_only: Option<bool>,
    pub failed_only: Option<bool>,
    pub downloaded_only: Option<bool>,
    pub not_downloaded_only: Option<bool>,
    pub diarized_only: Option<bool>,
    pub sort_by: Option<String>,
    pub sort_desc: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub search: Option<String>,
    pub category: Option<String>,
    pub include_variants: Option<bool>,
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
) -> Result<EpisodesResponse, AppError> {
    log::info!("get_episodes called with filters: {:?}", filters);

    let filters = filters.unwrap_or(EpisodeFilters {
        feed_source: None,
        transcribed_only: None,
        in_queue_only: None,
        failed_only: None,
        downloaded_only: None,
        not_downloaded_only: None,
        diarized_only: None,
        sort_by: None,
        sort_desc: None,
        limit: None,
        offset: None,
        search: None,
        category: None,
        include_variants: None,
    });

    let limit = filters.limit.unwrap_or(50);
    let offset = filters.offset.unwrap_or(0);
    let sort_desc = filters.sort_desc.unwrap_or(true);

    let (episodes, total) = db
        .get_episodes(
            filters.feed_source.as_deref(),
            filters.transcribed_only.unwrap_or(false),
            filters.in_queue_only.unwrap_or(false),
            filters.failed_only.unwrap_or(false),
            filters.downloaded_only.unwrap_or(false),
            filters.not_downloaded_only.unwrap_or(false),
            filters.diarized_only.unwrap_or(false),
            filters.sort_by.as_deref(),
            sort_desc,
            filters.search.as_deref(),
            limit,
            offset,
            filters.category.as_deref(),
            filters.include_variants.unwrap_or(false),
        )
        .map_err(AppError::from)?;

    log::info!("get_episodes returning {} episodes, total: {}", episodes.len(), total);

    Ok(EpisodesResponse {
        has_more: offset + (episodes.len() as i64) < total,
        episodes,
        total,
        limit,
        offset,
    })
}

/// Core feed sync logic — callable from command or scheduler
pub async fn sync_feed(db: &Arc<Database>, source: &str) -> Result<RefreshResult, AppError> {
    log::info!("sync_feed called for source: {}", source);

    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let project_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app");

    let rss_url = resolve_feed_url(&project_dir, source)
        .ok_or_else(|| format!("RSS feed URL not found for source: {}. Check your .env file.", source))?;

    log::info!("Fetching RSS from: {}", rss_url);

    // Fetch RSS feed with a proper User-Agent (some feeds reject default/empty UA)
    let client = reqwest::Client::builder()
        .user_agent("IceCreamSocial/2.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&rss_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch RSS: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "RSS feed returned HTTP {}: {}",
            status.as_u16(),
            status.canonical_reason().unwrap_or("Unknown")
        ).into());
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read RSS body: {}", e))?;

    if body.trim().is_empty() {
        return Err("RSS feed returned empty response body".into());
    }

    // Log first 200 chars for debugging if parse fails
    let feed = match feed_rs::parser::parse(body.as_bytes()) {
        Ok(f) => f,
        Err(e) => {
            let preview: String = body.chars().take(200).collect();
            log::error!(
                "RSS parse failed. Content-Type: {}, Body preview: {}",
                content_type,
                preview
            );
            return Err(format!(
                "Failed to parse RSS (Content-Type: {}): {}. The feed URL may be expired or returning an error page.",
                content_type, e
            ).into());
        }
    };

    log::info!("Parsed {} entries from RSS feed", feed.entries.len());

    // Load category rules for episode categorization
    let rules = db.get_category_rules().map_err(AppError::from)?;

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

        // Categorize episode from title using rules
        let cat_result = categorize_episode(&title, &rules);
        // Use category-derived episode_number if available, else fallback to basic extraction
        let episode_number = cat_result.episode_number.or_else(|| extract_episode_number(&title));

        // Get duration from media content if available
        let duration = entry
            .media
            .first()
            .and_then(|m| m.content.first())
            .and_then(|c| c.duration.map(|d| d.as_secs() as f64));

        let (ep_id, is_new) = db
            .upsert_episode(
                episode_number.as_deref(),
                &title,
                description.as_deref(),
                &audio_url,
                duration,
                None, // file_size
                published_date.as_deref(),
                source,
            )
            .map_err(AppError::from)?;

        // Update category fields
        let _ = db.update_episode_category(
            ep_id,
            &cat_result.category,
            episode_number.as_deref(),
            cat_result.category_number.as_deref(),
            cat_result.sub_series.as_deref(),
        );

        if is_new {
            added += 1;
        } else {
            updated += 1;
        }
    }

    log::info!("sync_feed completed: {} added, {} updated", added, updated);

    Ok(RefreshResult {
        added,
        updated,
        total: added + updated,
    })
}

/// Refresh feed from RSS (Tauri command wrapper)
#[tauri::command]
pub async fn refresh_feed(
    db: State<'_, Arc<Database>>,
    source: String,
    _force: bool,
) -> Result<RefreshResult, AppError> {
    sync_feed(&db, &source).await
}

/// Get transcript for an episode
#[tauri::command]
pub async fn get_transcript(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<TranscriptData, AppError> {
    log::info!("get_transcript called for episode: {}", episode_id);

    // First try to get from database
    if let Ok(Some(transcript)) = db.get_transcript(episode_id) {
        return Ok(transcript);
    }

    // If not in database, try to read from file
    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(AppError::from)?
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
            marked_samples: parsed.marked_samples,
        });
    }

    Err("Transcript not found".into())
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
    marked_samples: Option<Vec<i32>>,
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

        // Extract marked_samples (voice sample segment indices)
        let marked_samples: Option<Vec<i32>> = json.get("marked_samples")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_i64().map(|n| n as i32)).collect());

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
                marked_samples: marked_samples.clone(),
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
                marked_samples: marked_samples.clone(),
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
                marked_samples,
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
        marked_samples: None,
    }
}

fn extract_episode_number(title: &str) -> Option<String> {
    // Try patterns like "Episode 123", "#123", "Ep. 123", "Ep 123", "Ad Free 123"
    let patterns = [
        r"(?i)(?:Episode|Ad Free)\s+(\d+)",
        r"#(\d+)",
        r"(?i)Ep\.?\s*(\d+)",
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

/// Result of categorizing an episode
#[derive(Debug, Clone, Serialize)]
pub struct CategorizeResult {
    pub category: String,
    pub episode_number: Option<String>,
    pub category_number: Option<String>,
    pub sub_series: Option<String>,
}

/// Categorize an episode based on its title using the category_rules from DB
fn categorize_episode(title: &str, rules: &[crate::database::CategoryRule]) -> CategorizeResult {
    let title_lower = title.to_lowercase();

    for rule in rules {
        // Skip the fallback "bonus" rule (priority 99) — it matches everything
        if rule.priority == 99 {
            continue;
        }

        // Check keywords first (case-insensitive substring match)
        let keyword_match = rule.keywords.as_ref().map_or(false, |kw| {
            kw.split(',')
                .map(|k| k.trim().to_lowercase())
                .filter(|k| !k.is_empty())
                .any(|k| title_lower.contains(&k))
        });

        let regex_match = if !keyword_match {
            regex::Regex::new(&rule.title_pattern)
                .map(|re| re.is_match(title))
                .unwrap_or(false)
        } else {
            false
        };

        if keyword_match || regex_match {
            let mut category_number = None;
            let mut episode_number = None;
            let mut sub_series = None;

            // Extract number using the rule's number_pattern
            if let Some(ref num_pattern) = rule.number_pattern {
                if let Ok(num_re) = regex::Regex::new(num_pattern) {
                    if let Some(caps) = num_re.captures(title) {
                        if let Some(num) = caps.get(1) {
                            category_number = Some(num.as_str().to_string());
                        }
                    }
                }
            }

            // For 'episode' category, category_number is also the episode_number
            if rule.category == "episode" {
                episode_number = category_number.clone();
            }

            // For scoopflix, extract sub_series
            if rule.category == "scoopflix" {
                sub_series = extract_scoopflix_sub_series(title);
            }

            return CategorizeResult {
                category: rule.category.clone(),
                episode_number,
                category_number,
                sub_series,
            };
        }
    }

    // Fallback to bonus (catch-all)
    CategorizeResult {
        category: "bonus".to_string(),
        episode_number: extract_episode_number(title),
        category_number: None,
        sub_series: None,
    }
}

/// Extract the sub-series name from a Scoopflix/Not Furlong title
fn extract_scoopflix_sub_series(title: &str) -> Option<String> {
    // "Not Furlong" sub-series
    if regex::Regex::new(r"(?i)not\s+furlong").unwrap().is_match(title) {
        return Some("Not Furlong".to_string());
    }

    // Scoopflix show name patterns:
    // "ScoopFlix and Chill: Highway to Heaven" / "Scoopflix: Arrow" etc.
    if let Ok(re) = regex::Regex::new(r"(?i)scoopfl?i?x\s*(?:and Chill)?[:\s]+(.+?)(?:\s*[-–]\s*Episode|\s*\d+\s*$|\s*$)") {
        if let Some(caps) = re.captures(title) {
            if let Some(show) = caps.get(1) {
                let show_name = show.as_str().trim().to_string();
                if !show_name.is_empty() && show_name.len() > 1 {
                    return Some(show_name);
                }
            }
        }
    }

    None
}

/// Recategorize all episodes using category_rules from database
#[tauri::command]
pub async fn recategorize_all_episodes(
    db: State<'_, Arc<Database>>,
) -> Result<serde_json::Value, AppError> {
    log::info!("recategorize_all_episodes called");

    let rules = db.get_category_rules().map_err(AppError::from)?;
    let episodes = db.get_all_episodes_for_categorization().map_err(AppError::from)?;

    let mut counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();

    for (id, title, _feed_source) in &episodes {
        let result = categorize_episode(title, &rules);

        db.update_episode_category(
            *id,
            &result.category,
            result.episode_number.as_deref(),
            result.category_number.as_deref(),
            result.sub_series.as_deref(),
        )
        .map_err(AppError::from)?;

        *counts.entry(result.category.clone()).or_insert(0) += 1;
    }

    // Also delete stale local test record
    let deleted = db.delete_local_test_record().map_err(AppError::from)?;
    if deleted > 0 {
        log::info!("Deleted {} stale local test record(s)", deleted);
    }

    log::info!("Recategorized {} episodes: {:?}", episodes.len(), counts);

    Ok(serde_json::json!({
        "total": episodes.len(),
        "counts": counts,
        "deleted_local": deleted,
    }))
}

/// Link cross-feed duplicates: set canonical_id on "Ad Free" variants pointing to apple episodes
#[tauri::command]
pub async fn link_cross_feed_episodes(
    db: State<'_, Arc<Database>>,
) -> Result<serde_json::Value, AppError> {
    log::info!("link_cross_feed_episodes called");

    // Get all episode-category rows with a category_number, grouped by feed
    // We need episodes with category info to group by number
    let (all_episodes, _) = db.get_episodes(
        None, false, false, false, false, false, false,
        None, true, None, 10000, 0, None, true, // include_variants = true
    ).map_err(AppError::from)?;

    // Group episode-category episodes by category_number
    let mut by_number: std::collections::HashMap<String, Vec<&crate::database::Episode>> = std::collections::HashMap::new();
    for ep in &all_episodes {
        if ep.category.as_deref() == Some("episode") {
            if let Some(ref num) = ep.category_number {
                by_number.entry(num.clone()).or_default().push(ep);
            }
        }
    }

    let mut linked = 0i64;
    for (_num, eps) in &by_number {
        if eps.len() < 2 {
            continue;
        }

        // Find the apple episode (canonical) and patreon episode (variant)
        let apple = eps.iter().find(|e| e.feed_source == "apple");
        let patreon = eps.iter().find(|e| e.feed_source == "patreon");

        if let (Some(canonical), Some(variant)) = (apple, patreon) {
            // Only link if not already linked
            if variant.canonical_id.is_none() {
                db.set_canonical_id(variant.id, canonical.id)
                    .map_err(AppError::from)?;
                linked += 1;
            }
        }
    }

    log::info!("Linked {} cross-feed episode pairs", linked);

    Ok(serde_json::json!({
        "linked": linked,
        "episode_numbers_with_duplicates": by_number.len(),
    }))
}

/// Get category rules
#[tauri::command]
pub async fn get_category_rules(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<crate::database::CategoryRule>, AppError> {
    db.get_category_rules().map_err(AppError::from)
}

/// Get variant episodes for a given episode
#[tauri::command]
pub async fn get_episode_variants(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Vec<crate::database::Episode>, AppError> {
    db.get_episode_variants(episode_id).map_err(AppError::from)
}

/// Add a new category rule
#[tauri::command]
pub async fn add_category_rule(
    db: State<'_, Arc<Database>>,
    rule: crate::database::CategoryRule,
) -> Result<i64, AppError> {
    log::info!("add_category_rule called: {:?}", rule);
    db.add_category_rule(&rule).map_err(AppError::from)
}

/// Update an existing category rule
#[tauri::command]
pub async fn update_category_rule(
    db: State<'_, Arc<Database>>,
    rule: crate::database::CategoryRule,
) -> Result<(), AppError> {
    log::info!("update_category_rule called: {:?}", rule);
    db.update_category_rule(&rule).map_err(AppError::from)
}

/// Delete a category rule (protects the bonus catch-all)
#[tauri::command]
pub async fn delete_category_rule(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), AppError> {
    log::info!("delete_category_rule called for id: {}", id);

    // Check if this is the bonus catch-all rule
    let rules = db.get_category_rules().map_err(AppError::from)?;
    if let Some(rule) = rules.iter().find(|r| r.id == id) {
        if rule.category == "bonus" && rule.priority == 99 {
            return Err("Cannot delete the bonus catch-all rule".into());
        }
    }

    db.delete_category_rule(id).map_err(AppError::from)
}

/// Test a category rule pattern against episode titles
#[tauri::command]
pub async fn test_category_rule(
    db: State<'_, Arc<Database>>,
    pattern: String,
    keywords: Option<String>,
) -> Result<serde_json::Value, AppError> {
    log::info!("test_category_rule called with pattern: {}", pattern);

    // Validate regex
    let re = regex::Regex::new(&pattern).map_err(|e| format!("Invalid regex: {}", e))?;

    let episodes = db.get_all_episodes_for_categorization().map_err(AppError::from)?;

    let keyword_list: Vec<String> = keywords
        .as_ref()
        .map(|kw| {
            kw.split(',')
                .map(|k| k.trim().to_lowercase())
                .filter(|k| !k.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let mut matches: Vec<serde_json::Value> = Vec::new();
    for (_id, title, _feed_source) in &episodes {
        let title_lower = title.to_lowercase();
        let keyword_hit = keyword_list.iter().any(|k| title_lower.contains(k));
        let regex_hit = re.is_match(title);

        if keyword_hit || regex_hit {
            matches.push(serde_json::json!({
                "title": title,
                "matched_by": if keyword_hit { "keyword" } else { "regex" },
            }));
        }
    }

    let total = matches.len();
    let sample: Vec<_> = matches.into_iter().take(20).collect();

    Ok(serde_json::json!({
        "match_count": total,
        "samples": sample,
    }))
}


/// Resolve feed URL: check .env first, then fall back to config.yaml
fn resolve_feed_url(project_dir: &std::path::Path, source: &str) -> Option<String> {
    // Map source name to .env variable name
    let env_key = match source {
        "patreon" => "PATREON_RSS_URL",
        "apple" => "APPLE_RSS_URL",
        other => {
            log::warn!("Unknown feed source: {}", other);
            return None;
        }
    };

    // Try .env first (preferred - keeps secrets out of config)
    if let Some(url) = crate::load_env_value(project_dir, env_key) {
        if url.starts_with("http") {
            log::info!("Feed URL for {} loaded from .env ({})", source, env_key);
            return Some(url);
        }
    }

    // Fallback: try config.yaml (for backward compat during migration)
    let config_path = project_dir.join("config.yaml");
    if let Ok(config_content) = std::fs::read_to_string(&config_path) {
        if let Some(url) = parse_feed_url_from_config(&config_content, source) {
            log::warn!(
                "Feed URL for {} loaded from config.yaml - move to .env as {} for security",
                source, env_key
            );
            return Some(url);
        }
    }

    log::warn!("No feed URL found for source: {}. Set {} in .env", source, env_key);
    None
}

/// Parse feed URL from config.yaml (fallback for backward compat)
fn parse_feed_url_from_config(config_content: &str, source: &str) -> Option<String> {
    let source_pattern = format!("{}:", source);
    let lines: Vec<&str> = config_content.lines().collect();
    let mut found_source = false;

    for line in &lines {
        let trimmed = line.trim();
        if trimmed == source_pattern {
            found_source = true;
            continue;
        }
        if found_source {
            if trimmed.starts_with("url:") {
                let url = trimmed[4..].trim().trim_matches('"').trim_matches('\'');
                if url.starts_with("http") {
                    return Some(url.to_string());
                }
            }
            if trimmed.ends_with(':') && !trimmed.starts_with("url")
                && !trimmed.starts_with("name") && !trimmed.starts_with("enabled")
                && !trimmed.starts_with("env_var") {
                found_source = false;
            }
        }
    }

    // Fallback for patreon: try rss_feed_url
    if source == "patreon" {
        for line in &lines {
            let trimmed = line.trim();
            if trimmed.starts_with("rss_feed_url:") {
                let url = trimmed[13..].trim().trim_matches('"').trim_matches('\'');
                if !url.is_empty() && url.starts_with("http") {
                    return Some(url.to_string());
                }
            }
        }
    }

    None
}

/// GET /api/v2/episodes/:id -> get_episode command
#[tauri::command]
pub async fn get_episode(db: State<'_, Arc<Database>>, id: i64) -> Result<Episode, AppError> {
    db.get_episode_by_id(id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::from("Episode not found"))
}

/// Download episode audio file with streaming and timeouts
#[tauri::command]
pub async fn download_episode(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<String, AppError> {
    log::info!("download_episode called for episode: {}", episode_id);

    // Get episode from database
    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(AppError::from)?
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
        return Err(format!("Download failed with status: {}", response.status()).into());
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
            ).into());
        }
    }

    let file_path_str = file_path.to_string_lossy().to_string();

    log::info!("Download complete: {} bytes", downloaded);

    // Update database
    db.mark_downloaded(episode_id, &file_path_str)
        .map_err(AppError::from)?;

    db.update_episode_file_size(episode_id, downloaded as i64)
        .map_err(AppError::from)?;

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
    marked_samples: Option<Vec<i32>>,
) -> Result<(), AppError> {
    log::info!("update_speaker_names called for episode: {}, names: {:?}", episode_id, speaker_names);

    // Get episode to find transcript path
    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(AppError::from)?
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

    // Update marked_samples (voice sample segment indices)
    if let Some(samples) = marked_samples {
        if samples.is_empty() {
            json.as_object_mut().map(|obj| obj.remove("marked_samples"));
        } else {
            json["marked_samples"] = serde_json::to_value(&samples)
                .map_err(|e| format!("Failed to serialize marked samples: {}", e))?;
        }
    }

    // Write back
    let updated_content = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))?;

    std::fs::write(&actual_path, updated_content)
        .map_err(|e| format!("Failed to write transcript: {}", e))?;

    log::info!("Speaker names updated for episode {}", episode_id);

    // Sync episode_speakers DB rows so episode counts in the Audio ID tab reflect
    // every SPEAKER_XX assignment. Non-fatal — a failure here doesn't affect the save.
    match db.sync_episode_speaker_names(episode_id, &speaker_names) {
        Ok(()) => log::info!("Synced episode_speakers for episode {}", episode_id),
        Err(e) => log::warn!("Failed to sync episode_speakers for episode {}: {}", episode_id, e),
    }

    // Re-index FTS5 so search reflects the new speaker names (non-fatal)
    match db.index_episode_from_file(episode_id) {
        Ok(n) if n > 0 => log::info!("Re-indexed {} segments for episode {} after speaker name update", n, episode_id),
        Ok(_) => {},
        Err(e) => log::warn!("FTS re-index failed after speaker name update for episode {}: {}", episode_id, e),
    }

    Ok(())
}

/// Save transcript edits (speaker assignments and text changes)
#[tauri::command]
pub async fn save_transcript_edits(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    edits: std::collections::HashMap<usize, serde_json::Value>,
) -> Result<(), AppError> {
    log::info!("save_transcript_edits called for episode: {}", episode_id);

    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(AppError::from)?
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

    // Re-index FTS5 so search reflects the updated text/speakers (non-fatal)
    match db.index_episode_from_file(episode_id) {
        Ok(n) if n > 0 => log::info!("Re-indexed {} segments for episode {} after transcript edit", n, episode_id),
        Ok(_) => {},
        Err(e) => log::warn!("FTS re-index failed after transcript edit for episode {}: {}", episode_id, e),
    }

    Ok(())
}

/// Get audio file path for an episode
#[tauri::command]
pub async fn get_audio_path(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Option<String>, AppError> {
    log::info!("get_audio_path called for episode: {}", episode_id);

    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(AppError::from)?
        .ok_or("Episode not found")?;

    Ok(episode.audio_file_path)
}

/// Retry diarization for an episode
#[tauri::command]
pub async fn retry_diarization(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<(), AppError> {
    log::info!("retry_diarization called for episode: {}", episode_id);

    // Reset diarization status so worker will re-process
    db.update_diarization(episode_id, 0)
        .map_err(|e| format!("Failed to reset diarization: {}", e))?;

    // Use race-condition-safe requeue method
    db.requeue_for_diarization(episode_id, 100)
        .map_err(|e| format!("Failed to requeue for diarization: {}", e))?;

    log::info!("Episode {} queued for re-diarization", episode_id);
    Ok(())
}

/// Reprocess diarization with human correction hints
#[tauri::command]
pub async fn reprocess_diarization(
    db: State<'_, Arc<Database>>,
    app_handle: tauri::AppHandle,
    episode_id: i64,
    embedding_backend: Option<String>,
    prioritize_top: Option<bool>,
) -> Result<(), AppError> {
    log::info!("reprocess_diarization called for episode: {}", episode_id);
    const PRIORITY_REPROCESS_TOP: i32 = 10_000;

    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(AppError::from)?
        .ok_or("Episode not found")?;

    let embedding_backend = embedding_backend
        .filter(|v| !v.trim().is_empty())
        .map(|v| v.to_lowercase());
    if let Some(ref backend) = embedding_backend {
        if backend != "pyannote" && backend != "ecapa-tdnn" {
            return Err(format!("Unsupported embedding backend: {}", backend).into());
        }
    }
    let prioritize_top = prioritize_top.unwrap_or(true);

    let transcript_path = episode.transcript_path.ok_or("No transcript for this episode")?;

    // Get all unresolved speaker-related flags
    let flags = db.get_unresolved_speaker_flags(episode_id)
        .map_err(AppError::from)?;

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
            "character_voice" => {
                // Use the character name as the corrected speaker hint
                let mut name = flag.character_name.clone();
                if let Some(cid) = flag.character_id {
                    if let Ok(Some(speaker_name)) = db.get_character_speaker_name(cid) {
                        name = Some(speaker_name);
                    }
                }
                if let Some(ref name) = name {
                    corrections.push(serde_json::json!({
                        "segment_idx": flag.segment_idx,
                        "corrected_speaker": name,
                        "is_character": true,
                    }));
                    all_speakers.insert(name.clone());
                }
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

    // Use race-condition-safe requeue method
    db.requeue_for_diarization_with_backend(
        episode_id,
        if prioritize_top { PRIORITY_REPROCESS_TOP } else { 100 },
        embedding_backend.as_deref(),
    )
        .map_err(|e| format!("Failed to requeue for diarization: {}", e))?;

    // Optional: pause new transcribe starts during priority reprocess for maximum diarize resources.
    let should_pause_transcribe = db
        .get_setting("priority_reprocess_pause_transcribe")
        .unwrap_or(None)
        .map(|v| v == "true")
        .unwrap_or(false);
    if prioritize_top && should_pause_transcribe {
        let mode_active = db
            .get_setting("priority_reprocess_mode")
            .unwrap_or(None)
            .map(|v| v == "true")
            .unwrap_or(false);
        if !mode_active {
            let was_paused = db
                .get_setting("pause_transcribe_queue")
                .unwrap_or(None)
                .map(|v| v == "true")
                .unwrap_or(false);
            db.set_setting(
                "priority_reprocess_prev_pause_transcribe",
                if was_paused { "true" } else { "false" },
            )
            .map_err(AppError::from)?;
        }
        db.set_setting("priority_reprocess_mode", "true")
            .map_err(AppError::from)?;
        db.set_setting("pause_transcribe_queue", "true")
            .map_err(AppError::from)?;
    }

    log::info!(
        "Episode {} queued for re-diarization with hints (backend={:?}, priority_top={}, pause_transcribe={})",
        episode_id,
        embedding_backend,
        prioritize_top,
        should_pause_transcribe
    );

    // Notify frontend so queue display updates
    let _ = app_handle.emit("queue_update", serde_json::json!({
        "action": "diarization_queued",
        "episode_id": episode_id,
        "backend": embedding_backend,
        "priority_top": prioritize_top,
        "pause_transcribe": should_pause_transcribe,
        "hints": {
            "corrections": corrections.len(),
            "multiple_speakers_segments": multiple_speakers_segments.len(),
        }
    }));

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
    #[serde(rename = "segmentIdx")]
    pub segment_idx: Option<i64>,
    /// Precomputed from the frontend's audio_drop_instances for this segment.
    /// When set, skips the episode_speakers diarization-label lookup so sound
    /// bites tagged at segment level (not via a full-episode speaker assignment)
    /// are correctly routed to the sound-bite save path.
    #[serde(rename = "audioDropId", default)]
    pub audio_drop_id: Option<i64>,
}

/// Save voice samples to the voice library
#[tauri::command]
pub async fn save_voice_samples(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
    samples: Vec<VoiceSample>,
) -> Result<i32, AppError> {
    log::info!("save_voice_samples called for episode: {}, {} samples", episode_id, samples.len());

    // Get episode to find audio path
    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(AppError::from)?
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

    // Sound bite samples directory
    let sound_bites_dir = project_dir.join("scripts").join("voice_library").join("sound_bites");

    let mut saved_count = 0;
    let embedding_backend = db
        .get_setting("embedding_model")
        .unwrap_or(None)
        .filter(|v| v == "ecapa-tdnn" || v == "pyannote")
        .unwrap_or_else(|| "pyannote".to_string());

    for sample in samples {
        // Determine if this is a sound bite. Prefer the explicit id sent by the
        // frontend (from audio_drop_instances for this segment) over the
        // episode-wide diarization-label lookup — the segment may be tagged as a
        // drop at the clip level without having a full-episode speaker assignment.
        let audio_drop_id: Option<i64> = if sample.audio_drop_id.is_some() {
            sample.audio_drop_id
        } else {
            db.get_audio_drop_for_label(episode_id, &sample.speaker)
                .map_err(AppError::from)?
        };

        // Common: build sample filename and extract audio via ffmpeg
        let display_ep = episode
            .episode_number
            .as_deref()
            .map(|n| n.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| episode_id.to_string());
        let sample_filename = format!(
            "ep{}_id{}_{:.0}s-{:.0}s.wav",
            display_ep, episode_id, sample.start_time, sample.end_time
        );

        if let Some(drop_id) = audio_drop_id {
            // This is a sound bite — save to sound_bites dir
            log::info!(
                "Extracting sound bite sample for '{}' (drop_id={}): {:.2}s - {:.2}s",
                sample.speaker_name, drop_id, sample.start_time, sample.end_time
            );

            let drop_dir = sound_bites_dir.join(&sample.speaker_name);
            std::fs::create_dir_all(&drop_dir)
                .map_err(|e| format!("Failed to create sound bite dir: {}", e))?;

            let sample_path = drop_dir.join(&sample_filename);

            // Extract audio segment using ffmpeg
            let output = std::process::Command::new("ffmpeg")
                .args([
                    "-y",
                    "-i", audio_path.as_str(),
                    "-ss", &format!("{:.3}", sample.start_time),
                    "-to", &format!("{:.3}", sample.end_time),
                    "-ar", "16000",
                    "-ac", "1",
                    sample_path.to_str().unwrap(),
                ])
                .output()
                .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

            if output.status.success() {
                saved_count += 1;
                let path_str = sample_path.to_string_lossy().to_string();
                log::info!("Saved sound bite sample to '{}'", path_str);

                // Update the audio_drops table with the reference path
                let _ = db.update_audio_drop_reference(drop_id, &path_str);

                // Insert DB record for this voice sample
                let _ = db.insert_voice_sample(
                    &sample.speaker_name,
                    Some(episode_id),
                    sample.segment_idx,
                    sample.start_time,
                    sample.end_time,
                    Some(&sample.text),
                    &path_str,
                    Some("manual"),
                );
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                log::error!("Failed to extract sound bite for '{}': {}", sample.speaker_name, stderr);
            }
        } else {
            // This is a real speaker — extract audio AND add to voice library
            log::info!(
                "Extracting voice sample for '{}': {:.2}s - {:.2}s",
                sample.speaker_name,
                sample.start_time,
                sample.end_time
            );

            // 1. Extract audio file via ffmpeg (NEW — speakers now also get audio files)
            let speaker_dir_name = sample.speaker_name.replace(' ', "_");
            let speaker_samples_dir = project_dir
                .join("scripts")
                .join("voice_library")
                .join("samples")
                .join(&speaker_dir_name);
            std::fs::create_dir_all(&speaker_samples_dir)
                .map_err(|e| format!("Failed to create speaker samples dir: {}", e))?;

            let sample_path = speaker_samples_dir.join(&sample_filename);

            let ffmpeg_output = std::process::Command::new("ffmpeg")
                .args([
                    "-y",
                    "-i", audio_path.as_str(),
                    "-ss", &format!("{:.3}", sample.start_time),
                    "-to", &format!("{:.3}", sample.end_time),
                    "-ar", "16000",
                    "-ac", "1",
                    sample_path.to_str().unwrap(),
                ])
                .output()
                .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

            if ffmpeg_output.status.success() {
                let path_str = sample_path.to_string_lossy().to_string();
                log::info!("Extracted speaker audio to '{}'", path_str);

                // Insert DB record for this voice sample
                let _ = db.insert_voice_sample(
                    &sample.speaker_name,
                    Some(episode_id),
                    sample.segment_idx,
                    sample.start_time,
                    sample.end_time,
                    Some(&sample.text),
                    &path_str,
                    Some("manual"),
                );
            } else {
                let stderr = String::from_utf8_lossy(&ffmpeg_output.stderr);
                log::error!("Failed to extract audio for '{}': {}", sample.speaker_name, stderr);
            }

            // 2. Also add to voice library for embedding (existing flow)
            let output = std::process::Command::new(&venv_python)
                .args([
                    voice_library_script.to_str().unwrap(),
                    "add",
                    &sample.speaker_name,
                    audio_path.as_str(),
                    &format!("{:.3}", sample.start_time),
                    &format!("{:.3}", sample.end_time),
                    "--backend",
                    &embedding_backend,
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
) -> Result<ContentAnalysisResult, AppError> {
    log::info!("analyze_episode_content called for episode: {}", episode_id);

    // Get episode
    let episode = db
        .get_episode_by_id(episode_id)
        .map_err(AppError::from)?
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
        return Err(format!("Content analyzer failed: {}", stderr).into());
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
