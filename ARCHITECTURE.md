# Ice Cream Social App - Architecture Specification

## System Overview

The Ice Cream Social App is a podcast transcription and search system for the "Matt and Mattingly's Ice Cream Social" podcast, optimized for Apple Silicon (M3/M4).

## Technology Stack

### Current Architecture (Tauri/Rust)

```
┌─────────────────────────────────────────────────────────────┐
│                     Tauri App (Rust)                        │
├─────────────────────────────────────────────────────────────┤
│  React Frontend (webview)                                   │
│    - Vite build system                                      │
│    - TailwindCSS styling                                    │
│    - Tauri IPC for backend communication                    │
├─────────────────────────────────────────────────────────────┤
│  Rust Backend                                               │
│    ├─ Tauri commands (replaces Flask REST API)              │
│    ├─ SQLite database (rusqlite)                            │
│    ├─ Tokio async runtime                                   │
│    └─ Subprocess calls to:                                  │
│        - whisper-cli (transcription)                        │
│        - Python venv (diarization only, when needed)        │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

**Frontend**
- React 18 with Vite
- TailwindCSS for styling
- Tauri IPC (`invoke()`) for backend communication
- Real-time updates via Tauri events

**Backend (Rust)**
- Tauri v2 framework
- rusqlite for SQLite database access
- tokio for async operations
- reqwest for HTTP (RSS fetching)
- feed-rs for RSS parsing

**Transcription Engine**
- Primary: `whisper.cpp` CLI (`whisper-cli`)
- Model: Whisper medium (configurable)
- Path: `~/bin/whisper-cpp/whisper.cpp/build/bin/whisper-cli`

**Speaker Diarization**
- `MLX-Pyannote` (Python subprocess when needed)
- Uses Apple's MLX for M-series optimization

**Database**
- SQLite with rusqlite
- Path: `data/ice_cream_social.db`

## Project Structure

```
ice-cream-social-app/
├── CLAUDE.md              # Core instructions for Claude
├── SESSIONS.md            # Development log
├── ARCHITECTURE.md        # This file
├── config.yaml            # Configuration file
│
├── src-tauri/             # Tauri/Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── lib.rs         # App initialization
│       ├── commands/      # Tauri IPC commands
│       │   ├── episodes.rs
│       │   ├── queue.rs
│       │   ├── stats.rs
│       │   └── worker.rs
│       ├── database/      # SQLite operations
│       │   ├── mod.rs
│       │   └── models.rs
│       └── worker/        # Background transcription
│           └── mod.rs
│
├── scripts/
│   ├── dashboard-react/   # React frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── CurrentActivity.jsx
│   │   │   │   ├── EpisodesBrowser.jsx
│   │   │   │   ├── EpisodeCard.jsx
│   │   │   │   ├── EpisodeFeed.jsx
│   │   │   │   └── QueuePanel.jsx
│   │   │   └── services/
│   │   │       ├── api.js     # Auto-detects Tauri vs HTTP
│   │   │       └── tauri.js   # Tauri IPC wrapper
│   │   └── package.json
│   ├── episodes/          # Downloaded audio files
│   └── transcripts/       # Transcription outputs
│
├── data/
│   └── ice_cream_social.db  # SQLite database
│
└── docs/
    └── archive/           # Archived documentation
```

## Tauri Commands (API)

| Command | Description |
|---------|-------------|
| `get_episodes` | List episodes with filters, search, pagination |
| `get_episode` | Get single episode by ID |
| `get_feed_sources` | List available podcast feeds |
| `refresh_feed` | Fetch new episodes from RSS |
| `get_transcript` | Get transcript for episode |
| `get_queue` | List transcription queue |
| `add_to_queue` | Add episode to transcription queue |
| `remove_from_queue` | Remove episode from queue |
| `get_worker_status` | Get transcription worker status |
| `stop_current_transcription` | Stop active transcription |
| `get_stats` | Get dashboard statistics |

## Database Schema

```sql
-- Episodes table
CREATE TABLE episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_number TEXT,
    title TEXT NOT NULL,
    description TEXT,
    audio_url TEXT NOT NULL,
    duration REAL,
    file_size INTEGER,
    published_date TEXT,
    feed_source TEXT DEFAULT 'patreon',
    is_downloaded INTEGER DEFAULT 0,
    is_transcribed INTEGER DEFAULT 0,
    is_in_queue INTEGER DEFAULT 0,
    download_path TEXT,
    transcript_path TEXT,
    transcribed_date TEXT,
    transcription_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Transcription queue
CREATE TABLE transcription_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    priority INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    queue_type TEXT DEFAULT 'full', -- 'full' | 'diarize_only'
    embedding_backend_override TEXT, -- optional per-episode diarization backend
    added_at TEXT DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT,
    FOREIGN KEY (episode_id) REFERENCES episodes(id)
);

-- Transcripts table
CREATE TABLE transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    full_text TEXT NOT NULL,
    segments_json TEXT,
    language TEXT,
    model_used TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (episode_id) REFERENCES episodes(id)
);
```

## Data Flow

### 1. Episode Discovery
```
RSS Feed → refresh_feed command → Parse with feed-rs → Upsert to SQLite
```

### 2. Transcription Pipeline
```
Add to Queue → Worker picks up → Download audio → whisper-cli → Store transcript
```

### 3. Frontend Updates
```
React → invoke() → Rust command → SQLite → Response → React state
```

## Performance Targets

- **Transcription**: ~5-10 min per hour of audio (medium model)
- **Memory**: Peak < 8GB during transcription
- **UI Response**: < 100ms for all operations
- **Database**: Handles 1000+ episodes efficiently

## Critical Paths

| Resource | Path |
|----------|------|
| whisper-cli | `~/bin/whisper-cpp/whisper.cpp/build/bin/whisper-cli` |
| Models | `~/bin/whisper-cpp/whisper.cpp/models/` |
| Database | `data/ice_cream_social.db` |
| Episodes | `scripts/episodes/` |
| Transcripts | `scripts/transcripts/` |
| Config | `config.yaml` |

---

*Last Updated: January 28, 2026*
*Status: Tauri/Rust replatform in progress*
 
