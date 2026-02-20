use crate::database::Database;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

const WIKI_API_URL: &str = "https://heyscoops.fandom.com/api.php";
const WIKI_BASE_URL: &str = "https://heyscoops.fandom.com/wiki";

// ============================================================================
// Wikitext parsing helpers
// ============================================================================

/// Parse the Episode1 infobox template from raw wikitext
fn parse_episode_infobox(wikitext: &str) -> ParsedWikiEpisode {
    let mut result = ParsedWikiEpisode::default();

    // Extract fields from {{Episode1|field = value|...}}
    // The template uses pipe-delimited key=value pairs
    if let Some(start) = wikitext.find("{{Episode1|").or_else(|| wikitext.find("{{Episode Infobox")) {
        let template_start = wikitext[start..].find('|').map(|p| start + p + 1).unwrap_or(start);
        // Find matching closing }}
        let mut depth = 0;
        let mut template_end = wikitext.len();
        for (i, c) in wikitext[start..].char_indices() {
            match c {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth <= 0 {
                        template_end = start + i;
                        break;
                    }
                }
                _ => {}
            }
        }
        let content = &wikitext[template_start..template_end];

        // Split on top-level pipes (not inside [[ ]] or {{ }})
        let fields = split_template_fields(content);

        for field in fields {
            if let Some(eq_pos) = field.find('=') {
                let key = field[..eq_pos].trim().to_lowercase();
                let value = field[eq_pos + 1..].trim().to_string();
                let clean = clean_wikitext(&value);

                match key.as_str() {
                    "airdate" | "air_date" => result.air_date = Some(clean),
                    "caption from feed" | "caption" => result.summary = Some(clean),
                    "runtime" => result.runtime = Some(clean),
                    "topic" => result.topics = Some(clean),
                    "any memorable characters or bits created" | "characters" | "bits" => {
                        result.bits = Some(clean);
                    }
                    "scoopmail" => result.scoopmail = Some(clean),
                    "jockvnerd" | "jock_vs_nerd" => result.jock_vs_nerd = Some(clean),
                    "guest" | "guests" => result.guests = Some(clean),
                    _ => {}
                }
            }
        }
    }

    result
}

/// Split template content on top-level pipes
fn split_template_fields(content: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut bracket_depth = 0;
    let mut brace_depth = 0;

    for c in content.chars() {
        match c {
            '[' => { bracket_depth += 1; current.push(c); }
            ']' => { bracket_depth -= 1; current.push(c); }
            '{' => { brace_depth += 1; current.push(c); }
            '}' => { brace_depth -= 1; current.push(c); }
            '|' if bracket_depth == 0 && brace_depth == 0 => {
                fields.push(current.clone());
                current.clear();
            }
            _ => current.push(c),
        }
    }
    if !current.trim().is_empty() {
        fields.push(current);
    }
    fields
}

/// Remove wiki markup: [[links]], bold, bullets
fn clean_wikitext(text: &str) -> String {
    let mut result = text.to_string();
    // Remove [[ and ]] but keep the text
    result = result.replace("[[", "").replace("]]", "");
    // Remove ''' bold markers
    result = result.replace("'''", "");
    // Clean up bullet points to newlines
    result = regex::Regex::new(r"\n?\s*\*\s*")
        .map(|re| re.replace_all(&result, "\n- ").to_string())
        .unwrap_or(result);
    result.trim().to_string()
}

#[derive(Debug, Default)]
struct ParsedWikiEpisode {
    air_date: Option<String>,
    summary: Option<String>,
    runtime: Option<String>,
    topics: Option<String>,
    bits: Option<String>,
    scoopmail: Option<String>,
    jock_vs_nerd: Option<String>,
    guests: Option<String>,
}

// ============================================================================
// API response types
// ============================================================================

#[derive(Debug, Deserialize)]
struct WikiSearchResponse {
    query: Option<WikiSearchQuery>,
}

#[derive(Debug, Deserialize)]
struct WikiSearchQuery {
    search: Option<Vec<WikiSearchResult>>,
}

#[derive(Debug, Deserialize)]
struct WikiSearchResult {
    #[serde(rename = "pageid")]
    page_id: i64,
    title: String,
}

#[derive(Debug, Deserialize)]
struct WikiParseResponse {
    parse: Option<WikiParsedPage>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct WikiParsedPage {
    title: String,
    #[serde(rename = "pageid")]
    page_id: i64,
    wikitext: Option<WikiTextContent>,
    categories: Option<Vec<WikiCategory>>,
}

#[derive(Debug, Deserialize)]
struct WikiTextContent {
    #[serde(rename = "*")]
    content: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct WikiCategory {
    #[serde(rename = "*")]
    name: String,
}

// ============================================================================
// Tauri commands
// ============================================================================

#[derive(Debug, Serialize)]
pub struct WikiSyncResult {
    pub episode_id: i64,
    pub wiki_page_id: i64,
    pub wiki_title: String,
    pub has_summary: bool,
    pub has_bits: bool,
    pub has_scoopmail: bool,
    pub has_jock_vs_nerd: bool,
}

/// Sync wiki data for a single episode by its episode number
#[tauri::command]
pub async fn sync_wiki_episode(
    db: State<'_, Arc<Database>>,
    episode_number: String,
) -> Result<WikiSyncResult, AppError> {
    log::info!("sync_wiki_episode called for episode number: {}", episode_number);

    // Find the episode in our DB (prefer apple feed)
    let episode_id = db.find_episode_by_number(&episode_number, Some("apple"))?
        .or_else(|| {
            db.find_episode_by_number(&episode_number, Some("patreon"))
                .ok()
                .flatten()
        })
        .ok_or_else(|| format!("No episode found with number {}", episode_number))?;

    // Get episode title from DB for fallback search
    let episode_title = db.get_episode_by_id(episode_id)
        .ok()
        .flatten()
        .map(|ep| ep.title.clone())
        .unwrap_or_default();

    // Search for the episode on the wiki
    // Try multiple patterns since wiki naming is inconsistent
    let client = reqwest::Client::new();

    let num_str = episode_number.clone();
    let padded = format!("{:03}", num_str.parse::<i64>().unwrap_or(0));

    // Extract just the title portion (strip "Episode NNN: " prefix and trailing punctuation)
    let clean_title = episode_title
        .trim_start_matches("Episode ")
        .trim_start_matches("Ad Free ")
        .trim_start_matches(&format!("{}: ", num_str))
        .trim_start_matches(&format!("{}_ ", num_str))
        .trim_end_matches('.')
        .trim()
        .to_string();

    let search_queries = vec![
        format!("{}: ", episode_number),        // "998: " — matches "998: The Abolition..."
        format!("Episode {}", episode_number),  // "Episode 998" — matches "Episode 998: ..."
        clean_title.clone(),                    // "The Abolition of Hard Pants" — title-based fallback
    ];

    let mut wiki_page_id: Option<i64> = None;
    let mut wiki_title = String::new();

    for query in &search_queries {
        if query.is_empty() {
            continue;
        }

        let resp = client.get(WIKI_API_URL)
            .query(&[
                ("action", "query"),
                ("list", "search"),
                ("srsearch", query),
                ("srlimit", "5"),
                ("format", "json"),
            ])
            .send()
            .await
            .map_err(|e| format!("Wiki API request failed: {}", e))?;

        let search: WikiSearchResponse = resp.json().await
            .map_err(|e| format!("Failed to parse wiki search response: {}", e))?;

        if let Some(results) = search.query.and_then(|q| q.search) {
            for r in &results {
                let title_lower = r.title.to_lowercase();
                // Strict match: title starts with the episode number pattern
                if title_lower.starts_with(&format!("episode {}:", num_str.to_lowercase()))
                    || title_lower.starts_with(&format!("episode {}:", padded.to_lowercase()))
                    || title_lower.starts_with(&format!("{}:", num_str))
                    || title_lower.starts_with(&format!("{}:", padded))
                {
                    wiki_page_id = Some(r.page_id);
                    wiki_title = r.title.clone();
                    break;
                }
                // Loose match: title contains the episode number and part of the clean title
                if !clean_title.is_empty() && clean_title.len() > 5 {
                    let clean_lower = clean_title.to_lowercase();
                    if (title_lower.contains(&num_str) || title_lower.contains(&padded))
                        && title_lower.contains(&clean_lower[..clean_lower.len().min(20)])
                    {
                        wiki_page_id = Some(r.page_id);
                        wiki_title = r.title.clone();
                        break;
                    }
                }
            }
        }
        if wiki_page_id.is_some() {
            break;
        }
    }

    let page_id = wiki_page_id.ok_or_else(|| format!("Episode {} not found on wiki", episode_number))?;

    log::info!("Found wiki page: {} (id: {})", wiki_title, page_id);

    // Fetch the full page content
    let resp = client.get(WIKI_API_URL)
        .query(&[
            ("action", "parse"),
            ("pageid", &page_id.to_string()),
            ("prop", "wikitext|categories"),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|e| format!("Wiki parse request failed: {}", e))?;

    let parsed: WikiParseResponse = resp.json().await
        .map_err(|e| format!("Failed to parse wiki page response: {}", e))?;

    let page = parsed.parse.ok_or("Wiki returned empty parse result")?;
    let raw_wikitext = page.wikitext.map(|w| w.content).unwrap_or_default();

    // Parse the infobox
    let info = parse_episode_infobox(&raw_wikitext);

    let wiki_url = format!("{}/{}", WIKI_BASE_URL, wiki_title.replace(' ', "_"));

    // Build JSON arrays for list fields
    let bits_json = info.bits.as_ref().map(|b| {
        let items: Vec<&str> = b.split("\n- ").filter(|s| !s.trim().is_empty()).collect();
        serde_json::to_string(&items).unwrap_or_default()
    });

    let scoopmail_json = info.scoopmail.as_ref().map(|s| {
        let items: Vec<&str> = s.split("\n- ").filter(|s| !s.trim().is_empty()).collect();
        serde_json::to_string(&items).unwrap_or_default()
    });

    // Store in database
    db.upsert_wiki_episode_meta(
        episode_id,
        page_id,
        &wiki_url,
        info.topics.as_deref().or(info.summary.as_deref()),
        info.air_date.as_deref(),
        info.topics.as_deref(),
        info.guests.as_deref(),
        bits_json.as_deref(),
        scoopmail_json.as_deref(),
        info.jock_vs_nerd.as_deref(),
        Some(&raw_wikitext),
    )?;

    log::info!("Wiki data synced for episode {} (db id: {})", episode_number, episode_id);

    Ok(WikiSyncResult {
        episode_id,
        wiki_page_id: page_id,
        wiki_title,
        has_summary: info.topics.is_some() || info.summary.is_some(),
        has_bits: info.bits.is_some(),
        has_scoopmail: info.scoopmail.is_some(),
        has_jock_vs_nerd: info.jock_vs_nerd.is_some(),
    })
}

/// Get wiki episode metadata for display in the UI
#[tauri::command]
pub async fn get_wiki_episode_meta(
    db: State<'_, Arc<Database>>,
    episode_id: i64,
) -> Result<Option<crate::database::WikiEpisodeMeta>, AppError> {
    db.get_wiki_episode_meta(episode_id).map_err(AppError::from)
}
