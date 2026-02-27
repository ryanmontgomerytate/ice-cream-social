# Deferred Work — Voice Library (Do Not Start Yet)

  ### 1. sqlite-vec — Local ANN Vector Index

  **What:** Replace linear cosine scan in speaker identification with an HNSW index via sqlite-vec.
  **Why deferred:** At current scale (12 speakers, ~24 sample embeddings), linear scan is nanoseconds.
  sqlite-vec's HNSW index has fixed overhead that outweighs the benefit until ~1,000–5,000 vectors.

  **When to revisit:** When per-sample two-stage matching (V4) is in place AND sample count crosses
  ~1,000 embeddings. Rough thresholds for a single-show library:
  - 12 speakers × 150 samples = ~1,800 vectors → borderline, probably still skip
  - 50 speakers × 20–50 samples = ~2,500 vectors → worth adding
  - Multi-show (5+ podcasts sharing a library) = ~5,000+ vectors → clear win

  **Implementation path:** Add `SqliteVecEmbeddingStore` implementing the same interface as
  `SqliteVoiceEmbeddingStore`. Swap in via `--store-mode sqlite-vec`. No changes to Rust/Tauri layer.
  **Reference:** https://github.com/asg017/sqlite-vec

  ———

  ### 2. FAISS — Offline Accuracy Benchmarking

  **What:** Batch accuracy benchmarks comparing pyannote vs ECAPA-TDNN across many episodes.
  Standalone Python script — no app integration.

  **Why deferred:** The `compare` CLI command already handles one-episode comparison. FAISS enables
  bulk benchmarking to confirm quality improvements before rolling out to all 900 episodes.

  **When to revisit:** After V4 (per-sample quality weighting) is done — run benchmarks to measure
  the gain before full rollout.

  **Scope:** Standalone `scripts/benchmark_speaker_id.py` — reads diarized episodes with known
  speaker labels, embeds with both backends, reports precision/recall/F1 per speaker. No DB writes.
  **Reference:** https://github.com/facebookresearch/faiss

  ———

  ### 3. pgvector — Hosted Multi-Show Platform

  **What:** Postgres vector extension replacing sqlite-vec when the voice library moves to the
  hosted web platform.

  **Why deferred:** No hosted platform to deploy it to yet. Zero benefit in the local Tauri app.

  **When to revisit:** When the web platform is actively being built and voice library queries need
  to run server-side across multiple shows.

  **Implementation path:** Add `PgVectorEmbeddingStore` implementing the same storage interface.
  The abstraction in voice_library.py is already designed for this swap.

  ———

  ### 4. Dual-Model Fusion (pyannote + ECAPA-TDNN Ensemble)

  **What:** Run both embedding backends and combine their similarity scores for a final speaker ID
  decision. pyannote is stronger on temporal context; ECAPA on speaker discriminability. A weighted
  ensemble should outperform either alone.

  **Why deferred:** Doubles inference time. Needs FAISS benchmarks first to establish a quality
  baseline and confirm the gain justifies the cost.

  **Approaches to evaluate (in order of complexity):**
  - Score fusion: `final = w1 * cos_pyannote + w2 * cos_ecapa` — start here, w1=0.6, w2=0.4
  - Decision fusion: each model votes independently, weighted vote wins
  - Feature concat: [512 + 192 = 704-dim] vector + small linear classifier (needs labeled data)

  **DB impact:** Both centroid tables already exist per backend. Fusion is query-time Python only —
  no schema changes needed.

  **Dependency:** FAISS benchmarks (item 2) should run first to confirm the ensemble gain is real.
