pub mod models;

#[cfg(test)]
mod tests;

use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};

pub use models::*;

pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(db_path: &Path) -> Result<Self> {
        let conn = Connection::open(db_path)?;

        // Enable WAL mode for concurrent reads
        conn.execute_batch(
            "
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=NORMAL;
            PRAGMA cache_size=10000;
            PRAGMA temp_store=MEMORY;
        ",
        )?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };

        // Initialize schema
        db.init_schema()?;

        Ok(db)
    }

    fn init_schema(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS episodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                episode_number TEXT,
                title TEXT NOT NULL,
                description TEXT,
                audio_url TEXT NOT NULL UNIQUE,
                audio_file_path TEXT,
                duration REAL,
                file_size INTEGER,
                published_date TEXT,
                added_date TEXT NOT NULL DEFAULT (datetime('now')),
                downloaded_date TEXT,
                transcribed_date TEXT,
                is_downloaded INTEGER DEFAULT 0,
                is_transcribed INTEGER DEFAULT 0,
                is_in_queue INTEGER DEFAULT 0,
                transcript_path TEXT,
                transcription_status TEXT DEFAULT 'pending',
                transcription_error TEXT,
                processing_time REAL,
                feed_source TEXT DEFAULT 'patreon',
                metadata_json TEXT,
                has_diarization INTEGER DEFAULT 0,
                num_speakers INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_episodes_status_feed
                ON episodes(transcription_status, feed_source);
            CREATE INDEX IF NOT EXISTS idx_episodes_queue_status
                ON episodes(is_in_queue, transcription_status);
            CREATE INDEX IF NOT EXISTS idx_episodes_published
                ON episodes(published_date DESC);

            CREATE TABLE IF NOT EXISTS transcripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                episode_id INTEGER NOT NULL,
                full_text TEXT NOT NULL,
                segments_json TEXT,
                language TEXT DEFAULT 'en',
                language_probability REAL,
                model_used TEXT,
                created_date TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_transcripts_episode ON transcripts(episode_id);

            -- Searchable transcript segments (for full-text search)
            CREATE TABLE IF NOT EXISTS transcript_segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                episode_id INTEGER NOT NULL,
                segment_idx INTEGER NOT NULL,
                speaker TEXT,
                text TEXT NOT NULL,
                start_time REAL NOT NULL,
                end_time REAL,
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
                UNIQUE(episode_id, segment_idx)
            );

            CREATE INDEX IF NOT EXISTS idx_segments_episode ON transcript_segments(episode_id);
            CREATE INDEX IF NOT EXISTS idx_segments_speaker ON transcript_segments(speaker);

            -- Full-text search index on segments
            CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
                text,
                content='transcript_segments',
                content_rowid='id'
            );

            -- Triggers to keep FTS in sync
            CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON transcript_segments BEGIN
                INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
            END;
            CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON transcript_segments BEGIN
                INSERT INTO segments_fts(segments_fts, rowid, text) VALUES('delete', old.id, old.text);
            END;
            CREATE TRIGGER IF NOT EXISTS segments_au AFTER UPDATE ON transcript_segments BEGIN
                INSERT INTO segments_fts(segments_fts, rowid, text) VALUES('delete', old.id, old.text);
                INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
            END;

            -- Detected content (characters, commercials, bits from AI analysis)
            CREATE TABLE IF NOT EXISTS detected_content (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                episode_id INTEGER NOT NULL,
                content_type TEXT NOT NULL, -- 'character', 'commercial', 'bit', 'catchphrase'
                name TEXT NOT NULL,
                description TEXT,
                start_time REAL,
                end_time REAL,
                segment_idx INTEGER,
                confidence REAL DEFAULT 1.0,
                raw_text TEXT, -- The actual transcript text that was analyzed
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_detected_episode ON detected_content(episode_id);
            CREATE INDEX IF NOT EXISTS idx_detected_type ON detected_content(content_type);
            CREATE INDEX IF NOT EXISTS idx_detected_name ON detected_content(name);

            CREATE TABLE IF NOT EXISTS transcription_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                episode_id INTEGER NOT NULL UNIQUE,
                added_to_queue_date TEXT NOT NULL DEFAULT (datetime('now')),
                priority INTEGER DEFAULT 0,
                retry_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                started_date TEXT,
                completed_date TEXT,
                error_message TEXT,
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_queue_priority
                ON transcription_queue(status, priority DESC);

            -- Speakers table (hosts, recurring guests)
            CREATE TABLE IF NOT EXISTS speakers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                short_name TEXT,
                description TEXT,
                is_host INTEGER DEFAULT 0,
                image_url TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );

            -- Link diarization labels to known speakers per episode
            CREATE TABLE IF NOT EXISTS episode_speakers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                episode_id INTEGER NOT NULL,
                diarization_label TEXT NOT NULL,
                speaker_id INTEGER,
                speaking_time_seconds REAL,
                segment_count INTEGER,
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
                FOREIGN KEY (speaker_id) REFERENCES speakers(id),
                UNIQUE(episode_id, diarization_label)
            );

            CREATE INDEX IF NOT EXISTS idx_episode_speakers_episode ON episode_speakers(episode_id);
            CREATE INDEX IF NOT EXISTS idx_episode_speakers_speaker ON episode_speakers(speaker_id);

            -- App settings (key-value store)
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT DEFAULT (datetime('now'))
            );

            -- Chapters (recurring segments like Scoop Mail, Jock vs Nerd, etc.)
            CREATE TABLE IF NOT EXISTS chapter_types (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                color TEXT DEFAULT '#6366f1',
                icon TEXT,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );

            -- Episode chapters (instances of chapter types in episodes)
            CREATE TABLE IF NOT EXISTS episode_chapters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                episode_id INTEGER NOT NULL,
                chapter_type_id INTEGER NOT NULL,
                title TEXT,
                start_time REAL NOT NULL,
                end_time REAL,
                start_segment_idx INTEGER,
                end_segment_idx INTEGER,
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
                FOREIGN KEY (chapter_type_id) REFERENCES chapter_types(id)
            );

            CREATE INDEX IF NOT EXISTS idx_episode_chapters_episode ON episode_chapters(episode_id);

            -- ICS Characters (recurring characters from bits, commercials, etc.)
            CREATE TABLE IF NOT EXISTS characters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                short_name TEXT,
                description TEXT,
                catchphrase TEXT,
                first_episode_id INTEGER,
                image_url TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (first_episode_id) REFERENCES episodes(id)
            );

            -- Character appearances in episodes
            CREATE TABLE IF NOT EXISTS character_appearances (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id INTEGER NOT NULL,
                episode_id INTEGER NOT NULL,
                start_time REAL,
                end_time REAL,
                segment_idx INTEGER,
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_character_appearances_character ON character_appearances(character_id);
            CREATE INDEX IF NOT EXISTS idx_character_appearances_episode ON character_appearances(episode_id);

            -- Sponsors (fake commercials and real sponsors)
            CREATE TABLE IF NOT EXISTS sponsors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                tagline TEXT,
                description TEXT,
                is_real INTEGER DEFAULT 0,
                first_episode_id INTEGER,
                image_url TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (first_episode_id) REFERENCES episodes(id)
            );

            -- Sponsor mentions/appearances in episodes
            CREATE TABLE IF NOT EXISTS sponsor_mentions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sponsor_id INTEGER NOT NULL,
                episode_id INTEGER NOT NULL,
                start_time REAL,
                end_time REAL,
                segment_idx INTEGER,
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE,
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_sponsor_mentions_sponsor ON sponsor_mentions(sponsor_id);
            CREATE INDEX IF NOT EXISTS idx_sponsor_mentions_episode ON sponsor_mentions(episode_id);

            -- Extraction prompts (user-defined LLM prompts for content extraction)
            CREATE TABLE IF NOT EXISTS extraction_prompts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                content_type TEXT NOT NULL, -- 'character', 'trivia', 'guest', 'segment', 'custom'
                prompt_text TEXT NOT NULL,
                system_prompt TEXT,
                output_schema TEXT, -- JSON schema for expected output
                is_active INTEGER DEFAULT 1,
                run_count INTEGER DEFAULT 0,
                last_run_at TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_extraction_prompts_type ON extraction_prompts(content_type);
            CREATE INDEX IF NOT EXISTS idx_extraction_prompts_active ON extraction_prompts(is_active);

            -- Extraction runs (history of LLM extraction jobs)
            CREATE TABLE IF NOT EXISTS extraction_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prompt_id INTEGER NOT NULL,
                episode_id INTEGER NOT NULL,
                status TEXT DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
                input_text TEXT,
                raw_response TEXT,
                parsed_json TEXT,
                items_extracted INTEGER DEFAULT 0,
                error_message TEXT,
                duration_ms INTEGER,
                started_at TEXT,
                completed_at TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (prompt_id) REFERENCES extraction_prompts(id) ON DELETE CASCADE,
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_extraction_runs_prompt ON extraction_runs(prompt_id);
            CREATE INDEX IF NOT EXISTS idx_extraction_runs_episode ON extraction_runs(episode_id);
            CREATE INDEX IF NOT EXISTS idx_extraction_runs_status ON extraction_runs(status);

            -- Flagged segments (for review workflow - wrong speaker, character voices, etc.)
            CREATE TABLE IF NOT EXISTS flagged_segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                episode_id INTEGER NOT NULL,
                segment_idx INTEGER NOT NULL,
                flag_type TEXT NOT NULL,  -- 'wrong_speaker', 'character_voice', 'multiple_speakers', 'audio_issue', 'other'
                corrected_speaker TEXT,   -- For wrong_speaker flags
                character_id INTEGER,     -- For character_voice flags
                notes TEXT,
                resolved INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
                FOREIGN KEY (character_id) REFERENCES characters(id),
                UNIQUE(episode_id, segment_idx)
            );

            CREATE INDEX IF NOT EXISTS idx_flagged_segments_episode ON flagged_segments(episode_id);
            CREATE INDEX IF NOT EXISTS idx_flagged_segments_type ON flagged_segments(flag_type);
            CREATE INDEX IF NOT EXISTS idx_flagged_segments_resolved ON flagged_segments(resolved);

            -- Audio drops (pre-recorded sound bites library)
            CREATE TABLE IF NOT EXISTS audio_drops (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                transcript_text TEXT,
                description TEXT,
                category TEXT DEFAULT 'drop',
                created_at TEXT DEFAULT (datetime('now'))
            );

            -- Audio drop instances (occurrences in episodes)
            CREATE TABLE IF NOT EXISTS audio_drop_instances (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                audio_drop_id INTEGER NOT NULL,
                episode_id INTEGER NOT NULL,
                segment_idx INTEGER,
                start_time REAL,
                end_time REAL,
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (audio_drop_id) REFERENCES audio_drops(id) ON DELETE CASCADE,
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_audio_drop_instances_drop ON audio_drop_instances(audio_drop_id);
            CREATE INDEX IF NOT EXISTS idx_audio_drop_instances_episode ON audio_drop_instances(episode_id);

            -- Insert default chapter types
            INSERT OR IGNORE INTO chapter_types (name, description, color, icon, sort_order) VALUES
                ('Opening', 'Episode introduction and banter', '#22c55e', '🎬', 1),
                ('Scoop Mail', 'Listener mail segment', '#3b82f6', '📧', 2),
                ('Jock vs Nerd', 'Trivia competition segment', '#f59e0b', '🏆', 3),
                ('Fake Commercial', 'Satirical advertisement bit', '#ec4899', '📺', 4),
                ('Thank Yous', 'Patron acknowledgments', '#8b5cf6', '🙏', 5),
                ('Closing', 'Episode wrap-up', '#6b7280', '👋', 6),
                ('Interview', 'Guest interview segment', '#14b8a6', '🎤', 7),
                ('News', 'Current events discussion', '#ef4444', '📰', 8),
                ('Bit', 'Comedy bit or recurring joke', '#f97316', '😂', 9);

            -- Insert default hosts if not exists
            INSERT OR IGNORE INTO speakers (name, short_name, is_host) VALUES
                ('Matt Donnelly', 'Matt', 1),
                ('Paul Mattingly', 'Paul', 1);

            -- Insert default audio drops
            INSERT OR IGNORE INTO audio_drops (name, transcript_text, description, category) VALUES
                ('Intro', 'Hey, Johnny, do you want to go to an ice cream social? Yeah, I''d love to. Great. Let''s go.', 'Episode intro drop by Jacob', 'intro');

            -- Insert default settings
            INSERT OR IGNORE INTO app_settings (key, value) VALUES
                ('auto_transcribe', 'false'),
                ('transcription_model', 'medium'),
                ('enable_diarization', 'true'),
                ('ollama_model', 'llama3.2:3b');

            -- Insert default extraction prompts
            INSERT OR IGNORE INTO extraction_prompts (name, description, content_type, prompt_text, system_prompt, output_schema) VALUES
                ('Character Detection', 'Detect recurring characters like Sweet Bean, Duck Duck, Negative Nelly', 'character',
                 'Analyze this podcast transcript and identify any recurring characters or personas that are performed by the hosts. Look for:
- Named characters with distinct voices or personalities
- Catchphrases associated with characters
- Character entrances/exits marked by specific sounds or phrases

List each character found with their approximate timestamp.',
                 'You are analyzing a comedy podcast transcript. Extract character appearances with timestamps. Respond in JSON format.',
                 '{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"catchphrase":{"type":"string"},"start_time":{"type":"number"},"end_time":{"type":"number"},"confidence":{"type":"number"}}}}'),

                ('Trivia Scores', 'Extract Jock vs Nerd trivia scores', 'trivia',
                 'Find the "Jock vs Nerd" trivia segment in this transcript. Extract:
- Final score for Jock (Paul)
- Final score for Nerd (Matt)
- Category/topic of this episode''s trivia
- Any notable moments or disputed answers',
                 'You are analyzing a podcast transcript to find trivia game results. Respond in JSON format only.',
                 '{"type":"object","properties":{"jock_score":{"type":"integer"},"nerd_score":{"type":"integer"},"category":{"type":"string"},"winner":{"type":"string"},"notes":{"type":"string"}}}'),

                ('Guest Detection', 'Identify guest appearances and introductions', 'guest',
                 'Identify any guests on this podcast episode. Look for:
- Introduction of guests by name
- Guest credentials or background mentioned
- Interview segments

List each guest with when they appear.',
                 'You are analyzing a podcast transcript to identify guests. Respond in JSON format.',
                 '{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"title":{"type":"string"},"start_time":{"type":"number"},"topics_discussed":{"type":"array","items":{"type":"string"}}}}}'),

                ('Segment Detection', 'Detect recurring segments like Scoop Mail, commercials', 'segment',
                 'Identify the different segments in this podcast episode. Common segments include:
- Opening banter
- Scoop Mail (listener mail)
- Jock vs Nerd (trivia)
- Fake commercials/sponsors
- Thank yous to patrons
- Closing

Mark the start time of each segment.',
                 'You are analyzing a podcast to identify recurring segments. Respond in JSON format.',
                 '{"type":"array","items":{"type":"object","properties":{"segment_type":{"type":"string"},"title":{"type":"string"},"start_time":{"type":"number"},"end_time":{"type":"number"}}}}');
        "#,
        )?;

        // Migrations: Add speaker_ids column to flagged_segments (idempotent)
        let _ = conn.execute(
            "ALTER TABLE flagged_segments ADD COLUMN speaker_ids TEXT",
            [],
        ); // Ignore error if column already exists

        // Migration: Add queue_type column to transcription_queue (idempotent)
        let _ = conn.execute(
            "ALTER TABLE transcription_queue ADD COLUMN queue_type TEXT DEFAULT 'full'",
            [],
        ); // Ignore error if column already exists

        Ok(())
    }

    // =========================================================================
    // Episode queries
    // =========================================================================

    pub fn get_episodes(
        &self,
        feed_source: Option<&str>,
        transcribed_only: bool,
        in_queue_only: bool,
        sort_by: Option<&str>,
        sort_desc: bool,
        search: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Episode>, i64)> {
        let conn = self.conn.lock().unwrap();

        let mut conditions = Vec::new();
        if let Some(source) = feed_source {
            conditions.push(format!("feed_source = '{}'", source));
        }
        if transcribed_only {
            conditions.push("is_transcribed = 1".to_string());
        }
        if in_queue_only {
            conditions.push("is_in_queue = 1".to_string());
        }
        if let Some(search_term) = search {
            if !search_term.is_empty() {
                conditions.push(format!(
                    "(title LIKE '%{}%' OR description LIKE '%{}%')",
                    search_term.replace("'", "''"),
                    search_term.replace("'", "''")
                ));
            }
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        // Validate and map sort column
        let sort_column = match sort_by {
            Some("published_date") => "published_date",
            Some("title") => "title",
            Some("episode_number") => "CAST(episode_number AS INTEGER)",
            Some("duration") => "duration",
            Some("added_date") => "added_date",
            Some("has_diarization") => "has_diarization",
            _ => "published_date",
        };
        let sort_direction = if sort_desc { "DESC" } else { "ASC" };

        // Get total count
        let count_sql = format!("SELECT COUNT(*) FROM episodes {}", where_clause);
        let total: i64 = conn.query_row(&count_sql, [], |row| row.get(0))?;

        // Get episodes
        let sql = format!(
            "SELECT id, episode_number, title, description, audio_url, audio_file_path,
                    duration, file_size, published_date, added_date, downloaded_date,
                    transcribed_date, is_downloaded, is_transcribed, is_in_queue,
                    transcript_path, transcription_status, transcription_error,
                    processing_time, feed_source, metadata_json, has_diarization, num_speakers
             FROM episodes {}
             ORDER BY {} {}
             LIMIT ? OFFSET ?",
            where_clause, sort_column, sort_direction
        );

        let mut stmt = conn.prepare(&sql)?;
        let episodes = stmt
            .query_map(params![limit, offset], |row| {
                Ok(Episode {
                    id: row.get(0)?,
                    episode_number: row.get(1)?,
                    title: row.get(2)?,
                    description: row.get(3)?,
                    audio_url: row.get(4)?,
                    audio_file_path: row.get(5)?,
                    duration: row.get(6)?,
                    file_size: row.get(7)?,
                    published_date: row.get(8)?,
                    added_date: row.get(9)?,
                    downloaded_date: row.get(10)?,
                    transcribed_date: row.get(11)?,
                    is_downloaded: row.get::<_, i32>(12)? == 1,
                    is_transcribed: row.get::<_, i32>(13)? == 1,
                    is_in_queue: row.get::<_, i32>(14)? == 1,
                    transcript_path: row.get(15)?,
                    transcription_status: row
                        .get::<_, String>(16)
                        .unwrap_or_default()
                        .into(),
                    transcription_error: row.get(17)?,
                    processing_time: row.get(18)?,
                    feed_source: row.get(19)?,
                    metadata_json: row.get(20)?,
                    has_diarization: row.get::<_, i32>(21).unwrap_or(0) == 1,
                    num_speakers: row.get(22)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok((episodes, total))
    }

    pub fn get_episode_by_id(&self, id: i64) -> Result<Option<Episode>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, episode_number, title, description, audio_url, audio_file_path,
                    duration, file_size, published_date, added_date, downloaded_date,
                    transcribed_date, is_downloaded, is_transcribed, is_in_queue,
                    transcript_path, transcription_status, transcription_error,
                    processing_time, feed_source, metadata_json, has_diarization, num_speakers
             FROM episodes WHERE id = ?",
        )?;

        let episode = stmt
            .query_row(params![id], |row| {
                Ok(Episode {
                    id: row.get(0)?,
                    episode_number: row.get(1)?,
                    title: row.get(2)?,
                    description: row.get(3)?,
                    audio_url: row.get(4)?,
                    audio_file_path: row.get(5)?,
                    duration: row.get(6)?,
                    file_size: row.get(7)?,
                    published_date: row.get(8)?,
                    added_date: row.get(9)?,
                    downloaded_date: row.get(10)?,
                    transcribed_date: row.get(11)?,
                    is_downloaded: row.get::<_, i32>(12)? == 1,
                    is_transcribed: row.get::<_, i32>(13)? == 1,
                    is_in_queue: row.get::<_, i32>(14)? == 1,
                    transcript_path: row.get(15)?,
                    transcription_status: row
                        .get::<_, String>(16)
                        .unwrap_or_default()
                        .into(),
                    transcription_error: row.get(17)?,
                    processing_time: row.get(18)?,
                    feed_source: row.get(19)?,
                    metadata_json: row.get(20)?,
                    has_diarization: row.get::<_, i32>(21).unwrap_or(0) == 1,
                    num_speakers: row.get(22)?,
                })
            })
            .ok();

        Ok(episode)
    }

    /// Insert a new episode or update if it exists (by audio_url)
    pub fn upsert_episode(
        &self,
        episode_number: Option<&str>,
        title: &str,
        description: Option<&str>,
        audio_url: &str,
        duration: Option<f64>,
        file_size: Option<i64>,
        published_date: Option<&str>,
        feed_source: &str,
    ) -> Result<(i64, bool)> {
        let conn = self.conn.lock().unwrap();

        // Check if episode exists
        let existing_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM episodes WHERE audio_url = ?",
                params![audio_url],
                |row| row.get(0),
            )
            .ok();

        if let Some(id) = existing_id {
            // Update existing episode
            conn.execute(
                "UPDATE episodes SET
                    episode_number = COALESCE(?, episode_number),
                    title = ?,
                    description = COALESCE(?, description),
                    duration = COALESCE(?, duration),
                    file_size = COALESCE(?, file_size),
                    published_date = COALESCE(?, published_date)
                 WHERE id = ?",
                params![episode_number, title, description, duration, file_size, published_date, id],
            )?;
            Ok((id, false)) // false = not new
        } else {
            // Insert new episode with current timestamp and proper defaults
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO episodes (episode_number, title, description, audio_url, duration, file_size, published_date, feed_source, added_date, is_downloaded, is_transcribed, is_in_queue)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)",
                params![episode_number, title, description, audio_url, duration, file_size, published_date, feed_source, now],
            )?;
            let id = conn.last_insert_rowid();
            Ok((id, true)) // true = new
        }
    }

    /// Get transcript for an episode
    pub fn get_transcript(&self, episode_id: i64) -> Result<Option<TranscriptData>> {
        let conn = self.conn.lock().unwrap();

        let result = conn.query_row(
            "SELECT t.full_text, t.segments_json, t.language, t.model_used, t.created_date,
                    e.title, e.episode_number, e.transcript_path
             FROM transcripts t
             JOIN episodes e ON t.episode_id = e.id
             WHERE t.episode_id = ?",
            params![episode_id],
            |row| {
                Ok(TranscriptData {
                    full_text: row.get(0)?,
                    segments_json: row.get(1)?,
                    language: row.get(2)?,
                    model_used: row.get(3)?,
                    created_date: row.get(4)?,
                    episode_title: row.get(5)?,
                    episode_number: row.get(6)?,
                    transcript_path: row.get(7)?,
                    // Diarization info - not stored in DB yet, will be parsed from file
                    has_diarization: false,
                    num_speakers: None,
                    diarization_method: None,
                    speaker_names: None,
                })
            },
        ).ok();

        Ok(result)
    }

    /// Update episode download status
    pub fn mark_downloaded(&self, episode_id: i64, file_path: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE episodes SET is_downloaded = 1, audio_file_path = ?, downloaded_date = datetime('now') WHERE id = ?",
            params![file_path, episode_id],
        )?;
        Ok(())
    }

    /// Update episode file size
    pub fn update_episode_file_size(&self, episode_id: i64, file_size: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE episodes SET file_size = ? WHERE id = ?",
            params![file_size, episode_id],
        )?;
        Ok(())
    }

    // =========================================================================
    // Queue queries
    // =========================================================================

    /// Reset any stuck "processing" items to "pending" (for recovery after crash)
    pub fn reset_stuck_processing(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let count = conn.execute(
            "UPDATE transcription_queue SET status = 'pending', started_date = NULL WHERE status = 'processing'",
            [],
        )?;
        if count > 0 {
            log::info!("Reset {} stuck processing items to pending", count);
        }
        Ok(count)
    }

    /// Retry failed download items (reset to pending if retry_count < 3)
    pub fn retry_failed_downloads(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let count = conn.execute(
            "UPDATE transcription_queue SET status = 'pending', started_date = NULL WHERE status = 'failed' AND retry_count < 3 AND error_message LIKE '%ownload%'",
            [],
        )?;
        if count > 0 {
            log::info!("Reset {} failed download items to pending for retry", count);
        }
        Ok(count)
    }

    pub fn get_queue(&self) -> Result<(Vec<QueueItemWithEpisode>, Vec<QueueItemWithEpisode>, Vec<QueueItemWithEpisode>, Vec<QueueItemWithEpisode>)> {
        let conn = self.conn.lock().unwrap();

        let sql = r#"
            SELECT q.id, q.episode_id, q.added_to_queue_date, q.priority, q.retry_count,
                   q.status, q.started_date, q.completed_date, q.error_message,
                   e.id, e.episode_number, e.title, e.description, e.audio_url,
                   e.audio_file_path, e.duration, e.file_size, e.published_date,
                   e.added_date, e.downloaded_date, e.transcribed_date, e.is_downloaded,
                   e.is_transcribed, e.is_in_queue, e.transcript_path, e.transcription_status,
                   e.transcription_error, e.processing_time, e.feed_source, e.metadata_json,
                   e.has_diarization, e.num_speakers
            FROM transcription_queue q
            JOIN episodes e ON q.episode_id = e.id
            ORDER BY q.priority DESC, q.added_to_queue_date ASC
        "#;

        let mut stmt = conn.prepare(sql)?;
        let items: Vec<QueueItemWithEpisode> = stmt
            .query_map([], |row| {
                Ok(QueueItemWithEpisode {
                    queue_item: TranscriptionQueueItem {
                        id: row.get(0)?,
                        episode_id: row.get(1)?,
                        added_to_queue_date: row.get(2)?,
                        priority: row.get(3)?,
                        retry_count: row.get(4)?,
                        status: row.get(5)?,
                        started_date: row.get(6)?,
                        completed_date: row.get(7)?,
                        error_message: row.get(8)?,
                    },
                    episode: Episode {
                        id: row.get(9)?,
                        episode_number: row.get(10)?,
                        title: row.get(11)?,
                        description: row.get(12)?,
                        audio_url: row.get(13)?,
                        audio_file_path: row.get(14)?,
                        duration: row.get(15)?,
                        file_size: row.get(16)?,
                        published_date: row.get(17)?,
                        added_date: row.get(18)?,
                        downloaded_date: row.get(19)?,
                        transcribed_date: row.get(20)?,
                        is_downloaded: row.get::<_, i32>(21)? == 1,
                        is_transcribed: row.get::<_, i32>(22)? == 1,
                        is_in_queue: row.get::<_, i32>(23)? == 1,
                        transcript_path: row.get(24)?,
                        transcription_status: row
                            .get::<_, String>(25)
                            .unwrap_or_default()
                            .into(),
                        transcription_error: row.get(26)?,
                        processing_time: row.get(27)?,
                        feed_source: row.get(28)?,
                        metadata_json: row.get(29)?,
                        has_diarization: row.get::<_, i32>(30).unwrap_or(0) == 1,
                        num_speakers: row.get(31)?,
                    },
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut pending = Vec::new();
        let mut processing = Vec::new();
        let mut completed = Vec::new();
        let mut failed = Vec::new();

        for item in items {
            match item.queue_item.status.as_str() {
                "pending" => pending.push(item),
                "processing" => processing.push(item),
                "completed" => completed.push(item),
                "failed" => failed.push(item),
                _ => pending.push(item),
            }
        }

        Ok((pending, processing, completed, failed))
    }

    pub fn add_to_queue(&self, episode_id: i64, priority: i32) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR REPLACE INTO transcription_queue (episode_id, priority, status, added_to_queue_date, retry_count)
             VALUES (?, ?, 'pending', ?, 0)",
            params![episode_id, priority, now],
        )?;
        conn.execute(
            "UPDATE episodes SET is_in_queue = 1 WHERE id = ?",
            params![episode_id],
        )?;
        Ok(())
    }

    pub fn remove_from_queue(&self, episode_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM transcription_queue WHERE episode_id = ?",
            params![episode_id],
        )?;
        conn.execute(
            "UPDATE episodes SET is_in_queue = 0 WHERE id = ?",
            params![episode_id],
        )?;
        Ok(())
    }

    pub fn get_next_queue_item(&self) -> Result<Option<QueueItemWithEpisode>> {
        let conn = self.conn.lock().unwrap();

        let sql = r#"
            SELECT q.id, q.episode_id, q.added_to_queue_date, q.priority, q.retry_count,
                   q.status, q.started_date, q.completed_date, q.error_message,
                   e.id, e.episode_number, e.title, e.description, e.audio_url,
                   e.audio_file_path, e.duration, e.file_size, e.published_date,
                   e.added_date, e.downloaded_date, e.transcribed_date, e.is_downloaded,
                   e.is_transcribed, e.is_in_queue, e.transcript_path, e.transcription_status,
                   e.transcription_error, e.processing_time, e.feed_source, e.metadata_json,
                   e.has_diarization, e.num_speakers
            FROM transcription_queue q
            JOIN episodes e ON q.episode_id = e.id
            WHERE q.status = 'pending'
            ORDER BY q.priority DESC, q.added_to_queue_date ASC
            LIMIT 1
        "#;

        let item = conn
            .query_row(sql, [], |row| {
                Ok(QueueItemWithEpisode {
                    queue_item: TranscriptionQueueItem {
                        id: row.get(0)?,
                        episode_id: row.get(1)?,
                        added_to_queue_date: row.get(2)?,
                        priority: row.get(3)?,
                        retry_count: row.get(4)?,
                        status: row.get(5)?,
                        started_date: row.get(6)?,
                        completed_date: row.get(7)?,
                        error_message: row.get(8)?,
                    },
                    episode: Episode {
                        id: row.get(9)?,
                        episode_number: row.get(10)?,
                        title: row.get(11)?,
                        description: row.get(12)?,
                        audio_url: row.get(13)?,
                        audio_file_path: row.get(14)?,
                        duration: row.get(15)?,
                        file_size: row.get(16)?,
                        published_date: row.get(17)?,
                        added_date: row.get(18)?,
                        downloaded_date: row.get(19)?,
                        transcribed_date: row.get(20)?,
                        is_downloaded: row.get::<_, i32>(21)? == 1,
                        is_transcribed: row.get::<_, i32>(22)? == 1,
                        is_in_queue: row.get::<_, i32>(23)? == 1,
                        transcript_path: row.get(24)?,
                        transcription_status: row
                            .get::<_, String>(25)
                            .unwrap_or_default()
                            .into(),
                        transcription_error: row.get(26)?,
                        processing_time: row.get(27)?,
                        feed_source: row.get(28)?,
                        metadata_json: row.get(29)?,
                        has_diarization: row.get::<_, i32>(30).unwrap_or(0) == 1,
                        num_speakers: row.get(31)?,
                    },
                })
            })
            .ok();

        Ok(item)
    }

    /// Reset a processing item back to pending (when pipeline can't handle it yet)
    pub fn reset_to_pending(&self, episode_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE transcription_queue SET status = 'pending', started_date = NULL WHERE episode_id = ?",
            params![episode_id],
        )?;
        Ok(())
    }

    pub fn mark_processing(&self, episode_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE transcription_queue SET status = 'processing', started_date = datetime('now') WHERE episode_id = ?",
            params![episode_id],
        )?;
        conn.execute(
            "UPDATE episodes SET transcription_status = 'processing' WHERE id = ?",
            params![episode_id],
        )?;
        Ok(())
    }

    pub fn mark_completed(&self, episode_id: i64, transcript_path: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE transcription_queue SET status = 'completed', completed_date = datetime('now') WHERE episode_id = ?",
            params![episode_id],
        )?;
        // Set is_in_queue = 0 and save transcript_path
        conn.execute(
            "UPDATE episodes SET transcription_status = 'completed', is_transcribed = 1, is_in_queue = 0, transcript_path = ?, transcribed_date = datetime('now') WHERE id = ?",
            params![transcript_path, episode_id],
        )?;
        Ok(())
    }

    pub fn mark_failed(&self, episode_id: i64, error: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE transcription_queue SET status = 'failed', error_message = ?, retry_count = retry_count + 1 WHERE episode_id = ?",
            params![error, episode_id],
        )?;
        conn.execute(
            "UPDATE episodes SET transcription_status = 'failed', transcription_error = ? WHERE id = ?",
            params![error, episode_id],
        )?;
        Ok(())
    }

    /// Update diarization status for an episode
    pub fn update_diarization(&self, episode_id: i64, num_speakers: i32) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE episodes SET has_diarization = 1, num_speakers = ? WHERE id = ?",
            params![num_speakers, episode_id],
        )?;
        Ok(())
    }

    /// Requeue an episode for diarization only, with race condition protection.
    /// Returns error if the episode is currently being processed.
    pub fn requeue_for_diarization(&self, episode_id: i64, priority: i32) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        // Check current queue status
        let current_status: Option<String> = conn
            .query_row(
                "SELECT status FROM transcription_queue WHERE episode_id = ?",
                params![episode_id],
                |row| row.get(0),
            )
            .optional()?;

        match current_status.as_deref() {
            Some("processing") => {
                return Err(anyhow::anyhow!(
                    "Episode is currently being processed. Wait for it to finish."
                ));
            }
            Some("pending") => {
                // Already pending, just update priority and queue_type
                conn.execute(
                    "UPDATE transcription_queue SET priority = ?, queue_type = 'diarize_only' WHERE episode_id = ?",
                    params![priority, episode_id],
                )?;
            }
            Some(_) => {
                // completed or failed - update to pending
                let now = chrono::Utc::now().to_rfc3339();
                conn.execute(
                    "UPDATE transcription_queue SET status = 'pending', priority = ?, queue_type = 'diarize_only', \
                     added_to_queue_date = ?, retry_count = 0, error_message = NULL, \
                     started_date = NULL, completed_date = NULL WHERE episode_id = ?",
                    params![priority, now, episode_id],
                )?;
            }
            None => {
                // No row exists - insert
                let now = chrono::Utc::now().to_rfc3339();
                conn.execute(
                    "INSERT INTO transcription_queue (episode_id, priority, status, queue_type, added_to_queue_date, retry_count) \
                     VALUES (?, ?, 'pending', 'diarize_only', ?, 0)",
                    params![episode_id, priority, now],
                )?;
            }
        }

        conn.execute(
            "UPDATE episodes SET is_in_queue = 1 WHERE id = ?",
            params![episode_id],
        )?;

        Ok(())
    }

    /// Get upcoming queue items that need audio downloaded (for pre-fetching)
    pub fn get_upcoming_undownloaded(&self, limit: i64) -> Result<Vec<QueueItemWithEpisode>> {
        let conn = self.conn.lock().unwrap();
        let sql = r#"
            SELECT q.id, q.episode_id, q.added_to_queue_date, q.priority, q.retry_count,
                   q.status, q.started_date, q.completed_date, q.error_message,
                   e.id, e.episode_number, e.title, e.description, e.audio_url,
                   e.audio_file_path, e.duration, e.file_size, e.published_date,
                   e.added_date, e.downloaded_date, e.transcribed_date, e.is_downloaded,
                   e.is_transcribed, e.is_in_queue, e.transcript_path, e.transcription_status,
                   e.transcription_error, e.processing_time, e.feed_source, e.metadata_json,
                   e.has_diarization, e.num_speakers
            FROM transcription_queue q
            JOIN episodes e ON q.episode_id = e.id
            WHERE q.status = 'pending' AND (e.is_downloaded = 0 OR e.audio_file_path IS NULL)
            ORDER BY q.priority DESC, q.added_to_queue_date ASC
            LIMIT ?
        "#;

        let mut stmt = conn.prepare(sql)?;
        let items = stmt
            .query_map(params![limit], |row| {
                Ok(QueueItemWithEpisode {
                    queue_item: TranscriptionQueueItem {
                        id: row.get(0)?,
                        episode_id: row.get(1)?,
                        added_to_queue_date: row.get(2)?,
                        priority: row.get(3)?,
                        retry_count: row.get(4)?,
                        status: row.get(5)?,
                        started_date: row.get(6)?,
                        completed_date: row.get(7)?,
                        error_message: row.get(8)?,
                    },
                    episode: Episode {
                        id: row.get(9)?,
                        episode_number: row.get(10)?,
                        title: row.get(11)?,
                        description: row.get(12)?,
                        audio_url: row.get(13)?,
                        audio_file_path: row.get(14)?,
                        duration: row.get(15)?,
                        file_size: row.get(16)?,
                        published_date: row.get(17)?,
                        added_date: row.get(18)?,
                        downloaded_date: row.get(19)?,
                        transcribed_date: row.get(20)?,
                        is_downloaded: row.get::<_, i32>(21)? == 1,
                        is_transcribed: row.get::<_, i32>(22)? == 1,
                        is_in_queue: row.get::<_, i32>(23)? == 1,
                        transcript_path: row.get(24)?,
                        transcription_status: row
                            .get::<_, String>(25)
                            .unwrap_or_default()
                            .into(),
                        transcription_error: row.get(26)?,
                        processing_time: row.get(27)?,
                        feed_source: row.get(28)?,
                        metadata_json: row.get(29)?,
                        has_diarization: row.get::<_, i32>(30).unwrap_or(0) == 1,
                        num_speakers: row.get(31)?,
                    },
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(items)
    }

    /// Get the queue_type for an episode in the queue
    pub fn get_queue_type(&self, episode_id: i64) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let result = conn
            .query_row(
                "SELECT queue_type FROM transcription_queue WHERE episode_id = ?",
                params![episode_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(result)
    }

    // =========================================================================
    // Stats queries
    // =========================================================================

    pub fn get_stats(&self) -> Result<AppStats> {
        let conn = self.conn.lock().unwrap();

        let total_episodes: i64 =
            conn.query_row("SELECT COUNT(*) FROM episodes", [], |row| row.get(0))?;
        let downloaded_episodes: i64 = conn.query_row(
            "SELECT COUNT(*) FROM episodes WHERE is_downloaded = 1",
            [],
            |row| row.get(0),
        )?;
        let transcribed_episodes: i64 = conn.query_row(
            "SELECT COUNT(*) FROM episodes WHERE is_transcribed = 1",
            [],
            |row| row.get(0),
        )?;
        let in_queue: i64 =
            conn.query_row("SELECT COUNT(*) FROM episodes WHERE is_in_queue = 1", [], |row| {
                row.get(0)
            })?;
        let failed: i64 = conn.query_row(
            "SELECT COUNT(*) FROM episodes WHERE transcription_status = 'failed'",
            [],
            |row| row.get(0),
        )?;

        Ok(AppStats {
            total_episodes,
            downloaded_episodes,
            transcribed_episodes,
            in_queue,
            failed,
            completion_rate: CompletionRate {
                downloaded: if total_episodes > 0 {
                    (downloaded_episodes as f64 / total_episodes as f64) * 100.0
                } else {
                    0.0
                },
                total: if downloaded_episodes > 0 {
                    (transcribed_episodes as f64 / downloaded_episodes as f64) * 100.0
                } else {
                    0.0
                },
            },
        })
    }

    // =========================================================================
    // Settings
    // =========================================================================

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT value FROM app_settings WHERE key = ?",
            params![key],
            |row| row.get(0),
        );
        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)",
            params![key, value, now],
        )?;
        Ok(())
    }

    pub fn get_all_settings(&self) -> Result<std::collections::HashMap<String, String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT key, value FROM app_settings")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut settings = std::collections::HashMap::new();
        for row in rows {
            let (key, value) = row?;
            settings.insert(key, value);
        }
        Ok(settings)
    }

    // =========================================================================
    // Speakers
    // =========================================================================

    pub fn get_speakers(&self) -> Result<Vec<Speaker>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, short_name, description, is_host, image_url, created_at
             FROM speakers ORDER BY is_host DESC, name ASC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Speaker {
                id: row.get(0)?,
                name: row.get(1)?,
                short_name: row.get(2)?,
                description: row.get(3)?,
                is_host: row.get::<_, i32>(4)? == 1,
                image_url: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        let mut speakers = Vec::new();
        for row in rows {
            speakers.push(row?);
        }
        Ok(speakers)
    }

    pub fn create_speaker(&self, name: &str, short_name: Option<&str>, is_host: bool) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO speakers (name, short_name, is_host) VALUES (?, ?, ?)",
            params![name, short_name, if is_host { 1 } else { 0 }],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_speaker(&self, id: i64, name: &str, short_name: Option<&str>, is_host: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE speakers SET name = ?, short_name = ?, is_host = ? WHERE id = ?",
            params![name, short_name, if is_host { 1 } else { 0 }, id],
        )?;
        Ok(())
    }

    pub fn delete_speaker(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM speakers WHERE id = ?", params![id])?;
        Ok(())
    }

    pub fn get_speaker_stats(&self) -> Result<Vec<SpeakerStats>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT s.id, s.name, s.short_name, s.is_host,
                    COUNT(DISTINCT es.episode_id) as episode_count,
                    COALESCE(SUM(es.speaking_time_seconds), 0) as total_speaking_time,
                    COALESCE(SUM(es.segment_count), 0) as total_segments
             FROM speakers s
             LEFT JOIN episode_speakers es ON s.id = es.speaker_id
             GROUP BY s.id
             ORDER BY episode_count DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SpeakerStats {
                id: row.get(0)?,
                name: row.get(1)?,
                short_name: row.get(2)?,
                is_host: row.get::<_, i32>(3)? == 1,
                episode_count: row.get(4)?,
                total_speaking_time: row.get(5)?,
                total_segments: row.get(6)?,
            })
        })?;
        let mut stats = Vec::new();
        for row in rows {
            stats.push(row?);
        }
        Ok(stats)
    }

    pub fn link_episode_speaker(&self, episode_id: i64, diarization_label: &str, speaker_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO episode_speakers (episode_id, diarization_label, speaker_id)
             VALUES (?, ?, ?)",
            params![episode_id, diarization_label, speaker_id],
        )?;
        Ok(())
    }

    pub fn get_next_untranscribed_episode(&self) -> Result<Option<Episode>> {
        let conn = self.conn.lock().unwrap();
        // Don't require is_downloaded - worker will auto-download if needed
        // Prioritize already downloaded episodes, then by published date (newest first)
        let sql = r#"
            SELECT id, episode_number, title, description, audio_url, audio_file_path,
                   duration, file_size, published_date, added_date, downloaded_date,
                   transcribed_date, is_downloaded, is_transcribed, is_in_queue,
                   transcript_path, transcription_status, transcription_error,
                   processing_time, feed_source, metadata_json, has_diarization, num_speakers
            FROM episodes
            WHERE (is_transcribed = 0 OR is_transcribed IS NULL) AND (is_in_queue = 0 OR is_in_queue IS NULL)
            ORDER BY is_downloaded DESC, published_date DESC
            LIMIT 1
        "#;
        let episode = conn.query_row(sql, [], |row| {
            Ok(Episode {
                id: row.get(0)?,
                episode_number: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                audio_url: row.get(4)?,
                audio_file_path: row.get(5)?,
                duration: row.get(6)?,
                file_size: row.get(7)?,
                published_date: row.get(8)?,
                added_date: row.get(9)?,
                downloaded_date: row.get(10)?,
                transcribed_date: row.get(11)?,
                is_downloaded: row.get::<_, i32>(12)? == 1,
                is_transcribed: row.get::<_, i32>(13)? == 1,
                is_in_queue: row.get::<_, i32>(14)? == 1,
                transcript_path: row.get(15)?,
                transcription_status: row.get::<_, String>(16).unwrap_or_default().into(),
                transcription_error: row.get(17)?,
                processing_time: row.get(18)?,
                feed_source: row.get(19)?,
                metadata_json: row.get(20)?,
                has_diarization: row.get::<_, i32>(21).unwrap_or(0) == 1,
                num_speakers: row.get(22)?,
            })
        });
        match episode {
            Ok(ep) => Ok(Some(ep)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    // =========================================================================
    // Chapter Types
    // =========================================================================

    pub fn get_chapter_types(&self) -> Result<Vec<models::ChapterType>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, color, icon, sort_order FROM chapter_types ORDER BY sort_order"
        )?;
        let types = stmt.query_map([], |row| {
            Ok(models::ChapterType {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                color: row.get(3)?,
                icon: row.get(4)?,
                sort_order: row.get(5)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(types)
    }

    pub fn create_chapter_type(&self, name: &str, description: Option<&str>, color: &str, icon: Option<&str>) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO chapter_types (name, description, color, icon) VALUES (?1, ?2, ?3, ?4)",
            params![name, description, color, icon]
        )?;
        Ok(conn.last_insert_rowid())
    }

    // =========================================================================
    // Episode Chapters
    // =========================================================================

    pub fn get_episode_chapters(&self, episode_id: i64) -> Result<Vec<models::EpisodeChapter>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT ec.id, ec.episode_id, ec.chapter_type_id, ct.name, ct.color, ct.icon,
                      ec.title, ec.start_time, ec.end_time, ec.start_segment_idx, ec.end_segment_idx, ec.notes
               FROM episode_chapters ec
               JOIN chapter_types ct ON ec.chapter_type_id = ct.id
               WHERE ec.episode_id = ?1
               ORDER BY ec.start_time"#
        )?;
        let chapters = stmt.query_map([episode_id], |row| {
            Ok(models::EpisodeChapter {
                id: row.get(0)?,
                episode_id: row.get(1)?,
                chapter_type_id: row.get(2)?,
                chapter_type_name: row.get(3)?,
                chapter_type_color: row.get(4)?,
                chapter_type_icon: row.get(5)?,
                title: row.get(6)?,
                start_time: row.get(7)?,
                end_time: row.get(8)?,
                start_segment_idx: row.get(9)?,
                end_segment_idx: row.get(10)?,
                notes: row.get(11)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(chapters)
    }

    pub fn create_episode_chapter(
        &self, episode_id: i64, chapter_type_id: i64, title: Option<&str>,
        start_time: f64, end_time: Option<f64>, start_segment_idx: Option<i32>, end_segment_idx: Option<i32>
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"INSERT INTO episode_chapters (episode_id, chapter_type_id, title, start_time, end_time, start_segment_idx, end_segment_idx)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
            params![episode_id, chapter_type_id, title, start_time, end_time, start_segment_idx, end_segment_idx]
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn delete_episode_chapter(&self, chapter_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM episode_chapters WHERE id = ?1", [chapter_id])?;
        Ok(())
    }

    // =========================================================================
    // Characters
    // =========================================================================

    pub fn get_characters(&self) -> Result<Vec<models::Character>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT c.id, c.name, c.short_name, c.description, c.catchphrase,
                      c.first_episode_id, e.title, c.image_url,
                      (SELECT COUNT(*) FROM character_appearances WHERE character_id = c.id) as appearance_count
               FROM characters c
               LEFT JOIN episodes e ON c.first_episode_id = e.id
               ORDER BY c.name"#
        )?;
        let chars = stmt.query_map([], |row| {
            Ok(models::Character {
                id: row.get(0)?,
                name: row.get(1)?,
                short_name: row.get(2)?,
                description: row.get(3)?,
                catchphrase: row.get(4)?,
                first_episode_id: row.get(5)?,
                first_episode_title: row.get(6)?,
                image_url: row.get(7)?,
                appearance_count: row.get(8)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(chars)
    }

    pub fn create_character(&self, name: &str, short_name: Option<&str>, description: Option<&str>, catchphrase: Option<&str>) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO characters (name, short_name, description, catchphrase) VALUES (?1, ?2, ?3, ?4)",
            params![name, short_name, description, catchphrase]
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_character(&self, id: i64, name: &str, short_name: Option<&str>, description: Option<&str>, catchphrase: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE characters SET name = ?1, short_name = ?2, description = ?3, catchphrase = ?4 WHERE id = ?5",
            params![name, short_name, description, catchphrase, id]
        )?;
        Ok(())
    }

    pub fn delete_character(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM characters WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn add_character_appearance(&self, character_id: i64, episode_id: i64, start_time: Option<f64>, end_time: Option<f64>, segment_idx: Option<i32>) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO character_appearances (character_id, episode_id, start_time, end_time, segment_idx) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![character_id, episode_id, start_time, end_time, segment_idx]
        )?;
        Ok(conn.last_insert_rowid())
    }

    // =========================================================================
    // Sponsors
    // =========================================================================

    pub fn get_sponsors(&self) -> Result<Vec<models::Sponsor>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT s.id, s.name, s.tagline, s.description, s.is_real,
                      s.first_episode_id, e.title, s.image_url,
                      (SELECT COUNT(*) FROM sponsor_mentions WHERE sponsor_id = s.id) as mention_count
               FROM sponsors s
               LEFT JOIN episodes e ON s.first_episode_id = e.id
               ORDER BY s.name"#
        )?;
        let sponsors = stmt.query_map([], |row| {
            Ok(models::Sponsor {
                id: row.get(0)?,
                name: row.get(1)?,
                tagline: row.get(2)?,
                description: row.get(3)?,
                is_real: row.get::<_, i32>(4)? == 1,
                first_episode_id: row.get(5)?,
                first_episode_title: row.get(6)?,
                image_url: row.get(7)?,
                mention_count: row.get(8)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(sponsors)
    }

    pub fn create_sponsor(&self, name: &str, tagline: Option<&str>, description: Option<&str>, is_real: bool) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sponsors (name, tagline, description, is_real) VALUES (?1, ?2, ?3, ?4)",
            params![name, tagline, description, is_real as i32]
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_sponsor(&self, id: i64, name: &str, tagline: Option<&str>, description: Option<&str>, is_real: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sponsors SET name = ?1, tagline = ?2, description = ?3, is_real = ?4 WHERE id = ?5",
            params![name, tagline, description, is_real as i32, id]
        )?;
        Ok(())
    }

    pub fn delete_sponsor(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM sponsors WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn add_sponsor_mention(&self, sponsor_id: i64, episode_id: i64, start_time: Option<f64>, end_time: Option<f64>, segment_idx: Option<i32>) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sponsor_mentions (sponsor_id, episode_id, start_time, end_time, segment_idx) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![sponsor_id, episode_id, start_time, end_time, segment_idx]
        )?;
        Ok(conn.last_insert_rowid())
    }

    // =========================================================================
    // Transcript Search (FTS5)
    // =========================================================================

    /// Search transcripts using full-text search
    pub fn search_transcripts(&self, query: &str, limit: i64, offset: i64) -> Result<Vec<SearchResult>> {
        let conn = self.conn.lock().unwrap();

        // Use FTS5 MATCH with snippet for highlighting
        let sql = r#"
            SELECT
                ts.id,
                ts.episode_id,
                e.title as episode_title,
                e.episode_number,
                ts.speaker,
                ts.text,
                ts.start_time,
                ts.end_time,
                ts.segment_idx,
                snippet(segments_fts, 0, '<mark>', '</mark>', '...', 32) as snippet,
                bm25(segments_fts) as rank
            FROM segments_fts
            JOIN transcript_segments ts ON segments_fts.rowid = ts.id
            JOIN episodes e ON ts.episode_id = e.id
            WHERE segments_fts MATCH ?1
            ORDER BY rank
            LIMIT ?2 OFFSET ?3
        "#;

        let mut stmt = conn.prepare(sql)?;
        let results = stmt.query_map(params![query, limit, offset], |row| {
            Ok(SearchResult {
                id: row.get(0)?,
                episode_id: row.get(1)?,
                episode_title: row.get(2)?,
                episode_number: row.get(3)?,
                speaker: row.get(4)?,
                text: row.get(5)?,
                start_time: row.get(6)?,
                end_time: row.get(7)?,
                segment_idx: row.get(8)?,
                snippet: row.get(9)?,
                rank: row.get(10)?,
            })
        })?.filter_map(|r| r.ok()).collect();

        Ok(results)
    }

    /// Count total search results (for pagination)
    pub fn count_search_results(&self, query: &str) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM segments_fts WHERE segments_fts MATCH ?1",
            params![query],
            |row| row.get(0)
        )?;
        Ok(count)
    }

    /// Index a transcript's segments for full-text search
    pub fn index_transcript_segments(&self, episode_id: i64, segments: &[TranscriptSegment]) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        // Delete existing segments for this episode
        conn.execute(
            "DELETE FROM transcript_segments WHERE episode_id = ?1",
            params![episode_id]
        )?;

        // Insert new segments (FTS trigger will auto-update)
        let mut stmt = conn.prepare(
            "INSERT INTO transcript_segments (episode_id, segment_idx, speaker, text, start_time, end_time)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
        )?;

        for (idx, segment) in segments.iter().enumerate() {
            stmt.execute(params![
                episode_id,
                idx as i32,
                segment.speaker,
                segment.text,
                segment.start_time,
                segment.end_time
            ])?;
        }

        Ok(())
    }

    /// Get count of indexed segments
    pub fn get_indexed_segment_count(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM transcript_segments",
            [],
            |row| row.get(0)
        )?;
        Ok(count)
    }

    /// Get episodes that haven't been indexed yet
    pub fn get_unindexed_episodes(&self) -> Result<Vec<Episode>> {
        let conn = self.conn.lock().unwrap();
        let sql = r#"
            SELECT e.id, e.episode_number, e.title, e.description, e.audio_url, e.audio_file_path,
                   e.duration, e.file_size, e.published_date, e.added_date, e.downloaded_date,
                   e.transcribed_date, e.is_downloaded, e.is_transcribed, e.is_in_queue,
                   e.transcript_path, e.transcription_status, e.transcription_error,
                   e.processing_time, e.feed_source, e.metadata_json, e.has_diarization, e.num_speakers
            FROM episodes e
            WHERE e.is_transcribed = 1
              AND e.transcript_path IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM transcript_segments ts WHERE ts.episode_id = e.id)
            ORDER BY e.published_date DESC
        "#;

        let mut stmt = conn.prepare(sql)?;
        let episodes = stmt.query_map([], |row| {
            Ok(Episode {
                id: row.get(0)?,
                episode_number: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                audio_url: row.get(4)?,
                audio_file_path: row.get(5)?,
                duration: row.get(6)?,
                file_size: row.get(7)?,
                published_date: row.get(8)?,
                added_date: row.get(9)?,
                downloaded_date: row.get(10)?,
                transcribed_date: row.get(11)?,
                is_downloaded: row.get::<_, i32>(12)? == 1,
                is_transcribed: row.get::<_, i32>(13)? == 1,
                is_in_queue: row.get::<_, i32>(14)? == 1,
                transcript_path: row.get(15)?,
                transcription_status: row.get::<_, String>(16).unwrap_or_default().into(),
                transcription_error: row.get(17)?,
                processing_time: row.get(18)?,
                feed_source: row.get(19)?,
                metadata_json: row.get(20)?,
                has_diarization: row.get::<_, i32>(21).unwrap_or(0) == 1,
                num_speakers: row.get(22)?,
            })
        })?.filter_map(|r| r.ok()).collect();

        Ok(episodes)
    }

    // =========================================================================
    // Detected Content
    // =========================================================================

    /// Store detected content (characters, commercials, bits) from AI analysis
    pub fn add_detected_content(
        &self,
        episode_id: i64,
        content_type: &str,
        name: &str,
        description: Option<&str>,
        start_time: Option<f64>,
        end_time: Option<f64>,
        segment_idx: Option<i32>,
        confidence: f64,
        raw_text: Option<&str>,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"INSERT INTO detected_content
               (episode_id, content_type, name, description, start_time, end_time, segment_idx, confidence, raw_text)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"#,
            params![episode_id, content_type, name, description, start_time, end_time, segment_idx, confidence, raw_text]
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Get detected content for an episode
    pub fn get_detected_content(&self, episode_id: i64) -> Result<Vec<DetectedContent>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT id, episode_id, content_type, name, description, start_time, end_time,
                      segment_idx, confidence, raw_text, created_at
               FROM detected_content
               WHERE episode_id = ?1
               ORDER BY start_time NULLS LAST"#
        )?;
        let content = stmt.query_map([episode_id], |row| {
            Ok(DetectedContent {
                id: row.get(0)?,
                episode_id: row.get(1)?,
                content_type: row.get(2)?,
                name: row.get(3)?,
                description: row.get(4)?,
                start_time: row.get(5)?,
                end_time: row.get(6)?,
                segment_idx: row.get(7)?,
                confidence: row.get(8)?,
                raw_text: row.get(9)?,
                created_at: row.get(10)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(content)
    }

    /// Get all detected content by type (e.g., all characters across all episodes)
    pub fn get_detected_content_by_type(&self, content_type: &str) -> Result<Vec<DetectedContentWithEpisode>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT dc.id, dc.episode_id, e.title, e.episode_number, dc.content_type,
                      dc.name, dc.description, dc.start_time, dc.end_time,
                      dc.segment_idx, dc.confidence, dc.raw_text, dc.created_at
               FROM detected_content dc
               JOIN episodes e ON dc.episode_id = e.id
               WHERE dc.content_type = ?1
               ORDER BY dc.name, e.published_date DESC"#
        )?;
        let content = stmt.query_map([content_type], |row| {
            Ok(DetectedContentWithEpisode {
                id: row.get(0)?,
                episode_id: row.get(1)?,
                episode_title: row.get(2)?,
                episode_number: row.get(3)?,
                content_type: row.get(4)?,
                name: row.get(5)?,
                description: row.get(6)?,
                start_time: row.get(7)?,
                end_time: row.get(8)?,
                segment_idx: row.get(9)?,
                confidence: row.get(10)?,
                raw_text: row.get(11)?,
                created_at: row.get(12)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(content)
    }

    // =========================================================================
    // Extraction Prompts
    // =========================================================================

    /// Get all extraction prompts
    pub fn get_extraction_prompts(&self) -> Result<Vec<ExtractionPrompt>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT id, name, description, content_type, prompt_text, system_prompt,
                      output_schema, is_active, run_count, last_run_at, created_at, updated_at
               FROM extraction_prompts
               ORDER BY content_type, name"#
        )?;
        let prompts = stmt.query_map([], |row| {
            Ok(ExtractionPrompt {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                content_type: row.get(3)?,
                prompt_text: row.get(4)?,
                system_prompt: row.get(5)?,
                output_schema: row.get(6)?,
                is_active: row.get::<_, i32>(7)? != 0,
                run_count: row.get(8)?,
                last_run_at: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(prompts)
    }

    /// Get a single extraction prompt by ID
    pub fn get_extraction_prompt(&self, id: i64) -> Result<Option<ExtractionPrompt>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT id, name, description, content_type, prompt_text, system_prompt,
                      output_schema, is_active, run_count, last_run_at, created_at, updated_at
               FROM extraction_prompts WHERE id = ?1"#
        )?;
        let prompt = stmt.query_row([id], |row| {
            Ok(ExtractionPrompt {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                content_type: row.get(3)?,
                prompt_text: row.get(4)?,
                system_prompt: row.get(5)?,
                output_schema: row.get(6)?,
                is_active: row.get::<_, i32>(7)? != 0,
                run_count: row.get(8)?,
                last_run_at: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        }).optional()?;
        Ok(prompt)
    }

    /// Create a new extraction prompt
    pub fn create_extraction_prompt(
        &self,
        name: &str,
        description: Option<&str>,
        content_type: &str,
        prompt_text: &str,
        system_prompt: Option<&str>,
        output_schema: Option<&str>,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"INSERT INTO extraction_prompts (name, description, content_type, prompt_text, system_prompt, output_schema)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
            params![name, description, content_type, prompt_text, system_prompt, output_schema]
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Update an extraction prompt
    pub fn update_extraction_prompt(
        &self,
        id: i64,
        name: &str,
        description: Option<&str>,
        content_type: &str,
        prompt_text: &str,
        system_prompt: Option<&str>,
        output_schema: Option<&str>,
        is_active: bool,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"UPDATE extraction_prompts
               SET name = ?1, description = ?2, content_type = ?3, prompt_text = ?4,
                   system_prompt = ?5, output_schema = ?6, is_active = ?7, updated_at = datetime('now')
               WHERE id = ?8"#,
            params![name, description, content_type, prompt_text, system_prompt, output_schema, is_active as i32, id]
        )?;
        Ok(())
    }

    /// Delete an extraction prompt
    pub fn delete_extraction_prompt(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM extraction_prompts WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Record the start of an extraction run
    pub fn create_extraction_run(&self, prompt_id: i64, episode_id: i64, input_text: &str) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"INSERT INTO extraction_runs (prompt_id, episode_id, status, input_text, started_at)
               VALUES (?1, ?2, 'running', ?3, datetime('now'))"#,
            params![prompt_id, episode_id, input_text]
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Complete an extraction run (success)
    pub fn complete_extraction_run(
        &self,
        run_id: i64,
        raw_response: &str,
        parsed_json: Option<&str>,
        items_extracted: i32,
        duration_ms: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"UPDATE extraction_runs
               SET status = 'completed', raw_response = ?1, parsed_json = ?2,
                   items_extracted = ?3, duration_ms = ?4, completed_at = datetime('now')
               WHERE id = ?5"#,
            params![raw_response, parsed_json, items_extracted, duration_ms, run_id]
        )?;

        // Update prompt stats
        conn.execute(
            r#"UPDATE extraction_prompts
               SET run_count = run_count + 1, last_run_at = datetime('now')
               WHERE id = (SELECT prompt_id FROM extraction_runs WHERE id = ?1)"#,
            params![run_id]
        )?;
        Ok(())
    }

    /// Fail an extraction run
    pub fn fail_extraction_run(&self, run_id: i64, error_message: &str, duration_ms: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"UPDATE extraction_runs
               SET status = 'failed', error_message = ?1, duration_ms = ?2, completed_at = datetime('now')
               WHERE id = ?3"#,
            params![error_message, duration_ms, run_id]
        )?;
        Ok(())
    }

    /// Get extraction runs for an episode
    pub fn get_extraction_runs_for_episode(&self, episode_id: i64) -> Result<Vec<ExtractionRun>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT er.id, er.prompt_id, ep.name as prompt_name, er.episode_id, e.title as episode_title,
                      er.status, er.input_text, er.raw_response, er.parsed_json, er.items_extracted,
                      er.error_message, er.duration_ms, er.started_at, er.completed_at, er.created_at
               FROM extraction_runs er
               JOIN extraction_prompts ep ON er.prompt_id = ep.id
               JOIN episodes e ON er.episode_id = e.id
               WHERE er.episode_id = ?1
               ORDER BY er.created_at DESC"#
        )?;
        let runs = stmt.query_map([episode_id], |row| {
            Ok(ExtractionRun {
                id: row.get(0)?,
                prompt_id: row.get(1)?,
                prompt_name: row.get(2)?,
                episode_id: row.get(3)?,
                episode_title: row.get(4)?,
                status: row.get(5)?,
                input_text: row.get(6)?,
                raw_response: row.get(7)?,
                parsed_json: row.get(8)?,
                items_extracted: row.get(9)?,
                error_message: row.get(10)?,
                duration_ms: row.get(11)?,
                started_at: row.get(12)?,
                completed_at: row.get(13)?,
                created_at: row.get(14)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(runs)
    }

    /// Get recent extraction runs across all episodes
    pub fn get_recent_extraction_runs(&self, limit: i64) -> Result<Vec<ExtractionRun>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT er.id, er.prompt_id, ep.name as prompt_name, er.episode_id, e.title as episode_title,
                      er.status, er.input_text, er.raw_response, er.parsed_json, er.items_extracted,
                      er.error_message, er.duration_ms, er.started_at, er.completed_at, er.created_at
               FROM extraction_runs er
               JOIN extraction_prompts ep ON er.prompt_id = ep.id
               JOIN episodes e ON er.episode_id = e.id
               ORDER BY er.created_at DESC
               LIMIT ?1"#
        )?;
        let runs = stmt.query_map([limit], |row| {
            Ok(ExtractionRun {
                id: row.get(0)?,
                prompt_id: row.get(1)?,
                prompt_name: row.get(2)?,
                episode_id: row.get(3)?,
                episode_title: row.get(4)?,
                status: row.get(5)?,
                input_text: row.get(6)?,
                raw_response: row.get(7)?,
                parsed_json: row.get(8)?,
                items_extracted: row.get(9)?,
                error_message: row.get(10)?,
                duration_ms: row.get(11)?,
                started_at: row.get(12)?,
                completed_at: row.get(13)?,
                created_at: row.get(14)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(runs)
    }

    // =========================================================================
    // Flagged Segments (Review Workflow)
    // =========================================================================

    /// Create or update a flagged segment
    pub fn create_flagged_segment(
        &self,
        episode_id: i64,
        segment_idx: i32,
        flag_type: &str,
        corrected_speaker: Option<&str>,
        character_id: Option<i64>,
        notes: Option<&str>,
        speaker_ids: Option<&str>,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"INSERT OR REPLACE INTO flagged_segments
               (episode_id, segment_idx, flag_type, corrected_speaker, character_id, notes, speaker_ids, resolved)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)"#,
            params![episode_id, segment_idx, flag_type, corrected_speaker, character_id, notes, speaker_ids]
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Get all flagged segments for an episode
    pub fn get_flagged_segments_for_episode(&self, episode_id: i64) -> Result<Vec<models::FlaggedSegment>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT fs.id, fs.episode_id, fs.segment_idx, fs.flag_type,
                      fs.corrected_speaker, fs.character_id, c.name, fs.notes, fs.speaker_ids, fs.resolved, fs.created_at
               FROM flagged_segments fs
               LEFT JOIN characters c ON fs.character_id = c.id
               WHERE fs.episode_id = ?1
               ORDER BY fs.segment_idx"#
        )?;
        let flags = stmt.query_map([episode_id], |row| {
            Ok(models::FlaggedSegment {
                id: row.get(0)?,
                episode_id: row.get(1)?,
                segment_idx: row.get(2)?,
                flag_type: row.get(3)?,
                corrected_speaker: row.get(4)?,
                character_id: row.get(5)?,
                character_name: row.get(6)?,
                notes: row.get(7)?,
                speaker_ids: row.get(8)?,
                resolved: row.get::<_, i32>(9)? != 0,
                created_at: row.get(10)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(flags)
    }

    /// Update a flagged segment
    pub fn update_flagged_segment(
        &self,
        id: i64,
        flag_type: Option<&str>,
        corrected_speaker: Option<&str>,
        character_id: Option<i64>,
        notes: Option<&str>,
        speaker_ids: Option<&str>,
        resolved: Option<bool>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        // Build dynamic update query
        let mut updates = Vec::new();
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(ft) = flag_type {
            updates.push("flag_type = ?");
            params_vec.push(Box::new(ft.to_string()));
        }
        if let Some(cs) = corrected_speaker {
            updates.push("corrected_speaker = ?");
            params_vec.push(Box::new(cs.to_string()));
        }
        if let Some(cid) = character_id {
            updates.push("character_id = ?");
            params_vec.push(Box::new(cid));
        }
        if let Some(n) = notes {
            updates.push("notes = ?");
            params_vec.push(Box::new(n.to_string()));
        }
        if let Some(si) = speaker_ids {
            updates.push("speaker_ids = ?");
            params_vec.push(Box::new(si.to_string()));
        }
        if let Some(r) = resolved {
            updates.push("resolved = ?");
            params_vec.push(Box::new(if r { 1 } else { 0 }));
        }

        if updates.is_empty() {
            return Ok(());
        }

        params_vec.push(Box::new(id));

        let sql = format!(
            "UPDATE flagged_segments SET {} WHERE id = ?",
            updates.join(", ")
        );

        let params: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params.as_slice())?;
        Ok(())
    }

    /// Delete a flagged segment
    pub fn delete_flagged_segment(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM flagged_segments WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Get count of unresolved flagged segments for an episode
    pub fn get_unresolved_flag_count(&self, episode_id: i64) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM flagged_segments WHERE episode_id = ?1 AND resolved = 0",
            [episode_id],
            |row| row.get(0)
        )?;
        Ok(count)
    }

    /// Get unresolved speaker-related flags for an episode (wrong_speaker + multiple_speakers)
    pub fn get_unresolved_speaker_flags(&self, episode_id: i64) -> Result<Vec<models::FlaggedSegment>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT fs.id, fs.episode_id, fs.segment_idx, fs.flag_type,
                      fs.corrected_speaker, fs.character_id, c.name, fs.notes, fs.speaker_ids, fs.resolved, fs.created_at
               FROM flagged_segments fs
               LEFT JOIN characters c ON fs.character_id = c.id
               WHERE fs.episode_id = ?1 AND fs.flag_type IN ('wrong_speaker', 'multiple_speakers') AND fs.resolved = 0
               ORDER BY fs.segment_idx"#
        )?;
        let flags = stmt.query_map([episode_id], |row| {
            Ok(models::FlaggedSegment {
                id: row.get(0)?,
                episode_id: row.get(1)?,
                segment_idx: row.get(2)?,
                flag_type: row.get(3)?,
                corrected_speaker: row.get(4)?,
                character_id: row.get(5)?,
                character_name: row.get(6)?,
                notes: row.get(7)?,
                speaker_ids: row.get(8)?,
                resolved: row.get::<_, i32>(9)? != 0,
                created_at: row.get(10)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(flags)
    }

    // =========================================================================
    // Character Appearances (additional queries)
    // =========================================================================

    /// Get character appearances for an episode
    pub fn get_character_appearances_for_episode(&self, episode_id: i64) -> Result<Vec<models::CharacterAppearance>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT ca.id, ca.character_id, c.name, ca.episode_id, e.title,
                      ca.start_time, ca.end_time, ca.segment_idx, ca.notes
               FROM character_appearances ca
               JOIN characters c ON ca.character_id = c.id
               JOIN episodes e ON ca.episode_id = e.id
               WHERE ca.episode_id = ?1
               ORDER BY ca.start_time NULLS LAST, ca.segment_idx NULLS LAST"#
        )?;
        let appearances = stmt.query_map([episode_id], |row| {
            Ok(models::CharacterAppearance {
                id: row.get(0)?,
                character_id: row.get(1)?,
                character_name: row.get(2)?,
                episode_id: row.get(3)?,
                episode_title: row.get(4)?,
                start_time: row.get(5)?,
                end_time: row.get(6)?,
                segment_idx: row.get(7)?,
                notes: row.get(8)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(appearances)
    }

    /// Delete a character appearance
    pub fn delete_character_appearance(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM character_appearances WHERE id = ?1", [id])?;
        Ok(())
    }

    // =========================================================================
    // Audio Drops
    // =========================================================================

    pub fn get_audio_drops(&self) -> Result<Vec<models::AudioDrop>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, transcript_text, description, category, created_at FROM audio_drops ORDER BY name"
        )?;
        let drops = stmt.query_map([], |row| {
            Ok(models::AudioDrop {
                id: row.get(0)?,
                name: row.get(1)?,
                transcript_text: row.get(2)?,
                description: row.get(3)?,
                category: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(drops)
    }

    pub fn create_audio_drop(&self, name: &str, transcript_text: Option<&str>, description: Option<&str>, category: Option<&str>) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO audio_drops (name, transcript_text, description, category) VALUES (?1, ?2, ?3, ?4)",
            params![name, transcript_text, description, category.unwrap_or("drop")]
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn delete_audio_drop(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM audio_drops WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn add_audio_drop_instance(&self, audio_drop_id: i64, episode_id: i64, segment_idx: Option<i32>, start_time: Option<f64>, end_time: Option<f64>, notes: Option<&str>) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO audio_drop_instances (audio_drop_id, episode_id, segment_idx, start_time, end_time, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![audio_drop_id, episode_id, segment_idx, start_time, end_time, notes]
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_audio_drop_instances_for_episode(&self, episode_id: i64) -> Result<Vec<models::AudioDropInstance>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT adi.id, adi.audio_drop_id, ad.name, adi.episode_id,
                      adi.segment_idx, adi.start_time, adi.end_time, adi.notes, adi.created_at
               FROM audio_drop_instances adi
               JOIN audio_drops ad ON adi.audio_drop_id = ad.id
               WHERE adi.episode_id = ?1
               ORDER BY adi.segment_idx NULLS LAST, adi.start_time NULLS LAST"#
        )?;
        let instances = stmt.query_map([episode_id], |row| {
            Ok(models::AudioDropInstance {
                id: row.get(0)?,
                audio_drop_id: row.get(1)?,
                audio_drop_name: row.get(2)?,
                episode_id: row.get(3)?,
                segment_idx: row.get(4)?,
                start_time: row.get(5)?,
                end_time: row.get(6)?,
                notes: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(instances)
    }

    pub fn delete_audio_drop_instance(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM audio_drop_instances WHERE id = ?1", [id])?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Speaker {
    pub id: i64,
    pub name: String,
    pub short_name: Option<String>,
    pub description: Option<String>,
    pub is_host: bool,
    pub image_url: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakerStats {
    pub id: i64,
    pub name: String,
    pub short_name: Option<String>,
    pub is_host: bool,
    pub episode_count: i64,
    pub total_speaking_time: f64,
    pub total_segments: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppStats {
    pub total_episodes: i64,
    pub downloaded_episodes: i64,
    pub transcribed_episodes: i64,
    pub in_queue: i64,
    pub failed: i64,
    pub completion_rate: CompletionRate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptData {
    pub full_text: String,
    pub segments_json: Option<String>,
    pub language: Option<String>,
    pub model_used: Option<String>,
    pub created_date: Option<String>,
    pub episode_title: String,
    pub episode_number: Option<String>,
    pub transcript_path: Option<String>,
    // Diarization info
    pub has_diarization: bool,
    pub num_speakers: Option<i32>,
    pub diarization_method: Option<String>,
    // Speaker name mappings (e.g., {"SPEAKER_00": "Matt", "SPEAKER_01": "Paul"})
    pub speaker_names: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionRate {
    pub downloaded: f64,
    pub total: f64,
}

/// A segment for indexing into FTS
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub speaker: Option<String>,
    pub text: String,
    pub start_time: f64,
    pub end_time: Option<f64>,
}

/// Search result from FTS query
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: i64,
    pub episode_id: i64,
    pub episode_title: String,
    pub episode_number: Option<String>,
    pub speaker: Option<String>,
    pub text: String,
    pub start_time: f64,
    pub end_time: Option<f64>,
    pub segment_idx: i32,
    pub snippet: String,
    pub rank: f64,
}

/// Detected content from AI analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedContent {
    pub id: i64,
    pub episode_id: i64,
    pub content_type: String,
    pub name: String,
    pub description: Option<String>,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    pub segment_idx: Option<i32>,
    pub confidence: f64,
    pub raw_text: Option<String>,
    pub created_at: Option<String>,
}

/// Detected content with episode info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedContentWithEpisode {
    pub id: i64,
    pub episode_id: i64,
    pub episode_title: String,
    pub episode_number: Option<String>,
    pub content_type: String,
    pub name: String,
    pub description: Option<String>,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    pub segment_idx: Option<i32>,
    pub confidence: f64,
    pub raw_text: Option<String>,
    pub created_at: Option<String>,
}

/// Extraction prompt (user-defined LLM prompt)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionPrompt {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub content_type: String,
    pub prompt_text: String,
    pub system_prompt: Option<String>,
    pub output_schema: Option<String>,
    pub is_active: bool,
    pub run_count: i32,
    pub last_run_at: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// Extraction run (history of an LLM extraction job)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionRun {
    pub id: i64,
    pub prompt_id: i64,
    pub prompt_name: Option<String>,
    pub episode_id: i64,
    pub episode_title: Option<String>,
    pub status: String,
    pub input_text: Option<String>,
    pub raw_response: Option<String>,
    pub parsed_json: Option<String>,
    pub items_extracted: i32,
    pub error_message: Option<String>,
    pub duration_ms: Option<i64>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: Option<String>,
}

// Make Database thread-safe for Tauri state
unsafe impl Send for Database {}
unsafe impl Sync for Database {}
