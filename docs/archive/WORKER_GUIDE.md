# Background Transcription Worker Guide

## Overview

The transcription worker automatically monitors the `episodes/` folder and transcribes any new audio files in the background. You can continue working while it processes episodes.

## Quick Start

### 1. Start the Worker

```bash
# Activate virtual environment
source venv/bin/activate

# Start worker with medium model (good balance of speed and accuracy)
cd scripts
python transcription_worker.py --model medium

# Or use a different model
python transcription_worker.py --model small    # Faster, less accurate
python transcription_worker.py --model large-v3 # Slower, more accurate
```

### 2. Check Status

In another terminal:

```bash
cd scripts
python check_status.py

# Or watch continuously
python check_status.py --watch
```

### 3. Monitor Logs

```bash
# Follow the log in real-time
tail -f scripts/transcription_worker.log

# Or view recent logs
tail -50 scripts/transcription_worker.log
```

## How It Works

1. **Automatic Detection**: Worker scans `episodes/` folder every 60 seconds
2. **Queue Management**: Files are added to a queue and processed one at a time
3. **Skip Existing**: Already-transcribed files are automatically skipped
4. **Resume Support**: If interrupted, worker resumes from where it left off
5. **Output**: Transcripts saved to `transcripts/` in multiple formats:
   - `.json` - Full data with timestamps
   - `.txt` - Plain text transcript
   - `.srt` - Subtitle format
   - `.md` - Markdown with timestamps

## Worker Commands

```bash
# Start with default settings (medium model, check every 60s)
python transcription_worker.py

# Use different model
python transcription_worker.py --model small

# Check more frequently
python transcription_worker.py --model medium --check-interval 30

# Custom directories
python transcription_worker.py \
  --episodes-dir ../audio \
  --transcripts-dir ../output \
  --model medium
```

## Status Commands

```bash
# Check status once
python check_status.py

# Watch status (updates every 5 seconds)
python check_status.py --watch

# Watch with custom interval
python check_status.py --watch --interval 10
```

## Files Created

- `transcription_worker.log` - All worker activity
- `transcription_queue.json` - Current queue state
- `transcription_status.json` - Latest status info
- `transcripts/` - Output folder with all transcripts

## Typical Workflow

### Terminal 1: Run Worker
```bash
source venv/bin/activate
cd scripts
python transcription_worker.py --model medium
```

### Terminal 2: Download Episodes
```bash
source venv/bin/activate
cd scripts
python download_episodes.py --download 5
# Worker automatically picks up new files!
```

### Terminal 3: Monitor Progress
```bash
cd scripts
python check_status.py --watch
# Or: tail -f transcription_worker.log
```

## Stopping the Worker

- Press `Ctrl+C` in the worker terminal
- Worker will finish the current file before stopping gracefully

## Tips

1. **Model Selection**:
   - `tiny` - Very fast, poor accuracy (use for testing)
   - `small` - Fast, decent accuracy
   - `medium` - Good balance (recommended)
   - `large-v3` - Best accuracy, slower

2. **Performance**:
   - Medium model: ~5-10 minutes per hour of audio
   - Large model: ~10-20 minutes per hour of audio
   - Processing time depends on your hardware (CPU/GPU)

3. **Resuming Work**:
   - Queue is saved to disk
   - Safe to stop and restart worker
   - Won't re-transcribe completed files

4. **Troubleshooting**:
   - Check `transcription_worker.log` for errors
   - Check `transcription_status.json` for current state
   - Delete `transcription_queue.json` to reset queue

## Example Session

```bash
# Terminal 1: Start worker
$ source venv/bin/activate
$ cd scripts
$ python transcription_worker.py --model medium
2025-12-17 14:45:00 - Transcription Worker Started
2025-12-17 14:45:00 - Watching: episodes
2025-12-17 14:45:00 - Model: medium
2025-12-17 14:45:00 - Performing initial scan...
2025-12-17 14:45:00 - Added to queue: 0000 - Ad Free 1270 Saran Wrap and Crisco.mp3
2025-12-17 14:45:00 - Queue status: 1 pending, 0 completed, 0 failed
2025-12-17 14:45:01 - Loading Whisper model: medium
2025-12-17 14:45:05 - Model loaded successfully!
2025-12-17 14:45:05 - Starting transcription: 0000 - Ad Free 1270 Saran Wrap and Crisco.mp3
...processing...
2025-12-17 14:55:30 - Completed: 0000 - Ad Free 1270 Saran Wrap and Crisco.mp3
```

```bash
# Terminal 2: Check status while worker runs
$ python check_status.py
============================================================
TRANSCRIPTION WORKER STATUS
============================================================

📅 Last Updated: 2025-12-17T14:55:30 (5s ago)

⏳ Currently Processing: 0000 - Ad Free 1270 Saran Wrap and Crisco.mp3

📊 Queue Status:
   ⏳ Pending: 0
   🔄 Processing: 0000 - Ad Free 1270 Saran Wrap and Crisco.mp3
   ✅ Completed: 0

💡 Tips:
   - Watch live logs: tail -f transcription_worker.log
   - Stop worker: Ctrl+C in the worker terminal
============================================================
```
