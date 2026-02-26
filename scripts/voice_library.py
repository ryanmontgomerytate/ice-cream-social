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

BACKEND_PYANNOTE = "pyannote"
BACKEND_ECAPA = "ecapa-tdnn"
SUPPORTED_BACKENDS = [BACKEND_ECAPA, BACKEND_PYANNOTE]
DEFAULT_BACKEND = BACKEND_PYANNOTE

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


class VoiceLibrary:
    """Manages voice embeddings for known speakers"""

    def __init__(
        self,
        hf_token: Optional[str] = None,
        quiet: bool = False,
        backend: str = DEFAULT_BACKEND,
    ):
        if backend not in SUPPORTED_BACKENDS:
            raise ValueError(f"Unsupported backend: {backend}")

        self.backend = backend
        self.embeddings: Dict[str, Dict[str, Any]] = {}
        self.model = None
        self.inference = None
        self.hf_token = hf_token
        self.stored_backend = backend
        self._load_embeddings(quiet=quiet)

    def _embeddings_file(self, backend: Optional[str] = None) -> Path:
        b = backend or self.backend
        if b == BACKEND_ECAPA:
            return EMBEDDINGS_ECAPA_FILE
        return EMBEDDINGS_PYANNOTE_FILE

    def _load_embeddings(self, quiet: bool = False):
        """Load saved embeddings for the active backend from disk."""
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
        payload = {
            "meta": {
                "backend": self.backend,
                "updated_at": datetime.utcnow().isoformat() + "Z",
            },
            "speakers": self.embeddings,
        }
        with open(self._embeddings_file(), "w") as f:
            json.dump(payload, f, indent=2)

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
    ) -> bool:
        """Add a speaker to the library from an audio sample or segment."""
        audio_path = Path(audio_path)
        if not audio_path.exists():
            print(f"Error: Audio file not found: {audio_path}")
            return False

        try:
            print(f"Extracting voice embedding for {name} ({self.backend})...")
            new_embedding = self.extract_embedding(audio_path, start_time, end_time)

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
                if sample_date:
                    dates = self.embeddings[name].get("sample_dates", [])
                    dates.append(sample_date)
                    self.embeddings[name]["sample_dates"] = dates[-100:]
                print(f"✓ Updated {name}'s embedding (now {sample_count + 1} samples)")
            else:
                self.embeddings[name] = {
                    "embedding": new_embedding.tolist(),
                    "short_name": short_name or name.split()[0],
                    "sample_file": str(audio_path.name),
                    "sample_count": 1,
                    "sample_dates": [sample_date] if sample_date else [],
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
) -> Dict[str, Any]:
    diarization = _load_diarization_segments(diarization_path)
    labels = sorted({s.get("speaker") for s in diarization.get("segments", []) if s.get("speaker")})

    all_results: Dict[str, Dict[str, Any]] = {}
    backend_errors: Dict[str, str] = {}

    backend_mappings: Dict[str, Dict[str, Any]] = {}
    for backend in [BACKEND_ECAPA, BACKEND_PYANNOTE]:
        try:
            library = VoiceLibrary(hf_token=hf_token, quiet=True, backend=backend)
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


def main():
    parser = argparse.ArgumentParser(description="Voice Library - Speaker Recognition")
    subparsers = parser.add_subparsers(dest="command", help="Command")

    add_parser = subparsers.add_parser("add", help="Add a speaker to the library")
    add_parser.add_argument("name", help="Speaker's full name")
    add_parser.add_argument("audio", help="Path to audio sample")
    add_parser.add_argument("start_time", nargs="?", type=float, help="Start time in seconds (optional)")
    add_parser.add_argument("end_time", nargs="?", type=float, help="End time in seconds (optional)")
    add_parser.add_argument("--short", help="Short name (default: first name)")
    add_parser.add_argument("--overwrite", action="store_true", help="Overwrite existing instead of averaging")
    add_backend_arg(add_parser)

    remove_parser = subparsers.add_parser("remove", help="Remove a speaker")
    remove_parser.add_argument("name", help="Speaker's name")
    add_backend_arg(remove_parser)

    list_parser = subparsers.add_parser("list", help="List all speakers in library")
    add_backend_arg(list_parser)

    identify_parser = subparsers.add_parser("identify", help="Identify speakers in a diarized transcript")
    identify_parser.add_argument("transcript", help="Path to _with_speakers.json file")
    identify_parser.add_argument("audio", help="Path to original audio file")
    identify_parser.add_argument("--episode-date", type=str, default=None)
    add_backend_arg(identify_parser)

    info_parser = subparsers.add_parser("info", help="Get voice library info as JSON")
    add_backend_arg(info_parser)

    rebuild_parser = subparsers.add_parser("rebuild", help="Rebuild embeddings by scanning samples directory")
    add_backend_arg(rebuild_parser)

    rebuild_one_parser = subparsers.add_parser("rebuild-speaker", help="Rebuild embeddings for one speaker")
    rebuild_one_parser.add_argument("name", help="Speaker's full name")
    add_backend_arg(rebuild_one_parser)

    compare_parser = subparsers.add_parser("compare", help="Compare ECAPA and pyannote on one diarized episode")
    compare_parser.add_argument("--diarization-json", required=True, help="Path to transcript or diarization JSON")
    compare_parser.add_argument("--audio", required=True, help="Path to original audio file")
    compare_parser.add_argument("--episode-date", type=str, default=None, help="Episode date YYYY-MM-DD")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    hf_token = get_hf_token()

    if args.command == "compare":
        diarization_path = Path(args.diarization_json)
        audio_path = Path(args.audio)
        if not diarization_path.exists():
            print(json.dumps({"status": "error", "error": f"Diarization file not found: {diarization_path}"}))
            raise SystemExit(1)
        if not audio_path.exists():
            print(json.dumps({"status": "error", "error": f"Audio file not found: {audio_path}"}))
            raise SystemExit(1)

        result = run_compare_backends(diarization_path, audio_path, args.episode_date, hf_token)
        result["episode"] = args.episode_date
        print(json.dumps(result, indent=2))
        return

    quiet = args.command in ("info", "rebuild", "rebuild-speaker")
    library = VoiceLibrary(hf_token=hf_token, quiet=quiet, backend=args.backend)

    if args.command == "add":
        library.add_speaker(
            args.name,
            Path(args.audio),
            short_name=args.short,
            start_time=args.start_time,
            end_time=args.end_time,
            update_existing=not args.overwrite,
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


if __name__ == "__main__":
    main()
