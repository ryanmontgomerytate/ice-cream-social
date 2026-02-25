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
            PRAGMA cache_size=-65536;
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
                added_date TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
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
                created_date TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
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
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_detected_episode ON detected_content(episode_id);
            CREATE INDEX IF NOT EXISTS idx_detected_type ON detected_content(content_type);
            CREATE INDEX IF NOT EXISTS idx_detected_name ON detected_content(name);

            CREATE TABLE IF NOT EXISTS transcription_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                episode_id INTEGER NOT NULL UNIQUE,
                added_to_queue_date TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
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
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
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
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            -- Chapters (recurring segments like Scoop Mail, Jock vs Nerd, etc.)
            CREATE TABLE IF NOT EXISTS chapter_types (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                color TEXT DEFAULT '#6366f1',
                icon TEXT,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
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
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
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
                speaker_id INTEGER,
                image_url TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (first_episode_id) REFERENCES episodes(id),
                FOREIGN KEY (speaker_id) REFERENCES speakers(id)
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
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
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
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
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
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
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
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
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
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
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
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
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
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
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
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
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
                ('Bit', 'Comedy bit or recurring joke', '#f97316', '😂', 9),
                ('Commercial', 'Sponsor commercial segment', '#f97316', '📺', 10);

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
                ('pause_transcribe_queue', 'false'),
                ('pause_diarize_queue', 'false'),
                ('priority_reprocess_pause_transcribe', 'false'),
                ('embedding_model', 'pyannote'),
                ('hf_hub_offline', 'false'),
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
        let _ = conn.execute(
            "ALTER TABLE transcription_queue ADD COLUMN embedding_backend_override TEXT",
            [],
        ); // Ignore error if column already exists

        // Migration: Add category columns to episodes (idempotent)
        let _ = conn.execute(
            "ALTER TABLE episodes ADD COLUMN category TEXT DEFAULT 'episode'",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE episodes ADD COLUMN category_number TEXT",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE episodes ADD COLUMN sub_series TEXT",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE episodes ADD COLUMN canonical_id INTEGER REFERENCES episodes(id)",
            [],
        );

        // Indexes for category columns
        let _ = conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_episodes_category ON episodes(category);
             CREATE INDEX IF NOT EXISTS idx_episodes_canonical ON episodes(canonical_id);",
        );

        // Migration: Add pipeline timing columns to episodes (idempotent)
        let _ = conn.execute(
            "ALTER TABLE episodes ADD COLUMN download_duration REAL",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE episodes ADD COLUMN transcribe_duration REAL",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE episodes ADD COLUMN diarize_duration REAL",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE episodes ADD COLUMN diarized_date TEXT",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE episodes ADD COLUMN transcription_model_used TEXT",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE episodes ADD COLUMN embedding_backend_used TEXT",
            [],
        );

        // Category rules table (data-driven categorization)
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS category_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                title_pattern TEXT NOT NULL,
                number_pattern TEXT,
                priority INTEGER DEFAULT 0,
                icon TEXT,
                color TEXT,
                keywords TEXT
            );

            INSERT OR IGNORE INTO category_rules (category, display_name, title_pattern, number_pattern, priority, icon, color) VALUES
                ('fubts', 'FUBTS', '(?i)P?&?T?\s*FUBTS', '(?i)FUBTS\s*([\d.]+)', 1, '🎭', '#ef4444'),
                ('scoopflix', 'Scoopflix', '(?i)scoopfl?i?x|Not Furlong', NULL, 2, '🎬', '#f59e0b'),
                ('abracababble', 'Abracababble', '(?i)abracababble', '(?i)abracababble\s*(\d+)', 3, '🔮', '#8b5cf6'),
                ('shituational', 'Shituational', '(?i)shituational\s*aware', '(\d+)', 4, '💩', '#a3e635'),
                ('episode', 'Episode', '(?i)^(Episode|Ad Free)\s+\d+', '(?i)(?:Episode|Ad Free)\s+(\d+)', 5, '🎙️', '#6366f1'),
                ('bonus', 'Bonus', '.', NULL, 99, '🎁', '#6b7280');
            "#,
        )?;

        // Migration: add keywords column if it doesn't exist
        let has_keywords: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('category_rules') WHERE name='keywords'")?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)
            .unwrap_or(false);
        if !has_keywords {
            conn.execute_batch("ALTER TABLE category_rules ADD COLUMN keywords TEXT")?;
        }

        // Chapter label rules (auto-labeling from transcript text)
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS chapter_label_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chapter_type_id INTEGER NOT NULL,
                pattern TEXT NOT NULL,
                match_type TEXT NOT NULL DEFAULT 'contains',
                priority INTEGER DEFAULT 0,
                enabled INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (chapter_type_id) REFERENCES chapter_types(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_chapter_label_rules_type ON chapter_label_rules(chapter_type_id);
            "#,
        )?;

        // Wiki lore tables (fandom wiki integration)
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS wiki_lore (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                category TEXT NOT NULL,
                description TEXT,
                wiki_url TEXT,
                wiki_page_id INTEGER,
                first_episode_id INTEGER REFERENCES episodes(id),
                aliases TEXT,
                last_synced TEXT,
                is_wiki_sourced INTEGER DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS wiki_lore_mentions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lore_id INTEGER NOT NULL REFERENCES wiki_lore(id) ON DELETE CASCADE,
                episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
                segment_idx INTEGER,
                start_time REAL,
                end_time REAL,
                context_snippet TEXT,
                source TEXT DEFAULT 'auto',
                confidence REAL DEFAULT 1.0,
                UNIQUE(lore_id, episode_id, segment_idx)
            );

            CREATE TABLE IF NOT EXISTS wiki_episode_meta (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                episode_id INTEGER UNIQUE REFERENCES episodes(id) ON DELETE CASCADE,
                wiki_page_id INTEGER,
                wiki_url TEXT,
                summary TEXT,
                recording_location TEXT,
                air_date TEXT,
                topics_json TEXT,
                guests_json TEXT,
                bits_json TEXT,
                scoopmail_json TEXT,
                jock_vs_nerd TEXT,
                raw_wikitext TEXT,
                last_synced TEXT
            );
            "#,
        )?;

        // Migration: Add audio_drop_id to episode_speakers (unified speaker/drop assignment)
        let _ = conn.execute(
            "ALTER TABLE episode_speakers ADD COLUMN audio_drop_id INTEGER REFERENCES audio_drops(id) ON DELETE SET NULL",
            [],
        ); // Ignore error if column already exists

        // Migration: Add confidence + source to episode_speakers (voice feedback loop)
        let _ = conn.execute(
            "ALTER TABLE episode_speakers ADD COLUMN confidence REAL",
            [],
        ); // source values: 'manual' | 'auto' | 'harvest'
        let _ = conn.execute(
            "ALTER TABLE episode_speakers ADD COLUMN source TEXT DEFAULT 'manual'",
            [],
        );
        let _ = conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_episode_speakers_drop ON episode_speakers(audio_drop_id);",
        );

        // Migration: Add reference_audio_path to audio_drops (for sound bite audio samples)
        let _ = conn.execute(
            "ALTER TABLE audio_drops ADD COLUMN reference_audio_path TEXT",
            [],
        ); // Ignore error if column already exists

        // Migration: Add window matching settings to audio_drops
        let _ = conn.execute("ALTER TABLE audio_drops ADD COLUMN min_window INTEGER DEFAULT 1", []);
        let _ = conn.execute("ALTER TABLE audio_drops ADD COLUMN max_window INTEGER DEFAULT 4", []);

        // Voice samples table (saved audio clips for speaker/sound bite identification)
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS voice_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                speaker_name TEXT NOT NULL,
                episode_id INTEGER,
                segment_idx INTEGER,
                start_time REAL NOT NULL,
                end_time REAL NOT NULL,
                transcript_text TEXT,
                file_path TEXT NOT NULL,
                rating INTEGER DEFAULT 0,
                source TEXT DEFAULT 'manual',
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_voice_samples_speaker ON voice_samples(speaker_name);
            CREATE INDEX IF NOT EXISTS idx_voice_samples_episode ON voice_samples(episode_id);
            "#,
        )?;
        let _ = conn.execute(
            "ALTER TABLE voice_samples ADD COLUMN source TEXT DEFAULT 'manual'",
            [],
        );

        // Pipeline error log — persists across restarts for post-crash debugging
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS pipeline_errors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                occurred_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                context TEXT NOT NULL,
                episode_id INTEGER,
                error_kind TEXT NOT NULL,
                error_detail TEXT NOT NULL,
                retry_count INTEGER DEFAULT 0,
                resolved INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_pipeline_errors_episode ON pipeline_errors(episode_id);
            CREATE INDEX IF NOT EXISTS idx_pipeline_errors_occurred ON pipeline_errors(occurred_at DESC);
            "#,
        )?;

        // Migration: Add is_performance_bit column to transcript_segments (idempotent)
        let _ = conn.execute(
            "ALTER TABLE transcript_segments ADD COLUMN is_performance_bit INTEGER DEFAULT 0",
            [],
        ); // Ignore error if column already exists

        // Segment classifications (Qwen audio analysis results, pending human review)
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS segment_classifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                episode_id INTEGER NOT NULL,
                segment_idx INTEGER NOT NULL,
                classifier TEXT NOT NULL DEFAULT 'qwen_omni',
                is_performance_bit INTEGER DEFAULT 0,
                character_name TEXT,
                character_id INTEGER,
                speaker_note TEXT,
                tone_description TEXT,
                confidence REAL,
                approved INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
                FOREIGN KEY (character_id) REFERENCES characters(id)
            );
            CREATE INDEX IF NOT EXISTS idx_seg_class_episode ON segment_classifications(episode_id);
            CREATE INDEX IF NOT EXISTS idx_seg_class_approved ON segment_classifications(approved);
            "#,
        )?;

        // Transcript corrections (Scoop Polish — text correction + multi-speaker detection)
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS transcript_corrections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                episode_id INTEGER NOT NULL,
                segment_idx INTEGER NOT NULL,
                original_text TEXT NOT NULL,
                corrected_text TEXT NOT NULL,
                has_multiple_speakers INTEGER DEFAULT 0,
                speaker_change_note TEXT,
                confidence REAL,
                approved INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
                UNIQUE(episode_id, segment_idx)
            );
            CREATE INDEX IF NOT EXISTS idx_transcript_corrections_episode ON transcript_corrections(episode_id);
            CREATE INDEX IF NOT EXISTS idx_transcript_corrections_approved ON transcript_corrections(approved);
            "#,
        )?;

        // Migration: Add is_guest and is_scoop columns to speakers (idempotent)
        let _ = conn.execute(
            "ALTER TABLE speakers ADD COLUMN is_guest INTEGER DEFAULT 0",
            [],
        ); // Ignore error if column already exists
        let _ = conn.execute(
            "ALTER TABLE speakers ADD COLUMN is_scoop INTEGER DEFAULT 0",
            [],
        ); // Ignore error if column already exists

        // Migration: Add speaker_id to characters (idempotent)
        let _ = conn.execute(
            "ALTER TABLE characters ADD COLUMN speaker_id INTEGER REFERENCES speakers(id)",
            [],
        ); // Ignore error if column already exists
        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_characters_speaker ON characters(speaker_id)",
            [],
        );

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
        failed_only: bool,
        downloaded_only: bool,
        not_downloaded_only: bool,
        diarized_only: bool,
        sort_by: Option<&str>,
        sort_desc: bool,
        search: Option<&str>,
        limit: i64,
        offset: i64,
        category: Option<&str>,
        include_variants: bool,
    ) -> Result<(Vec<Episode>, i64)> {
        let conn = self.conn.lock().unwrap();

        let mut conditions = Vec::new();

        // Hide cross-feed variants by default
        if !include_variants {
            conditions.push("canonical_id IS NULL".to_string());
        }

        if let Some(cat) = category {
            conditions.push(format!("category = '{}'", cat.replace("'", "''")));
        }
        if let Some(source) = feed_source {
            conditions.push(format!("feed_source = '{}'", source));
        }
        if transcribed_only {
            conditions.push("is_transcribed = 1".to_string());
        }
        if in_queue_only {
            conditions.push("is_in_queue = 1".to_string());
        }
        if failed_only {
            conditions.push("(transcription_status = 'failed' OR id IN (SELECT episode_id FROM transcription_queue WHERE status = 'failed'))".to_string());
        }
        if downloaded_only {
            conditions.push("is_downloaded = 1".to_string());
        }
        if not_downloaded_only {
            conditions.push("(is_downloaded = 0 OR is_downloaded IS NULL)".to_string());
        }
        if diarized_only {
            conditions.push("has_diarization = 1".to_string());
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
                    processing_time, feed_source, metadata_json, has_diarization, num_speakers,
                    category, category_number, sub_series, canonical_id,
                    download_duration, transcribe_duration, diarize_duration, diarized_date
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
                    category: row.get(23)?,
                    category_number: row.get(24)?,
                    sub_series: row.get(25)?,
                    canonical_id: row.get(26)?,
                    download_duration: row.get(27)?,
                    transcribe_duration: row.get(28)?,
                    diarize_duration: row.get(29)?,
                    diarized_date: row.get(30)?,
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
                    processing_time, feed_source, metadata_json, has_diarization, num_speakers,
                    category, category_number, sub_series, canonical_id,
                    download_duration, transcribe_duration, diarize_duration, diarized_date
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
                    category: row.get(23)?,
                    category_number: row.get(24)?,
                    sub_series: row.get(25)?,
                    canonical_id: row.get(26)?,
                    download_duration: row.get(27)?,
                    transcribe_duration: row.get(28)?,
                    diarize_duration: row.get(29)?,
                    diarized_date: row.get(30)?,
                })
            })
            .ok();

        Ok(episode)
    }

    /// Get category rules ordered by priority
    pub fn get_category_rules(&self) -> Result<Vec<CategoryRule>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, category, display_name, title_pattern, number_pattern, priority, icon, color, keywords
             FROM category_rules ORDER BY priority ASC"
        )?;
        let rules = stmt
            .query_map([], |row| {
                Ok(CategoryRule {
                    id: row.get(0)?,
                    category: row.get(1)?,
                    display_name: row.get(2)?,
                    title_pattern: row.get(3)?,
                    number_pattern: row.get(4)?,
                    priority: row.get(5)?,
                    icon: row.get(6)?,
                    color: row.get(7)?,
                    keywords: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rules)
    }

    /// Add a new category rule
    pub fn add_category_rule(&self, rule: &CategoryRule) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO category_rules (category, display_name, title_pattern, number_pattern, priority, icon, color, keywords)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                rule.category,
                rule.display_name,
                rule.title_pattern,
                rule.number_pattern,
                rule.priority,
                rule.icon,
                rule.color,
                rule.keywords,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Update an existing category rule
    pub fn update_category_rule(&self, rule: &CategoryRule) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE category_rules SET category = ?1, display_name = ?2, title_pattern = ?3,
             number_pattern = ?4, priority = ?5, icon = ?6, color = ?7, keywords = ?8
             WHERE id = ?9",
            params![
                rule.category,
                rule.display_name,
                rule.title_pattern,
                rule.number_pattern,
                rule.priority,
                rule.icon,
                rule.color,
                rule.keywords,
                rule.id,
            ],
        )?;
        Ok(())
    }

    /// Delete a category rule by id
    pub fn delete_category_rule(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM category_rules WHERE id = ?1", params![id])?;
        Ok(())
    }

    // =========================================================================
    // Wiki Lore queries
    // =========================================================================

    /// Upsert wiki episode metadata
    pub fn upsert_wiki_episode_meta(
        &self,
        episode_id: i64,
        wiki_page_id: i64,
        wiki_url: &str,
        summary: Option<&str>,
        air_date: Option<&str>,
        topics_json: Option<&str>,
        guests_json: Option<&str>,
        bits_json: Option<&str>,
        scoopmail_json: Option<&str>,
        jock_vs_nerd: Option<&str>,
        raw_wikitext: Option<&str>,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "INSERT INTO wiki_episode_meta (episode_id, wiki_page_id, wiki_url, summary, air_date,
             topics_json, guests_json, bits_json, scoopmail_json, jock_vs_nerd, raw_wikitext, last_synced)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(episode_id) DO UPDATE SET
             wiki_page_id=?2, wiki_url=?3, summary=?4, air_date=?5,
             topics_json=?6, guests_json=?7, bits_json=?8, scoopmail_json=?9,
             jock_vs_nerd=?10, raw_wikitext=?11, last_synced=?12",
            params![episode_id, wiki_page_id, wiki_url, summary, air_date,
                    topics_json, guests_json, bits_json, scoopmail_json, jock_vs_nerd,
                    raw_wikitext, now],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Get wiki episode metadata for an episode
    pub fn get_wiki_episode_meta(&self, episode_id: i64) -> Result<Option<WikiEpisodeMeta>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, episode_id, wiki_page_id, wiki_url, summary, recording_location,
                    air_date, topics_json, guests_json, bits_json, scoopmail_json,
                    jock_vs_nerd, last_synced
             FROM wiki_episode_meta WHERE episode_id = ?1"
        )?;
        let result = stmt.query_row(params![episode_id], |row| {
            Ok(WikiEpisodeMeta {
                id: row.get(0)?,
                episode_id: row.get(1)?,
                wiki_page_id: row.get(2)?,
                wiki_url: row.get(3)?,
                summary: row.get(4)?,
                recording_location: row.get(5)?,
                air_date: row.get(6)?,
                topics_json: row.get(7)?,
                guests_json: row.get(8)?,
                bits_json: row.get(9)?,
                scoopmail_json: row.get(10)?,
                jock_vs_nerd: row.get(11)?,
                last_synced: row.get(12)?,
            })
        }).optional()?;
        Ok(result)
    }

    /// Find episode ID by category_number (for wiki matching)
    pub fn find_episode_by_number(&self, episode_number: &str, feed_source: Option<&str>) -> Result<Option<i64>> {
        let conn = self.conn.lock().unwrap();
        let source = feed_source.unwrap_or("apple");
        let mut stmt = conn.prepare(
            "SELECT id FROM episodes
             WHERE category_number = ?1 AND feed_source = ?2 AND category = 'episode'
             LIMIT 1"
        )?;
        let result = stmt.query_row(params![episode_number, source], |row| {
            row.get::<_, i64>(0)
        }).optional()?;
        Ok(result)
    }

    /// Get variant episodes that point to a given canonical episode
    pub fn get_episode_variants(&self, episode_id: i64) -> Result<Vec<Episode>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, episode_number, title, description, audio_url, audio_file_path,
                    duration, file_size, published_date, added_date, downloaded_date,
                    transcribed_date, is_downloaded, is_transcribed, is_in_queue,
                    transcript_path, transcription_status, transcription_error,
                    processing_time, feed_source, metadata_json, has_diarization, num_speakers,
                    category, category_number, sub_series, canonical_id,
                    download_duration, transcribe_duration, diarize_duration, diarized_date
             FROM episodes WHERE canonical_id = ?"
        )?;
        let episodes = stmt
            .query_map(params![episode_id], |row| {
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
                    category: row.get(23)?,
                    category_number: row.get(24)?,
                    sub_series: row.get(25)?,
                    canonical_id: row.get(26)?,
                    download_duration: row.get(27)?,
                    transcribe_duration: row.get(28)?,
                    diarize_duration: row.get(29)?,
                    diarized_date: row.get(30)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(episodes)
    }

    /// Update category fields on an episode
    pub fn update_episode_category(
        &self,
        episode_id: i64,
        category: &str,
        episode_number: Option<&str>,
        category_number: Option<&str>,
        sub_series: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE episodes SET category = ?, episode_number = COALESCE(?, episode_number), category_number = ?, sub_series = ? WHERE id = ?",
            params![category, episode_number, category_number, sub_series, episode_id],
        )?;
        Ok(())
    }

    /// Set canonical_id on an episode (linking it as a variant)
    pub fn set_canonical_id(&self, episode_id: i64, canonical_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE episodes SET canonical_id = ? WHERE id = ?",
            params![canonical_id, episode_id],
        )?;
        Ok(())
    }

    /// Get all episodes (minimal query for batch operations like recategorization)
    pub fn get_all_episodes_for_categorization(&self) -> Result<Vec<(i64, String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, title, feed_source FROM episodes")?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Delete the stale local test record
    pub fn delete_local_test_record(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let count = conn.execute("DELETE FROM episodes WHERE feed_source = 'local'", [])?;
        Ok(count)
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
            let now = chrono::Local::now().to_rfc3339();
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
                    marked_samples: None,
                })
            },
        ).ok();

        Ok(result)
    }

    /// Update episode download status
    pub fn mark_downloaded(&self, episode_id: i64, file_path: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE episodes SET is_downloaded = 1, audio_file_path = ?, downloaded_date = datetime('now', 'localtime') WHERE id = ?",
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
                   q.status, q.started_date, q.completed_date, q.error_message, q.queue_type,
                   e.id, e.episode_number, e.title, e.description, e.audio_url,
                   e.audio_file_path, e.duration, e.file_size, e.published_date,
                   e.added_date, e.downloaded_date, e.transcribed_date, e.is_downloaded,
                   e.is_transcribed, e.is_in_queue, e.transcript_path, e.transcription_status,
                   e.transcription_error, e.processing_time, e.feed_source, e.metadata_json,
                   e.has_diarization, e.num_speakers,
                   e.category, e.category_number, e.sub_series, e.canonical_id,
                   e.download_duration, e.transcribe_duration, e.diarize_duration, e.diarized_date
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
                        queue_type: row.get(9)?,
                    },
                    episode: Episode {
                        id: row.get(10)?,
                        episode_number: row.get(11)?,
                        title: row.get(12)?,
                        description: row.get(13)?,
                        audio_url: row.get(14)?,
                        audio_file_path: row.get(15)?,
                        duration: row.get(16)?,
                        file_size: row.get(17)?,
                        published_date: row.get(18)?,
                        added_date: row.get(19)?,
                        downloaded_date: row.get(20)?,
                        transcribed_date: row.get(21)?,
                        is_downloaded: row.get::<_, i32>(22)? == 1,
                        is_transcribed: row.get::<_, i32>(23)? == 1,
                        is_in_queue: row.get::<_, i32>(24)? == 1,
                        transcript_path: row.get(25)?,
                        transcription_status: row
                            .get::<_, String>(26)
                            .unwrap_or_default()
                            .into(),
                        transcription_error: row.get(27)?,
                        processing_time: row.get(28)?,
                        feed_source: row.get(29)?,
                        metadata_json: row.get(30)?,
                        has_diarization: row.get::<_, i32>(31).unwrap_or(0) == 1,
                        num_speakers: row.get(32)?,
                        category: row.get(33)?,
                        category_number: row.get(34)?,
                        sub_series: row.get(35)?,
                        canonical_id: row.get(36)?,
                        download_duration: row.get(37)?,
                        transcribe_duration: row.get(38)?,
                        diarize_duration: row.get(39)?,
                        diarized_date: row.get(40)?,
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
        let now = chrono::Local::now().to_rfc3339();
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

    /// Remove variant episodes (canonical_id IS NOT NULL) from the queue.
    /// Called on startup to clean up any variants that were queued before cross-feed linking.
    pub fn purge_variant_queue_items(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM transcription_queue q JOIN episodes e ON q.episode_id = e.id WHERE e.canonical_id IS NOT NULL AND q.status = 'pending'",
            [],
            |row| row.get(0),
        )?;
        if count > 0 {
            conn.execute(
                "DELETE FROM transcription_queue WHERE episode_id IN (SELECT id FROM episodes WHERE canonical_id IS NOT NULL) AND status = 'pending'",
                [],
            )?;
            conn.execute(
                "UPDATE episodes SET is_in_queue = 0 WHERE canonical_id IS NOT NULL AND is_in_queue = 1",
                [],
            )?;
        }
        Ok(count as usize)
    }

    pub fn get_next_queue_item(&self) -> Result<Option<QueueItemWithEpisode>> {
        let conn = self.conn.lock().unwrap();

        let sql = r#"
            SELECT q.id, q.episode_id, q.added_to_queue_date, q.priority, q.retry_count,
                   q.status, q.started_date, q.completed_date, q.error_message, q.queue_type,
                   e.id, e.episode_number, e.title, e.description, e.audio_url,
                   e.audio_file_path, e.duration, e.file_size, e.published_date,
                   e.added_date, e.downloaded_date, e.transcribed_date, e.is_downloaded,
                   e.is_transcribed, e.is_in_queue, e.transcript_path, e.transcription_status,
                   e.transcription_error, e.processing_time, e.feed_source, e.metadata_json,
                   e.has_diarization, e.num_speakers,
                   e.category, e.category_number, e.sub_series, e.canonical_id,
                   e.download_duration, e.transcribe_duration, e.diarize_duration, e.diarized_date
            FROM transcription_queue q
            JOIN episodes e ON q.episode_id = e.id
            WHERE q.status = 'pending' AND (q.queue_type IS NULL OR q.queue_type != 'diarize_only')
                  AND e.canonical_id IS NULL
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
                        queue_type: row.get(9)?,
                    },
                    episode: Episode {
                        id: row.get(10)?,
                        episode_number: row.get(11)?,
                        title: row.get(12)?,
                        description: row.get(13)?,
                        audio_url: row.get(14)?,
                        audio_file_path: row.get(15)?,
                        duration: row.get(16)?,
                        file_size: row.get(17)?,
                        published_date: row.get(18)?,
                        added_date: row.get(19)?,
                        downloaded_date: row.get(20)?,
                        transcribed_date: row.get(21)?,
                        is_downloaded: row.get::<_, i32>(22)? == 1,
                        is_transcribed: row.get::<_, i32>(23)? == 1,
                        is_in_queue: row.get::<_, i32>(24)? == 1,
                        transcript_path: row.get(25)?,
                        transcription_status: row
                            .get::<_, String>(26)
                            .unwrap_or_default()
                            .into(),
                        transcription_error: row.get(27)?,
                        processing_time: row.get(28)?,
                        feed_source: row.get(29)?,
                        metadata_json: row.get(30)?,
                        has_diarization: row.get::<_, i32>(31).unwrap_or(0) == 1,
                        num_speakers: row.get(32)?,
                        category: row.get(33)?,
                        category_number: row.get(34)?,
                        sub_series: row.get(35)?,
                        canonical_id: row.get(36)?,
                        download_duration: row.get(37)?,
                        transcribe_duration: row.get(38)?,
                        diarize_duration: row.get(39)?,
                        diarized_date: row.get(40)?,
                    },
                })
            })
            .ok();

        Ok(item)
    }

    /// Get the next diarize-only item from the queue (independent of full pipeline items)
    pub fn get_next_diarize_only_item(&self) -> Result<Option<QueueItemWithEpisode>> {
        let conn = self.conn.lock().unwrap();

        let sql = r#"
            SELECT q.id, q.episode_id, q.added_to_queue_date, q.priority, q.retry_count,
                   q.status, q.started_date, q.completed_date, q.error_message, q.queue_type,
                   e.id, e.episode_number, e.title, e.description, e.audio_url,
                   e.audio_file_path, e.duration, e.file_size, e.published_date,
                   e.added_date, e.downloaded_date, e.transcribed_date, e.is_downloaded,
                   e.is_transcribed, e.is_in_queue, e.transcript_path, e.transcription_status,
                   e.transcription_error, e.processing_time, e.feed_source, e.metadata_json,
                   e.has_diarization, e.num_speakers,
                   e.category, e.category_number, e.sub_series, e.canonical_id,
                   e.download_duration, e.transcribe_duration, e.diarize_duration, e.diarized_date
            FROM transcription_queue q
            JOIN episodes e ON q.episode_id = e.id
            WHERE q.status = 'pending' AND q.queue_type = 'diarize_only'
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
                        queue_type: row.get(9)?,
                    },
                    episode: Episode {
                        id: row.get(10)?,
                        episode_number: row.get(11)?,
                        title: row.get(12)?,
                        description: row.get(13)?,
                        audio_url: row.get(14)?,
                        audio_file_path: row.get(15)?,
                        duration: row.get(16)?,
                        file_size: row.get(17)?,
                        published_date: row.get(18)?,
                        added_date: row.get(19)?,
                        downloaded_date: row.get(20)?,
                        transcribed_date: row.get(21)?,
                        is_downloaded: row.get::<_, i32>(22)? == 1,
                        is_transcribed: row.get::<_, i32>(23)? == 1,
                        is_in_queue: row.get::<_, i32>(24)? == 1,
                        transcript_path: row.get(25)?,
                        transcription_status: row
                            .get::<_, String>(26)
                            .unwrap_or_default()
                            .into(),
                        transcription_error: row.get(27)?,
                        processing_time: row.get(28)?,
                        feed_source: row.get(29)?,
                        metadata_json: row.get(30)?,
                        has_diarization: row.get::<_, i32>(31).unwrap_or(0) == 1,
                        num_speakers: row.get(32)?,
                        category: row.get(33)?,
                        category_number: row.get(34)?,
                        sub_series: row.get(35)?,
                        canonical_id: row.get(36)?,
                        download_duration: row.get(37)?,
                        transcribe_duration: row.get(38)?,
                        diarize_duration: row.get(39)?,
                        diarized_date: row.get(40)?,
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
            "UPDATE transcription_queue SET status = 'processing', started_date = datetime('now', 'localtime') WHERE episode_id = ?",
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
            "UPDATE transcription_queue SET status = 'completed', completed_date = datetime('now', 'localtime') WHERE episode_id = ?",
            params![episode_id],
        )?;
        // Set is_in_queue = 0 and save transcript_path
        conn.execute(
            "UPDATE episodes SET transcription_status = 'completed', is_transcribed = 1, is_in_queue = 0, transcript_path = ?, transcribed_date = datetime('now', 'localtime') WHERE id = ?",
            params![transcript_path, episode_id],
        )?;
        Ok(())
    }

    pub fn mark_failed(&self, episode_id: i64, error: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let is_download_failure = error.to_lowercase().contains("download");

        if is_download_failure {
            // Download failures: remove from queue entirely (retrying won't help without a new URL)
            conn.execute(
                "DELETE FROM transcription_queue WHERE episode_id = ?",
                params![episode_id],
            )?;
            conn.execute(
                "UPDATE episodes SET transcription_status = 'failed', transcription_error = ?, is_in_queue = 0, is_downloaded = 0 WHERE id = ?",
                params![error, episode_id],
            )?;
        } else {
            // Other failures: keep in queue as failed for potential retry
            conn.execute(
                "UPDATE transcription_queue SET status = 'failed', error_message = ?, retry_count = retry_count + 1 WHERE episode_id = ?",
                params![error, episode_id],
            )?;
            conn.execute(
                "UPDATE episodes SET transcription_status = 'failed', transcription_error = ? WHERE id = ?",
                params![error, episode_id],
            )?;
        }
        Ok(())
    }

    /// Count transcribed episodes that don't have diarization and aren't already queued for it
    pub fn count_undiarized_transcribed(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM episodes WHERE is_transcribed = 1 AND has_diarization = 0",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Auto-queue all transcribed episodes that lack diarization
    pub fn queue_undiarized_transcribed(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Local::now().to_rfc3339();
        // Insert new diarize_only queue items for episodes not yet in the queue
        conn.execute(
            "INSERT OR IGNORE INTO transcription_queue (episode_id, priority, status, queue_type, added_to_queue_date, retry_count) \
             SELECT id, 0, 'pending', 'diarize_only', ?1, 0 FROM episodes \
             WHERE is_transcribed = 1 AND has_diarization = 0 \
             AND id NOT IN (SELECT episode_id FROM transcription_queue)",
            params![now],
        )?;
        // Fix stuck episodes: already in queue as 'completed'/'full' but never diarized
        // Reset them to pending/diarize_only so the worker picks them up
        let fixed = conn.execute(
            "UPDATE transcription_queue SET status = 'pending', queue_type = 'diarize_only' \
             WHERE episode_id IN (SELECT id FROM episodes WHERE is_transcribed = 1 AND has_diarization = 0) \
             AND status = 'completed' AND queue_type = 'full'",
            [],
        )?;
        if fixed > 0 {
            log::info!("Fixed {} episodes stuck as completed/full without diarization", fixed);
        }
        conn.execute(
            "UPDATE episodes SET is_in_queue = 1 WHERE is_transcribed = 1 AND has_diarization = 0 \
             AND id IN (SELECT episode_id FROM transcription_queue WHERE queue_type = 'diarize_only' AND status = 'pending')",
            [],
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
        self.requeue_for_diarization_with_backend(episode_id, priority, None)
    }

    /// Requeue an episode for diarization only and optionally force an embedding backend override.
    pub fn requeue_for_diarization_with_backend(
        &self,
        episode_id: i64,
        priority: i32,
        embedding_backend_override: Option<&str>,
    ) -> Result<()> {
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
                    "UPDATE transcription_queue SET priority = ?, queue_type = 'diarize_only', embedding_backend_override = ? WHERE episode_id = ?",
                    params![priority, embedding_backend_override, episode_id],
                )?;
            }
            Some(_) => {
                // completed or failed - update to pending
                let now = chrono::Local::now().to_rfc3339();
                conn.execute(
                    "UPDATE transcription_queue SET status = 'pending', priority = ?, queue_type = 'diarize_only', \
                     embedding_backend_override = ?, added_to_queue_date = ?, retry_count = 0, error_message = NULL, \
                     started_date = NULL, completed_date = NULL WHERE episode_id = ?",
                    params![priority, embedding_backend_override, now, episode_id],
                )?;
            }
            None => {
                // No row exists - insert
                let now = chrono::Local::now().to_rfc3339();
                conn.execute(
                    "INSERT INTO transcription_queue (episode_id, priority, status, queue_type, embedding_backend_override, added_to_queue_date, retry_count) \
                     VALUES (?, ?, 'pending', 'diarize_only', ?, ?, 0)",
                    params![episode_id, priority, embedding_backend_override, now],
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
                   q.status, q.started_date, q.completed_date, q.error_message, q.queue_type,
                   e.id, e.episode_number, e.title, e.description, e.audio_url,
                   e.audio_file_path, e.duration, e.file_size, e.published_date,
                   e.added_date, e.downloaded_date, e.transcribed_date, e.is_downloaded,
                   e.is_transcribed, e.is_in_queue, e.transcript_path, e.transcription_status,
                   e.transcription_error, e.processing_time, e.feed_source, e.metadata_json,
                   e.has_diarization, e.num_speakers,
                   e.category, e.category_number, e.sub_series, e.canonical_id,
                   e.download_duration, e.transcribe_duration, e.diarize_duration, e.diarized_date
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
                        queue_type: row.get(9)?,
                    },
                    episode: Episode {
                        id: row.get(10)?,
                        episode_number: row.get(11)?,
                        title: row.get(12)?,
                        description: row.get(13)?,
                        audio_url: row.get(14)?,
                        audio_file_path: row.get(15)?,
                        duration: row.get(16)?,
                        file_size: row.get(17)?,
                        published_date: row.get(18)?,
                        added_date: row.get(19)?,
                        downloaded_date: row.get(20)?,
                        transcribed_date: row.get(21)?,
                        is_downloaded: row.get::<_, i32>(22)? == 1,
                        is_transcribed: row.get::<_, i32>(23)? == 1,
                        is_in_queue: row.get::<_, i32>(24)? == 1,
                        transcript_path: row.get(25)?,
                        transcription_status: row
                            .get::<_, String>(26)
                            .unwrap_or_default()
                            .into(),
                        transcription_error: row.get(27)?,
                        processing_time: row.get(28)?,
                        feed_source: row.get(29)?,
                        metadata_json: row.get(30)?,
                        has_diarization: row.get::<_, i32>(31).unwrap_or(0) == 1,
                        num_speakers: row.get(32)?,
                        category: row.get(33)?,
                        category_number: row.get(34)?,
                        sub_series: row.get(35)?,
                        canonical_id: row.get(36)?,
                        download_duration: row.get(37)?,
                        transcribe_duration: row.get(38)?,
                        diarize_duration: row.get(39)?,
                        diarized_date: row.get(40)?,
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

    /// Get per-episode embedding backend override from queue, if set.
    pub fn get_queue_embedding_override(&self, episode_id: i64) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let result = conn
            .query_row(
                "SELECT embedding_backend_override FROM transcription_queue WHERE episode_id = ?",
                params![episode_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(result)
    }

    /// Count priority diarize-only items that are still pending/processing.
    pub fn count_priority_diarization_items(&self, min_priority: i32) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM transcription_queue \
             WHERE queue_type = 'diarize_only' AND priority >= ? \
             AND status IN ('pending', 'processing')",
            params![min_priority],
            |row| row.get(0),
        )?;
        Ok(count)
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
        let diarized_episodes: i64 = conn.query_row(
            "SELECT COUNT(*) FROM episodes WHERE has_diarization = 1",
            [],
            |row| row.get(0),
        )?;
        let in_queue: i64 =
            conn.query_row("SELECT COUNT(*) FROM episodes WHERE is_in_queue = 1", [], |row| {
                row.get(0)
            })?;
        let in_transcription_queue: i64 = conn.query_row(
            "SELECT COUNT(*) FROM transcription_queue WHERE status IN ('pending', 'processing') AND (queue_type IS NULL OR queue_type = 'full')",
            [],
            |row| row.get(0),
        )?;
        let in_diarization_queue: i64 = conn.query_row(
            "SELECT COUNT(*) FROM transcription_queue WHERE status IN ('pending', 'processing') AND queue_type = 'diarize_only'",
            [],
            |row| row.get(0),
        )?;
        let failed: i64 = conn.query_row(
            "SELECT COUNT(*) FROM episodes WHERE transcription_status = 'failed'",
            [],
            |row| row.get(0),
        )?;

        Ok(AppStats {
            total_episodes,
            downloaded_episodes,
            transcribed_episodes,
            diarized_episodes,
            in_queue,
            in_transcription_queue,
            in_diarization_queue,
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
    // Pipeline Timing
    // =========================================================================

    pub fn update_episode_duration(&self, episode_id: i64, duration: f64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE episodes SET duration = ? WHERE id = ?",
            params![duration, episode_id],
        )?;
        Ok(())
    }

    pub fn update_download_duration(&self, episode_id: i64, duration: f64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE episodes SET download_duration = ? WHERE id = ?",
            params![duration, episode_id],
        )?;
        Ok(())
    }

    pub fn update_transcribe_duration(&self, episode_id: i64, duration: f64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE episodes SET transcribe_duration = ? WHERE id = ?",
            params![duration, episode_id],
        )?;
        Ok(())
    }

    pub fn update_diarize_duration(&self, episode_id: i64, duration: f64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE episodes SET diarize_duration = ?, diarized_date = datetime('now', 'localtime') WHERE id = ?",
            params![duration, episode_id],
        )?;
        Ok(())
    }

    pub fn update_pipeline_duration(&self, episode_id: i64, duration: f64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE episodes SET processing_time = ? WHERE id = ?",
            params![duration, episode_id],
        )?;
        Ok(())
    }

    pub fn update_episode_pipeline_identity(
        &self,
        episode_id: i64,
        transcription_model: &str,
        embedding_backend: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE episodes SET transcription_model_used = ?, embedding_backend_used = ? WHERE id = ?",
            params![transcription_model, embedding_backend, episode_id],
        )?;
        Ok(())
    }

    pub fn get_pipeline_timing_stats(&self) -> Result<PipelineTimingStats> {
        let conn = self.conn.lock().unwrap();

        // Exclude variant episodes (canonical_id IS NOT NULL) from stats
        let avg_download: f64 = conn.query_row(
            "SELECT COALESCE(AVG(download_duration), 0) FROM episodes WHERE download_duration IS NOT NULL AND canonical_id IS NULL",
            [], |row| row.get(0),
        )?;
        let avg_transcribe: f64 = conn.query_row(
            "SELECT COALESCE(AVG(transcribe_duration), 0) FROM episodes WHERE transcribe_duration IS NOT NULL AND canonical_id IS NULL",
            [], |row| row.get(0),
        )?;
        let avg_diarize: f64 = conn.query_row(
            "SELECT COALESCE(AVG(diarize_duration), 0) FROM episodes WHERE diarize_duration IS NOT NULL AND canonical_id IS NULL",
            [], |row| row.get(0),
        )?;
        let avg_total: f64 = conn.query_row(
            "SELECT COALESCE(AVG(processing_time), 0) FROM episodes WHERE processing_time IS NOT NULL AND canonical_id IS NULL",
            [], |row| row.get(0),
        )?;
        let total_hours_processed: f64 = conn.query_row(
            "SELECT COALESCE(SUM(duration), 0) / 3600.0 FROM episodes WHERE transcribe_duration IS NOT NULL AND duration IS NOT NULL AND canonical_id IS NULL",
            [], |row| row.get(0),
        )?;
        let episodes_timed: i64 = conn.query_row(
            "SELECT COUNT(*) FROM episodes WHERE transcribe_duration IS NOT NULL AND canonical_id IS NULL",
            [], |row| row.get(0),
        )?;
        // Avg transcribe time per hour of audio
        let avg_transcribe_per_hour: f64 = conn.query_row(
            "SELECT CASE WHEN SUM(duration) > 0
                THEN SUM(transcribe_duration) / (SUM(duration) / 3600.0)
                ELSE 0 END
             FROM episodes WHERE transcribe_duration IS NOT NULL AND duration IS NOT NULL AND duration > 0 AND canonical_id IS NULL",
            [], |row| row.get(0),
        )?;

        Ok(PipelineTimingStats {
            avg_download_seconds: avg_download,
            avg_transcribe_seconds: avg_transcribe,
            avg_diarize_seconds: avg_diarize,
            avg_total_seconds: avg_total,
            avg_transcribe_per_hour_audio: avg_transcribe_per_hour,
            total_hours_processed,
            episodes_timed,
        })
    }

    pub fn get_processed_today(&self) -> Result<i32> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM episodes WHERE date(transcribed_date) = date('now', 'localtime') AND canonical_id IS NULL",
            [],
            |row| row.get(0),
        )?;
        Ok(count as i32)
    }

    pub fn get_recently_completed_episodes(&self, limit: i64) -> Result<Vec<CompletedEpisodeTiming>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT e.id, e.title, e.episode_number, e.duration, e.download_duration, e.transcribe_duration,
                    e.diarize_duration, e.processing_time,
                    COALESCE(q.completed_date, e.diarized_date, e.transcribed_date) AS completed_date,
                    e.transcription_model_used, e.embedding_backend_used,
                    q.queue_type
             FROM episodes e
             LEFT JOIN transcription_queue q ON q.episode_id = e.id
             WHERE (e.transcribe_duration IS NOT NULL OR e.diarize_duration IS NOT NULL)
               AND e.canonical_id IS NULL
             ORDER BY datetime(COALESCE(q.completed_date, e.diarized_date, e.transcribed_date)) DESC
             LIMIT ?",
        )?;
        let items = stmt.query_map(params![limit], |row| {
            Ok(CompletedEpisodeTiming {
                id: row.get(0)?,
                title: row.get(1)?,
                episode_number: row.get(2)?,
                audio_duration: row.get(3)?,
                download_duration: row.get(4)?,
                transcribe_duration: row.get(5)?,
                diarize_duration: row.get(6)?,
                total_duration: row.get(7)?,
                completed_date: row.get(8)?,
                transcription_model_used: row.get(9)?,
                embedding_backend_used: row.get(10)?,
                last_queue_type: row.get(11)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(items)
    }

    /// Get episodes for queue display.
    /// Transcribe list: ALL untranscribed non-canonical episodes (whether queued or not), with is_downloaded.
    /// Diarize list: pending diarize_only queue items.
    pub fn get_queue_episode_lists(
        &self,
    ) -> Result<
        (
            Vec<(i64, String, Option<i64>, String, bool)>,
            Vec<(i64, String, Option<i64>, String, Option<String>, i32)>,
        ),
    > {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT e.id, e.title, CAST(e.episode_number AS INTEGER),
                    COALESCE(q.added_to_queue_date, '') AS added_date,
                    e.is_downloaded
             FROM transcription_queue q
             JOIN episodes e ON e.id = q.episode_id
             WHERE q.status IN ('pending', 'processing')
               AND COALESCE(q.queue_type, 'full') != 'diarize_only'
             ORDER BY q.priority DESC, q.added_to_queue_date ASC
             LIMIT 1000"
        )?;
        let transcribe_queue = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<i64>>(2)?, row.get::<_, String>(3)?, row.get::<_, bool>(4)?))
        })?.filter_map(|r| r.ok()).collect();

        let mut stmt2 = conn.prepare(
            "SELECT e.id, e.title, CAST(e.episode_number AS INTEGER), q.added_to_queue_date,
                    q.embedding_backend_override, q.priority
             FROM transcription_queue q
             JOIN episodes e ON q.episode_id = e.id
             WHERE q.status IN ('pending', 'processing')
               AND q.queue_type = 'diarize_only'
             ORDER BY q.priority DESC, q.added_to_queue_date ASC"
        )?;
        let diarize_queue = stmt2.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, i32>(5)?,
            ))
        })?.filter_map(|r| r.ok()).collect();

        Ok((transcribe_queue, diarize_queue))
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
        let now = chrono::Local::now().to_rfc3339();
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
            "SELECT id, name, short_name, description, is_host, is_guest, is_scoop, image_url, created_at
             FROM speakers ORDER BY is_host DESC, name ASC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Speaker {
                id: row.get(0)?,
                name: row.get(1)?,
                short_name: row.get(2)?,
                description: row.get(3)?,
                is_host: row.get::<_, i32>(4)? == 1,
                is_guest: row.get::<_, i32>(5).unwrap_or(0) == 1,
                is_scoop: row.get::<_, i32>(6).unwrap_or(0) == 1,
                image_url: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?;
        let mut speakers = Vec::new();
        for row in rows {
            speakers.push(row?);
        }
        Ok(speakers)
    }

    pub fn create_speaker(&self, name: &str, short_name: Option<&str>, is_host: bool, is_guest: bool, is_scoop: bool) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO speakers (name, short_name, is_host, is_guest, is_scoop) VALUES (?, ?, ?, ?, ?)",
            params![name, short_name, if is_host { 1 } else { 0 }, if is_guest { 1 } else { 0 }, if is_scoop { 1 } else { 0 }],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_speaker(&self, id: i64, name: &str, short_name: Option<&str>, is_host: bool, is_guest: bool, is_scoop: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE speakers SET name = ?, short_name = ?, is_host = ?, is_guest = ?, is_scoop = ? WHERE id = ?",
            params![name, short_name, if is_host { 1 } else { 0 }, if is_guest { 1 } else { 0 }, if is_scoop { 1 } else { 0 }, id],
        )?;
        Ok(())
    }

    pub fn delete_speaker(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE episode_speakers SET speaker_id = NULL WHERE speaker_id = ?",
            params![id],
        )?;
        conn.execute(
            "UPDATE characters SET speaker_id = NULL WHERE speaker_id = ?",
            params![id],
        )?;
        conn.execute("DELETE FROM speakers WHERE id = ?", params![id])?;
        Ok(())
    }

    pub fn get_or_create_speaker_id_by_name(&self, name: &str) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        if let Ok(id) = conn.query_row(
            "SELECT id FROM speakers WHERE name = ?1",
            params![name],
            |row| row.get(0),
        ) {
            return Ok(id);
        }
        let short_name = name.split_whitespace().next().unwrap_or(name).to_string();
        conn.execute(
            "INSERT INTO speakers (name, short_name, is_host, is_guest, is_scoop) VALUES (?1, ?2, 0, 0, 0)",
            params![name, short_name],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_diarization_labels_for_episode(&self, episode_id: i64) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT speaker FROM transcript_segments WHERE episode_id = ?1 AND speaker IS NOT NULL",
        )?;
        let labels = stmt
            .query_map([episode_id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(labels)
    }

    pub fn get_episode_speaker_assignment_state(
        &self,
        episode_id: i64,
        diarization_label: &str,
    ) -> Result<Option<(Option<i64>, Option<i64>)>> {
        let conn = self.conn.lock().unwrap();
        let result = conn
            .query_row(
                "SELECT speaker_id, audio_drop_id FROM episode_speakers WHERE episode_id = ?1 AND diarization_label = ?2",
                params![episode_id, diarization_label],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();
        Ok(result)
    }

    pub fn auto_create_unknown_speakers_for_episode(&self, episode_id: i64) -> Result<i64> {
        let labels = self.get_diarization_labels_for_episode(episode_id)?;
        let mut created = 0;
        for label in labels {
            if !label.starts_with("SPEAKER_") {
                continue;
            }
            if let Some((speaker_id, audio_drop_id)) = self.get_episode_speaker_assignment_state(episode_id, &label)? {
                if speaker_id.is_some() || audio_drop_id.is_some() {
                    continue;
                }
            }
            let suffix = label.trim_start_matches("SPEAKER_");
            let speaker_name = format!("Speaker_{}", suffix);
            let speaker_id = self.get_or_create_speaker_id_by_name(&speaker_name)?;
            self.link_episode_speaker(episode_id, &label, speaker_id)?;
            created += 1;
        }
        Ok(created)
    }

    pub fn get_speaker_stats(&self) -> Result<Vec<SpeakerStats>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT s.id, s.name, s.short_name, s.is_host,
                    COUNT(DISTINCT es.episode_id) as episode_count,
                    COALESCE(SUM(es.speaking_time_seconds), 0) as total_speaking_time,
                    COALESCE(SUM(es.segment_count), 0) as total_segments
             FROM speakers s
             LEFT JOIN episode_speakers es ON s.id = es.speaker_id AND es.audio_drop_id IS NULL
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
            "INSERT OR REPLACE INTO episode_speakers (episode_id, diarization_label, speaker_id, audio_drop_id)
             VALUES (?, ?, ?, NULL)",
            params![episode_id, diarization_label, speaker_id],
        )?;
        Ok(())
    }

    /// Auto-assign a diarization label to a speaker based on voice library confidence.
    /// Uses INSERT OR IGNORE so it never overwrites an existing manual assignment.
    pub fn link_episode_speaker_auto(
        &self,
        episode_id: i64,
        diarization_label: &str,
        speaker_name: &str,
        confidence: f64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        // Resolve speaker_id by name (case-insensitive)
        let speaker_id: Option<i64> = conn.query_row(
            "SELECT id FROM speakers WHERE LOWER(name) = LOWER(?1)",
            params![speaker_name],
            |row| row.get(0),
        ).ok();
        let Some(speaker_id) = speaker_id else {
            return Ok(()); // Speaker not in DB — silently skip
        };
        // INSERT OR IGNORE — never overwrites manual assignments
        conn.execute(
            "INSERT OR IGNORE INTO episode_speakers (episode_id, diarization_label, speaker_id, confidence, source)
             VALUES (?1, ?2, ?3, ?4, 'auto')",
            params![episode_id, diarization_label, speaker_id, confidence],
        )?;
        Ok(())
    }

    pub fn link_episode_audio_drop(&self, episode_id: i64, diarization_label: &str, audio_drop_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO episode_speakers (episode_id, diarization_label, speaker_id, audio_drop_id)
             VALUES (?, ?, NULL, ?)",
            params![episode_id, diarization_label, audio_drop_id],
        )?;
        Ok(())
    }

    /// Sync episode_speakers from a speaker_names map (label → display name).
    /// For each SPEAKER_XX label that maps to a known speaker name, upserts a row in
    /// episode_speakers so episode counts stay accurate. Labels already assigned to an
    /// audio_drop are left untouched. Unknown names (guests not yet in speakers table)
    /// are silently skipped.
    pub fn sync_episode_speaker_names(
        &self,
        episode_id: i64,
        speaker_names: &std::collections::HashMap<String, String>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        for (label, name) in speaker_names {
            // Only process SPEAKER_XX labels (literal-name keys are self-referential)
            if !label.starts_with("SPEAKER_") {
                continue;
            }
            // Look up speaker by name
            let speaker_id: Option<i64> = conn.query_row(
                "SELECT id FROM speakers WHERE name = ?",
                params![name],
                |row| row.get(0),
            ).ok();
            let Some(speaker_id) = speaker_id else { continue };
            // Don't overwrite an existing audio_drop assignment for this label
            let has_drop: bool = conn.query_row(
                "SELECT COUNT(*) FROM episode_speakers WHERE episode_id = ? AND diarization_label = ? AND audio_drop_id IS NOT NULL",
                params![episode_id, label],
                |row| row.get::<_, i64>(0),
            ).unwrap_or(0) > 0;
            if has_drop {
                continue;
            }
            conn.execute(
                "INSERT OR REPLACE INTO episode_speakers (episode_id, diarization_label, speaker_id, audio_drop_id)
                 VALUES (?, ?, ?, NULL)",
                params![episode_id, label, speaker_id],
            )?;
        }
        Ok(())
    }

    /// Get the audio_drop_id for a diarization label, if it's assigned to a sound bite
    pub fn get_audio_drop_for_label(&self, episode_id: i64, diarization_label: &str) -> Result<Option<i64>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT audio_drop_id FROM episode_speakers WHERE episode_id = ? AND diarization_label = ? AND audio_drop_id IS NOT NULL",
            params![episode_id, diarization_label],
            |row| row.get(0),
        );
        match result {
            Ok(id) => Ok(Some(id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    // =========================================================================
    // Voice Samples (saved audio clips)
    // =========================================================================

    pub fn insert_voice_sample(
        &self,
        speaker_name: &str,
        episode_id: Option<i64>,
        segment_idx: Option<i64>,
        start_time: f64,
        end_time: f64,
        transcript_text: Option<&str>,
        file_path: &str,
        source: Option<&str>,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO voice_samples (speaker_name, episode_id, segment_idx, start_time, end_time, transcript_text, file_path, source)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
             WHERE NOT EXISTS (SELECT 1 FROM voice_samples WHERE file_path = ?7)",
            params![
                speaker_name,
                episode_id,
                segment_idx,
                start_time,
                end_time,
                transcript_text,
                file_path,
                source.unwrap_or("manual")
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_voice_samples_for_speaker(&self, speaker_name: &str) -> Result<Vec<VoiceSampleRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT vs.id, vs.speaker_name, vs.episode_id, vs.segment_idx,
                    vs.start_time, vs.end_time, vs.transcript_text, vs.file_path,
                    vs.rating, vs.source, vs.created_at, e.title as episode_title, e.episode_number
             FROM voice_samples vs
             LEFT JOIN episodes e ON vs.episode_id = e.id
             WHERE vs.speaker_name = ?1
             ORDER BY vs.created_at DESC"
        )?;
        let rows = stmt.query_map(params![speaker_name], |row| {
            Ok(VoiceSampleRecord {
                id: row.get(0)?,
                speaker_name: row.get(1)?,
                episode_id: row.get(2)?,
                segment_idx: row.get(3)?,
                start_time: row.get(4)?,
                end_time: row.get(5)?,
                transcript_text: row.get(6)?,
                file_path: row.get(7)?,
                rating: row.get(8)?,
                source: row.get(9)?,
                created_at: row.get(10)?,
                episode_title: row.get(11)?,
                episode_number: row.get(12)?,
            })
        })?;
        let mut samples = Vec::new();
        for row in rows {
            samples.push(row?);
        }
        Ok(samples)
    }

    pub fn update_voice_sample_rating(&self, id: i64, rating: i32) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE voice_samples SET rating = ?1 WHERE id = ?2",
            params![rating, id],
        )?;
        Ok(())
    }

    pub fn delete_voice_sample_record(&self, id: i64) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        // Return the file_path so caller can delete the file
        let file_path: Option<String> = conn.query_row(
            "SELECT file_path FROM voice_samples WHERE id = ?1",
            params![id],
            |row| row.get(0),
        ).optional()?;
        conn.execute("DELETE FROM voice_samples WHERE id = ?1", params![id])?;
        Ok(file_path)
    }

    pub fn get_voice_sample_files_by_source(&self, source: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT file_path FROM voice_samples WHERE source = ?1 AND file_path IS NOT NULL AND file_path != ''"
        )?;
        let mut rows = stmt.query(params![source])?;
        let mut files = Vec::new();
        while let Some(row) = rows.next()? {
            files.push(row.get::<_, String>(0)?);
        }
        Ok(files)
    }

    pub fn delete_voice_samples_by_source(&self, source: &str) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let deleted = conn.execute("DELETE FROM voice_samples WHERE source = ?1", params![source])?;
        Ok(deleted as i64)
    }

    pub fn unlink_episode_speaker(&self, episode_id: i64, diarization_label: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE episode_speakers SET speaker_id = NULL, audio_drop_id = NULL
             WHERE episode_id = ? AND diarization_label = ?",
            params![episode_id, diarization_label],
        )?;
        Ok(())
    }

    /// Returns a map of speaker_name -> episode_count (how many distinct episodes each speaker appears in)
    pub fn get_speaker_episode_counts(&self) -> Result<std::collections::HashMap<String, i32>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT s.name, COUNT(DISTINCT es.episode_id) as episode_count
             FROM episode_speakers es
             JOIN speakers s ON es.speaker_id = s.id
             GROUP BY s.id, s.name"
        )?;
        let map: std::collections::HashMap<String, i32> = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
        })?.filter_map(|r| r.ok()).collect();
        Ok(map)
    }

    pub fn get_episode_speaker_assignments(&self, episode_id: i64) -> Result<Vec<EpisodeSpeakerAssignment>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT es.id, es.episode_id, es.diarization_label, es.speaker_id,
                    s.name as speaker_name, es.audio_drop_id, ad.name as audio_drop_name,
                    es.speaking_time_seconds, es.segment_count
             FROM episode_speakers es
             LEFT JOIN speakers s ON es.speaker_id = s.id
             LEFT JOIN audio_drops ad ON es.audio_drop_id = ad.id
             WHERE es.episode_id = ?
             ORDER BY es.diarization_label"
        )?;
        let rows = stmt.query_map(params![episode_id], |row| {
            Ok(EpisodeSpeakerAssignment {
                id: row.get(0)?,
                episode_id: row.get(1)?,
                diarization_label: row.get(2)?,
                speaker_id: row.get(3)?,
                speaker_name: row.get(4)?,
                audio_drop_id: row.get(5)?,
                audio_drop_name: row.get(6)?,
                speaking_time_seconds: row.get(7)?,
                segment_count: row.get(8)?,
            })
        })?;
        let mut assignments = Vec::new();
        for row in rows {
            assignments.push(row?);
        }
        Ok(assignments)
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
                   processing_time, feed_source, metadata_json, has_diarization, num_speakers,
                   category, category_number, sub_series, canonical_id,
                   download_duration, transcribe_duration, diarize_duration, diarized_date
            FROM episodes
            WHERE (is_transcribed = 0 OR is_transcribed IS NULL) AND (is_in_queue = 0 OR is_in_queue IS NULL)
                  AND canonical_id IS NULL
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
                category: row.get(23)?,
                category_number: row.get(24)?,
                sub_series: row.get(25)?,
                canonical_id: row.get(26)?,
                download_duration: row.get(27)?,
                transcribe_duration: row.get(28)?,
                diarize_duration: row.get(29)?,
                diarized_date: row.get(30)?,
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

    fn ensure_default_chapter_types(&self, conn: &rusqlite::Connection) -> Result<()> {
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM chapter_types", [], |row| row.get(0))?;
        if count > 0 {
            return Ok(());
        }

        conn.execute_batch(
            r#"
            INSERT INTO chapter_types (name, description, color, icon, sort_order) VALUES
                ('Intro', 'Episode introduction and banter', '#22c55e', '🎬', 1),
                ('Scoop Mail', 'Listener mail segment', '#3b82f6', '📧', 2),
                ('Jock vs Nerd', 'Trivia competition segment', '#f59e0b', '🏆', 3),
                ('Thank Yous', 'Patron acknowledgments', '#8b5cf6', '🙏', 4),
                ('Patreon Extra', 'Bonus segment for patrons', '#14b8a6', '🎁', 5),
                ('Commercial', 'Sponsor commercial segment', '#ec4899', '📺', 6);
            "#
        )?;
        Ok(())
    }

    pub fn get_chapter_types(&self) -> Result<Vec<models::ChapterType>> {
        let conn = self.conn.lock().unwrap();
        self.ensure_default_chapter_types(&conn)?;
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
               LEFT JOIN chapter_types ct ON ec.chapter_type_id = ct.id
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
    // Chapter Label Rules
    // =========================================================================

    pub fn get_chapter_label_rules(&self) -> Result<Vec<models::ChapterLabelRule>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT clr.id, clr.chapter_type_id, ct.name, ct.color, ct.icon,
                      clr.pattern, clr.match_type, clr.priority, clr.enabled
               FROM chapter_label_rules clr
               JOIN chapter_types ct ON clr.chapter_type_id = ct.id
               ORDER BY clr.priority DESC, clr.id"#,
        )?;
        let rules = stmt.query_map([], |row| {
            Ok(models::ChapterLabelRule {
                id: row.get(0)?,
                chapter_type_id: row.get(1)?,
                chapter_type_name: row.get(2)?,
                chapter_type_color: row.get(3)?,
                chapter_type_icon: row.get(4)?,
                pattern: row.get(5)?,
                match_type: row.get(6)?,
                priority: row.get(7)?,
                enabled: row.get::<_, i32>(8)? != 0,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(rules)
    }

    pub fn save_chapter_label_rule(
        &self, id: Option<i64>, chapter_type_id: i64, pattern: &str,
        match_type: &str, priority: i32, enabled: bool,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        if let Some(rule_id) = id {
            conn.execute(
                "UPDATE chapter_label_rules SET chapter_type_id=?1, pattern=?2, match_type=?3, priority=?4, enabled=?5 WHERE id=?6",
                params![chapter_type_id, pattern, match_type, priority, enabled as i32, rule_id],
            )?;
            Ok(rule_id)
        } else {
            conn.execute(
                "INSERT INTO chapter_label_rules (chapter_type_id, pattern, match_type, priority, enabled) VALUES (?1,?2,?3,?4,?5)",
                params![chapter_type_id, pattern, match_type, priority, enabled as i32],
            )?;
            Ok(conn.last_insert_rowid())
        }
    }

    pub fn delete_chapter_label_rule(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM chapter_label_rules WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Get raw transcript segments for an episode (for auto-labeling)
    pub fn get_transcript_segments_for_episode(&self, episode_id: i64) -> Result<Vec<(i32, String, f64)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT segment_idx, text, start_time FROM transcript_segments WHERE episode_id = ?1 ORDER BY segment_idx",
        )?;
        let rows = stmt.query_map([episode_id], |row| {
            Ok((row.get::<_, i32>(0)?, row.get::<_, String>(1)?, row.get::<_, f64>(2)?))
        })?.filter_map(|r| r.ok()).collect();
        Ok(rows)
    }

    /// Get transcript segments with timing info (for AI chapter detection)
    pub fn get_transcript_segments_for_episode_full(
        &self,
        episode_id: i64,
    ) -> Result<Vec<(i32, String, f64, Option<f64>)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT segment_idx, text, start_time, end_time FROM transcript_segments WHERE episode_id = ?1 ORDER BY segment_idx",
        )?;
        let rows = stmt.query_map([episode_id], |row| {
            Ok((
                row.get::<_, i32>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?,
                row.get::<_, Option<f64>>(3)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();
        Ok(rows)
    }

    // =========================================================================
    // Characters
    // =========================================================================

    pub fn get_characters(&self) -> Result<Vec<models::Character>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT c.id, c.name, c.short_name, c.description, c.catchphrase,
                      c.first_episode_id, e.title, c.image_url,
                      c.speaker_id, s.name,
                      (SELECT COUNT(*) FROM character_appearances WHERE character_id = c.id) as appearance_count
               FROM characters c
               LEFT JOIN episodes e ON c.first_episode_id = e.id
               LEFT JOIN speakers s ON c.speaker_id = s.id
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
                speaker_id: row.get(8)?,
                speaker_name: row.get(9)?,
                appearance_count: row.get(10)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(chars)
    }

    pub fn create_character(&self, name: &str, short_name: Option<&str>, description: Option<&str>, catchphrase: Option<&str>, speaker_id: Option<i64>) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO characters (name, short_name, description, catchphrase, speaker_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![name, short_name, description, catchphrase, speaker_id]
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_character(&self, id: i64, name: &str, short_name: Option<&str>, description: Option<&str>, catchphrase: Option<&str>, speaker_id: Option<i64>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE characters SET name = ?1, short_name = ?2, description = ?3, catchphrase = ?4, speaker_id = ?5 WHERE id = ?6",
            params![name, short_name, description, catchphrase, speaker_id, id]
        )?;
        Ok(())
    }

    pub fn delete_character(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM characters WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn get_character_speaker_name(&self, character_id: i64) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let name: Option<String> = conn.query_row(
            "SELECT s.name FROM characters c LEFT JOIN speakers s ON c.speaker_id = s.id WHERE c.id = ?1",
            [character_id],
            |row| row.get(0),
        ).ok();
        Ok(name)
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

    /// Read the transcript file for an episode, resolve speaker labels to names,
    /// and update the FTS5 search index.  Called automatically after the pipeline
    /// finishes an episode and whenever speaker names or segment text are edited.
    pub fn index_episode_from_file(&self, episode_id: i64) -> Result<usize> {
        // 1. Find the transcript path from the database
        let transcript_path = {
            let conn = self.conn.lock().unwrap();
            let path: Option<String> = conn.query_row(
                "SELECT transcript_path FROM episodes WHERE id = ?1",
                params![episode_id],
                |row| row.get(0),
            )?;
            path
        };

        let base_path = match transcript_path {
            Some(p) => std::path::PathBuf::from(p),
            None => return Ok(0), // No transcript path recorded yet
        };

        // 2. Prefer the _with_speakers.json variant if it exists
        let with_speakers_path = {
            let stem = base_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default();
            let parent = base_path.parent().unwrap_or(std::path::Path::new("."));
            // The base JSON has the same name without "_with_speakers" suffix;
            // the diarized file appends "_with_speakers" before the extension.
            let candidate = if stem.ends_with("_with_speakers") {
                base_path.clone()
            } else {
                parent.join(format!("{}_with_speakers.json", stem))
            };
            candidate
        };

        let read_path = if with_speakers_path.exists() {
            with_speakers_path
        } else if base_path.exists() {
            base_path
        } else {
            return Ok(0); // File not present on disk yet
        };

        let content = std::fs::read_to_string(&read_path)?;

        // 3. Parse segments from JSON (supports both faster-whisper and whisper-cli formats)
        let mut segments = match parse_transcript_segments_from_str(&content) {
            Some(s) if !s.is_empty() => s,
            _ => return Ok(0),
        };

        // 4. Resolve SPEAKER_XX labels → human names using episode_speakers table
        let assignments = self.get_episode_speaker_assignments(episode_id)?;
        if !assignments.is_empty() {
            // Build a lookup: "SPEAKER_00" → "Matt Donnelly"
            let label_to_name: std::collections::HashMap<String, String> = assignments
                .into_iter()
                .filter_map(|a| a.speaker_name.map(|name| (a.diarization_label, name)))
                .collect();

            for seg in &mut segments {
                if let Some(ref label) = seg.speaker.clone() {
                    if let Some(name) = label_to_name.get(label) {
                        seg.speaker = Some(name.clone());
                    }
                }
            }
        }

        let count = segments.len();
        self.index_transcript_segments(episode_id, &segments)?;

        log::info!(
            "Auto-indexed {} segments for episode {} from {:?}",
            count,
            episode_id,
            read_path.file_name().unwrap_or_default()
        );

        Ok(count)
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
    /// Return (id, title) for every transcribed episode — used by the
    /// "reindex with speakers" backfill command.
    pub fn get_all_transcribed_episode_ids(&self) -> Result<Vec<(i64, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title FROM episodes
             WHERE is_transcribed = 1 AND transcript_path IS NOT NULL
             ORDER BY published_date DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?.filter_map(|r| r.ok()).collect();
        Ok(rows)
    }

    pub fn get_unindexed_episodes(&self) -> Result<Vec<Episode>> {
        let conn = self.conn.lock().unwrap();
        let sql = r#"
            SELECT e.id, e.episode_number, e.title, e.description, e.audio_url, e.audio_file_path,
                   e.duration, e.file_size, e.published_date, e.added_date, e.downloaded_date,
                   e.transcribed_date, e.is_downloaded, e.is_transcribed, e.is_in_queue,
                   e.transcript_path, e.transcription_status, e.transcription_error,
                   e.processing_time, e.feed_source, e.metadata_json, e.has_diarization, e.num_speakers,
                   e.category, e.category_number, e.sub_series, e.canonical_id,
                   e.download_duration, e.transcribe_duration, e.diarize_duration, e.diarized_date
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
                category: row.get(23)?,
                category_number: row.get(24)?,
                sub_series: row.get(25)?,
                canonical_id: row.get(26)?,
                download_duration: row.get(27)?,
                transcribe_duration: row.get(28)?,
                diarize_duration: row.get(29)?,
                diarized_date: row.get(30)?,
            })
        })?.filter_map(|r| r.ok()).collect();

        Ok(episodes)
    }

    // =========================================================================
    // Pipeline Error Log
    // =========================================================================

    pub fn log_pipeline_error(
        &self,
        context: &str,
        episode_id: Option<i64>,
        error_kind: &str,
        error_detail: &str,
        retry_count: i32,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO pipeline_errors (context, episode_id, error_kind, error_detail, retry_count)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![context, episode_id, error_kind, error_detail, retry_count],
        )?;
        Ok(())
    }

    /// Mark all unresolved errors for an episode as resolved (called on success)
    pub fn mark_pipeline_errors_resolved(&self, episode_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE pipeline_errors SET resolved = 1 WHERE episode_id = ?1 AND resolved = 0",
            [episode_id],
        )?;
        Ok(())
    }

    pub fn get_recent_pipeline_errors(&self, limit: i64) -> Result<Vec<models::PipelineError>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT pe.id, pe.occurred_at, pe.context, pe.episode_id, pe.error_kind,
                      pe.error_detail, pe.retry_count, pe.resolved, e.title
               FROM pipeline_errors pe
               LEFT JOIN episodes e ON pe.episode_id = e.id
               ORDER BY pe.occurred_at DESC
               LIMIT ?1"#,
        )?;
        let rows = stmt.query_map([limit], |row| {
            Ok(models::PipelineError {
                id: row.get(0)?,
                occurred_at: row.get(1)?,
                context: row.get(2)?,
                episode_id: row.get(3)?,
                error_kind: row.get(4)?,
                error_detail: row.get(5)?,
                retry_count: row.get(6)?,
                resolved: row.get::<_, i32>(7)? == 1,
                episode_title: row.get(8)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(rows)
    }

    pub fn get_pipeline_health_stats(&self) -> Result<models::PipelineHealth> {
        let conn = self.conn.lock().unwrap();

        // Success rate: among the last 50 terminal-state episodes, how many completed?
        let success_rate_last_50: f32 = conn.query_row(
            r#"SELECT CAST(SUM(CASE WHEN transcription_status = 'completed' THEN 1 ELSE 0 END) AS REAL)
                    / NULLIF(COUNT(*), 0)
               FROM (SELECT transcription_status FROM episodes
                     WHERE transcription_status IN ('completed','failed')
                     ORDER BY transcribed_date DESC NULLS LAST LIMIT 50)"#,
            [],
            |row| row.get::<_, Option<f64>>(0),
        )?.unwrap_or(1.0) as f32;

        // Average transcription time (last 50 timed)
        let avg_transcribe_seconds: f32 = conn.query_row(
            "SELECT COALESCE(AVG(transcribe_duration), 0) FROM
             (SELECT transcribe_duration FROM episodes
              WHERE transcribe_duration IS NOT NULL ORDER BY transcribed_date DESC NULLS LAST LIMIT 50)",
            [],
            |row| row.get::<_, f64>(0),
        )? as f32;

        // Episodes remaining in queue
        let episodes_remaining: i64 = conn.query_row(
            "SELECT COUNT(*) FROM transcription_queue WHERE status IN ('pending','processing')",
            [],
            |row| row.get(0),
        )?;

        // Rate: episodes processed in last 7 days
        let recent_rate: f64 = conn.query_row(
            "SELECT COUNT(*) FROM episodes
             WHERE transcription_status = 'completed'
               AND transcribed_date >= datetime('now', '-7 days')",
            [],
            |row| row.get::<_, f64>(0),
        )?;
        let per_day = recent_rate / 7.0;
        let estimated_completion_days: f32 = if per_day > 0.0 {
            (episodes_remaining as f64 / per_day) as f32
        } else {
            f32::INFINITY
        };

        // Errors in last 24h
        let failed_last_24h: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pipeline_errors
             WHERE occurred_at >= datetime('now', '-24 hours') AND resolved = 0",
            [],
            |row| row.get(0),
        )?;

        // Unresolved errors total
        let unresolved_errors: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pipeline_errors WHERE resolved = 0",
            [],
            |row| row.get(0),
        )?;

        Ok(models::PipelineHealth {
            success_rate_last_50,
            avg_transcribe_seconds,
            episodes_remaining,
            estimated_completion_days,
            failed_last_24h,
            unresolved_errors,
        })
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
                   system_prompt = ?5, output_schema = ?6, is_active = ?7, updated_at = datetime('now', 'localtime')
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
               VALUES (?1, ?2, 'running', ?3, datetime('now', 'localtime'))"#,
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
                   items_extracted = ?3, duration_ms = ?4, completed_at = datetime('now', 'localtime')
               WHERE id = ?5"#,
            params![raw_response, parsed_json, items_extracted, duration_ms, run_id]
        )?;

        // Update prompt stats
        conn.execute(
            r#"UPDATE extraction_prompts
               SET run_count = run_count + 1, last_run_at = datetime('now', 'localtime')
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
               SET status = 'failed', error_message = ?1, duration_ms = ?2, completed_at = datetime('now', 'localtime')
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

    /// Mark speaker-correction flags as resolved after successful re-diarization
    pub fn resolve_speaker_flags_for_episode(&self, episode_id: i64) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE flagged_segments SET resolved = 1 \
             WHERE episode_id = ?1 AND flag_type IN ('wrong_speaker', 'multiple_speakers', 'character_voice') AND resolved = 0",
            [episode_id],
        )?;
        Ok(n)
    }

    /// Get unresolved speaker-related flags for an episode (wrong_speaker + multiple_speakers)
    pub fn get_unresolved_speaker_flags(&self, episode_id: i64) -> Result<Vec<models::FlaggedSegment>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT fs.id, fs.episode_id, fs.segment_idx, fs.flag_type,
                      fs.corrected_speaker, fs.character_id, c.name, fs.notes, fs.speaker_ids, fs.resolved, fs.created_at
               FROM flagged_segments fs
               LEFT JOIN characters c ON fs.character_id = c.id
               WHERE fs.episode_id = ?1 AND fs.flag_type IN ('wrong_speaker', 'multiple_speakers', 'character_voice') AND fs.resolved = 0
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

    /// Get character appearances for a character across episodes
    pub fn get_character_appearances_for_character(&self, character_id: i64) -> Result<Vec<models::CharacterAppearance>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT ca.id, ca.character_id, c.name, ca.episode_id, e.title,
                      ca.start_time, ca.end_time, ca.segment_idx, ca.notes
               FROM character_appearances ca
               JOIN characters c ON ca.character_id = c.id
               JOIN episodes e ON ca.episode_id = e.id
               WHERE ca.character_id = ?1
               ORDER BY e.episode_number DESC, ca.start_time NULLS LAST, ca.segment_idx NULLS LAST"#
        )?;
        let appearances = stmt.query_map([character_id], |row| {
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
            "SELECT id, name, transcript_text, description, category, created_at, reference_audio_path, COALESCE(min_window, 1), COALESCE(max_window, 4) FROM audio_drops ORDER BY name"
        )?;
        let drops = stmt.query_map([], |row| {
            Ok(models::AudioDrop {
                id: row.get(0)?,
                name: row.get(1)?,
                transcript_text: row.get(2)?,
                description: row.get(3)?,
                category: row.get(4)?,
                created_at: row.get(5)?,
                reference_audio_path: row.get(6)?,
                min_window: row.get(7)?,
                max_window: row.get(8)?,
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

    pub fn update_audio_drop_transcript(&self, drop_id: i64, text: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE audio_drops SET transcript_text = ?1 WHERE id = ?2",
            params![text, drop_id],
        )?;
        Ok(())
    }

    pub fn update_audio_drop_window(&self, drop_id: i64, min_window: i64, max_window: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE audio_drops SET min_window = ?1, max_window = ?2 WHERE id = ?3",
            params![min_window, max_window, drop_id],
        )?;
        Ok(())
    }

    pub fn update_audio_drop_reference(&self, drop_id: i64, path: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE audio_drops SET reference_audio_path = ?1 WHERE id = ?2",
            params![path, drop_id],
        )?;
        Ok(())
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

    // -------------------------------------------------------------------------
    // Subagent support queries
    // -------------------------------------------------------------------------

    /// Count completed+diarized episodes that still have raw SPEAKER_XX labels
    /// in transcript_segments (i.e., speaker names were never saved).
    pub fn count_unresolved_speaker_labels(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT ts.episode_id)
             FROM transcript_segments ts
             JOIN episodes e ON e.id = ts.episode_id
             WHERE e.status = 'completed'
               AND e.has_diarization = 1
               AND ts.speaker LIKE 'SPEAKER_%'",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Count completed episodes with zero FTS-indexed segments.
    pub fn count_unindexed_completed_episodes(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*)
             FROM episodes e
             WHERE e.status = 'completed'
               AND NOT EXISTS (
                   SELECT 1 FROM transcript_segments ts WHERE ts.episode_id = e.id
               )",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Return episode IDs for completed episodes that have no extraction_runs record.
    pub fn get_unextracted_episode_ids(&self, limit: i64) -> Result<Vec<i64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT e.id FROM episodes e
             WHERE e.status = 'completed'
               AND NOT EXISTS (
                   SELECT 1 FROM extraction_runs er WHERE er.episode_id = e.id
               )
             ORDER BY e.id DESC
             LIMIT ?1",
        )?;
        let ids = stmt
            .query_map([limit], |row| row.get(0))?
            .collect::<std::result::Result<Vec<i64>, _>>()?;
        Ok(ids)
    }

    /// Return episode IDs that have unresolved speaker-related flags but no
    /// hints file on disk (so hints_prefetch_agent can pre-generate them).
    pub fn get_episodes_with_unresolved_speaker_flags(&self) -> Result<Vec<i64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT episode_id FROM flagged_segments
             WHERE flag_type IN ('wrong_speaker', 'multiple_speakers', 'character_voice')
               AND resolved = 0
             ORDER BY episode_id",
        )?;
        let ids = stmt
            .query_map([], |row| row.get(0))?
            .collect::<std::result::Result<Vec<i64>, _>>()?;
        Ok(ids)
    }

    /// Get just the audio_file_path for an episode (for subprocess calls).
    pub fn get_episode_audio_path(&self, episode_id: i64) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let path = conn.query_row(
            "SELECT audio_file_path FROM episodes WHERE id = ?1",
            [episode_id],
            |row| row.get(0),
        ).optional()?;
        Ok(path)
    }

    /// Get the published_date for an episode (first 10 chars = YYYY-MM-DD).
    pub fn get_episode_published_date(&self, episode_id: i64) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let date: Option<String> = conn.query_row(
            "SELECT SUBSTR(published_date, 1, 10) FROM episodes WHERE id = ?1",
            [episode_id],
            |row| row.get(0),
        ).optional()?;
        Ok(date)
    }

    /// Get start_time, end_time, and text for a segment.
    /// Returns None if the segment doesn't exist.
    pub fn get_segment_times(
        &self,
        episode_id: i64,
        segment_idx: i64,
    ) -> Result<Option<(f64, f64, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT start_time, end_time, text FROM transcript_segments WHERE episode_id = ?1 AND segment_idx = ?2",
            params![episode_id, segment_idx],
            |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?, row.get::<_, Option<String>>(2)?)),
        ).optional()?;
        Ok(result)
    }

    // =========================================================================
    // Segment Classifications (Qwen audio analysis)
    // =========================================================================

    /// Save a batch of classification results (all pending, approved=0).
    /// Replaces any existing pending classification for the same (episode_id, segment_idx).
    pub fn save_segment_classifications(
        &self,
        episode_id: i64,
        results: &[serde_json::Value],
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        for result in results {
            let segment_idx = result.get("segment_idx").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            let is_performance_bit = result.get("is_performance_bit").and_then(|v| v.as_bool()).unwrap_or(false) as i32;
            let character_name = result.get("character_name").and_then(|v| v.as_str()).map(|s| s.to_string());
            let speaker_note = result.get("speaker_note").and_then(|v| v.as_str()).map(|s| s.to_string());
            let tone_description = result.get("tone_description").and_then(|v| v.as_str()).map(|s| s.to_string());
            let confidence = result.get("confidence").and_then(|v| v.as_f64());

            // Try to resolve character_id from name
            let character_id: Option<i64> = if let Some(ref name) = character_name {
                conn.query_row(
                    "SELECT id FROM characters WHERE LOWER(name) = LOWER(?1) LIMIT 1",
                    params![name],
                    |row| row.get(0),
                ).optional().unwrap_or(None)
            } else {
                None
            };

            // Delete existing pending classification for this segment (replace strategy)
            conn.execute(
                "DELETE FROM segment_classifications WHERE episode_id = ?1 AND segment_idx = ?2 AND approved = 0",
                params![episode_id, segment_idx],
            )?;

            conn.execute(
                "INSERT INTO segment_classifications
                 (episode_id, segment_idx, classifier, is_performance_bit, character_name, character_id,
                  speaker_note, tone_description, confidence, approved, created_at)
                 VALUES (?1, ?2, 'qwen_omni', ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)",
                params![
                    episode_id, segment_idx, is_performance_bit,
                    character_name, character_id,
                    speaker_note, tone_description, confidence,
                    now,
                ],
            )?;
        }

        Ok(())
    }

    /// Get all segment classifications for an episode (with joined segment text/timing).
    pub fn get_segment_classifications(
        &self,
        episode_id: i64,
    ) -> Result<Vec<models::SegmentClassification>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT sc.id, sc.episode_id, sc.segment_idx, sc.classifier,
                    sc.is_performance_bit, sc.character_name, sc.character_id,
                    sc.speaker_note, sc.tone_description, sc.confidence,
                    sc.approved, sc.created_at,
                    ts.text, ts.start_time
             FROM segment_classifications sc
             LEFT JOIN transcript_segments ts
               ON ts.episode_id = sc.episode_id AND ts.segment_idx = sc.segment_idx
             WHERE sc.episode_id = ?1
             ORDER BY sc.segment_idx ASC",
        )?;
        let rows = stmt.query_map([episode_id], |row| {
            Ok(models::SegmentClassification {
                id: row.get(0)?,
                episode_id: row.get(1)?,
                segment_idx: row.get(2)?,
                classifier: row.get(3)?,
                is_performance_bit: {
                    let v: i32 = row.get(4)?;
                    v != 0
                },
                character_name: row.get(5)?,
                character_id: row.get(6)?,
                speaker_note: row.get(7)?,
                tone_description: row.get(8)?,
                confidence: row.get(9)?,
                approved: row.get(10)?,
                created_at: row.get(11)?,
                segment_text: row.get(12)?,
                segment_start_time: row.get(13)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Approve a classification: set approved=1, write is_performance_bit to
    /// transcript_segments, and optionally create a character_appearances entry.
    pub fn approve_segment_classification(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        // Fetch the classification
        let (episode_id, segment_idx, is_performance_bit, character_id, start_time_opt): (i64, i32, i32, Option<i64>, Option<f64>) =
            conn.query_row(
                "SELECT sc.episode_id, sc.segment_idx, sc.is_performance_bit, sc.character_id,
                        ts.start_time
                 FROM segment_classifications sc
                 LEFT JOIN transcript_segments ts
                   ON ts.episode_id = sc.episode_id AND ts.segment_idx = sc.segment_idx
                 WHERE sc.id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )?;

        // Mark approved
        conn.execute(
            "UPDATE segment_classifications SET approved = 1 WHERE id = ?1",
            [id],
        )?;

        // Write is_performance_bit to transcript_segments
        if is_performance_bit != 0 {
            conn.execute(
                "UPDATE transcript_segments SET is_performance_bit = 1
                 WHERE episode_id = ?1 AND segment_idx = ?2",
                params![episode_id, segment_idx],
            )?;
        }

        // Create character_appearance if character matched
        if let Some(char_id) = character_id {
            conn.execute(
                "INSERT OR IGNORE INTO character_appearances
                 (character_id, episode_id, start_time, segment_idx, notes)
                 VALUES (?1, ?2, ?3, ?4, 'Auto-detected by Qwen classification')",
                params![char_id, episode_id, start_time_opt, segment_idx],
            )?;
        }

        Ok(())
    }

    /// Reject a classification: set approved=-1, no writes to segments.
    pub fn reject_segment_classification(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE segment_classifications SET approved = -1 WHERE id = ?1",
            [id],
        )?;
        Ok(())
    }

    // =========================================================================
    // Transcript Corrections (Scoop Polish)
    // =========================================================================

    /// Save a batch of polish results (all pending, approved=0).
    /// Replaces any existing pending correction for the same (episode_id, segment_idx).
    pub fn save_transcript_corrections(
        &self,
        episode_id: i64,
        results: &[serde_json::Value],
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        for result in results {
            let segment_idx = result.get("segment_idx").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            let original_text = result.get("original_text").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let corrected_text = result.get("corrected_text").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let has_multiple = result.get("has_multiple_speakers").and_then(|v| v.as_bool()).unwrap_or(false) as i32;
            let speaker_change_note = result.get("speaker_change_note").and_then(|v| v.as_str()).map(|s| s.to_string());
            let confidence = result.get("confidence").and_then(|v| v.as_f64());

            // Replace existing pending correction for this segment
            conn.execute(
                "DELETE FROM transcript_corrections WHERE episode_id = ?1 AND segment_idx = ?2 AND approved = 0",
                params![episode_id, segment_idx],
            )?;

            conn.execute(
                "INSERT INTO transcript_corrections
                 (episode_id, segment_idx, original_text, corrected_text,
                  has_multiple_speakers, speaker_change_note, confidence, approved, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)",
                params![
                    episode_id, segment_idx, original_text, corrected_text,
                    has_multiple, speaker_change_note, confidence, now,
                ],
            )?;
        }

        Ok(())
    }

    /// Get all transcript corrections for an episode (with joined segment timing).
    pub fn get_transcript_corrections(
        &self,
        episode_id: i64,
    ) -> Result<Vec<models::TranscriptCorrection>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT tc.id, tc.episode_id, tc.segment_idx,
                    tc.original_text, tc.corrected_text,
                    tc.has_multiple_speakers, tc.speaker_change_note,
                    tc.confidence, tc.approved, tc.created_at,
                    ts.start_time
             FROM transcript_corrections tc
             LEFT JOIN transcript_segments ts
               ON ts.episode_id = tc.episode_id AND ts.segment_idx = tc.segment_idx
             WHERE tc.episode_id = ?1
             ORDER BY tc.segment_idx ASC",
        )?;
        let rows = stmt.query_map([episode_id], |row| {
            Ok(models::TranscriptCorrection {
                id: row.get(0)?,
                episode_id: row.get(1)?,
                segment_idx: row.get(2)?,
                original_text: row.get(3)?,
                corrected_text: row.get(4)?,
                has_multiple_speakers: {
                    let v: i32 = row.get(5)?;
                    v != 0
                },
                speaker_change_note: row.get(6)?,
                confidence: row.get(7)?,
                approved: row.get(8)?,
                created_at: row.get(9)?,
                segment_start_time: row.get(10)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Approve a correction: set approved=1.
    /// The caller is responsible for also calling save_transcript_edits to write the text.
    pub fn approve_transcript_correction(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE transcript_corrections SET approved = 1 WHERE id = ?1",
            [id],
        )?;
        Ok(())
    }

    /// Reject a correction: set approved=-1.
    pub fn reject_transcript_correction(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE transcript_corrections SET approved = -1 WHERE id = ?1",
            [id],
        )?;
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
    pub is_guest: bool,
    pub is_scoop: bool,
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
    pub diarized_episodes: i64,
    pub in_queue: i64,
    pub in_transcription_queue: i64,
    pub in_diarization_queue: i64,
    pub failed: i64,
    pub completion_rate: CompletionRate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineTimingStats {
    pub avg_download_seconds: f64,
    pub avg_transcribe_seconds: f64,
    pub avg_diarize_seconds: f64,
    pub avg_total_seconds: f64,
    pub avg_transcribe_per_hour_audio: f64,
    pub total_hours_processed: f64,
    pub episodes_timed: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletedEpisodeTiming {
    pub id: i64,
    pub title: String,
    pub episode_number: Option<String>,
    pub audio_duration: Option<f64>,
    pub download_duration: Option<f64>,
    pub transcribe_duration: Option<f64>,
    pub diarize_duration: Option<f64>,
    pub total_duration: Option<f64>,
    pub completed_date: Option<String>,
    pub transcription_model_used: Option<String>,
    pub embedding_backend_used: Option<String>,
    pub last_queue_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineStatsResponse {
    pub timing: PipelineTimingStats,
    pub recent: Vec<CompletedEpisodeTiming>,
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
    // Segment indices marked as voice samples
    pub marked_samples: Option<Vec<i32>>,
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

// ============================================================================
// Module-level helpers used by index_episode_from_file
// ============================================================================

/// Parse segments from raw transcript JSON.  Handles:
/// - faster-whisper / diarized format: `{ "segments": [ { "start", "end", "text", "speaker" } ] }`
/// - whisper-cli format: `{ "transcription": [ { "text", "timestamps": { "from", "to" } } ] }`
fn parse_transcript_segments_from_str(content: &str) -> Option<Vec<TranscriptSegment>> {
    let json: serde_json::Value = serde_json::from_str(content).ok()?;

    // Try "segments" array (faster-whisper / diarized JSON)
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
                Some(TranscriptSegment { speaker, text, start_time, end_time })
            })
            .collect();
        if !result.is_empty() {
            return Some(result);
        }
    }

    // Try "transcription" array (whisper-cli JSON)
    if let Some(transcription) = json.get("transcription").and_then(|v| v.as_array()) {
        let result: Vec<TranscriptSegment> = transcription
            .iter()
            .filter_map(|seg| {
                let text = seg.get("text").and_then(|t| t.as_str())?.trim().to_string();
                if text.is_empty() {
                    return None;
                }
                let start_time = seg.get("timestamps").and_then(|t| t.get("from")).and_then(|v| v.as_str())
                    .and_then(|s| parse_ts(s))
                    .or_else(|| seg.get("offsets").and_then(|o| o.get("from")).and_then(|v| v.as_f64()).map(|ms| ms / 1000.0))?;
                let end_time = seg.get("timestamps").and_then(|t| t.get("to")).and_then(|v| v.as_str())
                    .and_then(|s| parse_ts(s))
                    .or_else(|| seg.get("offsets").and_then(|o| o.get("to")).and_then(|v| v.as_f64()).map(|ms| ms / 1000.0));
                let speaker = seg.get("speaker").and_then(|s| s.as_str()).map(|s| s.to_string());
                Some(TranscriptSegment { speaker, text, start_time, end_time })
            })
            .collect();
        if !result.is_empty() {
            return Some(result);
        }
    }

    None
}

/// Parse "HH:MM:SS.mmm", "HH:MM:SS,mmm" (SRT-style), or "MM:SS.mmm" timestamp to seconds
fn parse_ts(s: &str) -> Option<f64> {
    // Normalise SRT-style comma decimal separator to period
    let normalised = s.replace(',', ".");
    let parts: Vec<&str> = normalised.split(':').collect();
    match parts.len() {
        3 => {
            let h: f64 = parts[0].parse().ok()?;
            let m: f64 = parts[1].parse().ok()?;
            let sec: f64 = parts[2].parse().ok()?;
            Some(h * 3600.0 + m * 60.0 + sec)
        }
        2 => {
            let m: f64 = parts[0].parse().ok()?;
            let sec: f64 = parts[1].parse().ok()?;
            Some(m * 60.0 + sec)
        }
        _ => None,
    }
}
unsafe impl Sync for Database {}
