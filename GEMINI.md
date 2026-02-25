# GEMINI.md - Ice Cream Social App Project Overview

This document outlines the project "Ice Cream Social App," an advanced transcription and analysis engine for the "Matt and Mattingly's Ice Cream Social" podcast. It aims to provide a high-performance, native-first solution optimized for Apple Silicon (M4).

## 1. Project Overview

The Ice Cream Social App is designed to automate the process of transcribing podcast episodes, performing speaker diarization, and eventually enabling semantic search and structured data extraction. The application provides a user-friendly interface for managing episodes, transcription queues, and reviewing processed content. The project is currently undergoing a replatforming effort to leverage the performance benefits of Rust and the native desktop capabilities of Tauri.

## 2. Architecture

The application follows a client-server architecture pattern within a single desktop application, where the Tauri-Rust backend acts as the server and the React frontend as the client.

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
│    ├─ Tauri commands (IPC API)                              │
│    ├─ SQLite database (rusqlite)                            │
│    ├─ Tokio async runtime                                   │
│    └─ Subprocess calls to:                                  │
│        - whisper-cli (transcription)                        │
│        - Python venv (diarization only)                     │
└─────────────────────────────────────────────────────────────┘
```

**Key Architectural Principles:**
*   **Native-First:** Prioritizing native performance and efficiency, especially for Apple Silicon.
*   **Modularity:** Decoupled components for easier maintenance and testing.
*   **Event-Driven:** Utilizing Tauri events for real-time updates between backend and frontend.
*   **Binary Focus:** Leveraging optimized native binaries (e.g., `whisper.cpp`) via subprocesses to minimize overhead.

## 3. Technology Stack

### Core Technologies
*   **Application Framework:** Tauri v2 (Rust) - For building cross-platform native desktop applications with web frontend.
*   **Backend Language:** Rust - Chosen for performance, memory safety, and concurrency.
*   **Frontend Library:** React 18 with Vite - For building the interactive user interface.
*   **Styling:** TailwindCSS - For utility-first CSS styling.
*   **Database:** SQLite - Embedded relational database, accessed via `rusqlite` crate.
*   **Asynchronous Runtime:** Tokio - For efficient asynchronous operations in Rust.
*   **Transcription Engine:** `whisper.cpp` CLI - High-performance, native transcription tool.
*   **Speaker Diarization:** `MLX-Pyannote` (Python) - Called as a subprocess for speaker identification.

### Data Formats
*   **Configuration:** YAML
*   **Transcripts:** JSON, TXT, SRT, MD
*   **Database:** SQLite

## 4. Key Features

*   **Episode Management:** Automatic discovery and metadata extraction from RSS feeds.
*   **Transcription Pipeline:** Queued processing, audio download, and transcription using `whisper.cpp`.
*   **Speaker Diarization:** Identification and labeling of different speakers within an episode.
*   **Interactive Dashboard:** React-based UI for monitoring transcription progress, managing queues, and viewing episodes.
*   **Human Review Pipeline (Planned):** Workflow for human verification and correction of transcripts and diarization results.
*   **Semantic Search & Data Extraction (Future):** Advanced search capabilities and structured data extraction from transcripts.

## 5. Project Structure

```
ice-cream-social-app/
├── ARCHITECTURE.md          # Detailed architectural specifications
├── CLAUDE.md                # Instructions and context for Claude
├── config.yaml              # Application configuration
├── README.md                # General project information
│
├── src-tauri/               # Tauri/Rust backend application
│   ├── Cargo.toml           # Rust dependencies
│   ├── tauri.conf.json      # Tauri configuration
│   └── src/                 # Rust source code
│       ├── commands/        # Tauri IPC commands
│       ├── database/        # SQLite operations and models
│       └── worker/          # Background transcription worker logic
│
├── scripts/                 # Contains various utility scripts and data directories
│   ├── dashboard-react/     # React frontend source code
│   │   ├── src/             # React components, services
│   │   └── package.json     # Frontend dependencies
│   ├── episodes/            # Downloaded audio files
│   ├── transcripts/         # Transcription outputs (JSON, TXT, SRT, MD)
│   ├── speaker_diarization.py # Python script for diarization
│   └── ...                  # Other utility Python scripts
│
├── data/                    # Application data directory
│   └── ice_cream_social.db  # SQLite database file
│
└── venv/                    # Python virtual environment
```

## 6. Development Guidelines

*   **Native Performance:** Prioritize compiled binaries and Rust-native implementations over Python libraries for CPU/GPU intensive tasks.
*   **Memory Efficiency:** Actively manage model loading and unloading to optimize RAM usage, especially on Apple Silicon with unified memory.
*   **Configuration:** All configurable settings should reside in `config.yaml`.
*   **Security:** Never hardcode secrets. Use environment variables (`os.getenv()`) and document them in `.env.example`. **Never touch `.env` files directly; only add to `.env.example`.** Avoid accessing sensitive files directly.
*   **Testing:** Adhere to project's testing procedures.
*   **Documentation:** Keep `ARCHITECTURE.md`, `CLAUDE.md`, and `SESSIONS.md` updated as the sources of truth.

## 7. Quick Start (Tauri/Rust)

**Prerequisites:**
*   Rust toolchain
*   Node.js 18+ and npm
*   Tauri CLI (`cargo install tauri-cli`)

**To run the application:**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app
cargo tauri dev
```

This command will start the Rust backend, React frontend (via Vite), and launch the native Tauri window.

**Database Location:** `data/ice_cream_social.db`

---
*Generated by Gemini CLI Agent*
