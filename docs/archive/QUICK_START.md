# Quick Start Guide

Get up and running in 15 minutes.

---

## 1. Set Up Environment

```bash
# Create project directory (if not already done)
mkdir ice-cream-social-app
cd ice-cream-social-app

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install faster-whisper feedparser requests tqdm
```

## 2. Download Some Episodes

```bash
# First, check the feed and list episodes
python scripts/download_episodes.py --list

# Download 5 most recent episodes to test
python scripts/download_episodes.py --download 5
```

This creates an `episodes/` folder with the audio files.

## 3. Transcribe Episodes

```bash
# Transcribe a single episode
python scripts/transcribe.py episodes/0500\ -\ Episode\ Title.mp3

# Or transcribe all downloaded episodes
python scripts/transcribe.py episodes/ --batch
```

This creates a `transcripts/` folder with:
- `.json` - Full data with timestamps
- `.txt` - Plain text
- `.srt` - Subtitle format
- `.md` - Markdown (best for AnythingLLM)

**Note**: First run downloads the Whisper model (~3GB for large-v3). Subsequent runs are faster.

## 4. Load into AnythingLLM

1. Open AnythingLLM
2. Create a new workspace called "Ice Cream Social"
3. Upload the `.md` files from `transcripts/`
4. Start asking questions!

Example queries to try:
- "What episodes mention [character name]?"
- "Summarize the Jock vs Nerd results"
- "Find discussions about domain names"
- "What guests appeared recently?"

---

## Processing Time Estimates

On M4 MacBook Air (24GB):

| Episodes | Download Time | Transcribe Time (large-v3) |
|----------|---------------|---------------------------|
| 5 | ~10 min | ~1-2 hours |
| 50 | ~2 hours | ~10-20 hours |
| 500 | ~20 hours | ~100-200 hours |

**Tip**: Start with 5-10 episodes to validate the approach before processing the full backlog.

---

## Next Steps

After validating the basic workflow:

1. **Add speaker diarization** - Identify who said what
2. **Build extraction prompts** - Use Claude to pull out characters, trivia, etc.
3. **Automate new episodes** - Set up scheduled downloads
4. **Create a frontend** - Build wiki pages

See `PROJECT_SETUP.md` for the full roadmap.

---

## Troubleshooting

### "Model not found" error
The first transcription downloads the model. Make sure you have ~5GB free space.

### Slow transcription
Try a smaller model: `python scripts/transcribe.py --model medium episode.mp3`

### RSS feed not working
Verify the feed URL is correct. Find it in your podcast app's share/subscribe options.

### Memory errors
Close other apps, or use a smaller model. The `medium` model works well with 16GB RAM.
