# Exception.md Implementation Plan

Tracks UX bugs and feature requests from `exception.md`. Items are grouped by priority and tagged with completion status.

---

## P0 — Bug Fixes

| # | Status | Issue | Fix |
|---|--------|-------|-----|
| 1a | ✅ | Character edits in Characters tab don't update transcript view | Extended `prevVisibleRef` useEffect in `TranscriptEditor.jsx` to refresh `characterAppearances` and `characters` on tab focus |
| 1d | ✅ | Clicking character badge silently removes it | Replaced single-click remove with hover-reveal × button (`group/char` Tailwind pattern) |
| 3b | ✅ | 🔊 audio drop appears in wrong-speaker flag picker | Filter `voiceLibrary` using an `audioDropNames` Set before rendering picker options |
| 3i | ✅ | Wrong-speaker picker overflows / bad scroll | Added `max-h-48 overflow-y-auto` wrapper around speaker list |
| 7b | ✅ | Commercial tab empty even when segments are labeled commercial | Added `('Commercial', ...)` to `chapter_types` seed insert; changed INNER JOIN → LEFT JOIN in `get_episode_chapters` |

---

## P1 — Feature Additions

| # | Status | Issue | What's Needed |
|---|--------|-------|---------------|
| 4 | ✅ | Add Guest and Scoop badges to speakers | Added `is_guest`/`is_scoop` columns (DB migration), Rust struct fields, command params, form checkboxes, and row badges in `SpeakersPanel.jsx` |
| 4a | ✅ | Episode tooling speaker picker should show Guest/Scoop badges | `PropertiesPanel.jsx` now cross-references `voiceLibrary` with `speakers` DB list to show Host/Guest/Scoop badges right-aligned in dropdown |
| 1b | ✅ | Characters tab: show which episodes each character appears in | New `get_appearances_for_character(character_id)` Rust command + collapsible episode list in `CharactersPanel.jsx` |
| 2 | ✅ | Save vs auto-save confusion | Audit save paths; add "● Unsaved changes" chip near Save button; "✓ saved" micro-toast for immediate-save actions |
| 3a | ✅ | Wrong-speaker flag can't target unassigned soundbites | Include unassigned diarization labels (no `speaker_id`, no `audio_drop_id`) in the wrong-speaker picker |
| 5 | ✅ | Recalibrate speakers doesn't include soundbites | Extend diarization recalibration scope to include audio drop entries |
| 6a | ✅ | Chapter settings UI broken / not wired | Wire `contentAPI.getChapterLabelRules()` into Settings UI; seed default chapter types if table is empty |
| 7c | ✅ | Chapter range selection (click start, type end segment #) | After marking chapter start, show inline "End at segment #___" input; submit calls `createChapter(startIdx, endIdx)` |
| 8 | ✅ | Episode art missing from transcript tooling header | Render `episode.image_url` in `TranscriptEditor.jsx` header; fall back to wiki URL pattern if not populated |
| 9b | ✅ | Deleting a voice sample doesn't rebuild voiceprint | After `deleteVoiceSample()` succeeds, call `rebuildVoiceLibrary(speakerName)`; show "Rebuilding…" indicator |

---

## P2 — Architectural / Future Work

| # | Issue | Scope |
|---|-------|-------|
| 1c | ✅ Characters as a subset of speakers (voiceprint-capable) | Add `speaker_id FK` to `characters` table; route character voice extractions through voice library; enables Macho Man-style recognition |
| 5x | ✅ Recalibrate should include characters (depends on 1c) | Extend recalibration to character-linked speakers once 1c is done |
| 6 AI | ✅ AI-powered chapter detection | Qwen or lightweight model reads transcript + segment position %; outputs suggested `chapter_type` + confidence for human review |
| 7d | ✅ Named sponsor clips + shareable video export | Detect commercial boundaries, fetch episode art, render short video (episode art → transcript bubbles → sponsor overlay), direct download, no server storage |
| 9a | ✅ Auto-harvest voice samples during pipeline | Add `harvest` worker step after `diarize`; auto-create `Speaker_XXXX` entries for unknown voices; users rename/merge/delete in SpeakersPanel |

---

## Implementation Notes

### 1b — Episode appearances in Characters tab
- New Rust command in `src-tauri/src/commands/content.rs`:
  `get_appearances_for_character(character_id: i64) -> Result<Vec<CharacterAppearance>>`
- New DB query in `src-tauri/src/database/mod.rs` — reuse existing `CharacterAppearance` struct; filter by `character_id` instead of `episode_id`
- `CharactersPanel.jsx`: expand character card with collapsible episode list, timestamps, and "jump to segment" links

### 2 — Save/Auto-save clarity
- **Immediate save** (no button needed): flags, chapters, audio drops, character appearances
- **Manual save** (Save button required): speaker name edits, voice sample markers
- Show persistent "● Unsaved changes" chip near Save button when manual changes are pending
- Show brief "✓ saved" toast after any immediate-save action

### 3a — Unassigned soundbites in wrong-speaker picker
- Currently filters to assigned speakers only; unassigned diarization labels (SPEAKER_XX with no assignment) should also appear so they can be flagged

### 6a — Chapter settings UI
- Verify `contentAPI.getChapterLabelRules()` is wired into `SettingsPanel.jsx`
- If the DB table is empty, seed: Intro, Scoop Mail, Jock vs Nerd, Thank Yous, Patreon Extra, Commercial

### 7c — Chapter range selection
- After user clicks "Mark chapter start" on segment N, show inline input: `to segment # [____]`
- On submit, call `createChapter({ startSegmentIdx: N, endSegmentIdx: userInput })`

### 8 — Episode art in header
- `episodes` table has `image_url` field
- If populated: render `<img>` in `TranscriptEditor.jsx` header beside episode title
- If not populated: construct URL from wiki pattern `ICS_{episode_number}.png`

### 9b — Delete sample → rebuild voiceprint
- `SpeakersPanel.jsx` delete handler: after `deleteVoiceSample()` resolves, call `rebuildVoiceLibrary(speakerName)`
- Rust command already exists; just needs to be chained in the frontend

---

## Files Modified (This Session)

**Rust backend**
- `src-tauri/src/database/mod.rs` — is_guest/is_scoop migration, Commercial chapter type seed, LEFT JOIN fix, Speaker struct, get/create/update_speaker queries
- `src-tauri/src/commands/speakers.rs` — is_guest/is_scoop params on create_speaker and update_speaker

**React frontend**
- `scripts/dashboard-react/src/components/TranscriptEditor.jsx` — fixes 1a, 1d, 3b, 3i
- `scripts/dashboard-react/src/components/PropertiesPanel.jsx` — fix 4a (badge display in speaker picker), fix 7b (commercial tab)
- `scripts/dashboard-react/src/components/SpeakersPanel.jsx` — feature 4 (Guest/Scoop badges + form checkboxes)
- `scripts/dashboard-react/src/services/tauri.js` — is_guest/is_scoop params
- `scripts/dashboard-react/src/services/api.js` — is_guest/is_scoop params
