use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptionStatus {
    Pending,
    Queued,
    Processing,
    Completed,
    Failed,
    Stopped,
}

impl Default for TranscriptionStatus {
    fn default() -> Self {
        Self::Pending
    }
}

impl std::fmt::Display for TranscriptionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Pending => write!(f, "pending"),
            Self::Queued => write!(f, "queued"),
            Self::Processing => write!(f, "processing"),
            Self::Completed => write!(f, "completed"),
            Self::Failed => write!(f, "failed"),
            Self::Stopped => write!(f, "stopped"),
        }
    }
}

impl From<String> for TranscriptionStatus {
    fn from(s: String) -> Self {
        match s.as_str() {
            "pending" => Self::Pending,
            "queued" => Self::Queued,
            "processing" => Self::Processing,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "stopped" => Self::Stopped,
            _ => Self::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Episode {
    pub id: i64,
    pub episode_number: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub audio_url: String,
    pub audio_file_path: Option<String>,
    pub duration: Option<f64>,
    pub file_size: Option<i64>,
    pub published_date: Option<String>,
    pub added_date: String,
    pub downloaded_date: Option<String>,
    pub transcribed_date: Option<String>,
    pub is_downloaded: bool,
    pub is_transcribed: bool,
    pub is_in_queue: bool,
    pub transcript_path: Option<String>,
    pub transcription_status: TranscriptionStatus,
    pub transcription_error: Option<String>,
    pub processing_time: Option<f64>,
    pub feed_source: String,
    pub metadata_json: Option<String>,
    pub has_diarization: bool,
    pub num_speakers: Option<i32>,
    pub category: Option<String>,
    pub category_number: Option<String>,
    pub sub_series: Option<String>,
    pub canonical_id: Option<i64>,
    pub download_duration: Option<f64>,
    pub transcribe_duration: Option<f64>,
    pub diarize_duration: Option<f64>,
    pub diarized_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeSummary {
    pub id: i64,
    pub title: String,
    pub duration: Option<f64>,
    pub episode_number: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transcript {
    pub id: i64,
    pub episode_id: i64,
    pub full_text: String,
    pub segments_json: Option<String>,
    pub language: String,
    pub language_probability: Option<f64>,
    pub model_used: Option<String>,
    pub created_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionQueueItem {
    pub id: i64,
    pub episode_id: i64,
    pub added_to_queue_date: String,
    pub priority: i32,
    pub retry_count: Option<i32>,
    pub status: String,
    pub started_date: Option<String>,
    pub completed_date: Option<String>,
    pub error_message: Option<String>,
    pub queue_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueItemWithEpisode {
    pub queue_item: TranscriptionQueueItem,
    pub episode: Episode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedSource {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub enabled: bool,
}

// ============================================================================
// Category Rules (data-driven episode categorization)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryRule {
    pub id: i64,
    pub category: String,
    pub display_name: String,
    pub title_pattern: String,
    pub number_pattern: Option<String>,
    pub priority: i32,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub keywords: Option<String>,
}

// ============================================================================
// Chapter Types and Episode Chapters
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterType {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub color: String,
    pub icon: Option<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeChapter {
    pub id: i64,
    pub episode_id: i64,
    pub chapter_type_id: i64,
    pub chapter_type_name: Option<String>,
    pub chapter_type_color: Option<String>,
    pub chapter_type_icon: Option<String>,
    pub title: Option<String>,
    pub start_time: f64,
    pub end_time: Option<f64>,
    pub start_segment_idx: Option<i32>,
    pub end_segment_idx: Option<i32>,
    pub notes: Option<String>,
}

// ============================================================================
// ICS Characters
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Character {
    pub id: i64,
    pub name: String,
    pub short_name: Option<String>,
    pub description: Option<String>,
    pub catchphrase: Option<String>,
    pub first_episode_id: Option<i64>,
    pub first_episode_title: Option<String>,
    pub image_url: Option<String>,
    pub appearance_count: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterAppearance {
    pub id: i64,
    pub character_id: i64,
    pub character_name: Option<String>,
    pub episode_id: i64,
    pub episode_title: Option<String>,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    pub segment_idx: Option<i32>,
    pub notes: Option<String>,
}

// ============================================================================
// Sponsors (Fake Commercials)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sponsor {
    pub id: i64,
    pub name: String,
    pub tagline: Option<String>,
    pub description: Option<String>,
    pub is_real: bool,
    pub first_episode_id: Option<i64>,
    pub first_episode_title: Option<String>,
    pub image_url: Option<String>,
    pub mention_count: Option<i32>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SponsorMention {
    pub id: i64,
    pub sponsor_id: i64,
    pub sponsor_name: Option<String>,
    pub episode_id: i64,
    pub episode_title: Option<String>,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    pub segment_idx: Option<i32>,
    pub notes: Option<String>,
}

// ============================================================================
// Audio Drops (pre-recorded sound bites)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDrop {
    pub id: i64,
    pub name: String,
    pub transcript_text: Option<String>,
    pub description: Option<String>,
    pub category: String,
    pub created_at: Option<String>,
    pub reference_audio_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDropInstance {
    pub id: i64,
    pub audio_drop_id: i64,
    pub audio_drop_name: String,
    pub episode_id: i64,
    pub segment_idx: Option<i32>,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    pub notes: Option<String>,
    pub created_at: Option<String>,
}

// ============================================================================
// Wiki Lore (Fandom wiki integration)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WikiLore {
    pub id: i64,
    pub name: String,
    pub category: String,
    pub description: Option<String>,
    pub wiki_url: Option<String>,
    pub wiki_page_id: Option<i64>,
    pub first_episode_id: Option<i64>,
    pub aliases: Option<String>,
    pub last_synced: Option<String>,
    pub is_wiki_sourced: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WikiEpisodeMeta {
    pub id: i64,
    pub episode_id: i64,
    pub wiki_page_id: Option<i64>,
    pub wiki_url: Option<String>,
    pub summary: Option<String>,
    pub recording_location: Option<String>,
    pub air_date: Option<String>,
    pub topics_json: Option<String>,
    pub guests_json: Option<String>,
    pub bits_json: Option<String>,
    pub scoopmail_json: Option<String>,
    pub jock_vs_nerd: Option<String>,
    pub last_synced: Option<String>,
}

// ============================================================================
// Episode Speaker Assignments (unified speaker/drop assignments)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeSpeakerAssignment {
    pub id: i64,
    pub episode_id: i64,
    pub diarization_label: String,
    pub speaker_id: Option<i64>,
    pub speaker_name: Option<String>,
    pub audio_drop_id: Option<i64>,
    pub audio_drop_name: Option<String>,
    pub speaking_time_seconds: Option<f64>,
    pub segment_count: Option<i32>,
}

// ============================================================================
// Voice Samples (saved audio clips for speaker identification)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceSampleRecord {
    pub id: i64,
    pub speaker_name: String,
    pub episode_id: Option<i64>,
    pub segment_idx: Option<i64>,
    pub start_time: f64,
    pub end_time: f64,
    pub transcript_text: Option<String>,
    pub file_path: String,
    pub rating: i32,
    pub created_at: Option<String>,
    // Joined fields:
    pub episode_title: Option<String>,
}

// ============================================================================
// Flagged Segments (for review workflow)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlaggedSegment {
    pub id: i64,
    pub episode_id: i64,
    pub segment_idx: i32,
    pub flag_type: String,  // 'wrong_speaker', 'character_voice', 'multiple_speakers', 'audio_issue', 'other'
    pub corrected_speaker: Option<String>,  // For wrong_speaker flags
    pub character_id: Option<i64>,  // For character_voice flags
    pub character_name: Option<String>,  // Joined from characters table
    pub notes: Option<String>,
    pub speaker_ids: Option<String>,  // JSON array: ["SPEAKER_00","SPEAKER_01"]
    pub resolved: bool,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineError {
    pub id: i64,
    pub occurred_at: String,
    pub context: String,       // "download" | "transcribe" | "diarize"
    pub episode_id: Option<i64>,
    pub error_kind: String,
    pub error_detail: String,
    pub retry_count: i32,
    pub resolved: bool,
    pub episode_title: Option<String>,  // joined from episodes
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineHealth {
    pub success_rate_last_50: f32,
    pub avg_transcribe_seconds: f32,
    pub episodes_remaining: i64,
    pub estimated_completion_days: f32,
    pub failed_last_24h: i64,
    pub unresolved_errors: i64,
}
