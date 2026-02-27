#!/usr/bin/env python3
"""
Voice Library - Speaker Recognition System
Creates voice embeddings for known speakers and matches against diarization results.
"""

import argparse
import contextlib
import io
import json
import math
import os
import sqlite3
import warnings
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

warnings.filterwarnings("ignore")

# Voice library storage
LIBRARY_DIR = Path(__file__).parent / "voice_library"
LEGACY_EMBEDDINGS_FILE = LIBRARY_DIR / "embeddings.json"
EMBEDDINGS_PYANNOTE_FILE = LIBRARY_DIR / "embeddings_pyannote.json"
EMBEDDINGS_ECAPA_FILE = LIBRARY_DIR / "embeddings_ecapa.json"
SAMPLES_DIR = LIBRARY_DIR / "samples"
SOUND_BITES_DIR = LIBRARY_DIR / "sound_bites"
DEFAULT_DB_PATH = Path(__file__).parent.parent / "data" / "ice_cream_social.db"
STORE_AUTO = "auto"
STORE_JSON = "json"
STORE_SQLITE = "sqlite"

BACKEND_PYANNOTE = "pyannote"
BACKEND_ECAPA = "ecapa-tdnn"
SUPPORTED_BACKENDS = [BACKEND_ECAPA, BACKEND_PYANNOTE]
DEFAULT_BACKEND = BACKEND_PYANNOTE
MODEL_META = {
    BACKEND_PYANNOTE: {
        "model_id": "pyannote/embedding",
        "embedding_dim": 512,
        "dtype": "float32",
        "version_tag": "voice-lib-v1",
    },
    BACKEND_ECAPA: {
        "model_id": "speechbrain/spkrec-ecapa-voxceleb",
        "embedding_dim": 192,
        "dtype": "float32",
        "version_tag": "voice-lib-v1",
    },
}

# Ensure directories exist
LIBRARY_DIR.mkdir(exist_ok=True)
SAMPLES_DIR.mkdir(exist_ok=True)
SOUND_BITES_DIR.mkdir(exist_ok=True)

try:
    from pyannote.audio import Model, Inference
    import torch
    import torchaudio

    PYANNOTE_AVAILABLE = True

    _orig_torch_load = torch.load

    def _patched_torch_load(*args, **kwargs):
        if "weights_only" not in kwargs or kwargs["weights_only"] is None:
            kwargs["weights_only"] = False
        return _orig_torch_load(*args, **kwargs)

    torch.load = _patched_torch_load
except ImportError:
    PYANNOTE_AVAILABLE = False
    import sys

    print("pyannote.audio not available for embeddings", file=sys.stderr)

try:
    from speechbrain.inference.speaker import SpeakerRecognition

    ECAPA_AVAILABLE = True
except ImportError:
    ECAPA_AVAILABLE = False


def _normalize_sample_date(sample_date: Optional[str]) -> Optional[str]:
    if not sample_date:
        return None
    s = str(sample_date).strip()
    if not s:
        return None
    # Accept full timestamps and normalize to YYYY-MM-DD when possible.
    if len(s) >= 10:
        prefix = s[:10]
        try:
            datetime.strptime(prefix, "%Y-%m-%d")
            return prefix
        except ValueError:
            pass
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _resolve_sample_type(
    sample_type: Optional[str],
    audio_path: Path,
    file_path: Optional[str],
) -> str:
    if sample_type in ("speaker", "sound_bite"):
        return sample_type
    for p in (file_path, str(audio_path)):
        if p and "sound_bites" in p:
            return "sound_bite"
    return "speaker"


def _pack_embedding_blob(embedding: np.ndarray) -> Tuple[bytes, int]:
    arr = np.asarray(embedding, dtype=np.float32).flatten()
    return arr.tobytes(), int(arr.shape[0])


def _unpack_embedding_blob(blob: bytes, dim: int) -> np.ndarray:
    arr = np.frombuffer(blob, dtype=np.float32)
    if dim and arr.shape[0] > dim:
        arr = arr[:dim]
    return arr.copy()


class SqliteVoiceEmbeddingStore:
    def __init__(self, db_path: Path, quiet: bool = False):
        self.db_path = Path(db_path)
        self.quiet = quiet
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS voice_embedding_models (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    backend TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    embedding_dim INTEGER NOT NULL,
                    dtype TEXT NOT NULL DEFAULT 'float32',
                    version_tag TEXT NOT NULL DEFAULT 'voice-lib-v1',
                    created_at TEXT DEFAULT (datetime('now', 'localtime')),
                    is_active INTEGER DEFAULT 1,
                    UNIQUE(backend, model_id, embedding_dim, dtype, version_tag)
                );

                CREATE TABLE IF NOT EXISTS voice_embedding_samples (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sample_key TEXT NOT NULL UNIQUE,
                    speaker_name TEXT NOT NULL,
                    sample_type TEXT NOT NULL DEFAULT 'speaker',
                    voice_sample_id INTEGER,
                    episode_id INTEGER,
                    segment_idx INTEGER,
                    file_path TEXT,
                    sample_date TEXT,
                    start_time REAL,
                    end_time REAL,
                    source TEXT DEFAULT 'manual',
                    backend_model_id INTEGER NOT NULL,
                    embedding_blob BLOB NOT NULL,
                    embedding_norm REAL,
                    created_at TEXT DEFAULT (datetime('now', 'localtime')),
                    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY (backend_model_id) REFERENCES voice_embedding_models(id),
                    FOREIGN KEY (voice_sample_id) REFERENCES voice_samples(id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS idx_voice_embedding_samples_speaker
                    ON voice_embedding_samples(speaker_name, sample_type);
                CREATE INDEX IF NOT EXISTS idx_voice_embedding_samples_backend
                    ON voice_embedding_samples(backend_model_id);

                CREATE TABLE IF NOT EXISTS voice_embedding_centroids (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    speaker_name TEXT NOT NULL,
                    sample_type TEXT NOT NULL DEFAULT 'speaker',
                    short_name TEXT,
                    sample_file TEXT,
                    sample_count INTEGER NOT NULL DEFAULT 0,
                    sample_dates_json TEXT,
                    centroid_blob BLOB NOT NULL,
                    embedding_dim INTEGER NOT NULL,
                    dtype TEXT NOT NULL DEFAULT 'float32',
                    backend_model_id INTEGER NOT NULL,
                    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY (backend_model_id) REFERENCES voice_embedding_models(id),
                    UNIQUE(speaker_name, sample_type, backend_model_id)
                );
                CREATE INDEX IF NOT EXISTS idx_voice_embedding_centroids_backend
                    ON voice_embedding_centroids(backend_model_id);
                """
            )

    def _model_row_id(self, conn: sqlite3.Connection, backend: str, embedding_dim: int) -> int:
        meta = MODEL_META.get(backend, {})
        model_id = str(meta.get("model_id", backend))
        dtype = str(meta.get("dtype", "float32"))
        version_tag = str(meta.get("version_tag", "voice-lib-v1"))
        conn.execute(
            """
            INSERT OR IGNORE INTO voice_embedding_models
                (backend, model_id, embedding_dim, dtype, version_tag, is_active)
            VALUES (?, ?, ?, ?, ?, 1)
            """,
            (backend, model_id, embedding_dim, dtype, version_tag),
        )
        row = conn.execute(
            """
            SELECT id FROM voice_embedding_models
            WHERE backend = ? AND model_id = ? AND embedding_dim = ? AND dtype = ? AND version_tag = ?
            LIMIT 1
            """,
            (backend, model_id, embedding_dim, dtype, version_tag),
        ).fetchone()
        if row is None:
            raise RuntimeError(f"Failed to resolve voice embedding model row for backend={backend}")
        return int(row["id"])

    def load_centroids(self, backend: str) -> Dict[str, Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT c.speaker_name, c.sample_type, c.short_name, c.sample_file, c.sample_count,
                       c.sample_dates_json, c.centroid_blob, c.embedding_dim, c.dtype
                FROM voice_embedding_centroids c
                JOIN voice_embedding_models m ON m.id = c.backend_model_id
                WHERE m.backend = ? AND m.is_active = 1
                ORDER BY c.speaker_name COLLATE NOCASE
                """,
                (backend,),
            ).fetchall()

        result: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            speaker_name = str(row["speaker_name"])
            emb = _unpack_embedding_blob(row["centroid_blob"], int(row["embedding_dim"] or 0))
            sample_dates = []
            raw_dates = row["sample_dates_json"]
            if raw_dates:
                try:
                    parsed = json.loads(raw_dates)
                    if isinstance(parsed, list):
                        sample_dates = [str(d) for d in parsed if d]
                except Exception:
                    sample_dates = []
            result[speaker_name] = {
                "embedding": emb.tolist(),
                "short_name": row["short_name"] or speaker_name.split()[0],
                "sample_file": row["sample_file"],
                "sample_count": int(row["sample_count"] or 0),
                "sample_dates": sample_dates,
                "sample_type": row["sample_type"] or "speaker",
            }
        return result

    def replace_centroids(self, backend: str, embeddings: Dict[str, Dict[str, Any]]):
        if not embeddings:
            with self._connect() as conn:
                conn.execute(
                    """
                    DELETE FROM voice_embedding_centroids
                    WHERE backend_model_id IN (
                        SELECT id FROM voice_embedding_models WHERE backend = ?
                    )
                    """,
                    (backend,),
                )
            return

        first = next(iter(embeddings.values()))
        dim = len(first.get("embedding", [])) or int(MODEL_META.get(backend, {}).get("embedding_dim", 0))
        with self._connect() as conn:
            model_id = self._model_row_id(conn, backend, dim)
            conn.execute("DELETE FROM voice_embedding_centroids WHERE backend_model_id = ?", (model_id,))
            for speaker_name, data in embeddings.items():
                emb_arr = np.asarray(data.get("embedding", []), dtype=np.float32).flatten()
                if emb_arr.size == 0:
                    continue
                blob, emb_dim = _pack_embedding_blob(emb_arr)
                sample_type = data.get("sample_type") or "speaker"
                conn.execute(
                    """
                    INSERT OR REPLACE INTO voice_embedding_centroids
                        (speaker_name, sample_type, short_name, sample_file, sample_count, sample_dates_json,
                         centroid_blob, embedding_dim, dtype, backend_model_id, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'float32', ?, datetime('now', 'localtime'))
                    """,
                    (
                        speaker_name,
                        sample_type,
                        data.get("short_name"),
                        data.get("sample_file"),
                        int(data.get("sample_count", 0) or 0),
                        json.dumps(data.get("sample_dates", [])),
                        blob,
                        emb_dim,
                        model_id,
                    ),
                )

    def import_centroids_missing_only(self, backend: str, embeddings: Dict[str, Dict[str, Any]]) -> int:
        """Insert centroids from `embeddings` for speakers not already in SQLite. Returns count added."""
        existing = set(self.load_centroids(backend).keys())
        to_import = {k: v for k, v in embeddings.items() if k not in existing}
        if not to_import:
            return 0
        # Merge: preserve existing + add missing, then write the full set atomically
        merged = {**self.load_centroids(backend), **to_import}
        self.replace_centroids(backend, merged)
        return len(to_import)

    def export_centroids_to_json(self, backend: str) -> Dict[str, Any]:
        """Return centroids as a JSON-serialisable dict matching the legacy embeddings file format."""
        centroids = self.load_centroids(backend)
        return {
            "meta": {
                "backend": backend,
                "exported_at": datetime.utcnow().isoformat() + "Z",
                "source": "sqlite",
            },
            "speakers": centroids,
        }

    def _sample_key(
        self,
        backend: str,
        speaker_name: str,
        sample_type: str,
        file_path: Optional[str],
        episode_id: Optional[int],
        segment_idx: Optional[int],
        start_time: Optional[float],
        end_time: Optional[float],
        voice_sample_id: Optional[int],
    ) -> str:
        parts = [
            backend,
            speaker_name,
            sample_type,
            str(file_path or ""),
            str(episode_id if episode_id is not None else ""),
            str(segment_idx if segment_idx is not None else ""),
            "" if start_time is None else f"{float(start_time):.3f}",
            "" if end_time is None else f"{float(end_time):.3f}",
            str(voice_sample_id if voice_sample_id is not None else ""),
        ]
        return "|".join(parts)

    def upsert_sample_embedding(
        self,
        *,
        backend: str,
        speaker_name: str,
        embedding: np.ndarray,
        sample_type: str,
        voice_sample_id: Optional[int],
        episode_id: Optional[int],
        segment_idx: Optional[int],
        file_path: Optional[str],
        sample_date: Optional[str],
        start_time: Optional[float],
        end_time: Optional[float],
        source: str,
    ):
        blob, dim = _pack_embedding_blob(embedding)
        norm = float(np.linalg.norm(np.asarray(embedding, dtype=np.float32)))
        sample_key = self._sample_key(
            backend,
            speaker_name,
            sample_type,
            file_path,
            episode_id,
            segment_idx,
            start_time,
            end_time,
            voice_sample_id,
        )
        with self._connect() as conn:
            model_id = self._model_row_id(conn, backend, dim)
            conn.execute(
                """
                INSERT INTO voice_embedding_samples
                    (sample_key, speaker_name, sample_type, voice_sample_id, episode_id, segment_idx,
                     file_path, sample_date, start_time, end_time, source, backend_model_id,
                     embedding_blob, embedding_norm, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
                ON CONFLICT(sample_key) DO UPDATE SET
                    voice_sample_id = excluded.voice_sample_id,
                    episode_id = excluded.episode_id,
                    segment_idx = excluded.segment_idx,
                    file_path = excluded.file_path,
                    sample_date = excluded.sample_date,
                    start_time = excluded.start_time,
                    end_time = excluded.end_time,
                    source = excluded.source,
                    backend_model_id = excluded.backend_model_id,
                    embedding_blob = excluded.embedding_blob,
                    embedding_norm = excluded.embedding_norm,
                    updated_at = datetime('now', 'localtime')
                """,
                (
                    sample_key,
                    speaker_name,
                    sample_type,
                    voice_sample_id,
                    episode_id,
                    segment_idx,
                    file_path,
                    sample_date,
                    start_time,
                    end_time,
                    source,
                    model_id,
                    blob,
                    norm,
                ),
            )

    def delete_speaker(self, backend: str, speaker_name: str):
        with self._connect() as conn:
            conn.execute(
                """
                DELETE FROM voice_embedding_samples
                WHERE speaker_name = ?
                  AND backend_model_id IN (SELECT id FROM voice_embedding_models WHERE backend = ?)
                """,
                (speaker_name, backend),
            )
            conn.execute(
                """
                DELETE FROM voice_embedding_centroids
                WHERE speaker_name = ?
                  AND backend_model_id IN (SELECT id FROM voice_embedding_models WHERE backend = ?)
                """,
                (speaker_name, backend),
            )

    def clear_speaker_samples(self, backend: str, speaker_name: str):
        with self._connect() as conn:
            conn.execute(
                """
                DELETE FROM voice_embedding_samples
                WHERE speaker_name = ?
                  AND backend_model_id IN (SELECT id FROM voice_embedding_models WHERE backend = ?)
                """,
                (speaker_name, backend),
            )

    def rebuild_centroids_from_samples(self, backend: str) -> Dict[str, int]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    s.backend_model_id,
                    s.speaker_name,
                    COALESCE(s.sample_type, 'speaker') AS sample_type,
                    s.sample_date,
                    s.file_path,
                    s.embedding_blob,
                    m.embedding_dim
                FROM voice_embedding_samples s
                JOIN voice_embedding_models m ON m.id = s.backend_model_id
                WHERE m.backend = ?
                  AND m.is_active = 1
                """,
                (backend,),
            ).fetchall()

            conn.execute(
                """
                DELETE FROM voice_embedding_centroids
                WHERE backend_model_id IN (
                    SELECT id FROM voice_embedding_models WHERE backend = ?
                )
                """,
                (backend,),
            )

            if not rows:
                return {
                    "sample_rows": 0,
                    "group_count": 0,
                    "centroids_written": 0,
                }

            grouped: Dict[Tuple[int, str, str], Dict[str, Any]] = {}
            for row in rows:
                model_id = int(row["backend_model_id"])
                speaker_name = str(row["speaker_name"])
                sample_type = str(row["sample_type"] or "speaker")
                key = (model_id, speaker_name, sample_type)
                state = grouped.setdefault(
                    key,
                    {
                        "vectors": [],
                        "sample_dates": [],
                        "sample_file": None,
                        "dim": int(row["embedding_dim"] or 0),
                    },
                )

                vec = _unpack_embedding_blob(row["embedding_blob"], int(row["embedding_dim"] or 0))
                if vec.size == 0:
                    continue
                state["vectors"].append(vec)

                sample_date = row["sample_date"]
                if sample_date:
                    normalized = _normalize_sample_date(sample_date)
                    if normalized:
                        state["sample_dates"].append(normalized)

                if not state["sample_file"] and row["file_path"]:
                    state["sample_file"] = Path(str(row["file_path"])).name

            written = 0
            for (model_id, speaker_name, sample_type), state in grouped.items():
                vectors: List[np.ndarray] = state["vectors"]
                if not vectors:
                    continue

                centroid = np.mean(np.stack(vectors, axis=0), axis=0).astype(np.float32)
                blob, emb_dim = _pack_embedding_blob(centroid)
                short_name = speaker_name.split()[0] if speaker_name.split() else speaker_name
                sample_dates = state["sample_dates"][-100:]

                conn.execute(
                    """
                    INSERT INTO voice_embedding_centroids
                        (speaker_name, sample_type, short_name, sample_file, sample_count,
                         sample_dates_json, centroid_blob, embedding_dim, dtype, backend_model_id, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'float32', ?, datetime('now', 'localtime'))
                    ON CONFLICT(speaker_name, sample_type, backend_model_id) DO UPDATE SET
                        short_name = excluded.short_name,
                        sample_file = excluded.sample_file,
                        sample_count = excluded.sample_count,
                        sample_dates_json = excluded.sample_dates_json,
                        centroid_blob = excluded.centroid_blob,
                        embedding_dim = excluded.embedding_dim,
                        dtype = excluded.dtype,
                        updated_at = datetime('now', 'localtime')
                    """,
                    (
                        speaker_name,
                        sample_type,
                        short_name,
                        state["sample_file"],
                        len(vectors),
                        json.dumps(sample_dates),
                        blob,
                        emb_dim,
                        model_id,
                    ),
                )
                written += 1

            return {
                "sample_rows": len(rows),
                "group_count": len(grouped),
                "centroids_written": written,
            }

    def verify_integrity(self, backend: str) -> Dict[str, Any]:
        with self._connect() as conn:
            sample_row = conn.execute(
                """
                SELECT COUNT(*) AS c
                FROM voice_embedding_samples s
                JOIN voice_embedding_models m ON m.id = s.backend_model_id
                WHERE m.backend = ? AND m.is_active = 1
                """,
                (backend,),
            ).fetchone()
            centroid_row = conn.execute(
                """
                SELECT COUNT(*) AS c
                FROM voice_embedding_centroids c
                JOIN voice_embedding_models m ON m.id = c.backend_model_id
                WHERE m.backend = ? AND m.is_active = 1
                """,
                (backend,),
            ).fetchone()
            distinct_speaker_row = conn.execute(
                """
                SELECT COUNT(*) AS c
                FROM (
                    SELECT DISTINCT s.speaker_name, COALESCE(s.sample_type, 'speaker') AS sample_type
                    FROM voice_embedding_samples s
                    JOIN voice_embedding_models m ON m.id = s.backend_model_id
                    WHERE m.backend = ? AND m.is_active = 1
                ) t
                """,
                (backend,),
            ).fetchone()
            orphan_samples_row = conn.execute(
                """
                SELECT COUNT(*) AS c
                FROM voice_embedding_samples s
                JOIN voice_embedding_models m ON m.id = s.backend_model_id
                LEFT JOIN voice_samples vs ON vs.id = s.voice_sample_id
                WHERE m.backend = ?
                  AND m.is_active = 1
                  AND s.voice_sample_id IS NOT NULL
                  AND vs.id IS NULL
                """,
                (backend,),
            ).fetchone()
            speakers_without_centroid_row = conn.execute(
                """
                SELECT COUNT(*) AS c
                FROM (
                    SELECT DISTINCT s.speaker_name, COALESCE(s.sample_type, 'speaker') AS sample_type
                    FROM voice_embedding_samples s
                    JOIN voice_embedding_models m ON m.id = s.backend_model_id
                    WHERE m.backend = ? AND m.is_active = 1
                ) src
                LEFT JOIN (
                    SELECT DISTINCT c.speaker_name, c.sample_type
                    FROM voice_embedding_centroids c
                    JOIN voice_embedding_models m ON m.id = c.backend_model_id
                    WHERE m.backend = ? AND m.is_active = 1
                ) ctr
                  ON ctr.speaker_name = src.speaker_name
                 AND ctr.sample_type = src.sample_type
                WHERE ctr.speaker_name IS NULL
                """,
                (backend, backend),
            ).fetchone()

            missing_voice_sample_files = 0
            for row in conn.execute(
                """
                SELECT file_path
                FROM voice_samples
                WHERE file_path IS NOT NULL
                  AND TRIM(file_path) <> ''
                """
            ).fetchall():
                file_path = str(row["file_path"])
                if not Path(file_path).exists():
                    missing_voice_sample_files += 1

            missing_embedding_files = 0
            for row in conn.execute(
                """
                SELECT s.file_path
                FROM voice_embedding_samples s
                JOIN voice_embedding_models m ON m.id = s.backend_model_id
                WHERE m.backend = ?
                  AND m.is_active = 1
                  AND s.file_path IS NOT NULL
                  AND TRIM(s.file_path) <> ''
                """,
                (backend,),
            ).fetchall():
                file_path = str(row["file_path"])
                if not Path(file_path).exists():
                    missing_embedding_files += 1

            sample_rows = int(sample_row["c"] or 0)
            centroid_rows = int(centroid_row["c"] or 0)
            distinct_speakers = int(distinct_speaker_row["c"] or 0)
            orphan_samples = int(orphan_samples_row["c"] or 0)
            speakers_without_centroid = int(speakers_without_centroid_row["c"] or 0)
            ok = (
                orphan_samples == 0
                and speakers_without_centroid == 0
                and missing_voice_sample_files == 0
                and missing_embedding_files == 0
            )

            return {
                "ok": ok,
                "backend": backend,
                "sample_rows": sample_rows,
                "centroid_rows": centroid_rows,
                "distinct_speaker_groups": distinct_speakers,
                "orphan_embedding_sample_rows": orphan_samples,
                "speakers_without_centroid": speakers_without_centroid,
                "missing_voice_sample_files": missing_voice_sample_files,
                "missing_embedding_sample_files": missing_embedding_files,
            }


class VoiceLibrary:
    """Manages voice embeddings for known speakers"""

    def __init__(
        self,
        hf_token: Optional[str] = None,
        quiet: bool = False,
        backend: str = DEFAULT_BACKEND,
        db_path: Optional[Path] = None,
        store_mode: str = STORE_AUTO,
    ):
        if backend not in SUPPORTED_BACKENDS:
            raise ValueError(f"Unsupported backend: {backend}")

        self.backend = backend
        self.embeddings: Dict[str, Dict[str, Any]] = {}
        self.model = None
        self.inference = None
        self.hf_token = hf_token
        self.stored_backend = backend
        self.db_path = Path(db_path) if db_path else DEFAULT_DB_PATH
        self.store_mode = store_mode
        self.sqlite_store: Optional[SqliteVoiceEmbeddingStore] = None
        self._init_store(quiet=quiet)
        self._load_embeddings(quiet=quiet)

    def _init_store(self, quiet: bool = False):
        if self.store_mode not in (STORE_AUTO, STORE_JSON, STORE_SQLITE):
            raise ValueError(f"Unsupported store mode: {self.store_mode}")
        if self.store_mode == STORE_JSON:
            return
        if self.store_mode == STORE_AUTO and not self.db_path.exists():
            return
        try:
            self.sqlite_store = SqliteVoiceEmbeddingStore(self.db_path, quiet=quiet)
        except Exception as e:
            if not quiet:
                import sys

                print(f"SQLite embedding store unavailable: {e}", file=sys.stderr)
            if self.store_mode == STORE_SQLITE:
                raise RuntimeError(f"SQLite store mode requested but unavailable: {e}") from e
            self.sqlite_store = None

    def _embeddings_file(self, backend: Optional[str] = None) -> Path:
        b = backend or self.backend
        if b == BACKEND_ECAPA:
            return EMBEDDINGS_ECAPA_FILE
        return EMBEDDINGS_PYANNOTE_FILE

    def _load_embeddings(self, quiet: bool = False):
        """Load saved embeddings for the active backend from disk."""
        if self.sqlite_store is not None:
            try:
                loaded = self.sqlite_store.load_centroids(self.backend)
                if loaded:
                    self.embeddings = loaded
                    self.stored_backend = self.backend
                    if not quiet:
                        import sys

                        print(
                            f"Loaded {len(self.embeddings)} speaker embeddings ({self.backend}) from sqlite",
                            file=sys.stderr,
                        )
                    return
            except Exception as e:
                if not quiet:
                    import sys

                    print(f"Failed loading sqlite embeddings ({self.backend}): {e}", file=sys.stderr)
        # SQLite-only mode: no JSON fallback
        if self.store_mode == STORE_SQLITE:
            return
        target = self._embeddings_file()
        data = None

        if target.exists():
            with open(target) as f:
                data = json.load(f)
        elif self.backend == BACKEND_PYANNOTE and LEGACY_EMBEDDINGS_FILE.exists():
            with open(LEGACY_EMBEDDINGS_FILE) as f:
                data = json.load(f)

        if data:
            self.embeddings = data.get("speakers", {})
            self.stored_backend = data.get("meta", {}).get("backend", self.backend)
            if not quiet:
                import sys

                print(
                    f"Loaded {len(self.embeddings)} speaker embeddings ({self.backend})",
                    file=sys.stderr,
                )

    def _save_embeddings(self):
        """Save embeddings to backend-specific storage."""
        # Write JSON only in explicit json mode, or auto mode without a sqlite store available
        if self.store_mode == STORE_JSON or (self.store_mode == STORE_AUTO and self.sqlite_store is None):
            payload = {
                "meta": {
                    "backend": self.backend,
                    "updated_at": datetime.utcnow().isoformat() + "Z",
                },
                "speakers": self.embeddings,
            }
            with open(self._embeddings_file(), "w") as f:
                json.dump(payload, f, indent=2)
        if self.sqlite_store is not None:
            self.sqlite_store.replace_centroids(self.backend, self.embeddings)

    def _init_model(self):
        """Initialize the embedding model (lazy loading)."""
        if self.model is not None:
            return

        if self.backend == BACKEND_ECAPA:
            if not ECAPA_AVAILABLE:
                raise RuntimeError("speechbrain not available")
            cache_dir = str(LIBRARY_DIR / "models" / "speechbrain_ecapa")
            self.model = SpeakerRecognition.from_hparams(
                source="speechbrain/spkrec-ecapa-voxceleb",
                savedir=cache_dir,
            )
            return

        if not PYANNOTE_AVAILABLE:
            raise RuntimeError("pyannote.audio not available")
        if not self.hf_token:
            raise RuntimeError("HuggingFace token required for pyannote speaker embeddings")

        self.model = Model.from_pretrained("pyannote/embedding", use_auth_token=self.hf_token)
        self.inference = Inference(self.model, window="whole")

    def extract_embedding(
        self,
        audio_path: Path,
        start_time: Optional[float] = None,
        end_time: Optional[float] = None,
    ) -> np.ndarray:
        """Extract voice embedding from an audio file or segment."""
        self._init_model()

        waveform, sample_rate = torchaudio.load(str(audio_path))
        if sample_rate != 16000:
            resampler = torchaudio.transforms.Resample(sample_rate, 16000)
            waveform = resampler(waveform)
            sample_rate = 16000

        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)

        if start_time is not None and end_time is not None:
            start_sample = int(start_time * sample_rate)
            end_sample = min(int(end_time * sample_rate), waveform.shape[1])
            waveform = waveform[:, start_sample:end_sample]
            print(
                f"  Extracting segment: {start_time:.2f}s - {end_time:.2f}s "
                f"({waveform.shape[1] / sample_rate:.2f}s)"
            )

        if self.backend == BACKEND_ECAPA:
            emb = self.model.encode_batch(waveform)
            return emb.squeeze().detach().cpu().numpy().flatten()

        emb = self.inference({"waveform": waveform, "sample_rate": 16000})
        return emb.flatten()

    def add_speaker(
        self,
        name: str,
        audio_path: Path,
        short_name: Optional[str] = None,
        start_time: Optional[float] = None,
        end_time: Optional[float] = None,
        update_existing: bool = True,
        sample_date: Optional[str] = None,
        sample_type: Optional[str] = None,
        voice_sample_id: Optional[int] = None,
        episode_id: Optional[int] = None,
        segment_idx: Optional[int] = None,
        file_path: Optional[str] = None,
    ) -> bool:
        """Add a speaker to the library from an audio sample or segment."""
        audio_path = Path(audio_path)
        if not audio_path.exists():
            print(f"Error: Audio file not found: {audio_path}")
            return False

        try:
            print(f"Extracting voice embedding for {name} ({self.backend})...")
            new_embedding = self.extract_embedding(audio_path, start_time, end_time)
            normalized_sample_date = _normalize_sample_date(sample_date)
            resolved_sample_type = _resolve_sample_type(sample_type, audio_path, file_path)

            if self.sqlite_store is not None:
                self.sqlite_store.upsert_sample_embedding(
                    backend=self.backend,
                    speaker_name=name,
                    embedding=new_embedding,
                    sample_type=resolved_sample_type,
                    voice_sample_id=voice_sample_id,
                    episode_id=episode_id,
                    segment_idx=segment_idx,
                    file_path=file_path or str(audio_path),
                    sample_date=normalized_sample_date,
                    start_time=start_time,
                    end_time=end_time,
                    source="manual",
                )

            if name in self.embeddings and update_existing:
                existing = np.array(self.embeddings[name]["embedding"])
                if existing.shape != new_embedding.shape:
                    print(
                        f"Shape mismatch for {name}: {existing.shape} vs {new_embedding.shape}; resetting embedding"
                    )
                    update_existing = False

            if name in self.embeddings and update_existing:
                existing = np.array(self.embeddings[name]["embedding"])
                sample_count = self.embeddings[name].get("sample_count", 1)
                combined = (existing * sample_count + new_embedding) / (sample_count + 1)
                self.embeddings[name]["embedding"] = combined.tolist()
                self.embeddings[name]["sample_count"] = sample_count + 1
                if normalized_sample_date:
                    dates = self.embeddings[name].get("sample_dates", [])
                    dates.append(normalized_sample_date)
                    self.embeddings[name]["sample_dates"] = dates[-100:]
                print(f"✓ Updated {name}'s embedding (now {sample_count + 1} samples)")
            else:
                self.embeddings[name] = {
                    "embedding": new_embedding.tolist(),
                    "short_name": short_name or name.split()[0],
                    "sample_file": str(audio_path.name),
                    "sample_count": 1,
                    "sample_dates": [normalized_sample_date] if normalized_sample_date else [],
                }
                print(f"✓ Added {name} to voice library")

            self._save_embeddings()
            return True
        except Exception as e:
            print(f"Error extracting embedding: {e}")
            import traceback

            traceback.print_exc()
            return False

    def remove_speaker(self, name: str) -> bool:
        if name in self.embeddings:
            del self.embeddings[name]
            self._save_embeddings()
            if self.sqlite_store is not None:
                self.sqlite_store.delete_speaker(self.backend, name)
            print(f"✓ Removed {name} from voice library ({self.backend})")
            return True
        print(f"Speaker not found: {name}")
        return False

    def list_speakers(self) -> List[str]:
        return list(self.embeddings.keys())

    def _mean_date(self, dates: List[str]) -> Optional[date]:
        parsed = []
        for d in dates:
            try:
                parsed.append(datetime.strptime(d, "%Y-%m-%d").date())
            except (ValueError, TypeError):
                continue
        if not parsed:
            return None
        avg_ordinal = sum(d.toordinal() for d in parsed) // len(parsed)
        return date.fromordinal(avg_ordinal)

    def _temporal_weight(self, sample_dates: List[str], target_date: Optional[str]) -> float:
        if not target_date or not sample_dates:
            return 1.0
        try:
            target = datetime.strptime(target_date, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            return 1.0
        avg = self._mean_date(sample_dates)
        if avg is None:
            return 1.0
        days_diff = abs((target - avg).days)
        return 0.5 + 0.5 * math.exp(-days_diff / 365.0)

    def identify_speaker(
        self,
        embedding: np.ndarray,
        threshold: float = 0.5,
        target_date: Optional[str] = None,
    ) -> Tuple[Optional[str], float]:
        if not self.embeddings:
            return None, 0.0

        best_match = None
        best_score = -1.0

        for name, data in self.embeddings.items():
            known_embedding = np.array(data["embedding"])
            if known_embedding.shape != embedding.shape:
                continue

            similarity = np.dot(embedding, known_embedding) / (
                np.linalg.norm(embedding) * np.linalg.norm(known_embedding)
            )
            weight = self._temporal_weight(data.get("sample_dates", []), target_date)
            adjusted = float(similarity * weight)

            if adjusted > best_score:
                best_score = adjusted
                best_match = name

        if best_score >= threshold:
            return best_match, best_score
        return None, max(0.0, best_score)

    def _extract_segment_embedding(self, segment_audio) -> Optional[np.ndarray]:
        try:
            if self.backend == BACKEND_ECAPA:
                emb = self.model.encode_batch(segment_audio)
                return emb.squeeze().detach().cpu().numpy().flatten()
            emb = self.inference({"waveform": segment_audio, "sample_rate": 16000})
            return emb.flatten()
        except Exception:
            return None

    def identify_speakers_in_diarization(
        self,
        diarization_result: Dict[str, Any],
        audio_path: Path,
        return_scores: bool = False,
        episode_date: Optional[str] = None,
        progress_callback=None,
    ) -> Dict[str, Any]:
        if not self.embeddings:
            print("No speakers in voice library")
            return {}

        self._init_model()

        waveform, sample_rate = torchaudio.load(str(audio_path))
        if sample_rate != 16000:
            resampler = torchaudio.transforms.Resample(sample_rate, 16000)
            waveform = resampler(waveform)
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)

        speaker_segments: Dict[str, List[Dict[str, Any]]] = {}
        for seg in diarization_result.get("segments", []):
            speaker = seg.get("speaker")
            if speaker and speaker != "UNKNOWN":
                speaker_segments.setdefault(speaker, []).append(seg)

        speaker_mapping: Dict[str, str] = {}
        speaker_scores: Dict[str, float] = {}

        speaker_labels = list(speaker_segments.keys())
        total = len(speaker_labels)

        for i, speaker_label in enumerate(speaker_labels):
            segments = speaker_segments[speaker_label]
            segments.sort(key=lambda s: s.get("end", 0) - s.get("start", 0), reverse=True)
            top_segments = segments[:5]

            embeddings = []
            for seg in top_segments:
                start_sample = int(seg["start"] * 16000)
                end_sample = min(int(seg["end"] * 16000), waveform.shape[1])
                if end_sample - start_sample < 16000:
                    continue

                segment_audio = waveform[:, start_sample:end_sample]
                emb = self._extract_segment_embedding(segment_audio)
                if emb is not None:
                    embeddings.append(emb)

            if embeddings:
                avg_embedding = np.mean(embeddings, axis=0)
                match, score = self.identify_speaker(avg_embedding, target_date=episode_date)
                speaker_scores[speaker_label] = round(score, 3)
                if match:
                    speaker_mapping[speaker_label] = match
                    print(f"  {speaker_label} -> {match} (confidence: {score:.2f})")
                else:
                    print(f"  {speaker_label} -> Unknown (best score: {score:.2f})")

            if progress_callback is not None and total > 0:
                progress_callback(int((i + 1) / total * 100))

        if return_scores:
            return {
                label: {
                    "name": speaker_mapping.get(label),
                    "confidence": speaker_scores.get(label, 0.0),
                }
                for label in speaker_segments.keys()
            }
        return speaker_mapping


def get_hf_token():
    """Get HuggingFace token from .env file or environment."""
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                if line.startswith("HF_TOKEN=") or line.startswith("HUGGINGFACE_TOKEN="):
                    return line.strip().split("=", 1)[1].strip('"\'')
    return os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")


def _load_diarization_segments(diarization_path: Path) -> Dict[str, Any]:
    with open(diarization_path) as f:
        data = json.load(f)

    if isinstance(data, dict) and "diarization" in data:
        return {"segments": data.get("diarization", {}).get("segments", [])}
    if isinstance(data, dict) and "segments" in data:
        return {"segments": data.get("segments", [])}
    return {"segments": []}


def _normalize_score_result(entry: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(entry, dict):
        return {"name": None, "confidence": 0.0}
    return {
        "name": entry.get("name"),
        "confidence": float(entry.get("confidence", 0.0) or 0.0),
    }


def run_compare_backends(
    diarization_path: Path,
    audio_path: Path,
    episode_date: Optional[str],
    hf_token: Optional[str],
    db_path: Path,
    store_mode: str,
) -> Dict[str, Any]:
    diarization = _load_diarization_segments(diarization_path)
    labels = sorted({s.get("speaker") for s in diarization.get("segments", []) if s.get("speaker")})

    all_results: Dict[str, Dict[str, Any]] = {}
    backend_errors: Dict[str, str] = {}

    backend_mappings: Dict[str, Dict[str, Any]] = {}
    for backend in [BACKEND_ECAPA, BACKEND_PYANNOTE]:
        try:
            library = VoiceLibrary(
                hf_token=hf_token,
                quiet=True,
                backend=backend,
                db_path=db_path,
                store_mode=store_mode,
            )
            with contextlib.redirect_stdout(io.StringIO()):
                mapping = library.identify_speakers_in_diarization(
                    diarization,
                    audio_path,
                    return_scores=True,
                    episode_date=episode_date,
                )
            backend_mappings[backend] = mapping
        except Exception as e:
            backend_errors[backend] = str(e)
            backend_mappings[backend] = {}

    for label in labels:
        all_results[label] = {
            BACKEND_ECAPA: _normalize_score_result(backend_mappings[BACKEND_ECAPA].get(label)),
            BACKEND_PYANNOTE: _normalize_score_result(backend_mappings[BACKEND_PYANNOTE].get(label)),
        }

    return {
        "segments_tested": len(labels),
        "results": all_results,
        "backend_errors": backend_errors,
    }


def add_backend_arg(parser):
    parser.add_argument(
        "--backend",
        choices=SUPPORTED_BACKENDS,
        default=DEFAULT_BACKEND,
        help=f"Embedding backend (default: {DEFAULT_BACKEND})",
    )


def add_store_args(parser):
    parser.add_argument(
        "--db-path",
        type=str,
        default=str(DEFAULT_DB_PATH),
        help="SQLite DB path for embedding store (default: ../data/ice_cream_social.db)",
    )
    parser.add_argument(
        "--store-mode",
        choices=[STORE_AUTO, STORE_JSON, STORE_SQLITE],
        default=STORE_AUTO,
        help=f"Embedding metadata store mode (default: {STORE_AUTO})",
    )


def main():
    parser = argparse.ArgumentParser(description="Voice Library - Speaker Recognition")
    subparsers = parser.add_subparsers(dest="command", help="Command")

    add_parser = subparsers.add_parser("add", help="Add a speaker to the library")
    add_parser.add_argument("name", help="Speaker's full name")
    add_parser.add_argument("audio", help="Path to audio sample")
    add_parser.add_argument("start_time", nargs="?", type=float, help="Start time in seconds (optional)")
    add_parser.add_argument("end_time", nargs="?", type=float, help="End time in seconds (optional)")
    add_parser.add_argument("--short", help="Short name (default: first name)")
    add_parser.add_argument("--sample-type", choices=["speaker", "sound_bite"], default=None)
    add_parser.add_argument("--voice-sample-id", type=int, default=None)
    add_parser.add_argument("--episode-id", type=int, default=None)
    add_parser.add_argument("--segment-idx", type=int, default=None)
    add_parser.add_argument("--file-path", type=str, default=None)
    add_parser.add_argument("--sample-date", type=str, default=None, help="YYYY-MM-DD (or timestamp)")
    add_parser.add_argument("--overwrite", action="store_true", help="Overwrite existing instead of averaging")
    add_backend_arg(add_parser)
    add_store_args(add_parser)

    remove_parser = subparsers.add_parser("remove", help="Remove a speaker")
    remove_parser.add_argument("name", help="Speaker's name")
    add_backend_arg(remove_parser)
    add_store_args(remove_parser)

    list_parser = subparsers.add_parser("list", help="List all speakers in library")
    add_backend_arg(list_parser)
    add_store_args(list_parser)

    identify_parser = subparsers.add_parser("identify", help="Identify speakers in a diarized transcript")
    identify_parser.add_argument("transcript", help="Path to _with_speakers.json file")
    identify_parser.add_argument("audio", help="Path to original audio file")
    identify_parser.add_argument("--episode-date", type=str, default=None)
    add_backend_arg(identify_parser)
    add_store_args(identify_parser)

    info_parser = subparsers.add_parser("info", help="Get voice library info as JSON")
    add_backend_arg(info_parser)
    add_store_args(info_parser)

    rebuild_parser = subparsers.add_parser("rebuild", help="Rebuild embeddings by scanning samples directory")
    add_backend_arg(rebuild_parser)
    add_store_args(rebuild_parser)

    rebuild_one_parser = subparsers.add_parser("rebuild-speaker", help="Rebuild embeddings for one speaker")
    rebuild_one_parser.add_argument("name", help="Speaker's full name")
    add_backend_arg(rebuild_one_parser)
    add_store_args(rebuild_one_parser)

    rebuild_db_parser = subparsers.add_parser(
        "rebuild-from-db",
        help="Rebuild centroids from voice_embedding_samples in SQLite",
    )
    add_backend_arg(rebuild_db_parser)
    add_store_args(rebuild_db_parser)

    verify_parser = subparsers.add_parser(
        "verify",
        help="Verify voice library DB/file integrity and centroid coverage",
    )
    add_backend_arg(verify_parser)
    add_store_args(verify_parser)

    migrate_json_parser = subparsers.add_parser(
        "migrate-json",
        help="Import centroids from JSON file into SQLite for any speakers not already present",
    )
    add_backend_arg(migrate_json_parser)
    add_store_args(migrate_json_parser)

    export_json_parser = subparsers.add_parser(
        "export-json",
        help="Export SQLite centroids to JSON file (portability/debug)",
    )
    add_backend_arg(export_json_parser)
    add_store_args(export_json_parser)
    export_json_parser.add_argument("--output", type=str, default=None, help="Output path (default: embeddings_<backend>.json)")

    compare_parser = subparsers.add_parser("compare", help="Compare ECAPA and pyannote on one diarized episode")
    compare_parser.add_argument("--diarization-json", required=True, help="Path to transcript or diarization JSON")
    compare_parser.add_argument("--audio", required=True, help="Path to original audio file")
    compare_parser.add_argument("--episode-date", type=str, default=None, help="Episode date YYYY-MM-DD")
    add_store_args(compare_parser)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    hf_token = get_hf_token()

    if args.command == "compare":
        diarization_path = Path(args.diarization_json)
        audio_path = Path(args.audio)
        db_path = Path(getattr(args, "db_path", str(DEFAULT_DB_PATH)))
        store_mode = getattr(args, "store_mode", STORE_AUTO)
        if not diarization_path.exists():
            print(json.dumps({"status": "error", "error": f"Diarization file not found: {diarization_path}"}))
            raise SystemExit(1)
        if not audio_path.exists():
            print(json.dumps({"status": "error", "error": f"Audio file not found: {audio_path}"}))
            raise SystemExit(1)

        result = run_compare_backends(
            diarization_path,
            audio_path,
            args.episode_date,
            hf_token,
            db_path,
            store_mode,
        )
        result["episode"] = args.episode_date
        print(json.dumps(result, indent=2))
        return

    quiet = args.command in ("info", "rebuild", "rebuild-speaker", "rebuild-from-db", "verify", "migrate-json", "export-json")
    db_path = Path(getattr(args, "db_path", str(DEFAULT_DB_PATH)))
    store_mode = getattr(args, "store_mode", STORE_AUTO)
    library = VoiceLibrary(
        hf_token=hf_token,
        quiet=quiet,
        backend=args.backend,
        db_path=db_path,
        store_mode=store_mode,
    )

    if args.command == "add":
        library.add_speaker(
            args.name,
            Path(args.audio),
            short_name=args.short,
            start_time=args.start_time,
            end_time=args.end_time,
            update_existing=not args.overwrite,
            sample_date=args.sample_date,
            sample_type=args.sample_type,
            voice_sample_id=args.voice_sample_id,
            episode_id=args.episode_id,
            segment_idx=args.segment_idx,
            file_path=args.file_path,
        )

    elif args.command == "remove":
        library.remove_speaker(args.name)

    elif args.command == "list":
        speakers = library.list_speakers()
        if speakers:
            print(f"Voice Library ({len(speakers)} speakers, backend={library.backend}):")
            for name in speakers:
                data = library.embeddings[name]
                sample_count = data.get("sample_count", 1)
                print(f"  - {name} ({data.get('short_name', 'N/A')}) - {sample_count} sample(s)")
        else:
            print("Voice library is empty. Add speakers with:")
            print("  python voice_library.py add 'Matt Donnelly' path/to/sample.mp3")

    elif args.command == "identify":
        transcript_path = Path(args.transcript)
        audio_path = Path(args.audio)

        if not transcript_path.exists():
            print(f"Transcript not found: {transcript_path}")
            return
        if not audio_path.exists():
            print(f"Audio not found: {audio_path}")
            return

        diarization = _load_diarization_segments(transcript_path)
        if not diarization.get("segments"):
            print("No diarization data in transcript")
            return

        print(f"Identifying speakers (backend={library.backend})...")
        mapping = library.identify_speakers_in_diarization(
            diarization,
            audio_path,
            episode_date=args.episode_date,
        )

        if mapping:
            print("\nSpeaker Mapping:")
            for label, name in mapping.items():
                print(f"  {label} = {name}")

    elif args.command == "info":
        speakers_info = []
        for name, data in library.embeddings.items():
            speakers_info.append(
                {
                    "name": name,
                    "short_name": data.get("short_name", name.split()[0]),
                    "sample_count": data.get("sample_count", 1),
                    "sample_file": data.get("sample_file"),
                    "sample_dates": data.get("sample_dates", []),
                }
            )
        print(
            json.dumps(
                {
                    "backend": library.backend,
                    "active_backend": library.stored_backend,
                    "speakers": speakers_info,
                },
                indent=2,
            )
        )

    elif args.command == "rebuild":
        if library.backend == BACKEND_PYANNOTE and not hf_token:
            import sys

            print(
                "Error: HuggingFace token required for pyannote rebuild. Set HF_TOKEN in .env",
                file=sys.stderr,
                flush=True,
            )
            sys.exit(1)

        rebuilt = 0
        skipped = 0
        errors = 0

        speaker_files = {}
        for root in (SAMPLES_DIR, SOUND_BITES_DIR):
            if not root.exists():
                continue
            for speaker_dir in [d for d in root.iterdir() if d.is_dir()]:
                speaker_name = speaker_dir.name.replace("_", " ")
                audio_files = sorted(
                    [
                        f
                        for f in speaker_dir.iterdir()
                        if f.suffix.lower() in (".wav", ".mp3", ".m4a", ".flac")
                    ]
                )
                if audio_files:
                    speaker_files.setdefault(speaker_name, []).extend(audio_files)

        speaker_names = sorted(speaker_files.keys())
        total = len(speaker_names)

        for i, speaker_name in enumerate(speaker_names):
            audio_files = speaker_files.get(speaker_name, [])
            if not audio_files:
                skipped += 1
                print(f"REBUILD_PROGRESS: {int((i + 1) / max(total, 1) * 100)}", flush=True)
                continue

            if speaker_name in library.embeddings:
                del library.embeddings[speaker_name]
            if library.sqlite_store is not None:
                library.sqlite_store.clear_speaker_samples(library.backend, speaker_name)

            for audio_file in audio_files:
                ok = library.add_speaker(speaker_name, audio_file, update_existing=True)
                if ok:
                    rebuilt += 1
                else:
                    errors += 1

            print(f"REBUILD_PROGRESS: {int((i + 1) / max(total, 1) * 100)}", flush=True)

        print(
            json.dumps(
                {
                    "status": "success",
                    "backend": library.backend,
                    "rebuilt": rebuilt,
                    "skipped": skipped,
                    "errors": errors,
                    "speaker_count": len(library.embeddings),
                }
            )
        )

    elif args.command == "rebuild-speaker":
        if library.backend == BACKEND_PYANNOTE and not hf_token:
            import sys

            print(
                "Error: HuggingFace token required for pyannote. Set HF_TOKEN in .env",
                file=sys.stderr,
                flush=True,
            )
            sys.exit(1)

        speaker_name = args.name
        normalized = speaker_name.replace(" ", "_")
        speaker_dir = SAMPLES_DIR / normalized

        if not speaker_dir.exists():
            if speaker_name in library.embeddings:
                del library.embeddings[speaker_name]
            if library.sqlite_store is not None:
                library.sqlite_store.clear_speaker_samples(library.backend, speaker_name)
            library._save_embeddings()
            print(
                json.dumps(
                    {
                        "status": "success",
                        "backend": library.backend,
                        "rebuilt": 0,
                        "speaker": speaker_name,
                    }
                )
            )
        else:
            audio_files = sorted(
                [
                    f
                    for f in speaker_dir.iterdir()
                    if f.suffix.lower() in (".wav", ".mp3", ".m4a", ".flac")
                ]
            )
            if not audio_files:
                if speaker_name in library.embeddings:
                    del library.embeddings[speaker_name]
                if library.sqlite_store is not None:
                    library.sqlite_store.clear_speaker_samples(library.backend, speaker_name)
                library._save_embeddings()
                print(
                    json.dumps(
                        {
                            "status": "success",
                            "backend": library.backend,
                            "rebuilt": 0,
                            "speaker": speaker_name,
                        }
                    )
                )
            else:
                if speaker_name in library.embeddings:
                    del library.embeddings[speaker_name]
                if library.sqlite_store is not None:
                    library.sqlite_store.clear_speaker_samples(library.backend, speaker_name)
                rebuilt = 0
                for audio_file in audio_files:
                    ok = library.add_speaker(speaker_name, audio_file, update_existing=True)
                    if ok:
                        rebuilt += 1
                print(
                    json.dumps(
                        {
                            "status": "success",
                            "backend": library.backend,
                            "rebuilt": rebuilt,
                            "speaker": speaker_name,
                            "sample_count": library.embeddings.get(speaker_name, {}).get(
                                "sample_count", 0
                            ),
                        }
                    )
                )

    elif args.command == "rebuild-from-db":
        if library.sqlite_store is None:
            print(
                json.dumps(
                    {
                        "status": "error",
                        "backend": library.backend,
                        "error": "SQLite embedding store unavailable (use --store-mode sqlite with valid --db-path)",
                    }
                )
            )
            raise SystemExit(1)

        stats = library.sqlite_store.rebuild_centroids_from_samples(library.backend)
        library._load_embeddings(quiet=True)
        print(
            json.dumps(
                {
                    "status": "success",
                    "backend": library.backend,
                    **stats,
                    "speaker_count": len(library.embeddings),
                }
            )
        )

    elif args.command == "verify":
        if library.sqlite_store is None:
            print(
                json.dumps(
                    {
                        "status": "error",
                        "backend": library.backend,
                        "ok": False,
                        "error": "SQLite embedding store unavailable (use --store-mode sqlite with valid --db-path)",
                    }
                )
            )
            raise SystemExit(1)

        report = library.sqlite_store.verify_integrity(library.backend)
        print(
            json.dumps(
                {
                    "status": "success" if report.get("ok") else "warning",
                    **report,
                }
            )
        )

    elif args.command == "migrate-json":
        if library.sqlite_store is None:
            print(json.dumps({"status": "error", "backend": library.backend, "error": "SQLite store unavailable"}))
            raise SystemExit(1)

        # Load centroids from the JSON file for this backend (no sqlite store active during read)
        json_lib = VoiceLibrary(hf_token=hf_token, quiet=True, backend=library.backend, store_mode=STORE_JSON)
        if not json_lib.embeddings:
            print(json.dumps({"status": "ok", "backend": library.backend, "imported": 0, "message": "No JSON embeddings found"}))
        else:
            imported = library.sqlite_store.import_centroids_missing_only(library.backend, json_lib.embeddings)
            print(
                json.dumps(
                    {
                        "status": "success",
                        "backend": library.backend,
                        "imported": imported,
                        "json_speakers": list(json_lib.embeddings.keys()),
                        "message": f"Imported {imported} speaker(s) from JSON into SQLite",
                    }
                )
            )

    elif args.command == "export-json":
        if library.sqlite_store is None:
            print(json.dumps({"status": "error", "backend": library.backend, "error": "SQLite store unavailable"}))
            raise SystemExit(1)

        payload = library.sqlite_store.export_centroids_to_json(library.backend)
        out_path = Path(args.output) if getattr(args, "output", None) else library._embeddings_file()
        with open(out_path, "w") as f:
            json.dump(payload, f, indent=2)
        print(
            json.dumps(
                {
                    "status": "success",
                    "backend": library.backend,
                    "speaker_count": len(payload.get("speakers", {})),
                    "output": str(out_path),
                }
            )
        )


if __name__ == "__main__":
    main()
