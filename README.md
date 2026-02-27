# Ice Cream Social

A desktop-first transcription, diarization, and review engine for *Matt and Mattingly's Ice Cream Social* — a podcast with 900+ episodes. Built for the fan community ("Scoops") to search, explore, and annotate every episode.

---

## Features

- **Automated transcription** via `whisper.cpp` (native Apple Silicon, CoreML/Neural Engine)
- **Speaker diarization** using `pyannote` + ECAPA-TDNN voice library
- **Human review UI** — transcript editor with inline speaker correction, flagging, chapter marking, and voice sample trimming
- **Full-text search** across all transcribed episodes
- **Character & guest tracking** — recurring characters, appearance tagging, Qwen-powered classification
- **Scoop Polish** — AI-assisted transcript cleanup for noisy segments
- **Audio IDs** — trimmed voice sample library per speaker, used to improve diarization over time
- **Episode wiki sync** — links to the Fandom wiki for each episode
- **Background pipeline** — download → transcribe → diarize → review, all managed by a Tokio async worker

---

## Tech Stack

| Layer | Technology |
|---|---|
| App shell | [Tauri v2](https://tauri.app/) (Rust) |
| Backend | Rust + Tokio async runtime |
| Frontend | React 18 + Vite + TailwindCSS |
| Database | SQLite via `rusqlite` (bundled) |
| Transcription | `whisper.cpp` CLI (native binary) |
| Diarization | Python subprocess — `pyannote.audio` + `speechbrain` ECAPA-TDNN |
| IPC | Tauri commands (replaces REST API) |

---

## Prerequisites

- macOS (Apple Silicon recommended — M1/M2/M3/M4)
- [Rust toolchain](https://rustup.rs/)
- Node.js 18+
- Python 3.9+ with a virtualenv at `venv/`
- `whisper.cpp` built at `~/bin/whisper-cpp/whisper.cpp/build/bin/whisper-cli`
- Whisper models at `~/bin/whisper-cpp/whisper.cpp/models/ggml-{small,medium}.bin`

---

## Quick Start

```bash
# Clone
git clone https://github.com/ryanmontgomerytate/ice-cream-social.git
cd ice-cream-social

# Install frontend dependencies
npm --prefix scripts/dashboard-react install

# Set up Python environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Copy environment config
cp .env.example .env
# Edit .env — add HF_TOKEN (required for pyannote diarization)

# Run the app
cargo tauri dev
```

The Tauri window opens with the full dashboard. DevTools: `Cmd+Option+I`.

---

## Development

### Run checks after making changes

**Rust / Tauri commands:**
```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

**React frontend:**
```bash
npm --prefix scripts/dashboard-react run build
```

**Python scripts:**
```bash
python3 -m py_compile scripts/speaker_diarization.py
```

### Project structure

```
ice-cream-social-app/
├── src-tauri/                  # Rust backend (Tauri app)
│   └── src/
│       ├── commands/           # IPC command handlers
│       ├── database/           # SQLite schema + queries
│       └── worker/             # Background pipeline (download/transcribe/diarize)
├── scripts/
│   ├── dashboard-react/        # React frontend (served in Tauri webview)
│   ├── speaker_diarization.py  # Diarization pipeline (pyannote)
│   ├── voice_library.py        # Speaker embedding library
│   └── episodes/               # Downloaded audio files
├── data/
│   └── ice_cream_social.db     # SQLite database (~917 episodes)
├── docs/                       # Architecture and operational docs
└── web/                        # Hosted web app (Next.js, Supabase)
```

---

## Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable | Purpose |
|---|---|
| `HF_TOKEN` | Hugging Face token — required for pyannote diarization models |

---

## Database

SQLite at `data/ice_cream_social.db`. Schema managed by `src-tauri/src/database/mod.rs` — migrations run automatically on startup.

---

## License

Personal project. Not currently open source.

---

*Built with [Tauri](https://tauri.app/), [whisper.cpp](https://github.com/ggerganov/whisper.cpp), and [Claude](https://claude.ai/).*
