# Character ↔ Performer Tracking

> **Status:** Option A implemented (Feb 2026). Options B/C deferred — see thresholds below.

## Why this matters

Paul Mattingly doing a Paul McCartney impression is acoustically different from Matt Donnelly
doing a Paul McCartney impression. The character is the same; the voice is different. Getting
this distinction into the data is the foundation for everything below.

---

## What's built (Option A)

`character_appearances` now has a `performed_by_speaker_id` column.

When you mark a character on a segment via the `...` menu, the system automatically looks up
who the diarization assigned that segment to and records them as the performer. The Properties
panel shows "· by Paul Mattingly" under each character appearance.

**What this unlocks immediately:**
- "Which characters does Paul perform?" query
- "Who performs Sweet Bean?" → Paul (34×), Matt (2×)
- Diarization hints: richer `exclude_from_voiceprint` context — we know *whose* voice to exclude
- Foundation for voice profiles below

---

## Option B — Characters as speaker sub-entries

Add `parent_speaker_id` to the `speakers` table. A character becomes a child speaker:

```
speakers:
  Paul Mattingly       (real person, no parent)
    └── Paul McCartney voice  (character, parent = Paul Mattingly)
    └── Sweet Bean            (character, parent = Paul Mattingly)
  Matt Donnelly        (real person, no parent)
    └── Sweet Bean            (character, parent = Matt Donnelly — sounds different)
```

**Schema change:** `ALTER TABLE speakers ADD COLUMN parent_speaker_id INTEGER REFERENCES speakers(id)`

**Gets you:**
- Separate voice centroids per character-performer combo in the voice library
- Diarization can eventually cluster and identify "Paul's McCartney voice" as a distinct SPEAKER_XX
- "Characters" section of the app becomes a filtered speaker list, not a separate entity

**Threshold to build:** When you have **≥ 3 distinct characters** that appear in **≥ 10 episodes each**
and the performer distinction is causing missed attributions in diarization. Check by running
`SELECT character_name, performed_by_speaker_name, COUNT(*) FROM ...` — if two different performers
show up for the same character regularly, the acoustic split is worth modeling.

---

## Option C — Character voice profiles in the voice library

Don't change the data model. After marking a segment as "Paul doing McCartney," harvest
that clip into `voice_library/samples/Paul_McCartney__Paul/` (double-underscore = "character
voice performed by speaker"). This is a naming convention on top of the existing harvest pipeline.

**Gets you:**
- Separate embedding centroid per character-performer combo
- Voice ID can distinguish "is this Paul's McCartney or Matt's McCartney?"
- No schema change beyond what's already there

**Threshold to build:** When you have **≥ 20 samples** of a specific character-performer combo
in the voice library. Below that, the centroid is too noisy to be useful. The auto-harvest
pipeline (added Feb 2026) will accumulate these naturally as you review episodes — check
`voice_embedding_samples` table: `SELECT speaker_name, COUNT(*) GROUP BY speaker_name`.

---

## Option D — Per-segment character confidence (future)

After diarization, score each segment: "how likely is this a character voice vs the host's
normal voice?" Store as `character_confidence REAL` in `transcript_segments`. Use this to
surface "probable character moments" for review without manual flagging.

**Threshold:** After Options B or C are in place and generating labeled training data.
Not worth building before that — you need ground truth first.

---

## Performer breakdown query

Run this against `data/ice_cream_social.db` to see the current state:

```sql
-- Full performer breakdown: which characters, who performs them, how often
SELECT
    c.name                                          AS character,
    COALESCE(sp.name, '(unassigned)')               AS performer,
    COUNT(*)                                        AS appearances,
    COUNT(DISTINCT ca.episode_id)                   AS episodes,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY c.name), 1) AS pct_of_char
FROM character_appearances ca
JOIN characters c ON ca.character_id = c.id
LEFT JOIN speakers sp ON ca.performed_by_speaker_id = sp.id
GROUP BY c.name, sp.name
ORDER BY c.name, appearances DESC;
```

**How to read it:**
- `appearances` — total segments tagged for this character/performer pair
- `episodes` — how many distinct episodes the pair shows up in
- `pct_of_char` — what % of this character's total appearances are from this performer (100% = only one person does it; split values signal acoustic diversity)
- `(unassigned)` — segments marked before Option A shipped, or segments where diarization hadn't assigned a speaker yet

**Quick thresholds at a glance:**

| What you see | What it means |
|---|---|
| `pct_of_char = 100` for all characters | One performer owns each character — voice profiles would be clean |
| Two performers sharing a character, both `n ≥ 20` | Option C harvest worth starting |
| 3+ characters each `episodes ≥ 10` with split performers | Option B sub-speaker schema worth it |
| `(unassigned)` rows dominate | Review more episodes before acting on this data |

---

## Decision guide

Ask when you're working on a new episode batch:

1. Run the breakdown query above
2. If any (character, performer) pair has **appearances ≥ 20** → Option C harvest is worth setting up
3. If **3+ characters** each with **episodes ≥ 10** across multiple performers → Option B schema upgrade is worth it
4. If diarization is still confusing character voices with host voices after Option C → Option D

---

*Last updated: February 2026*
*Related issue: [GitHub Issue for Options B–D]*
