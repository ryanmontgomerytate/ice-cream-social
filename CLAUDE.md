# Ice Cream Social Fandom App

An automated transcription and analysis system for the "Matt and Mattingly's Ice Cream Social" podcast. This project uses AI to transcribe 900+ episodes, extract structured data (characters, trivia, guests), and provide semantic search capabilities for the fan community ("Scoops").


# 🛠 The M4-Native Podcast Engine Framework

## 1. Core Identity & Architecture Strategy

You are the Lead Systems Architect for the "Ice Cream Social" App. Our goal is to build a high-performance, native-first transcription and RAG engine optimized for Apple Silicon (M3/M4 with 24GB RAM).

### The "Native-First" Stack (Tauri/Rust Replatform - January 2026)

| Layer | Tool / Tech | Why? |
|-------|------------|------|
| **App Framework** | `Tauri v2` (Rust) | Native desktop app, tiny binary, system webview, IPC commands |
| **Backend** | `Rust` + `Tokio` | Zero-cost abstractions, async runtime, memory safety |
| **Database** | `SQLite` + `rusqlite` | Embedded database with bundled SQLite |
| **Frontend** | `React` + `Vite` | Existing dashboard, served in Tauri webview |
| **Transcription** | `whisper.cpp` CLI | Native binary, bypasses Python overhead, uses Neural Engine |
| **Diarization** | `Python` subprocess | MLX-Pyannote only, called via subprocess when needed |

### Legacy Stack (Deprecated)

| Layer | Tool / Tech | Status |
|-------|------------|--------|
| Transcription | `whisper.cpp` (CoreML) | ✅ Still used via subprocess |
| Diarization | `MLX-Whisper` + `Pyannote` | ✅ Still used via Python subprocess |
| Database | `SQLite` + `sqlite-vec` | ⚠️ Migrating to rusqlite |
| Language | `Python 3.12` (Glue only) | ⚠️ Deprecated for main app, kept for diarization |

## 2. The "Context Anchoring" Rules

To prevent memory drift, you must strictly maintain three files:

* `CLAUDE.md`: (This file) Core architecture, tech stack, and "personality"
* `SESSIONS.md`: A chronological log of what was done today. Every task ends with a "Current State" update here
* `ARCHITECTURE.md`: Detailed specs of the database schema and transcription pipelines

**Instruction**: Before starting any code change, Claude must read these three files to verify the current "Source of Truth."

## 3. M4 Performance Standards

* **Model Management**: All models (Whisper, LLM) must have an Auto-Unload policy (default: 10 mins idle) to keep the 24GB RAM available for the macOS UI and other tasks
* **No Polling**: Use `FSEvents` (via `watchdog`) or database triggers. Never use `while True: sleep(10)` loops that waste CPU cycles
* **Binary Focus**: If a native binary (like `whisper-cli`) exists, use `subprocess` to call it rather than importing a massive Python library that stays in memory

## 4. The "Execution Loop" (Standard Operating Procedure)

For every request from the user, follow these steps:

1. **Validate**: Run `python scripts/validate_env.py` to ensure local paths and binaries are correct
2. **Propose**: Detail the logic change. Always prioritize `sqlite-vec` for search tasks over high-level APIs
3. **Execute**: Write modular, type-hinted code
4. **Audit**: Check memory usage. If a new service is added, it must include a health-check endpoint
5. **Log**: Update `SESSIONS.md` with the new progress

## 5. Security & Isolation

### CRITICAL: Never Hardcode Secrets
* **NEVER** write API keys, tokens, or credentials directly in code files
* **NEVER** hardcode secrets in config files, documentation, or comments
* **ALWAYS** use environment variables: `os.getenv('HF_TOKEN')` or `os.environ.get('HF_TOKEN')`
* **ALWAYS** document required environment variables in `.env.example` (with placeholder values only)

### Workspace & Permissions
* **Workspace Lock**: Only touch files within `/Users/ryan/Desktop/Projects/ice-cream-social-app/`
* **Permissions**: Never use `sudo` in scripts. If a permission error occurs, Claude must ask the user to run the command manually

### Restricted Files - DO NOT READ OR MODIFY
The following files contain secrets and Claude must NEVER read, cat, grep, or access them:
- `.env` - Contains API tokens and secrets
- `.env.local` - Local environment overrides
- `.env.*.local` - Environment-specific secrets
- `.claude/settings.local.json` - Contains local Claude settings and may include secrets
- Any file matching `*.secret.*` or `*credentials*`

If code needs to reference these files, only reference the `.env.example` template which contains no real values.

### Environment Variable Checklist
When adding code that needs API keys or tokens:
1. ✅ Use `os.getenv('VAR_NAME')` to read from environment
2. ✅ Add error handling if the variable is not set
3. ✅ Document the variable in `.env.example` with a placeholder value
4. ✅ Update documentation to mention the required environment setup
5. ❌ NEVER commit the actual `.env` file or hardcoded secrets

## 6. Key Principles

* **Memory Efficiency**: Always consider M4's 24GB unified memory. Unload models when idle
* **Native Performance**: Prefer compiled binaries over Python libraries for CPU/GPU intensive tasks
* **Type Safety**: Use Python type hints throughout
* **Modularity**: Keep services decoupled and testable
* **Documentation**: Every significant change gets logged in SESSIONS.md

## 7. MCP Memory Server (Knowledge Graph)

Claude has access to a persistent knowledge graph via the MCP Memory Server (`@modelcontextprotocol/server-memory`). This provides long-term memory that persists across conversations.

### Available Tools

| Tool | Purpose |
|------|---------|
| `create_entities` | Create new entities (characters, episodes, concepts) with observations |
| `create_relations` | Link entities together (e.g., "Sweet Bean" → appears_in → "Episode 500") |
| `add_observations` | Add new facts/observations to existing entities |
| `delete_entities` | Remove entities from the knowledge graph |
| `delete_observations` | Remove specific observations from entities |
| `delete_relations` | Remove relations between entities |
| `read_graph` | Read the entire knowledge graph |
| `search_nodes` | Search for entities by name, type, or observation content |
| `open_nodes` | Retrieve specific entities by name |

### Use Cases for This Project

* **Character Database**: Store recurring characters (Sweet Bean, Duck Duck, etc.) with their traits and episode appearances
* **Guest Tracking**: Remember guest information and which episodes they appeared on
* **Trivia Scores**: Track Jock vs Nerd trivia results across episodes
* **Notable Moments**: Index memorable bits, quotes, and running jokes
* **Project Decisions**: Remember architectural decisions and why they were made

### Example Usage

```
# Create a character entity
create_entities([{
  name: "Sweet Bean",
  entityType: "character",
  observations: ["Recurring character", "First appeared around episode 200"]
}])

# Link character to episode
create_relations([{
  from: "Sweet Bean",
  to: "Episode 500",
  relationType: "appears_in"
}])
```

---

*Last Updated: February 4, 2026*
*System: MacBook Air M3 (24GB RAM) - Tauri/Rust replatform in progress*

## 🚀 Quick Start: Getting Everything Running

### NEW: Tauri/Rust App (Recommended)

**Prerequisites:**
- Rust toolchain (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- Node.js 18+ and npm
- Tauri CLI (`cargo install tauri-cli`)

**Single command to start the full app:**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app
cargo tauri dev
```

This starts:
- Rust backend with Tokio async runtime
- React frontend via Vite (http://localhost:3000)
- Native Tauri window with webview
- Background transcription worker (built-in)

**DevTools:** Press `Cmd+Option+I` in the Tauri app window

**Database:** `data/ice_cream_social.db` (917 episodes)

**Stop the app:** Press `Ctrl+C` in the terminal

### Legacy: Python/Flask Mode (Deprecated)

> **First time?** See **[GETTING_STARTED.md](GETTING_STARTED.md)** for step-by-step instructions

**Terminal 1: Backend (Flask + SocketIO)**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app/scripts
source ../venv/bin/activate
python dashboard_server.py
# Runs on http://localhost:8000
```

**Terminal 2: Frontend (React + Vite)**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app/scripts/dashboard-react
npm run dev
# Runs on http://localhost:3000
```

**Terminal 3: Worker (Background transcription)**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app/scripts
source ../venv/bin/activate
python transcription_worker.py --model medium --idle-timeout 30
```

**Having Issues?**
- "Port in use" → See [DEVELOPMENT.md#port-errors](DEVELOPMENT.md)
- "Connection refused" → Start backend (Terminal 1) first
- "Module not found" → Run `python validate_environment.py`

---

## 🦀 Framework Reference: Tauri v2 + Rust

### Project Structure (Tauri)

```
ice-cream-social-app/
├── src-tauri/                      # Tauri/Rust application
│   ├── Cargo.toml                  # Rust dependencies
│   ├── tauri.conf.json             # Tauri configuration
│   └── src/
│       ├── main.rs                 # Entry point
│       ├── lib.rs                  # App setup, command registration
│       ├── commands/               # Tauri IPC commands (replaces REST API)
│       │   ├── mod.rs              # Command exports
│       │   ├── episodes.rs         # get_episodes, get_episode, get_feed_sources
│       │   ├── queue.rs            # get_queue, add_to_queue, remove_from_queue
│       │   ├── stats.rs            # get_stats
│       │   └── worker.rs           # get_worker_status, stop_current_transcription
│       ├── database/               # SQLite with rusqlite
│       │   ├── mod.rs              # Database struct, queries
│       │   └── models.rs           # Episode, QueueItem, FeedSource structs
│       └── worker/                 # Background processing
│           └── mod.rs              # TranscriptionWorker, whisper.cpp subprocess
│
├── scripts/dashboard-react/        # React frontend (served in Tauri webview)
│   ├── src/
│   │   ├── App.jsx                 # Main app, auto-detects Tauri vs browser
│   │   ├── services/
│   │   │   ├── api.js              # API facade (Tauri IPC or HTTP fallback)
│   │   │   └── tauri.js            # Tauri invoke wrapper
│   │   └── components/             # React components
│   └── package.json
│
├── data/                           # Application data
│   └── ice_cream_social.db         # SQLite database (904 episodes)
│
└── scripts/                        # Legacy Python scripts
    ├── speaker_diarization.py      # MLX-Pyannote (still used via subprocess)
    └── episodes/                   # Downloaded audio files
```

### Key Rust/Tauri Patterns

**Tauri Commands (IPC):**
```rust
#[tauri::command]
pub async fn get_episodes(
    db: State<'_, Arc<Database>>,
    filters: Option<EpisodeFilters>,
) -> Result<EpisodesResponse, String> {
    // Access managed state, return serializable data
}
```

**Frontend Invocation:**
```javascript
import { invoke } from '@tauri-apps/api/core';
const result = await invoke('get_episodes', { filters: params });
```

**Tauri Events (replaces WebSocket):**
```rust
use tauri::Emitter;
app_handle.emit("status_update", &status)?;
```

### Key Dependencies (Cargo.toml)

```toml
tauri = "2.9"
tokio = { version = "1.35", features = ["full", "process", "sync"] }
rusqlite = { version = "0.31", features = ["bundled"] }
serde = { version = "1.0", features = ["derive"] }
chrono = { version = "0.4", features = ["serde"] }
```

### Critical Paths

- **whisper.cpp binary:** `~/bin/whisper-cpp/whisper.cpp/build/bin/whisper-cli`
- **Whisper models:** `~/bin/whisper-cpp/whisper.cpp/models/ggml-{small,medium}.bin`
- **Database:** `data/ice_cream_social.db`
- **Episodes:** `scripts/episodes/`
- **Transcripts:** `scripts/transcripts/`

---

## Project Status

**Phase:** Tauri/Rust Replatform (Active Development)
**Version:** 2.0.0-alpha
**Last Updated:** January 28, 2026

### Current Progress

- ✅ **Tauri App:** Running with Rust backend
- ✅ **Database:** SQLite with rusqlite (904 episodes)
- ✅ **React Frontend:** Integrated in Tauri webview
- ✅ **IPC Commands:** Episodes, queue, stats, worker status
- ✅ **Background Worker:** Tokio-based transcription worker
- ⏳ **Transcription:** whisper.cpp subprocess integration (in progress)
- ⏳ **Diarization:** Python subprocess integration (planned)
- ⏳ **Vector Search:** sqlite-vec migration (planned)

## Quick Start

### Prerequisites

- Python 3.9+
- macOS M4 (or similar ARM64/x86_64)
- 24GB RAM recommended
- ~10GB disk space for models and transcripts

### Installation

```bash
# Clone/navigate to project
cd ice-cream-social-app

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Copy and configure settings
cp config.example.yaml config.yaml
# Edit config.yaml with your RSS feed URL
```

### Basic Usage

**Download Episodes:**
```bash
cd scripts
python download_episodes.py --download 5
```

**Start Transcription Worker (with UI):**
```bash
python transcription_worker.py --model medium
```

**Launch Web Dashboard:**
```bash
python dashboard_server.py
# Open http://localhost:5000
```

## Architecture

### System Components (Tauri/Rust)

```
┌─────────────────────────────────────────────────────────────┐
│                     Tauri App (Rust)                        │
├─────────────────────────────────────────────────────────────┤
│  React Frontend (webview) - existing code, minimal changes  │
│  - Auto-detects Tauri vs browser mode                       │
│  - Uses invoke() for IPC commands                           │
│  - Listens for Tauri events (replaces WebSocket)            │
├─────────────────────────────────────────────────────────────┤
│  Rust Backend                                               │
│    ├─ Tauri commands (replaces Flask routes)                │
│    ├─ SQLite + rusqlite (embedded database)                 │
│    ├─ Tokio async runtime (background tasks)                │
│    └─ Subprocess calls to:                                  │
│        - whisper-cli (transcription)                        │
│        - Python venv (diarization only)                     │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data Layer                                │
├─────────────────────────────────────────────────────────────┤
│  SQLite Database (data/ice_cream_social.db)                 │
│    - episodes: 904 episodes from Patreon                    │
│    - queue: transcription queue                             │
│    - transcripts: transcript metadata                       │
├─────────────────────────────────────────────────────────────┤
│  File Storage                                               │
│    - scripts/episodes/: downloaded audio files              │
│    - scripts/transcripts/: JSON, TXT, SRT, MD files        │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    External Binaries                         │
├─────────────────────────────────────────────────────────────┤
│  whisper-cli (~/bin/whisper-cpp/)                           │
│    - Native transcription on Apple Silicon                  │
│    - Models: ggml-small.bin, ggml-medium.bin                │
├─────────────────────────────────────────────────────────────┤
│  Python (subprocess for diarization only)                   │
│    - MLX-Pyannote speaker diarization                       │
│    - scripts/speaker_diarization.py                         │
└─────────────────────────────────────────────────────────────┘
```

### Technology Stack

**App Framework:**
- Tauri v2 (Rust-based desktop app framework)
- System webview (no Electron bloat)
- Native file system access

**Backend (Rust):**
- Tokio async runtime
- rusqlite (SQLite bindings)
- serde (JSON serialization)
- chrono (date/time handling)

**Frontend (React):**
- React 18 with Vite
- TailwindCSS
- @tauri-apps/api (IPC)

**Transcription:**
- whisper.cpp (native binary)
- Models: small (244MB), medium (769MB)

**Database:**
- SQLite 3 (embedded)
- rusqlite with bundled feature

## Project Structure

```
ice-cream-social-app/
├── config.yaml                 # Main configuration
├── config.example.yaml         # Template for sharing
├── requirements.txt            # Python dependencies
├── TODO.md                     # Task tracking
├── CLAUDE.md                   # This file
├── UI_GUIDE.md                 # Monitoring interface docs
│
├── scripts/                    # Main application code
│   ├── config.py              # Config loader
│   ├── download_episodes.py   # RSS feed downloader
│   ├── transcribe.py          # Single-file transcription
│   ├── transcription_worker.py # Background worker
│   ├── ui_manager.py          # Rich terminal UI
│   ├── dashboard_server.py    # Web dashboard backend
│   ├── check_status.py        # Status utility
│   │
│   ├── dashboard/             # Web interface
│   │   └── templates/
│   │       └── dashboard.html
│   │
│   ├── episodes/              # Downloaded audio files
│   ├── transcripts/           # Transcription outputs
│   │   ├── *.json            # Full data + timestamps
│   │   ├── *.txt             # Plain text
│   │   ├── *.srt             # Subtitles
│   │   └── *.md              # Markdown
│   │
│   ├── transcription_worker.log
│   ├── transcription_queue.json
│   └── transcription_status.json
│
├── data/                      # (Planned) Structured data
│   └── ice_cream_social.db   # SQLite database
│
└── venv/                      # Python virtual environment
```

## Configuration

All settings are managed in `config.yaml`:

### Key Settings

**Podcast Feed:**
```yaml
podcast:
  name: "Matt and Mattingly's Ice Cream Social"
  rss_feed_url: "YOUR_RSS_FEED_URL"
```

**Transcription:**
```yaml
transcription:
  model: "medium"          # tiny, base, small, medium, large-v2, large-v3
  device: "auto"           # auto, cpu, cuda
  word_timestamps: true
  vad_filter: true         # Filter silence
```

**Worker:**
```yaml
worker:
  check_interval: 60       # Seconds between scans
  max_retries: 3
```

**Paths:**
```yaml
paths:
  episodes: "scripts/episodes"
  transcripts: "scripts/transcripts"
  data: "data"
  database: "data/ice_cream_social.db"
```

### Environment-Specific Config

The config system supports:
- Default values with fallbacks
- Path resolution (relative → absolute)
- Validation on load
- Per-environment overrides

## Features

### Implemented

#### 1. Episode Download
- RSS feed parsing (903 episodes available)
- Automatic metadata extraction
- Episode numbering detection
- Duplicate prevention

#### 2. Transcription
- **Model:** Faster-Whisper (medium by default)
- **Quality:** Word-level timestamps, VAD filtering
- **Output Formats:** JSON, TXT, SRT, MD
- **Performance:** ~5-10 min per hour of audio (medium model)

#### 3. Background Worker
- Automatic folder monitoring
- Queue-based processing
- Resume on interruption
- Graceful shutdown
- Status file updates

#### 4. Monitoring
- **Terminal:** Rich UI with progress bars, stats, notifications
- **Web:** Real-time dashboard at localhost:5000
- **Logs:** Detailed file logging
- **Notifications:** macOS desktop alerts

#### 5. Configuration
- YAML-based centralized config
- Environment-agnostic
- Validation built-in
- Template for sharing

### Planned

#### Phase 2: Database & Structure
- SQLite schema implementation
- Episode metadata storage
- Segment indexing
- Full-text search

#### Phase 3: Data Extraction
- Character identification (e.g., "Sweet Bean", "Duck Duck")
- Trivia segment parsing (Jock vs Nerd scores)
- Guest identification
- Topic classification
- Notable quotes extraction

#### Phase 4: Search & Discovery
- AnythingLLM integration
- Semantic search ("find the bit about...")
- Character/topic filtering
- Similar episode recommendations

#### Phase 5: Frontend
- React-based web interface
- Episode wiki pages
- Character database
- Trivia leaderboard
- Search interface

## Development

### Running Tests

```bash
# Test config
cd scripts
python config.py --validate

# Test UI
python ui_manager.py

# Test single transcription
python transcribe.py path/to/audio.mp3 --model medium
```

### Adding Features

The project follows these patterns:
- Configuration in `config.yaml`
- Modules in `scripts/`
- Data storage in `scripts/transcripts/` and `data/`
- UI components separate from logic

### Code Style

- Type hints where helpful
- Docstrings for non-obvious functions
- Error handling for I/O operations
- Progress indicators for long tasks
- Industry-standard patterns (worker queues, config management)

## Performance

### Transcription Speed
- **Tiny:** ~2-3 min per hour of audio (poor quality)
- **Base:** ~3-5 min per hour (acceptable)
- **Small:** ~4-7 min per hour (good)
- **Medium:** ~5-10 min per hour (recommended)
- **Large-v3:** ~10-20 min per hour (best quality)

### Hardware Requirements
- **M4 MacBook Air (24GB RAM):** Excellent performance
- **CPU-only:** Slower but functional
- **GPU acceleration:** Automatic if available

### Scalability
- **Current:** Single-threaded processing
- **Bottleneck:** Whisper model inference
- **Future:** Parallel workers, batch processing

## Data

### RSS Feed
- **Source:** Patreon private feed
- **Episodes:** 903 total
- **Coverage:** 2014 - present
- **Format:** MP3, ~50-120 min each

### Storage Requirements
- **Audio:** ~50MB per episode → ~45GB for all
- **Transcripts:** ~1-2MB per episode → ~1-2GB for all
- **Database:** ~100-200MB (estimated)
- **Total:** ~50GB recommended

## API

### Tauri IPC Commands (Current)

**Episodes:**
```rust
get_episodes(filters: Option<EpisodeFilters>) -> EpisodesResponse
get_episode(id: i64) -> Episode
get_feed_sources() -> Vec<FeedSource>
refresh_feed(source: String, force: bool) -> Result
```

**Queue:**
```rust
get_queue() -> QueueResponse
add_to_queue(episode_id: i64, priority: i32) -> Result
remove_from_queue(episode_id: i64) -> Result
```

**Worker:**
```rust
get_worker_status() -> WorkerStatus
stop_current_transcription() -> Result
retry_transcription(episode_id: i64) -> Result
```

**Stats:**
```rust
get_stats() -> Stats
```

### Tauri Events (replaces WebSocket)

```rust
status_update     // Worker status changed
queue_update      // Queue modified
stats_update      // Statistics changed
transcription_complete(episode_id)
transcription_failed(episode_id, error)
```

### Legacy Flask API (Deprecated)

```
GET  /api/v2/episodes       # Episode list
GET  /api/v2/queue          # Queue state
POST /api/v2/queue/add      # Add to queue
GET  /api/v2/stats          # Statistics
```

## Contributing

This is a personal project, but follows best practices:
- Modular design for easy extension
- Configuration-driven behavior
- Comprehensive documentation
- Industry-standard patterns

### Areas for Expansion
- Speaker diarization (pyannote.audio)
- LLM-based data extraction
- Advanced search features
- Social media integration
- Community features

## Proposed Features

### Human Review Pipeline (January 2026)

**Problem:** Transcriptions and diarization can have errors. Currently, completed items are marked as done with no human verification step.

**Proposed Pipeline:**
```
Download → Transcribe → Diarize → REVIEW → Publish
                                    ↑
                         Human edits transcript,
                         verifies speaker labels,
                         approves for publishing
```

**New Episode Statuses:**
- `pending` - In queue, waiting to process
- `downloading` - Fetching audio file
- `transcribing` - Whisper running
- `diarizing` - Speaker identification
- `pending_review` - **NEW: Needs human approval**
- `completed` - Approved and published

**UI Components Needed:**
1. **Review Panel** - Edit transcript text, fix speaker labels, timestamp corrections
2. **Approve/Reject buttons** - Mark as complete or re-process
3. **Review Queue** - List of items pending review with filters
4. **Episode status badges** - Visual indicators for each stage

**Database Changes:**
- Add `transcription_status` enum with new values
- Add `reviewed_by` and `reviewed_date` fields
- Add `review_notes` for reviewer comments

**Priority:** Medium - Implement after diarization is verified working

## License

Personal project - not currently open source.

## Acknowledgments

- **Podcast:** Matt Donnelly & Paul Mattingly
- **Transcription:** Faster-Whisper (OpenAI Whisper)
- **Inspiration:** Sonarr, Radarr, and other *arr tools

## Contact

Built with assistance from Claude (Anthropic).

---

**Last Updated:** February 4, 2026
**Project Lead:** Ryan
**AI Assistant:** Claude (Opus 4.5)
**Stack:** Tauri v2 + Rust + React + SQLite
