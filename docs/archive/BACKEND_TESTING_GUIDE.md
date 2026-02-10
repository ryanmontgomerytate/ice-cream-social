# Backend Testing Guide - Episode Management System

## 🧪 Complete Backend Testing Workflow

Test the new episode management API before building the frontend.

---

## Step 1: Start the Backend

**Terminal 1: Start Backend Server**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app
./start_dev_simple.sh
```

**Expected Output:**
```
✅ Environment validated!
✅ Backend running
✅ Frontend running
✅ Worker running

Access your app:
  • React Dashboard: http://localhost:3000
  • Backend API:     http://localhost:8000
```

**Verify Backend Started:**
```bash
# Check the logs
tail -f logs/backend.log
```

Look for:
```
✅ Enhanced API v2 registered at /api/v2/
 * Running on http://0.0.0.0:8000
```

---

## Step 2: Test API Health

**Terminal 2: Open new terminal for testing**

```bash
# Test API is responding
curl http://localhost:8000/api/v2/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "version": "2.0",
  "timestamp": "2025-12-18T..."
}
```

✅ If you see this, the enhanced API is working!

---

## Step 3: Test Episodes Endpoint

### Get All Episodes
```bash
curl http://localhost:8000/api/v2/episodes | python3 -m json.tool
```

**Expected Response:**
```json
{
  "episodes": [
    {
      "id": 1,
      "episode_number": "1270",
      "title": "0000 - Ad Free 1270 Saran Wrap and Crisco",
      "audio_url": "file:///Users/ryan/.../episodes/0000 - Ad Free 1270 Saran Wrap and Crisco.mp3",
      "is_downloaded": true,
      "is_transcribed": true,
      "transcription_status": "completed",
      "feed_source": "local",
      ...
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0,
  "has_more": false
}
```

### Test Filtering
```bash
# Get only transcribed episodes
curl "http://localhost:8000/api/v2/episodes?transcribed_only=true" | python3 -m json.tool

# Filter by feed source
curl "http://localhost:8000/api/v2/episodes?feed_source=local" | python3 -m json.tool

# Search by title
curl "http://localhost:8000/api/v2/episodes?search=saran" | python3 -m json.tool
```

### Test Sorting
```bash
# Sort by title
curl "http://localhost:8000/api/v2/episodes?sort_by=title&sort_desc=false" | python3 -m json.tool

# Sort by date (newest first)
curl "http://localhost:8000/api/v2/episodes?sort_by=published_date&sort_desc=true" | python3 -m json.tool
```

### Test Pagination
```bash
# Get first 10
curl "http://localhost:8000/api/v2/episodes?limit=10&offset=0" | python3 -m json.tool

# Get next 10
curl "http://localhost:8000/api/v2/episodes?limit=10&offset=10" | python3 -m json.tool
```

---

## Step 4: Test Single Episode

```bash
# Get episode ID 1
curl http://localhost:8000/api/v2/episodes/1 | python3 -m json.tool
```

**Expected:** Full episode details

```bash
# Test non-existent episode
curl http://localhost:8000/api/v2/episodes/999
```

**Expected:**
```json
{
  "error": "Episode not found"
}
```

✅ Error handling works!

---

## Step 5: Test Queue Management

### Get Queue Status
```bash
curl http://localhost:8000/api/v2/queue/status | python3 -m json.tool
```

**Expected:**
```json
{
  "pending": 0,
  "processing": 0,
  "completed": 0,
  "failed": 0,
  "total": 0
}
```

### Get Full Queue
```bash
curl http://localhost:8000/api/v2/queue | python3 -m json.tool
```

**Expected:**
```json
{
  "queue": {
    "pending": [],
    "processing": [],
    "completed": [],
    "failed": []
  },
  "status": {
    "pending": 0,
    "processing": 0,
    "completed": 0,
    "failed": 0,
    "total": 0
  }
}
```

### Add Episode to Queue
```bash
curl -X POST http://localhost:8000/api/v2/queue/add \
  -H "Content-Type: application/json" \
  -d '{"episode_id": 1, "priority": 0}' | python3 -m json.tool
```

**Expected:**
```json
{
  "message": "Episode added to queue",
  "queue_item": {
    "id": 1,
    "episode_id": 1,
    "status": "pending",
    "priority": 0,
    ...
  },
  "episode": { ... }
}
```

### Verify Episode in Queue
```bash
# Check queue status again
curl http://localhost:8000/api/v2/queue/status | python3 -m json.tool
```

**Expected:**
```json
{
  "pending": 1,  ← Should be 1 now!
  "processing": 0,
  "completed": 0,
  "failed": 0,
  "total": 1
}
```

### Check Episode Status Updated
```bash
curl http://localhost:8000/api/v2/episodes/1 | python3 -m json.tool | grep "is_in_queue"
```

**Expected:**
```
"is_in_queue": true,
```

### Remove from Queue
```bash
curl -X DELETE http://localhost:8000/api/v2/queue/remove/1 | python3 -m json.tool
```

**Expected:**
```json
{
  "message": "Episode removed from queue"
}
```

### Verify Removed
```bash
curl http://localhost:8000/api/v2/queue/status | python3 -m json.tool
```

**Expected:** Pending back to 0

---

## Step 6: Test Feed Sources

```bash
curl http://localhost:8000/api/v2/feeds/sources | python3 -m json.tool
```

**Expected:**
```json
[
  {
    "id": "patreon",
    "name": "Patreon (Premium)",
    "icon": "💎",
    "enabled": true
  },
  {
    "id": "apple",
    "name": "Apple Podcasts",
    "icon": "🎙️",
    "enabled": false
  }
]
```

---

## Step 7: Test Feed Refresh (IMPORTANT!)

This will fetch all 900+ episodes from your RSS feed!

### Check Current Episodes
```bash
curl http://localhost:8000/api/v2/episodes | python3 -m json.tool | grep "total"
```

**Expected:** `"total": 1` (just the local one)

### Trigger Feed Refresh
```bash
curl -X POST http://localhost:8000/api/v2/episodes/refresh-feed \
  -H "Content-Type: application/json" \
  -d '{"source": "patreon", "force": false}' | python3 -m json.tool
```

**Expected:**
```json
{
  "status": "started",
  "message": "Feed refresh started for patreon",
  "source": "patreon"
}
```

### Check Refresh Status
```bash
# Wait a few seconds, then check
curl http://localhost:8000/api/v2/episodes/refresh-status/patreon | python3 -m json.tool
```

**While Refreshing:**
```json
{
  "status": "in_progress",
  "started": "2025-12-18T...",
  "is_refreshing": true
}
```

**After Complete:**
```json
{
  "status": "completed",
  "completed": "2025-12-18T...",
  "added": 902,
  "updated": 1,
  "errors": 0,
  "total": 903,
  "is_refreshing": false
}
```

### Verify Episodes Imported
```bash
curl http://localhost:8000/api/v2/episodes | python3 -m json.tool | grep "total"
```

**Expected:** `"total": 903` (or however many are in your feed)

🎉 If you see 900+ episodes, the feed import works!

---

## Step 8: Test Advanced Features

### Test Search
```bash
# Search for "holiday"
curl "http://localhost:8000/api/v2/episodes?search=holiday&limit=5" | python3 -m json.tool
```

### Test Multiple Filters
```bash
# Get untranscribed Patreon episodes, sorted by date
curl "http://localhost:8000/api/v2/episodes?feed_source=patreon&transcribed_only=false&sort_by=published_date&sort_desc=true&limit=10" | python3 -m json.tool
```

### Test Queue Operations
```bash
# Add multiple episodes to queue
curl -X POST http://localhost:8000/api/v2/queue/add \
  -H "Content-Type: application/json" \
  -d '{"episode_id": 2, "priority": 5}'

curl -X POST http://localhost:8000/api/v2/queue/add \
  -H "Content-Type: application/json" \
  -d '{"episode_id": 3, "priority": 10}'

curl -X POST http://localhost:8000/api/v2/queue/add \
  -H "Content-Type: application/json" \
  -d '{"episode_id": 4, "priority": 1}'

# Check queue - should be ordered by priority (10, 5, 1)
curl http://localhost:8000/api/v2/queue | python3 -m json.tool
```

---

## Step 9: Test Worker Integration

Now that episodes are in the queue, the worker should pick them up!

### Check Worker Logs
```bash
tail -f logs/worker.log
```

**Expected:** Worker should start processing the queued episodes automatically

**Look for:**
```
Starting transcription: [episode name]
Memory before transcription: XXX MB
...
Completed: [episode name]
```

---

## Step 10: Database Inspection (Optional)

Want to see the data directly?

```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app

# Install sqlite3 if needed
# brew install sqlite3

# Open database
sqlite3 data/ice_cream_social.db

# Run queries
sqlite> SELECT COUNT(*) FROM episodes;
sqlite> SELECT title, transcription_status FROM episodes LIMIT 5;
sqlite> SELECT * FROM transcription_queue;
sqlite> .quit
```

---

## ✅ Success Checklist

After testing, you should have:

- ✅ Backend API responding at port 8000
- ✅ Health check passes
- ✅ Episodes endpoint returns data
- ✅ Filtering and sorting works
- ✅ Single episode fetch works
- ✅ Queue operations work (add/remove)
- ✅ Feed refresh successfully imports 900+ episodes
- ✅ Queue status updates correctly
- ✅ Worker picks up queued episodes
- ✅ Database contains all episodes

---

## 🐛 Troubleshooting

### API Returns 404
**Problem:** Enhanced API not registered

**Fix:**
```bash
# Check backend log for this line:
tail -f logs/backend.log | grep "Enhanced API"
```

Should see: `✅ Enhanced API v2 registered at /api/v2/`

If not, check for import errors in the log.

### Feed Refresh Fails
**Problem:** RSS feed URL not configured

**Check:**
```bash
cat config.yaml | grep rss_feed_url
```

**Fix:** Make sure your Patreon RSS URL is in `config.yaml`

### Database Errors
**Problem:** Tables not created

**Fix:**
```bash
cd scripts
../venv/bin/python init_database.py
```

### Worker Not Processing Queue
**Problem:** Using old queue system

**Fix:** Worker needs to be updated to use database queue (Phase 3)

---

## 📊 Testing Results Template

Document your testing:

```
✅ Backend Health: PASS
✅ Get Episodes: PASS (1 episodes)
✅ Add to Queue: PASS
✅ Remove from Queue: PASS
✅ Queue Status: PASS
✅ Feed Refresh: PASS (903 episodes imported)
✅ Filtering: PASS
✅ Sorting: PASS
✅ Pagination: PASS
✅ Search: PASS

Issues Found:
- [ ] Issue 1 description
- [ ] Issue 2 description

Notes:
- Backend is solid and ready for frontend
- All 903 episodes imported successfully
- Queue management works perfectly
```

---

## 🚀 Next Steps After Testing

Once backend testing is complete:

1. **Report Results:** Let me know what worked and what didn't
2. **Build Frontend:** I'll create the React UI components
3. **Integration:** Connect React to the working backend
4. **Full E2E Test:** Test complete workflow through UI

Ready to test? Start with Step 1 and work through each step!
