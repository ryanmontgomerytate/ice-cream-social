# Development Sessions Log

## Session: February 25, 2026

Plan 
What current reprocess actually uses                                                                                                                                                        
                                                                                                                                                                                              
  More than just voiceprints — but with notable gaps:                                                                                                                                         
                                                                                                                                                                                              
  Uses:                                                                                                                                                                                       
  - ✅ Unresolved wrong_speaker / multiple_speakers / character_voice flags → written to hints JSON                                                                                           
  - ✅ Voice library embeddings (with temporal era decay)                                                                                                                                     
  - ✅ num_speakers_hint derived from how many distinct corrected names are in flags
  - ✅ Episode date for temporal weighting on voice matches

  Gaps:
  - ❌ Resolved flags are excluded — once you mark a flag resolved, that correction never re-feeds the hints. If you re-diarize a second time, you've lost those anchors
  - ❌ Approved Qwen classifications not used — approved segment_classifications (is_performance_bit=1, character_name) never flow back into diarization hints
  - ❌ Approved Scoop Polish corrections not used — approved transcript_corrections survive the reprocess (they live in a separate table) but the multi-speaker notes
  (has_multiple_speakers=1, speaker_change_note) never become hints
  - ❌ Character voice hints are weak — a character_voice flag writes the character name as the corrected_speaker, but pyannote has no concept of "this is a performed voice, not a real
  person" — it still tries to match it against voice prints
  - ❌ ECAPA and pyannote voice libraries are completely siloed — switching backends means starting from zero voiceprints

  ---
  Ideas: Guided Reprocess incorporating Qwen + Scoop Polish

  1 — Richer hints file (fix the gaps)

  Extend the hints JSON to include all approved data sources:

  {
    "corrections": [
      // From unresolved wrong_speaker flags (existing)
      {"segment_idx": 5, "corrected_speaker": "Matt", "is_character": false, "anchor": true},
      // From approved Qwen classifications (NEW)
      {"segment_idx": 12, "corrected_speaker": "Sweet Bean", "is_character": true, "is_performance_bit": true},
      // From RESOLVED flags too (fix the gap — currently excluded)
      {"segment_idx": 2, "corrected_speaker": "Paul", "is_character": false, "anchor": true}
    ],
    "multiple_speakers_segments": [
      // From multiple_speakers flags + Scoop Polish has_multiple_speakers (NEW)
      {"segment_idx": 23, "primary_speaker": "Matt", "note": "~0.4s Paul says 'yeah'"}
    ],
    "exclude_from_voiceprint": [
      // Character voice segments — tell pyannote to ignore these for speaker ID (NEW)
      12, 34, 67
    ],
    "num_speakers_hint": 3
  }

  The exclude_from_voiceprint list is the key insight — currently pyannote wastes time trying to match Sweet Bean's voice against your voice library and probably misidentifies her as Paul
  (similar register). Telling the script to skip those segments during voice matching would clean up a lot of phantom speakers.

  2 — Post-reprocess: auto-apply approved corrections

  Approved Scoop Polish text corrections should survive any reprocess (they're in a separate table) and be re-applied to transcript_segments automatically after diarization completes. Right
  now they persist in the transcript_corrections table but the UI requires manual re-approval after reprocess. That's unnecessary friction.

  3 — Post-reprocess: targeted Qwen validation

  After a guided reprocess, only re-run Qwen Polish on segments whose speaker label changed from the previous run. Those are the highest-risk segments for transcription errors (voice ID
  uncertainty correlates with speech clarity issues).

  4 — ECAPA as a second-opinion, not an alternative

  Instead of choosing one backend, run both in parallel and take the higher-confidence result. The two models fail differently — pyannote is better at segmentation, ECAPA-TDNN is better at
  short clip verification. A simple merge rule: if pyannote confidence ≥ 0.75 use it, else try ECAPA, else flag as uncertain. This doubles the voice library value since you'd build prints
  for both backends.

  ---
  Data points extractable from episodes — feeding back into the initial pipeline

  From a single episode

  ┌─────────────────────────────┬───────────────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │           Signal            │        Where it comes from        │                                              How it improves pipeline                                               │
  ├─────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Corrected speaker per       │ Resolved flags                    │ Expands voice library with labeled clips → better auto-ID on future episodes                                        │
  │ segment                     │                                   │                                                                                                                     │
  ├─────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Character voice segments    │ Approved Qwen classifications     │ Builds character clip library for audio drop detection + excludes from speaker matching                             │
  ├─────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Transcript error patterns   │ Approved Scoop Polish             │ Podcast-specific vocabulary for a custom Whisper prompt (initial_prompt) — "Ice Cream Social, Scoops,               │
  │                             │                                   │ fartsinabag.biz" etc.                                                                                               │
  ├─────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Multi-speaker timestamps    │ Scoop Polish                      │ Can be cross-referenced with audio energy to detect crosstalk patterns                                              │
  │                             │ has_multiple_speakers             │                                                                                                                     │
  ├─────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Jock vs Nerd segments       │ Qwen classification               │ Structural template for chapter auto-labeling                                                                       │
  └─────────────────────────────┴───────────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  From multiple episodes (the compounding value)

  Speaker clustering: If SPEAKER_00 in episode 697 and SPEAKER_02 in episode 698 both auto-assign to Matt with ≥0.85 confidence, you now know Matt's voice print is stable. Episodes where the
   auto-ID failed (confidence < 0.75) probably have audio quality issues — flag those for manual review before queueing.

  Episode structure priors: After 50 episodes are processed with approved chapters, you can extract a probabilistic template: "Intro at 0:00–2:00, Jock vs Nerd starts around 45–55 min mark."
   Feed that as chapter seed hints to new episodes — auto-label and let the user correct rather than detect from scratch.

  Vocabulary corpus for Whisper fine-tuning / prompting: Every approved Scoop Polish correction is a ground-truth (heard wrong → heard right) training pair. 500+ corrections = enough to
  build a custom initial_prompt for Whisper that dramatically reduces mishearings of show-specific terms.

  Voice drift tracking: The temporal decay weighting already handles this but only forward — you can mine backwards too. Episodes from 2014–2018 where Matt's voice is younger should have a
  separate voice print bucket. The sample_dates list in the voice library supports this but nobody's mining it yet.

  Cross-episode character consistency: If Sweet Bean appears in episodes 200, 350, 500, and 697 — you have audio clips and you can auto-detect likely character appearances in unprocessed
  episodes by scanning for segments matching Sweet Bean's known voice print (separate from regular speaker diarization pass).

  ---
  The highest-ROI short-term improvement is fixing the hints file to include resolved flags + approved Qwen classifications + exclude character voice segments from voice matching. That's a
  Rust-side change to reprocess_diarization in commands/episodes.rs — want me to implement that?