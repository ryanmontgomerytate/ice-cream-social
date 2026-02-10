# Ice Cream Social Fandom App - TODO

## 🔥 Current Sprint

- [x] **Background transcription worker** - Run transcription in separate process while developing other features
- [x] **Resource optimization** - Fixed excessive logging, added auto-shutdown, memory management
- [ ] **SQLite database + MCP setup** - Store episodes, characters, trivia in structured database
- [x] **Config file** - Centralize settings (RSS URL, model size, paths, API keys)
- [ ] **AnythingLLM integration** - Auto-upload transcripts for semantic search

---

## 📋 Backlog

### Transcription Pipeline
- [ ] Add speaker diarization (pyannote.audio)
- [ ] Batch processing with progress tracking
- [ ] Auto-detect new episodes from RSS feed
- [ ] Resume interrupted transcriptions

### Data Extraction
- [ ] Character extraction prompts (identify recurring characters)
- [ ] Trivia segment parser (Jock vs Nerd results)
- [ ] Guest identification
- [ ] Topic/bit classification
- [ ] Notable quotes extraction

### Search & Discovery
- [ ] Semantic search ("find the bit about...")
- [ ] Full-text search across transcripts
- [ ] Search by character, guest, topic
- [ ] "Find similar bits" feature

### Frontend / UI
- [ ] Episode wiki pages
- [ ] Character database pages
- [ ] Trivia leaderboard dashboard
- [ ] Search interface
- [ ] Transcription progress dashboard

### Social & Community
- [ ] @heyscoops Twitter/X aggregation
- [ ] Instagram feed integration
- [ ] Re-analysis request system
- [ ] User contributions / corrections

### Infrastructure
- [ ] Docker setup for workers
- [ ] Automated new episode processing
- [ ] Backup system for database
- [ ] API for external tools

---

## ✅ Completed

- [x] Project setup and structure
- [x] Basic transcription script (faster-whisper)
- [x] Episode download script (RSS feed)
- [x] Python environment configured
- [x] Background transcription worker with queue system
- [x] Status monitoring and logging utilities
- [x] RSS feed configured and tested (903 episodes available)
- [x] Centralized configuration system (config.yaml + config.py)
- [x] All scripts updated to use config
- [x] Rich terminal UI with progress bars and desktop notifications
- [x] Web dashboard with real-time updates (Flask + WebSocket)
- [x] Industry-standard monitoring interfaces
- [x] Resource optimization (v0.2.0):
  - Log rotation (10MB max, 3 backups)
  - Reduced idle logging (96% fewer entries)
  - Auto-shutdown on idle timeout
  - Memory monitoring and reporting
  - Automatic model unloading (frees 2-4GB after 10 min idle)
  - Error retry logic (3 attempts with exponential backoff)
  - Smart idle behavior (progressive sleep backoff)
  - Enhanced error handling (MemoryError, detailed logging)

---

## 📝 Notes

- RSS Feed URL: https://www.patreon.com/rss/heyscoops?auth=REDACTED_PATREON_AUTH_TOKEN&show=876202
- Total episodes in feed: 903
- Target: 500+ episodes in back catalog
- Hardware: M4 MacBook Air, 24GB RAM
- Transcription estimate: ~5-10 min per 2-hour episode with medium model, ~15-30 min with large-v3

---

## 🤔 Questions to Resolve

- [ ] Reach out to Matt & Paul for blessing/partnership?
- [ ] Start with recent episodes or go back to episode 1?
- [ ] Open source this for other Scoops to contribute?
- [ ] Host publicly or keep personal?
