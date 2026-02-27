//! Background subagent schedulers.
//!
//! Each function runs in its own Tokio task (spawned in lib.rs setup).
//! They follow the same pattern as `feed_sync_scheduler` in lib.rs:
//! - receive `Arc<Database>` + `AppHandle`
//! - loop forever with a `tokio::time::sleep` between runs
//! - emit Tauri events to notify the frontend of results

use crate::database::Database;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;

// ============================================================================
// S1: Quality scan agent — runs every 6 hours
// ============================================================================

/// Scans for quality issues and emits a `quality_alert` event with counts.
///
/// Checks:
/// - Episodes where diarization is complete but speaker labels are still SPEAKER_XX
/// - Completed episodes with zero FTS-indexed segments (transcript never indexed)
pub async fn quality_scan_agent(db: Arc<Database>, app_handle: tauri::AppHandle) {
    log::info!("Quality scan agent started (every 6 hours)");

    loop {
        tokio::time::sleep(Duration::from_secs(6 * 3600)).await;

        let unresolved_labels = match db.count_unresolved_speaker_labels() {
            Ok(n) => n,
            Err(e) => {
                log::warn!(
                    "quality_scan: count_unresolved_speaker_labels failed: {}",
                    e
                );
                0
            }
        };

        let unindexed = match db.count_unindexed_completed_episodes() {
            Ok(n) => n,
            Err(e) => {
                log::warn!(
                    "quality_scan: count_unindexed_completed_episodes failed: {}",
                    e
                );
                0
            }
        };

        if unresolved_labels > 0 || unindexed > 0 {
            log::info!(
                "Quality scan: {} episodes with unresolved speaker labels, {} unindexed",
                unresolved_labels,
                unindexed,
            );
        }

        let _ = app_handle.emit(
            "quality_alert",
            serde_json::json!({
                "unresolved_speaker_labels": unresolved_labels,
                "unindexed_completed": unindexed,
            }),
        );
    }
}

// ============================================================================
// S2: Extraction coordinator agent — runs every 2 hours
// ============================================================================

/// Finds transcribed episodes with no extraction run and emits
/// `extraction_queued` so the frontend can prompt the user.
///
/// Does NOT call Ollama directly — extraction is user-initiated.
/// This agent just surfaces the work that is waiting.
pub async fn extraction_coordinator_agent(db: Arc<Database>, app_handle: tauri::AppHandle) {
    log::info!("Extraction coordinator agent started (every 2 hours)");

    loop {
        tokio::time::sleep(Duration::from_secs(2 * 3600)).await;

        let ids = match db.get_unextracted_episode_ids(50) {
            Ok(v) => v,
            Err(e) => {
                log::warn!(
                    "extraction_coordinator: get_unextracted_episode_ids failed: {}",
                    e
                );
                continue;
            }
        };

        if !ids.is_empty() {
            log::info!(
                "Extraction coordinator: {} episodes awaiting extraction",
                ids.len()
            );
            let _ = app_handle.emit(
                "extraction_queued",
                serde_json::json!({ "count": ids.len() }),
            );
        }
    }
}

// ============================================================================
// S3: Wiki sync agent — runs daily at 3:00 AM
// ============================================================================

/// Syncs wiki lore from episode content daily at 3:00 AM local time.
/// Emits `stats_update` after each run.
pub async fn wiki_sync_agent(_db: Arc<Database>, app_handle: tauri::AppHandle) {
    use chrono::Local;

    log::info!("Wiki sync agent started (daily at 3:00 AM)");

    loop {
        let now = Local::now();
        let today_target = now.date_naive().and_hms_opt(3, 0, 0).unwrap();

        let next_run = if now.naive_local() < today_target {
            today_target
        } else {
            today_target + chrono::Duration::days(1)
        };

        let wait_duration = (next_run - now.naive_local())
            .to_std()
            .unwrap_or(Duration::from_secs(3600));

        log::info!(
            "Next wiki sync scheduled for {} (in {:.1} hours)",
            next_run.format("%Y-%m-%d %H:%M"),
            wait_duration.as_secs_f64() / 3600.0
        );

        tokio::time::sleep(wait_duration).await;

        // Wiki sync requires HTTP calls to MediaWiki and is user-initiated via
        // the `sync_wiki_episode` command. This agent just pings the frontend
        // so it can surface a "wiki sync available" badge if desired.
        log::info!("Wiki sync window reached — emitting stats_update for frontend refresh");
        let _ = app_handle.emit("stats_update", ());
        let _ = app_handle.emit("wiki_sync_ready", ());
    }
}

// ============================================================================
// S4: Hints prefetch agent — runs every hour
// ============================================================================

/// For episodes with unresolved speaker flags that don't yet have a hints file,
/// pre-generates the `{episode_id}_hints.json` so re-diarization can start
/// immediately when the user requests it.
pub async fn hints_prefetch_agent(db: Arc<Database>, app_handle: tauri::AppHandle) {
    log::info!("Hints prefetch agent started (every 1 hour)");

    // Need the transcripts dir to write hint files
    let home_dir = match dirs::home_dir() {
        Some(p) => p,
        None => {
            log::warn!("hints_prefetch: could not determine home directory");
            return;
        }
    };
    let transcripts_dir = home_dir
        .join("Desktop")
        .join("Projects")
        .join("ice-cream-social-app")
        .join("scripts")
        .join("transcripts");

    loop {
        tokio::time::sleep(Duration::from_secs(3600)).await;

        let episode_ids = match db.get_episodes_with_unresolved_speaker_flags() {
            Ok(v) => v,
            Err(e) => {
                log::warn!(
                    "hints_prefetch: get_episodes_with_unresolved_speaker_flags failed: {}",
                    e
                );
                continue;
            }
        };

        let mut prefetched = 0usize;

        for episode_id in &episode_ids {
            let hints_path = transcripts_dir.join(format!("{}_hints.json", episode_id));

            // Skip if a hints file already exists
            if hints_path.exists() {
                continue;
            }

            if let Err(e) = write_hints_file(*episode_id, &hints_path, &db) {
                log::warn!(
                    "hints_prefetch: failed to write hints for episode {}: {}",
                    episode_id,
                    e
                );
            } else {
                prefetched += 1;
            }
        }

        if prefetched > 0 {
            log::info!("Hints prefetch: generated {} hints files", prefetched);
            let _ = app_handle.emit(
                "hints_prefetched",
                serde_json::json!({ "count": prefetched }),
            );
        }
    }
}

/// Build and write a `{episode_id}_hints.json` file from unresolved speaker flags.
fn write_hints_file(episode_id: i64, path: &PathBuf, db: &Arc<Database>) -> Result<(), String> {
    let flags = db
        .get_unresolved_speaker_flags(episode_id)
        .map_err(|e| e.to_string())?;

    if flags.is_empty() {
        return Ok(());
    }

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
                let speaker_ids: Vec<String> = flag
                    .speaker_ids
                    .as_ref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or_default();
                for sid in &speaker_ids {
                    all_speakers.insert(sid.clone());
                }
                multiple_speakers_segments.push(serde_json::json!({
                    "segment_idx": flag.segment_idx,
                    "speaker_ids": speaker_ids,
                }));
            }
            "character_voice" => {
                if let Some(ref name) = flag.character_name {
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

    let num_speakers_hint = if all_speakers.len() > 1 {
        Some(all_speakers.len())
    } else {
        None
    };

    let hints = serde_json::json!({
        "corrections": corrections,
        "multiple_speakers_segments": multiple_speakers_segments,
        "num_speakers_hint": num_speakers_hint,
    });

    std::fs::write(path, serde_json::to_string_pretty(&hints).unwrap())
        .map_err(|e| format!("write failed: {}", e))?;

    Ok(())
}
