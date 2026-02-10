# Episode Management UI - Implementation Plan

## 🎯 Goals

1. **Stop auto-processing** - Worker waits for user selection ✅ DONE
2. **Browse podcast feeds** - Fast loading with caching
3. **Two feed tabs** - Patreon and Apple Podcasts
4. **Sort & Filter** - By date, status, etc.
5. **Transcription status** - Show which episodes are transcribed
6. **Database** - SQLite with proper schema ✅ DONE
7. **Queue management** - Add/remove episodes, see queue
8. **Stop button** - Cancel current transcription

---

## ✅ Completed So Far

### 1. Database Schema (database.py)
Created industry-standard SQLAlchemy models:

**Episodes Table:**
- Basic info (title, description, episode number)
- Media info (URL, file path, duration, size)
- Status flags (downloaded, transcribed, in_queue)
- Transcription metadata
- Feed source (patreon/apple)
- Timestamps for everything

**Transcripts Table:**
- Full text
- Segments with timestamps (JSON)
- Language detection
- Model used

**TranscriptionQueue Table:**
- Priority-based queue
- Retry tracking
- Status management

**Features:**
- Proper indexes for performance
- Foreign key relationships
- JSON serialization methods
- Session management

### 2. Worker Changes
- ✅ Removed auto-scan on startup
- ✅ Worker waits for UI to add episodes
- ✅ No automatic file discovery

### 3. Dependencies
- ✅ Added SQLAlchemy to requirements.txt

---

## 📋 TODO: Backend API Endpoints

Need to create these new API endpoints in `dashboard_server.py`:

### Episode Management
```python
GET  /api/episodes
     - Query params: feed_source, transcribed_only, sort_by, sort_desc, limit, offset
     - Returns: Paginated list of episodes

GET  /api/episodes/:id
     - Returns: Single episode details

POST /api/episodes/refresh-feed
     - Body: {feed_source: "patreon" | "apple"}
     - Returns: {added: 10, updated: 5, cached: 100}
     - Fetches latest from RSS, updates database
     - Uses caching to avoid slow loads

GET  /api/feeds/sources
     - Returns: List of available feed sources with metadata
```

### Queue Management
```python
POST /api/queue/add
     - Body: {episode_id: 123, priority: 0}
     - Adds episode to transcription queue

DELETE /api/queue/remove/:episode_id
     - Removes episode from queue

GET  /api/queue
     - Returns: Current queue with episode details

POST /api/queue/stop-current
     - Stops current transcription (if any)
     - Returns current episode that was stopped

GET  /api/queue/status
     - Returns: {pending: 5, processing: 1, completed: 10, failed: 0}
```

### Download Management
```python
POST /api/episodes/:id/download
     - Downloads audio file for episode
     - Returns: download status

POST /api/episodes/batch-download
     - Body: {episode_ids: [1,2,3]}
     - Downloads multiple episodes
```

---

## 📋 TODO: Frontend UI

### New Components Needed

**1. EpisodesBrowser Component**
```jsx
<EpisodesBrowser>
  <Tabs>
    <TabPanel name="patreon">
      <EpisodeFeed source="patreon" />
    </TabPanel>
    <TabPanel name="apple">
      <EpisodeFeed source="apple" />
    </TabPanel>
  </Tabs>
</EpisodesBrowser>
```

**2. EpisodeFeed Component**
- Table/Grid view of episodes
- Columns: Episode #, Title, Date, Duration, Status
- Sort controls
- Filter controls (transcribed/not transcribed)
- Action buttons (Add to Queue, Download, View)

**3. TranscriptionQueue Component**
```jsx
<TranscriptionQueue>
  <CurrentlyProcessing />
  <QueuedEpisodes />
  <CompletedEpisodes />
  <StopButton />
</TranscriptionQueue>
```

**4. EpisodeCard Component**
- Shows episode details
- Transcription status badge
- Quick actions

---

## 🚀 Fast Feed Loading Strategy

### Problem
RSS feeds can be slow (~5-10 seconds to fetch)

### Solution: Multi-Layer Caching
```python
1. Database Cache (episodes table)
   - Store all fetched episodes
   - Update timestamps
   - Serve from DB instantly

2. In-Memory Cache
   - Keep feed data in memory for 5 minutes
   - Avoid DB hits for repeated requests

3. Background Refresh
   - Fetch new episodes in background
   - Update DB without blocking UI
   - WebSocket notification when new episodes arrive

4. Incremental Updates
   - Only fetch since last update
   - Use RSS GUID/pubDate to detect new
   - Don't refetch entire feed each time
```

### Implementation
```python
class FeedCache:
    def __init__(self):
        self.cache = {}  # {source: {data, timestamp}}
        self.cache_duration = 300  # 5 minutes

    def get_episodes(self, source, force_refresh=False):
        if not force_refresh and self._is_cached(source):
            return self._from_cache(source)

        # Fetch from DB first (instant)
        episodes = db.get_episodes(source=source)

        if episodes:
            return episodes

        # If DB empty or force refresh, fetch from RSS
        return self._fetch_and_update(source)

    def _fetch_and_update(self, source):
        # Background task
        feed_data = download_episodes.parse_feed(source)

        # Update database
        for entry in feed_data:
            db.upsert_episode(entry)

        return db.get_episodes(source=source)
```

---

## 🔄 Implementation Steps

### Phase 1: Database & Backend (1-2 hours)
1. ✅ Create database.py with models
2. ⏳ Create init_database.py script
3. ⏳ Add episode management endpoints to dashboard_server.py
4. ⏳ Add queue management endpoints
5. ⏳ Implement feed caching
6. ⏳ Test all endpoints with curl/Postman

### Phase 2: Frontend UI (2-3 hours)
7. ⏳ Create EpisodesBrowser component with tabs
8. ⏳ Create EpisodeFeed component with table
9. ⏳ Add sort and filter controls
10. ⏳ Create TranscriptionQueue panel
11. ⏳ Add stop button functionality
12. ⏳ Style with Tailwind

### Phase 3: Integration & Testing (1 hour)
13. ⏳ Connect frontend to new API endpoints
14. ⏳ Test add/remove from queue
15. ⏳ Test stop functionality
16. ⏳ Test with both feed sources
17. ⏳ Performance testing

---

## 📊 Database Initialization

To set up the database:

```bash
cd scripts
source ../venv/bin/activate

# Install SQLAlchemy
pip install sqlalchemy

# Initialize database
python database.py

# This creates: data/ice_cream_social.db
```

Or run the init script (to be created):
```bash
python init_database.py --import-existing
```

This will:
- Create database tables
- Import existing transcripts
- Populate episode metadata from RSS feeds

---

## 🎨 UI Mockup

```
┌─────────────────────────────────────────────────────────────┐
│  Ice Cream Social - Episodes                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  📺 Browse Episodes    [Patreon] [Apple Podcasts]           │
│                                                              │
│  Sort: [Date ▼]  Filter: [○ All ● Not Transcribed]         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ #1270  Saran Wrap and Crisco         Dec 17, 2025   │  │
│  │ ✅ Transcribed   1:45:23   [View] [Add to Queue]    │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ #1269  Holiday Special              Dec 16, 2025   │  │
│  │ ⏸️  Not Transcribed   2:15:00   [Download] [Queue]  │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ #1268  Year in Review               Dec 15, 2025   │  │
│  │ 🔄 Processing...   1:30:45   [Stop]                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  📋 Transcription Queue (3 pending)                         │
│                                                              │
│  Currently Processing:                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ #1268 Year in Review  [████████░░] 80%  [🛑 Stop]   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  Up Next:                                                    │
│  1. #1269 Holiday Special                                   │
│  2. #1267 Best Of 2024                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 Configuration

Add to `config.yaml`:

```yaml
feeds:
  patreon:
    url: "https://www.patreon.com/rss/..."
    enabled: true
    cache_duration: 300  # 5 minutes

  apple:
    url: "https://podcasts.apple.com/..."
    enabled: true
    cache_duration: 300

database:
  path: "data/ice_cream_social.db"
  enable_wal: true  # Write-Ahead Logging for better performance
  pool_size: 5
```

---

## 🎯 Next Immediate Steps

Would you like me to:

**Option A: Continue Implementation**
- Create the backend API endpoints
- Implement feed caching
- Build the React UI components

**Option B: Create Helper Scripts First**
- init_database.py - Set up and populate database
- migrate_existing.py - Import existing transcripts
- test_api.py - Test new endpoints

**Option C: Focus on One Feature**
- Just the episode browser with tabs
- Just the queue management
- Just the feed caching

Let me know which direction you'd like to take, and I'll continue building!
