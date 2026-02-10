# UI Redesign Plan - Verbose & Actionable Information
**Date:** December 18, 2025
**Goal:** Make all information visible, digestible, and actionable

---

## User Pain Points (Current Issues)

### 1. **Stats Card is Confusing**
**Problem:**
```
Current Display:
┌─────────────────┐
│ Episodes: 1     │
│ Transcribed: 1  │
│ Pending: 0      │
│ Completion: 100%│
└─────────────────┘
```

**Why it's confusing:**
- Shows "Episodes: 1" but there are 905 episodes in database
- Unclear if this means "downloaded" or "total"
- User has to guess what these numbers mean

**Solution:**
```
Redesigned Display:
┌────────────────────────────────────┐
│ 📊 Episode Statistics              │
├────────────────────────────────────┤
│ Total in Database:  905            │
│ Downloaded:         1              │
│ Transcribed:        1              │
│ In Queue:           0              │
│ Failed:             2              │
├────────────────────────────────────┤
│ Completion:  1/1 downloaded (100%) │
│              1/905 total (0.1%)    │
└────────────────────────────────────┘
```

**Key Changes:**
- Show BOTH "total in database" AND "downloaded"
- Show two completion rates: downloaded and total
- Show failed count
- Clear labels - no ambiguity

---

### 2. **Can't View Transcripts**
**Problem:**
- Episode ID 1 is transcribed
- Transcript file exists
- But no button to view it!

**Solution:**
```jsx
<EpisodeCard>
  {episode.is_transcribed && episode.transcript_path && (
    <div className="flex gap-2 mt-3">
      <button className="btn-primary">
        📄 View Transcript
      </button>
      <button className="btn-secondary">
        ⬇️ Download JSON
      </button>
      <button className="btn-secondary">
        📝 Download Text
      </button>
    </div>
  )}
</EpisodeCard>
```

**Features:**
- View transcript in modal or new page
- Download JSON/TXT/SRT/MD formats
- Show transcript metadata (duration, word count, processing time)

---

### 3. **Queue Items Lack Information**
**Problem:**
```
Current Display:
┌─────────────────────────────┐
│ ⏱️ Pending (0)              │
│ (empty)                     │
└─────────────────────────────┘
│ ❌ Failed (2)               │
│ • Episode 3                 │
│ • Episode 4                 │
└─────────────────────────────┘
```

**Why it's not helpful:**
- No error messages shown
- No indication why they failed
- No source information
- No download status
- No retry/remove buttons

**Solution:**
```
Redesigned Display:
┌────────────────────────────────────────────┐
│ ❌ Failed (2)                               │
├────────────────────────────────────────────┤
│ Ad Free 1270: Saran Wrap and Crisco        │
│   📍 Source: Patreon Feed                  │
│   ⬇️ Downloaded: No                        │
│   ❌ Error: No audio file available        │
│   🔁 Retries: 3/3 (max reached)            │
│   [Download First] [Remove from Queue]     │
├────────────────────────────────────────────┤
│ Ad Free 1269: Upside Down Swedish...       │
│   📍 Source: Patreon Feed                  │
│   ⬇️ Downloaded: No                        │
│   ❌ Error: No audio file available        │
│   🔁 Retries: 3/3 (max reached)            │
│   [Download First] [Remove from Queue]     │
└────────────────────────────────────────────┘
```

**Key Information Shown:**
- Episode title (full, not truncated)
- Feed source (Patreon, Apple, Local)
- Download status (Yes/No + file size if downloaded)
- Actual error message from worker
- Retry count (X/3)
- Action buttons (Download, Retry, Remove)

---

### 4. **Current Activity Panel Problems**
**Problem:**
```
Current Display:
┌─────────────────────────────┐
│ ⚡ Current Activity          │
│                              │
│ Transcribing:                │
│ 0000 - Ad Free 1270...       │
└─────────────────────────────┘
```

**Issues:**
- Shows Episode ID 1 as "Transcribing" when it's already done!
- No progress indicator
- No cancel button
- No time estimate
- No verbose status info

**Solution:**
```
Redesigned Display:
┌────────────────────────────────────────────┐
│ ⚡ Current Activity                         │
├────────────────────────────────────────────┤
│ Status: IDLE                                │
│ Last Completed: 2025-12-17 16:06:45        │
│ Next Check: 45 seconds                     │
│                                             │
│ Worker Info:                                │
│   Model: small (optimized)                 │
│   Memory: 2.1 GB / 24 GB                   │
│   Processed Today: 1 episode               │
└────────────────────────────────────────────┘
```

**When Actually Transcribing:**
```
┌────────────────────────────────────────────┐
│ ⚡ Current Activity                         │
├────────────────────────────────────────────┤
│ Status: TRANSCRIBING                        │
│                                             │
│ Episode: Ad Free 1271: Race for...         │
│ Duration: 76 minutes                        │
│ Progress: ~45% (estimated)                 │
│ Elapsed: 2m 15s                            │
│ Estimated Remaining: 3m 10s                │
│                                             │
│ [⏸️ Pause] [🛑 Cancel] [📊 View Log]       │
└────────────────────────────────────────────┘
```

**Key Features:**
- Clear status (IDLE vs TRANSCRIBING vs ERROR)
- Progress estimation
- Time elapsed and remaining
- Cancel/pause buttons
- View log button for debugging
- Worker stats (model, memory)

---

### 5. **Episode Card Information**
**Problem:**
```
Current Display:
┌─────────────────────────────┐
│ 1270                         │  ← Number doesn't match!
│ Ad Free 1270: Saran Wrap...  │
│ [Transcribed]                │
│ [Add to Queue]               │
└─────────────────────────────┘
```

**Issues:**
- Episode number "1270" doesn't match actual number "0000"
- No download status
- No file size
- No transcript info
- No source indicator

**Solution:**
```
Redesigned Display:
┌────────────────────────────────────────────┐
│ Episode #0000 │ 📍 Local File              │
│ Ad Free 1270: Saran Wrap and Crisco        │
│                                             │
│ Duration: 76 min │ Size: 52.6 MB           │
│ Added: 2025-12-17 │ Source: local          │
│                                             │
│ Status: ✅ TRANSCRIBED                     │
│   • Completed: 2025-12-17 16:06:45         │
│   • Processing Time: 36m 35s               │
│   • Transcript: 15,432 words               │
│                                             │
│ [📄 View Transcript] [⬇️ Download]        │
│ [🔄 Re-transcribe] [🗑️ Delete]           │
└────────────────────────────────────────────┘
```

**For Failed Episode:**
```
┌────────────────────────────────────────────┐
│ Episode #1270 │ 📍 Patreon Feed           │
│ Ad Free 1270: Saran Wrap and Crisco        │
│                                             │
│ Duration: 76 min │ Size: Unknown           │
│ Published: 2024-12-15                      │
│                                             │
│ Status: ⬇️ NOT DOWNLOADED                  │
│   • Available in Patreon feed              │
│   • Audio URL: Available                   │
│   • Local file: None                       │
│                                             │
│ ⚠️ Failed Transcription Attempts: 3        │
│   Error: "No audio file available"         │
│   Last Attempt: 2025-12-18 14:11:32        │
│                                             │
│ [⬇️ Download Episode] [🗑️ Remove Failed]  │
└────────────────────────────────────────────┘
```

**Key Information:**
- Actual episode number from database
- Clear source indicator (Local, Patreon, Apple)
- Download status with details
- Verbose error messages
- Transcript stats when available
- Actionable buttons based on state

---

## Information Architecture Redesign

### Dashboard Layout (Redesigned)
```
┌─────────────────────────────────────────────────────────┐
│ 🍦 Ice Cream Social - Transcription Dashboard           │
└─────────────────────────────────────────────────────────┘

┌──────────────────┬──────────────────┬──────────────────┐
│ 📊 Statistics    │ ⚡ Activity      │ 🎯 Quick Actions │
│                  │                  │                  │
│ Total in DB: 905 │ Status: IDLE     │ [Download More]  │
│ Downloaded: 1    │ Next Check: 45s  │ [Refresh Feed]   │
│ Transcribed: 1   │ Model: small     │ [View Logs]      │
│ In Queue: 0      │ Memory: 2.1 GB   │ [Settings]       │
│ Failed: 2        │                  │                  │
└──────────────────┴──────────────────┴──────────────────┘

┌─────────────────────────────────┬──────────────────────┐
│ 📚 Episodes (2/3 width)         │ 🔄 Queue (1/3 width) │
│                                 │                      │
│ [Tabs: Patreon | Apple]        │ ⏱️ Pending (0)       │
│                                 │ (empty)              │
│ [Search...] [Filters] [Sort]   │                      │
│                                 │ ⚙️ Processing (0)    │
│ ┌─────────────────────────┐    │ (empty)              │
│ │ Episode Card (verbose)  │    │                      │
│ │ • All metadata          │    │ ✅ Completed (0)     │
│ │ • Status badges         │    │ (empty)              │
│ │ • Action buttons        │    │                      │
│ │ • Error messages        │    │ ❌ Failed (2)        │
│ └─────────────────────────┘    │ • Verbose errors     │
│                                 │ • Action buttons     │
│ [Load More Episodes (883)]     │ • Retry/Remove       │
└─────────────────────────────────┴──────────────────────┘
```

---

## API Enhancements Needed

### 1. Enhanced `/api/v2/stats` Response
```json
{
  "total_episodes": 905,
  "downloaded_episodes": 1,
  "transcribed_episodes": 1,
  "in_queue": 0,
  "failed": 2,
  "completion_rate": {
    "downloaded": 1.0,
    "total": 0.0011
  },
  "storage": {
    "audio_size_mb": 52.6,
    "transcript_size_mb": 1.2
  }
}
```

### 2. Enhanced `/api/v2/queue` Response
```json
{
  "pending": [],
  "processing": [],
  "completed": [],
  "failed": [
    {
      "id": 2,
      "episode_id": 3,
      "episode": {
        "title": "Ad Free 1270: Saran Wrap and Crisco",
        "episode_number": "1270",
        "feed_source": "patreon",
        "is_downloaded": false,
        "audio_url": "https://...",
        "audio_file_path": null,
        "file_size": null
      },
      "status": "failed",
      "error_message": "No audio file available",
      "retry_count": 3,
      "started_date": "2025-12-18T14:11:32",
      "completed_date": "2025-12-18T14:11:32"
    }
  ]
}
```

### 3. Enhanced `/api/v2/worker/status` Response
```json
{
  "status": "idle",  // idle, transcribing, error
  "current_episode": null,
  "progress": null,
  "elapsed_seconds": null,
  "estimated_remaining_seconds": null,
  "last_activity": "2025-12-17T16:06:45",
  "next_check_seconds": 45,
  "worker_info": {
    "model": "small",
    "memory_mb": 2100,
    "memory_percent": 8.8,
    "processed_today": 1
  }
}
```

### 4. New `/api/v2/episodes/{id}/transcript` Endpoint
```json
{
  "episode_id": 1,
  "text": "Full transcript text...",
  "segments": [...],
  "metadata": {
    "duration": 4594.86,
    "word_count": 15432,
    "processing_time": 2195.52,
    "model": "medium"
  },
  "formats_available": {
    "json": "/transcripts/0000...json",
    "text": "/transcripts/0000...txt",
    "srt": "/transcripts/0000...srt",
    "markdown": "/transcripts/0000...md"
  }
}
```

### 5. New `/api/v2/queue/{id}/cancel` Endpoint
```json
POST /api/v2/queue/{id}/cancel

Response:
{
  "message": "Transcription cancelled",
  "queue_item_id": 5,
  "status": "cancelled"
}
```

---

## Implementation Priority

### Phase 1: Critical Information Display (NOW)
1. ✅ Fix stats card to show total vs downloaded
2. ✅ Add verbose queue item display (source, download status, errors)
3. ✅ Fix current activity display (don't show completed items as processing)
4. ✅ Add "View Transcript" button for transcribed episodes

### Phase 2: Actions (NEXT)
5. ⏳ Add cancel button to current activity
6. ⏳ Add retry/remove buttons to failed queue items
7. ⏳ Add download button for undownloaded episodes

### Phase 3: Polish (LATER)
8. ⏳ Add transcript viewer modal
9. ⏳ Add progress indicators for active transcriptions
10. ⏳ Add worker stats and monitoring

---

## Component Changes Needed

### 1. `Stats.jsx` (NEW)
```jsx
export default function Stats({ stats }) {
  return (
    <div className="stats-card">
      <h3>📊 Episode Statistics</h3>
      <div className="stats-grid">
        <StatItem label="Total in Database" value={stats.total_episodes} />
        <StatItem label="Downloaded" value={stats.downloaded_episodes} />
        <StatItem label="Transcribed" value={stats.transcribed_episodes} />
        <StatItem label="In Queue" value={stats.in_queue} />
        <StatItem label="Failed" value={stats.failed} alert={stats.failed > 0} />
      </div>
      <div className="completion-rates">
        <p>Completion: {stats.transcribed_episodes}/{stats.downloaded_episodes} downloaded ({(stats.completion_rate.downloaded * 100).toFixed(1)}%)</p>
        <p className="text-muted">{stats.transcribed_episodes}/{stats.total_episodes} total ({(stats.completion_rate.total * 100).toFixed(2)}%)</p>
      </div>
    </div>
  )
}
```

### 2. `TranscriptionQueue.jsx` (ENHANCE)
```jsx
function QueueItem({ item, type }) {
  const episode = item.episode

  return (
    <div className={`queue-item queue-item-${type}`}>
      <h4>{episode.title}</h4>

      {/* Verbose Information */}
      <div className="queue-item-details">
        <Detail icon="📍" label="Source" value={episode.feed_source} />
        <Detail icon="⬇️" label="Downloaded" value={episode.is_downloaded ? 'Yes' : 'No'} />

        {type === 'failed' && (
          <>
            <Detail icon="❌" label="Error" value={item.error_message} alert />
            <Detail icon="🔁" label="Retries" value={`${item.retry_count}/3`} />
          </>
        )}

        {type === 'processing' && (
          <>
            <Detail icon="⏱️" label="Elapsed" value={formatDuration(item.elapsed)} />
            <Detail icon="📊" label="Progress" value={`~${item.progress}%`} />
          </>
        )}
      </div>

      {/* Action Buttons */}
      <div className="queue-item-actions">
        {type === 'failed' && !episode.is_downloaded && (
          <button onClick={() => downloadEpisode(episode.id)}>
            ⬇️ Download First
          </button>
        )}
        {type === 'failed' && (
          <button onClick={() => retryTranscription(item.id)}>
            🔄 Retry
          </button>
        )}
        {type === 'processing' && (
          <button onClick={() => cancelTranscription(item.id)}>
            🛑 Cancel
          </button>
        )}
        <button onClick={() => removeFromQueue(item.id)}>
          🗑️ Remove
        </button>
      </div>
    </div>
  )
}
```

### 3. `CurrentActivity.jsx` (NEW)
```jsx
export default function CurrentActivity({ workerStatus }) {
  if (workerStatus.status === 'idle') {
    return (
      <div className="activity-panel">
        <h3>⚡ Current Activity</h3>
        <div className="status-idle">
          <p><strong>Status:</strong> IDLE</p>
          <p>Last Completed: {workerStatus.last_activity}</p>
          <p>Next Check: {workerStatus.next_check_seconds}s</p>
        </div>
        <div className="worker-info">
          <p>Model: {workerStatus.worker_info.model}</p>
          <p>Memory: {workerStatus.worker_info.memory_mb} MB / 24 GB</p>
          <p>Processed Today: {workerStatus.worker_info.processed_today}</p>
        </div>
      </div>
    )
  }

  if (workerStatus.status === 'transcribing') {
    return (
      <div className="activity-panel">
        <h3>⚡ Current Activity</h3>
        <div className="status-active">
          <p><strong>Status:</strong> TRANSCRIBING</p>
          <p><strong>Episode:</strong> {workerStatus.current_episode.title}</p>
          <p>Duration: {formatDuration(workerStatus.current_episode.duration)}</p>
          <p>Progress: ~{workerStatus.progress}%</p>
          <p>Elapsed: {formatDuration(workerStatus.elapsed_seconds)}</p>
          <p>Remaining: ~{formatDuration(workerStatus.estimated_remaining_seconds)}</p>
        </div>
        <div className="activity-actions">
          <button onClick={cancelCurrent}>🛑 Cancel</button>
          <button onClick={viewLog}>📊 View Log</button>
        </div>
      </div>
    )
  }
}
```

### 4. `EpisodeCard.jsx` (ENHANCE)
```jsx
// Add after existing content
{episode.is_transcribed && episode.transcript_path && (
  <div className="transcript-actions">
    <button onClick={() => viewTranscript(episode.id)}>
      📄 View Transcript
    </button>
    <button onClick={() => downloadTranscript(episode.id, 'json')}>
      ⬇️ JSON
    </button>
    <button onClick={() => downloadTranscript(episode.id, 'txt')}>
      📝 TXT
    </button>
  </div>
)}

{!episode.is_downloaded && episode.audio_url && (
  <div className="download-prompt">
    <p className="text-warning">⬇️ Episode not downloaded</p>
    <button onClick={() => downloadEpisode(episode.id)}>
      Download Episode ({episode.file_size_mb} MB)
    </button>
  </div>
)}

{episode.transcription_error && (
  <div className="error-display">
    <p className="text-error">❌ Transcription failed:</p>
    <code>{episode.transcription_error}</code>
  </div>
)}
```

---

## Success Metrics

After redesign, user should be able to:
- ✅ Understand at a glance: total episodes vs downloaded vs transcribed
- ✅ See why failed episodes failed (actual error message)
- ✅ Know if episode is downloaded or needs download first
- ✅ View transcripts for completed episodes
- ✅ Cancel running transcriptions
- ✅ Retry or remove failed queue items
- ✅ Understand current worker status
- ✅ Debug issues faster with verbose information

---

**Next Step:** Implement Phase 1 changes to make information visible and actionable.
