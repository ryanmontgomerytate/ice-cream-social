# Upgrade Guide - v0.1.0 to v0.2.0

## Quick Upgrade Steps

### 1. Install New Dependencies

```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app
source venv/bin/activate
pip install psutil
```

### 2. Clean Up Old Logs (Optional)

Your existing log file is 92KB and contains 1,456 lines of mostly "waiting" messages. You can:

**Option A: Archive and start fresh**
```bash
cd scripts
mv transcription_worker.log transcription_worker.log.old
```

**Option B: Keep as-is**
- New rotation system will manage size going forward
- Old log will be renamed when it hits 10MB

### 3. Test the Improvements

**Basic Test:**
```bash
cd scripts
python transcription_worker.py --model medium
```

Watch for:
- Less frequent logging when idle (every 5 min instead of every 10 sec)
- Memory usage displayed periodically
- Model unloading after 10 min idle

**Test Auto-Shutdown:**
```bash
python transcription_worker.py --model medium --idle-timeout 5
```
Worker should shut down after 5 minutes of no files to process.

**Test Resource Monitoring:**
Watch the logs for entries like:
```
Idle - no files to process. Memory: 487.3 MB (2.0%)
Loading Whisper model: medium (current memory: 487.3 MB)
Model loaded successfully! Used 1534.2 MB (current memory: 2021.5 MB)
```

## What Changed?

### Command-Line Arguments (New)

```bash
--idle-timeout MINUTES    # Auto-shutdown after idle time
--max-retries N          # Retry failed transcriptions (default: 3)
```

### Log Files

**Before:**
- Single `transcription_worker.log` growing indefinitely
- ~6 entries per minute when idle

**After:**
- Rotated logs: `transcription_worker.log`, `.log.1`, `.log.2`
- ~0.2 entries per minute when idle (96% reduction)
- Max 10MB per file, 30MB total

### Memory Management

**Before:**
- Model loaded once, kept in RAM forever (~2-4GB)

**After:**
- Model unloads after 10 minutes idle
- Memory freed back to ~500MB
- Automatically reloads when needed

### Retry Behavior

**Before:**
- Failed transcriptions marked as failed immediately

**After:**
- Automatic retry (3 attempts by default)
- Tracks retry count per file
- Only marks as permanently failed after max retries

## Recommended Configuration

### For Your Setup (M4, 24GB RAM)

**Overnight Processing:**
```bash
python transcription_worker.py \
  --model medium \
  --idle-timeout 60 \
  --max-retries 5 \
  --check-interval 30
```

**Active Development:**
```bash
python transcription_worker.py \
  --model medium \
  --idle-timeout 30
```

**Production/Long-Running:**
```bash
python transcription_worker.py \
  --model medium \
  --max-retries 5 \
  --check-interval 60
```

## Troubleshooting

### "ModuleNotFoundError: No module named 'psutil'"

```bash
pip install psutil
```

### Worker still using lots of memory after 10 minutes

Check the logs for "Unloading Whisper model" message. If not present, the worker might be processing files or checking frequently. Increase `--check-interval` to reduce activity.

### Logs still growing quickly

The new rotation only applies to new log entries. If you see frequent logging:
1. Check if files are being processed
2. Ensure you're running the updated `transcription_worker.py`
3. Look for ERROR or WARNING messages indicating issues

### Want to go back to old behavior

The updated worker is fully backward compatible. To disable new features:
- Don't use `--idle-timeout` (worker runs indefinitely)
- Don't use `--max-retries` (defaults to 3, was implicit before)
- Model unloading happens automatically but won't affect functionality

## Verification

After upgrading, verify everything works:

```bash
# 1. Check worker starts
cd scripts
python transcription_worker.py --model medium &
WORKER_PID=$!

# 2. Let it run for 1 minute
sleep 60

# 3. Check log file size
ls -lh transcription_worker.log

# 4. Stop worker
kill $WORKER_PID

# 5. Check final log size (should be ~1-2KB for 1 min)
wc -l transcription_worker.log
```

Expected result: Much fewer log lines than before (2-3 vs 60+).

## Need Help?

If you encounter issues:
1. Check `transcription_worker.log` for errors
2. Run with `--no-ui` to see console output
3. Use `--check-interval 10` to revert to more frequent checks
4. Remove `--idle-timeout` if auto-shutdown is problematic
