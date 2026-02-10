#!/usr/bin/env python3
"""
Voice Library - Speaker Recognition System
Creates voice embeddings for known speakers and matches against diarization results.

Usage:
    # Add a speaker from an audio sample
    python voice_library.py add "Matt Donnelly" path/to/matt_sample.mp3

    # List known speakers
    python voice_library.py list

    # Identify speakers in a diarized transcript
    python voice_library.py identify path/to/transcript_with_speakers.json
"""

import json
import argparse
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import warnings
warnings.filterwarnings('ignore')

# Voice library storage
LIBRARY_DIR = Path(__file__).parent / "voice_library"
EMBEDDINGS_FILE = LIBRARY_DIR / "embeddings.json"
SAMPLES_DIR = LIBRARY_DIR / "samples"

# Ensure directories exist
LIBRARY_DIR.mkdir(exist_ok=True)
SAMPLES_DIR.mkdir(exist_ok=True)

try:
    from pyannote.audio import Model, Inference
    import torch
    import torchaudio
    EMBEDDING_AVAILABLE = True
except ImportError:
    EMBEDDING_AVAILABLE = False
    import sys
    print("pyannote.audio not available for embeddings", file=sys.stderr)


class VoiceLibrary:
    """Manages voice embeddings for known speakers"""

    def __init__(self, hf_token: Optional[str] = None, quiet: bool = False):
        self.embeddings: Dict[str, Dict] = {}
        self.model = None
        self.inference = None
        self.hf_token = hf_token
        self._load_embeddings(quiet=quiet)

    def _load_embeddings(self, quiet: bool = False):
        """Load saved embeddings from disk"""
        if EMBEDDINGS_FILE.exists():
            with open(EMBEDDINGS_FILE) as f:
                data = json.load(f)
                self.embeddings = data.get("speakers", {})
                if not quiet:
                    import sys
                    print(f"Loaded {len(self.embeddings)} speaker embeddings", file=sys.stderr)

    def _save_embeddings(self):
        """Save embeddings to disk"""
        with open(EMBEDDINGS_FILE, 'w') as f:
            json.dump({"speakers": self.embeddings}, f, indent=2)

    def _init_model(self):
        """Initialize the embedding model (lazy loading)"""
        if self.model is not None:
            return

        if not EMBEDDING_AVAILABLE:
            raise RuntimeError("pyannote.audio not available")

        if not self.hf_token:
            raise RuntimeError("HuggingFace token required for speaker embedding model")

        print("Loading speaker embedding model...")
        # Use pyannote's speaker embedding model
        self.model = Model.from_pretrained(
            "pyannote/embedding",
            use_auth_token=self.hf_token
        )
        self.inference = Inference(self.model, window="whole")
        print("Model loaded")

    def extract_embedding(self, audio_path: Path, start_time: Optional[float] = None, end_time: Optional[float] = None) -> np.ndarray:
        """Extract voice embedding from an audio file or segment"""
        self._init_model()

        # Load and preprocess audio
        waveform, sample_rate = torchaudio.load(str(audio_path))

        # Resample to 16kHz if needed
        if sample_rate != 16000:
            resampler = torchaudio.transforms.Resample(sample_rate, 16000)
            waveform = resampler(waveform)
            sample_rate = 16000

        # Convert to mono
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)

        # Extract segment if times specified
        if start_time is not None and end_time is not None:
            start_sample = int(start_time * sample_rate)
            end_sample = int(end_time * sample_rate)
            if end_sample > waveform.shape[1]:
                end_sample = waveform.shape[1]
            waveform = waveform[:, start_sample:end_sample]
            print(f"  Extracting segment: {start_time:.2f}s - {end_time:.2f}s ({waveform.shape[1]/sample_rate:.2f}s)")

        # Extract embedding
        embedding = self.inference({"waveform": waveform, "sample_rate": 16000})
        return embedding.flatten()

    def add_speaker(self, name: str, audio_path: Path, short_name: Optional[str] = None,
                    start_time: Optional[float] = None, end_time: Optional[float] = None,
                    update_existing: bool = True) -> bool:
        """Add a speaker to the library from an audio sample or segment

        Args:
            name: Speaker's full name
            audio_path: Path to audio file
            short_name: Short name (default: first name)
            start_time: Start time in seconds (for segment extraction)
            end_time: End time in seconds (for segment extraction)
            update_existing: If True, average new embedding with existing one
        """
        audio_path = Path(audio_path)
        if not audio_path.exists():
            print(f"Error: Audio file not found: {audio_path}")
            return False

        try:
            print(f"Extracting voice embedding for {name}...")
            new_embedding = self.extract_embedding(audio_path, start_time, end_time)

            # If speaker exists and we should update, average the embeddings
            if name in self.embeddings and update_existing:
                existing = np.array(self.embeddings[name]["embedding"])
                # Weight existing more if we have multiple samples
                sample_count = self.embeddings[name].get("sample_count", 1)
                combined = (existing * sample_count + new_embedding) / (sample_count + 1)
                self.embeddings[name]["embedding"] = combined.tolist()
                self.embeddings[name]["sample_count"] = sample_count + 1
                print(f"✓ Updated {name}'s embedding (now {sample_count + 1} samples)")
            else:
                # New speaker or overwrite
                self.embeddings[name] = {
                    "embedding": new_embedding.tolist(),
                    "short_name": short_name or name.split()[0],
                    "sample_file": str(audio_path.name),
                    "sample_count": 1,
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
        """Remove a speaker from the library"""
        if name in self.embeddings:
            del self.embeddings[name]
            self._save_embeddings()
            print(f"✓ Removed {name} from voice library")
            return True
        print(f"Speaker not found: {name}")
        return False

    def list_speakers(self) -> List[str]:
        """List all speakers in the library"""
        return list(self.embeddings.keys())

    def identify_speaker(self, embedding: np.ndarray, threshold: float = 0.5) -> Tuple[Optional[str], float]:
        """
        Identify a speaker from their voice embedding.

        Returns:
            Tuple of (speaker_name, confidence_score)
            Returns (None, 0.0) if no match above threshold
        """
        if not self.embeddings:
            return None, 0.0

        best_match = None
        best_score = 0.0

        for name, data in self.embeddings.items():
            known_embedding = np.array(data["embedding"])

            # Cosine similarity
            similarity = np.dot(embedding, known_embedding) / (
                np.linalg.norm(embedding) * np.linalg.norm(known_embedding)
            )

            if similarity > best_score:
                best_score = similarity
                best_match = name

        if best_score >= threshold:
            return best_match, best_score
        return None, best_score

    def identify_speakers_in_diarization(self, diarization_result: Dict, audio_path: Path, return_scores: bool = False) -> Dict[str, any]:
        """
        Match diarization labels (SPEAKER_00, etc.) to known speakers.

        Args:
            diarization_result: Output from speaker_diarization.py
            audio_path: Path to the original audio file
            return_scores: If True, returns dict with name and confidence

        Returns:
            If return_scores=False: Mapping of diarization labels to speaker names
                e.g., {"SPEAKER_00": "Matt Donnelly", "SPEAKER_01": "Paul Mattingly"}
            If return_scores=True: Mapping with name and confidence
                e.g., {"SPEAKER_00": {"name": "Matt Donnelly", "confidence": 0.85}}
        """
        if not self.embeddings:
            print("No speakers in voice library")
            return {}

        self._init_model()

        # Load audio
        waveform, sample_rate = torchaudio.load(str(audio_path))
        if sample_rate != 16000:
            resampler = torchaudio.transforms.Resample(sample_rate, 16000)
            waveform = resampler(waveform)
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)

        # Get segments per speaker
        speaker_segments = {}
        for seg in diarization_result.get("segments", []):
            speaker = seg.get("speaker")
            if speaker and speaker != "UNKNOWN":
                if speaker not in speaker_segments:
                    speaker_segments[speaker] = []
                speaker_segments[speaker].append(seg)

        # Extract embedding for each speaker (using their longest segments)
        speaker_mapping = {}
        speaker_scores = {}

        for speaker_label, segments in speaker_segments.items():
            # Sort by duration and take top segments
            segments.sort(key=lambda s: s["end"] - s["start"], reverse=True)
            top_segments = segments[:5]  # Use up to 5 longest segments

            # Extract embeddings from these segments
            embeddings = []
            for seg in top_segments:
                start_sample = int(seg["start"] * 16000)
                end_sample = int(seg["end"] * 16000)

                if end_sample > waveform.shape[1]:
                    end_sample = waveform.shape[1]
                if end_sample - start_sample < 16000:  # Skip segments < 1 second
                    continue

                segment_audio = waveform[:, start_sample:end_sample]

                try:
                    emb = self.inference({"waveform": segment_audio, "sample_rate": 16000})
                    embeddings.append(emb.flatten())
                except:
                    continue

            if embeddings:
                # Average the embeddings
                avg_embedding = np.mean(embeddings, axis=0)

                # Identify against library
                match, score = self.identify_speaker(avg_embedding)
                speaker_scores[speaker_label] = round(score, 3)
                if match:
                    speaker_mapping[speaker_label] = match
                    print(f"  {speaker_label} → {match} (confidence: {score:.2f})")
                else:
                    print(f"  {speaker_label} → Unknown (best score: {score:.2f})")

        # Return with scores if requested
        if return_scores:
            return {
                label: {
                    "name": speaker_mapping.get(label),
                    "confidence": speaker_scores.get(label, 0.0)
                }
                for label in speaker_segments.keys()
            }
        return speaker_mapping


def get_hf_token():
    """Get HuggingFace token from .env file"""
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                if line.startswith("HF_TOKEN=") or line.startswith("HUGGINGFACE_TOKEN="):
                    return line.strip().split("=", 1)[1].strip('"\'')
    import os
    return os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")


def main():
    parser = argparse.ArgumentParser(description="Voice Library - Speaker Recognition")
    subparsers = parser.add_subparsers(dest="command", help="Command")

    # Add speaker
    add_parser = subparsers.add_parser("add", help="Add a speaker to the library")
    add_parser.add_argument("name", help="Speaker's full name")
    add_parser.add_argument("audio", help="Path to audio sample")
    add_parser.add_argument("start_time", nargs="?", type=float, help="Start time in seconds (optional)")
    add_parser.add_argument("end_time", nargs="?", type=float, help="End time in seconds (optional)")
    add_parser.add_argument("--short", help="Short name (default: first name)")
    add_parser.add_argument("--overwrite", action="store_true", help="Overwrite existing instead of averaging")

    # Remove speaker
    remove_parser = subparsers.add_parser("remove", help="Remove a speaker")
    remove_parser.add_argument("name", help="Speaker's name")

    # List speakers
    subparsers.add_parser("list", help="List all speakers in library")

    # Identify speakers in transcript
    identify_parser = subparsers.add_parser("identify", help="Identify speakers in a diarized transcript")
    identify_parser.add_argument("transcript", help="Path to _with_speakers.json file")
    identify_parser.add_argument("audio", help="Path to original audio file")

    # Get library info as JSON
    subparsers.add_parser("info", help="Get voice library info as JSON")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    hf_token = get_hf_token()
    # Use quiet mode for info command to avoid polluting JSON output
    quiet = args.command == "info"
    library = VoiceLibrary(hf_token, quiet=quiet)

    if args.command == "add":
        library.add_speaker(
            args.name,
            Path(args.audio),
            short_name=args.short,
            start_time=args.start_time,
            end_time=args.end_time,
            update_existing=not args.overwrite
        )

    elif args.command == "remove":
        library.remove_speaker(args.name)

    elif args.command == "list":
        speakers = library.list_speakers()
        if speakers:
            print(f"Voice Library ({len(speakers)} speakers):")
            for name in speakers:
                data = library.embeddings[name]
                sample_count = data.get('sample_count', 1)
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

        with open(transcript_path) as f:
            data = json.load(f)

        diarization = data.get("diarization", {})
        if not diarization:
            print("No diarization data in transcript")
            return

        print("Identifying speakers...")
        mapping = library.identify_speakers_in_diarization(
            {"segments": diarization.get("segments", [])},
            audio_path
        )

        if mapping:
            print("\nSpeaker Mapping:")
            for label, name in mapping.items():
                print(f"  {label} = {name}")

    elif args.command == "info":
        # Return voice library info as JSON for the UI
        speakers_info = []
        for name, data in library.embeddings.items():
            speakers_info.append({
                "name": name,
                "short_name": data.get("short_name", name.split()[0]),
                "sample_count": data.get("sample_count", 1),
                "sample_file": data.get("sample_file"),
            })
        print(json.dumps({"speakers": speakers_info}, indent=2))


if __name__ == "__main__":
    main()
