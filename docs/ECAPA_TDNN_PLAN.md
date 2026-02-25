# ECAPA-TDNN Embedding Backend Plan

## Overview

Add ECAPA-TDNN as a toggleable embedding backend alternative to pyannote/embedding.

**Key advantage:** No HuggingFace token required. SpeechBrain 1.0.3 already installed in venv.
**Performance gain:** ~5-10% EER improvement — borderline 0.73 confidence → ~0.79, crossing auto-assign threshold.

---

## Files to Modify

| File | Change |
|---|---|
| `scripts/voice_library.py` | Add `--backend` flag; branch `_init_model()` for ecapa vs pyannote; store backend in embeddings.json metadata |
| `src-tauri/src/commands/speakers.rs` | Read `embedding_model` setting and pass `--backend` to all voice_library.py calls; add `set_embedding_model` and `compare_embedding_backends` commands |
| `src-tauri/src/lib.rs` | Register new commands in invoke_handler |
| `scripts/dashboard-react/src/components/SpeakersPanel.jsx` | Add backend selector UI in header; warn on switch that rebuild is required; add "Compare Backends" button/modal |

---

## Step 1 — `voice_library.py`

### `__init__`
```python
def __init__(self, backend: str = "ecapa-tdnn"):
    self.backend = backend
    self.model = None
    self._load_embeddings()
```

### `_init_model()`
```python
def _init_model(self):
    if self.backend == "ecapa-tdnn":
        from speechbrain.inference.speaker import SpeakerRecognition
        self.model = SpeakerRecognition.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir="/tmp/speechbrain_ecapa"
        )
    else:  # pyannote
        from pyannote.audio import Model
        hf_token = os.getenv("HF_TOKEN")
        self.model = Model.from_pretrained("pyannote/embedding", use_auth_token=hf_token)
```

### `_load_embeddings()` — read `meta.backend`
- On load, read `data.get("meta", {}).get("backend", "pyannote")` and store as `self.stored_backend`
- Defaults to `"pyannote"` for existing files (backward compat)

### `_save_embeddings()` — write `meta.backend`
- Include `"meta": {"backend": self.backend}` in the JSON

### `_get_embedding(wav_path)` — branch on backend
- ECAPA: `self.model.encode_batch(signal)` → `.squeeze().numpy()`
- pyannote: existing inference call

### CLI changes
- Add `--backend` arg (default: `"ecapa-tdnn"`) to all subcommands: `rebuild`, `rebuild-speaker`, `add`, `identify`
- Pass to `VoiceLibrary(backend=args.backend)`

### New `compare` subcommand
```bash
python voice_library.py compare \
  --diarization-json scripts/transcripts/2024-11-15_with_speakers.json \
  --episode-date 2024-11-15
```

Output JSON:
```json
{
  "episode": "2024-11-15",
  "segments_tested": 47,
  "results": {
    "SPEAKER_00": {
      "ecapa": {"name": "Matt Donnelly", "confidence": 0.84},
      "pyannote": {"name": "Matt Donnelly", "confidence": 0.79}
    },
    "SPEAKER_01": {
      "ecapa": {"name": "Paul Mattingly", "confidence": 0.81},
      "pyannote": {"name": "Paul Mattingly", "confidence": 0.73}
    }
  }
}
```

Logic:
1. Load ecapa embeddings (from `voice_library/embeddings_ecapa.json` or flag both backends explicitly)
2. Load pyannote embeddings (from `voice_library/embeddings_pyannote.json`)
3. Run `identify_speakers_in_diarization()` with each
4. Merge and return

**Note on embeddings storage:** To support comparison, embeddings need to be stored per-backend:
- `voice_library/embeddings_ecapa.json`
- `voice_library/embeddings_pyannote.json`
- `voice_library/embeddings.json` = symlink or copy of whichever is `configured_backend`

Alternatively: single `embeddings.json` contains active backend; comparison requires both files to exist.

### `get_voice_library()` response additions
Add to the response:
```python
"active_backend": data.get("meta", {}).get("backend", "pyannote"),  # from embeddings.json
"configured_backend": configured_backend,  # from DB setting (passed as arg)
```

---

## Step 2 — `speakers.rs`

### Pass `--backend` to existing commands

In `rebuild_voice_library`, `delete_voice_sample`, `add_voice_sample`, `rebuild_speaker_voice`:
```rust
let backend = db.get_setting("embedding_model")
    .unwrap_or_else(|_| "ecapa-tdnn".to_string());
cmd.arg("--backend").arg(&backend);
```

### New command: `set_embedding_model`
```rust
#[tauri::command]
pub async fn set_embedding_model(
    backend: String,
    db: State<'_, Arc<Database>>,
) -> Result<(), AppError> {
    db.set_setting("embedding_model", &backend)?;
    Ok(())
}
```

### New command: `compare_embedding_backends`
```rust
#[tauri::command]
pub async fn compare_embedding_backends(
    episode_id: i64,
    db: State<'_, Arc<Database>>,
    app: AppHandle,
) -> Result<serde_json::Value, AppError> {
    // Find _with_speakers.json for episode
    // Get episode published_date from DB
    // Call: python voice_library.py compare --diarization-json <path> --episode-date <date>
    // Parse and return JSON output
}
```

### Update `get_voice_library` command
Pass configured_backend to Python so it can return both `active_backend` and `configured_backend`.

### Register in `lib.rs`
Add `set_embedding_model` and `compare_embedding_backends` to invoke_handler.

---

## Step 3 — `SpeakersPanel.jsx`

### Header additions

```jsx
// Backend selector (left of Recalibrate All)
<select value={configuredBackend} onChange={handleBackendChange}>
  <option value="ecapa-tdnn">ECAPA-TDNN (no token needed)</option>
  <option value="pyannote">pyannote/embedding (requires HF_TOKEN)</option>
</select>

// Compare Backends button
<button onClick={() => setShowCompare(true)}>Compare Backends</button>

// Recalibrate All (existing)
```

### Backend mismatch warning
```jsx
{activeBackend !== configuredBackend && (
  <div className="amber warning">
    Voice prints were built with {activeBackend}.
    Click Recalibrate All to switch to {configuredBackend}.
  </div>
)}
```

### `handleBackendChange`
1. Call `invoke('set_embedding_model', { backend: newBackend })`
2. Show toast: "Switching backends requires a full rebuild. All voice prints will be retrained."
3. Refresh voice library data (to show mismatch warning)

### Compare Backends modal/panel
- Episode picker dropdown (filtered to episodes with diarization)
- "Run Comparison" button → calls `invoke('compare_embedding_backends', { episodeId })`
- Results table:

| Label | ECAPA-TDNN | pyannote/embedding |
|---|---|---|
| SPEAKER_00 | **Matt (84%)** | Matt (79%) |
| SPEAKER_01 | **Paul (81%)** | Paul (73%) |

Bold = higher confidence.

---

## State to Track in SpeakersPanel

```js
const [configuredBackend, setConfiguredBackend] = useState('ecapa-tdnn');
const [activeBackend, setActiveBackend] = useState(null); // from embeddings.json meta
const [showCompare, setShowCompare] = useState(false);
const [compareEpisodeId, setCompareEpisodeId] = useState(null);
const [compareResults, setCompareResults] = useState(null);
const [compareLoading, setCompareLoading] = useState(false);
```

`activeBackend` and `configuredBackend` come from `get_voice_library` response.

---

## Verification Checklist

1. Start app, go to Speakers panel
2. Selector shows "ECAPA-TDNN (no token needed)" by default
3. Click "Recalibrate All" → rebuilds using ECAPA-TDNN (no HF_TOKEN prompt)
4. Green "Voice Print" badges appear for Matt, Paul, etc.
5. Switch selector to "pyannote/embedding" → amber mismatch warning appears
6. Switch back → warning clears, existing prints are compatible
7. Add a voice sample → `rebuild-speaker` fires with correct `--backend`
8. Compare Backends: pick diarized episode → table shows both columns
9. Bold = higher confidence column

---

## Notes

- Embeddings are incompatible between backends (192-dim ECAPA vs 512-dim pyannote) — rebuild required on switch
- Existing `voice_library/embeddings.json` defaults to `"pyannote"` backend (backward compat)
- For side-by-side comparison to work, user must rebuild with each backend separately first
- `speechbrain` package already installed in venv (no new dependencies needed for ECAPA)
- pyannote/embedding still requires HF_TOKEN (no change there)

---

*Plan created: Feb 21, 2026*
*Status: Ready to implement*
