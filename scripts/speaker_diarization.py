#!/usr/bin/env python3
"""
Speaker Diarization Module
Identifies different speakers in podcast episodes

Uses pyannote.audio for speaker diarization
Integrates with voice_library for automatic speaker identification
Requires HuggingFace token with accepted pyannote terms
"""

import json
import logging
from pathlib import Path
from typing import Optional, Dict, List
import warnings
import torch
import torchaudio
import tempfile
import os

# Voice library integration (optional)
try:
    from voice_library import VoiceLibrary
    VOICE_LIBRARY_AVAILABLE = True
except ImportError:
    VOICE_LIBRARY_AVAILABLE = False

# Fix PyTorch 2.6+ weights_only issue - pyannote is a trusted source
_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    kwargs.setdefault('weights_only', False)
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load

# Suppress warnings
warnings.filterwarnings('ignore')

try:
    from pyannote.audio import Pipeline
    DIARIZATION_AVAILABLE = True
except ImportError:
    DIARIZATION_AVAILABLE = False
    print("⚠️  pyannote.audio not installed. Run: pip install pyannote.audio")

logger = logging.getLogger(__name__)

# Pyannote uses 10-second windows (160000 samples at 16kHz)
WINDOW_SIZE = 160000


def pad_audio_for_diarization(audio_path: Path) -> Optional[Path]:
    """Pad audio to a round number of window sizes to avoid tensor mismatch errors.

    Pyannote's embedding extraction uses 10-second windows. If the last segment
    is shorter, torch.vstack fails. This pads the audio with zeros.

    Returns:
        Path to padded audio file (temporary file), or None if padding not needed
    """
    try:
        waveform, sample_rate = torchaudio.load(str(audio_path))

        # Resample to 16kHz if needed (pyannote expects 16kHz)
        if sample_rate != 16000:
            resampler = torchaudio.transforms.Resample(sample_rate, 16000)
            waveform = resampler(waveform)
            sample_rate = 16000

        # Convert to mono if stereo
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)

        # Calculate padding needed
        current_length = waveform.shape[1]
        remainder = current_length % WINDOW_SIZE

        if remainder == 0:
            logger.info("Audio length is already aligned, no padding needed")
            return None

        padding_needed = WINDOW_SIZE - remainder
        logger.info(f"Padding audio with {padding_needed} samples ({padding_needed/16000:.2f}s) to avoid tensor mismatch")

        # Pad with zeros
        padded_waveform = torch.nn.functional.pad(waveform, (0, padding_needed))

        # Save to temporary file
        temp_dir = tempfile.gettempdir()
        temp_path = Path(temp_dir) / f"diarization_padded_{audio_path.stem}.wav"
        torchaudio.save(str(temp_path), padded_waveform, sample_rate)

        logger.info(f"Created padded audio: {temp_path}")
        return temp_path

    except Exception as e:
        logger.warning(f"Failed to pad audio: {e}")
        return None


class SpeakerDiarizer:
    """Handles speaker diarization for podcast episodes"""

    def __init__(self, hf_token: Optional[str] = None, use_voice_library: bool = True):
        """Initialize speaker diarization pipeline

        Args:
            hf_token: HuggingFace API token (required for pyannote models)
                     Get token at: https://huggingface.co/settings/tokens
                     Accept terms at: https://huggingface.co/pyannote/speaker-diarization-3.1
            use_voice_library: Whether to use voice library for speaker identification
        """
        if not DIARIZATION_AVAILABLE:
            raise RuntimeError("pyannote.audio not available")

        self.hf_token = hf_token
        self.pipeline = None
        self.voice_library = None
        self.use_voice_library = use_voice_library

        if hf_token:
            self._load_pipeline()
            # Initialize voice library if available and enabled
            if use_voice_library and VOICE_LIBRARY_AVAILABLE:
                try:
                    self.voice_library = VoiceLibrary(hf_token)
                    if self.voice_library.embeddings:
                        logger.info(f"Voice library loaded with {len(self.voice_library.embeddings)} speakers")
                    else:
                        logger.info("Voice library is empty - speaker identification disabled")
                        self.voice_library = None
                except Exception as e:
                    logger.warning(f"Failed to load voice library: {e}")
                    self.voice_library = None

    def _load_pipeline(self):
        """Load the diarization pipeline"""
        try:
            logger.info("Loading speaker diarization pipeline...")
            # Use the latest pyannote speaker diarization model
            self.pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=self.hf_token
            )

            # Enable M4 GPU acceleration (MPS on Apple Silicon)
            if torch.backends.mps.is_available():
                logger.info("🚀 Using M4 GPU acceleration (MPS)")
                self.pipeline.to(torch.device("mps"))
            else:
                logger.info("Using CPU (MPS not available)")

            logger.info("✅ Diarization pipeline loaded")
        except Exception as e:
            logger.error(f"Failed to load diarization pipeline: {e}")
            logger.error("Make sure you've accepted the terms at: https://huggingface.co/pyannote/speaker-diarization-3.1")
            raise

    def diarize(self, audio_path: Path, num_speakers: Optional[int] = None,
                progress_callback=None) -> Dict:
        """Run speaker diarization on an audio file

        Args:
            audio_path: Path to audio file
            num_speakers: Expected number of speakers (None = auto-detect)
                         For Ice Cream Social: 2 (Matt & Mattingly) or 3+ with guests
            progress_callback: Optional callback for progress updates

        Returns:
            Dictionary with speaker segments:
            {
                'speakers': ['SPEAKER_00', 'SPEAKER_01', ...],
                'segments': [
                    {
                        'start': 0.0,
                        'end': 5.2,
                        'speaker': 'SPEAKER_00'
                    },
                    ...
                ]
            }
        """
        if not self.pipeline:
            raise RuntimeError("Pipeline not loaded. Provide HuggingFace token.")

        logger.info(f"Running speaker diarization on: {audio_path.name}")
        print(f"DIARIZATION_PROGRESS: 0", flush=True)

        # Preprocess audio to avoid tensor size mismatch errors
        padded_audio_path = pad_audio_for_diarization(audio_path)
        processing_path = padded_audio_path if padded_audio_path else audio_path

        try:
            # Hook for progress updates during diarization
            def hook(step_name, step_artifact, file=None, total=None, completed=None):
                if completed is not None and total is not None and total > 0:
                    progress = int((completed / total) * 100)
                    print(f"DIARIZATION_PROGRESS: {progress}", flush=True)

            # Run diarization with progress hook using padded audio
            diarization = None
            try:
                if num_speakers:
                    diarization = self.pipeline(str(processing_path), num_speakers=num_speakers, hook=hook)
                else:
                    diarization = self.pipeline(str(processing_path), hook=hook)
            except RuntimeError as e:
                if "Sizes of tensors must match" in str(e):
                    logger.warning(f"Tensor size mismatch even with padding: {e}")
                    logger.warning("Returning empty diarization result")
                    return {
                        'speakers': [],
                        'num_speakers': 0,
                        'segments': [],
                        'total_segments': 0,
                        'error': 'Tensor size mismatch - pyannote edge case'
                    }
                else:
                    raise
            finally:
                # Clean up padded audio file
                if padded_audio_path and padded_audio_path.exists():
                    try:
                        os.remove(padded_audio_path)
                        logger.debug(f"Cleaned up padded audio: {padded_audio_path}")
                    except Exception:
                        pass

            # Extract speaker information
            speakers = set()
            segments = []

            for turn, _, speaker in diarization.itertracks(yield_label=True):
                speakers.add(speaker)
                segments.append({
                    'start': turn.start,
                    'end': turn.end,
                    'speaker': speaker
                })

            result = {
                'speakers': sorted(list(speakers)),
                'num_speakers': len(speakers),
                'segments': segments,
                'total_segments': len(segments)
            }

            print(f"DIARIZATION_PROGRESS: 100", flush=True)
            logger.info(f"✅ Diarization complete: {len(speakers)} speakers, {len(segments)} segments")
            return result

        except Exception as e:
            logger.error(f"Diarization failed: {e}")
            raise

    def identify_speakers(self, diarization: Dict, audio_path: Path) -> Dict[str, Dict]:
        """Identify diarization speakers using voice library

        Args:
            diarization: Output from diarize()
            audio_path: Path to original audio file

        Returns:
            Mapping of diarization labels to speaker info with confidence
            e.g., {"SPEAKER_00": {"name": "Matt Donnelly", "confidence": 0.85}}
        """
        if not self.voice_library:
            return {}

        try:
            logger.info("Identifying speakers using voice library...")
            mapping = self.voice_library.identify_speakers_in_diarization(
                diarization, audio_path, return_scores=True
            )
            return mapping
        except Exception as e:
            logger.warning(f"Voice library identification failed: {e}")
            return {}

    def align_with_transcript(self, diarization: Dict, transcript: Dict,
                             speaker_mapping: Optional[Dict[str, str]] = None) -> Dict:
        """Align speaker labels with transcript segments

        Args:
            diarization: Output from diarize()
            transcript: Transcript with segments (supports both faster-whisper and whisper-cli formats)
            speaker_mapping: Optional mapping of diarization labels to real names

        Returns:
            Transcript with speaker labels added to each segment
        """
        logger.info("Aligning speakers with transcript...")

        # Support both faster-whisper ('segments') and whisper-cli ('transcription') formats
        transcript_segments = transcript.get('segments', transcript.get('transcription', []))
        speaker_segments = diarization.get('segments', [])

        def parse_timestamp(ts_str: str) -> float:
            """Parse timestamp string like '00:01:23,456' to seconds"""
            try:
                # Handle format "00:01:23,456" or "00:01:23.456"
                ts_str = ts_str.replace(',', '.')
                parts = ts_str.split(':')
                if len(parts) == 3:
                    h, m, s = parts
                    return float(h) * 3600 + float(m) * 60 + float(s)
                return 0.0
            except:
                return 0.0

        # For each transcript segment, find overlapping speaker
        for t_seg in transcript_segments:
            # Handle whisper-cli format: {timestamps: {from: "00:00:00,000", to: "00:00:03,380"}}
            if 'timestamps' in t_seg:
                t_start = parse_timestamp(t_seg['timestamps'].get('from', '0'))
                t_end = parse_timestamp(t_seg['timestamps'].get('to', '0'))
            # Handle faster-whisper format: {start: 0.0, end: 3.38}
            else:
                t_start = t_seg.get('start', 0)
                t_end = t_seg.get('end', 0)

            t_mid = (t_start + t_end) / 2  # Use midpoint for matching

            # Find speaker at midpoint
            speaker = None
            for s_seg in speaker_segments:
                if s_seg['start'] <= t_mid <= s_seg['end']:
                    speaker = s_seg['speaker']
                    break

            # Always keep original speaker label for consistency
            # The UI will apply the mapping from speaker_names
            t_seg['speaker'] = speaker or 'UNKNOWN'

        # Build speaker names mapping from voice library identifications
        # speaker_mapping now contains {"SPEAKER_00": {"name": "Matt", "confidence": 0.85}}
        identified_speakers = {}
        for label in diarization['speakers']:
            if speaker_mapping and label in speaker_mapping:
                info = speaker_mapping[label]
                identified_speakers[label] = {
                    "name": info.get("name") if isinstance(info, dict) else info,
                    "confidence": info.get("confidence", 1.0) if isinstance(info, dict) else 1.0
                }
            else:
                identified_speakers[label] = {"name": None, "confidence": 0.0}

        transcript['diarization'] = {
            'speakers': diarization['speakers'],
            'num_speakers': diarization['num_speakers'],
            'method': 'pyannote.audio v3.1',
            'identified_speakers': identified_speakers,
            'segments': diarization.get('segments', [])
        }

        # Also store at top level for easier access by UI
        # Only include successfully identified speakers (format: {label: name})
        transcript['speaker_names'] = {
            label: info["name"]
            for label, info in identified_speakers.items()
            if info.get("name")
        }

        # Store confidence scores separately for UI
        transcript['speaker_confidence'] = {
            label: info["confidence"]
            for label, info in identified_speakers.items()
        }

        logger.info(f"✅ Speaker alignment complete - labeled {len(transcript_segments)} segments")
        return transcript

    def save_diarization(self, diarization: Dict, output_path: Path):
        """Save diarization results to JSON file

        Args:
            diarization: Output from diarize()
            output_path: Path to save JSON file
        """
        with open(output_path, 'w') as f:
            json.dump(diarization, f, indent=2)
        logger.info(f"Saved diarization to: {output_path}")


def load_hints(hints_path: Path) -> Optional[Dict]:
    """Load human correction hints from JSON file

    Args:
        hints_path: Path to hints JSON file

    Returns:
        Dict with corrections, multiple_speakers_segments, num_speakers_hint
    """
    try:
        with open(hints_path, 'r') as f:
            hints = json.load(f)
        logger.info(f"Loaded hints: {len(hints.get('corrections', []))} corrections, "
                    f"{len(hints.get('multiple_speakers_segments', []))} multi-speaker segments")
        return hints
    except Exception as e:
        logger.warning(f"Failed to load hints file: {e}")
        return None


def apply_hints_to_transcript(transcript: Dict, hints: Dict) -> Dict:
    """Apply human correction hints to transcript after alignment

    Args:
        transcript: Enhanced transcript with speaker labels
        hints: Hints dict with corrections and multiple_speakers_segments

    Returns:
        Transcript with corrections applied
    """
    # Support both formats
    segments = transcript.get('segments', transcript.get('transcription', []))

    corrections_applied = 0

    # Apply wrong_speaker corrections
    for correction in hints.get('corrections', []):
        idx = correction.get('segment_idx')
        corrected_speaker = correction.get('corrected_speaker')
        if idx is not None and corrected_speaker and idx < len(segments):
            old_speaker = segments[idx].get('speaker', 'UNKNOWN')
            segments[idx]['speaker'] = corrected_speaker
            logger.info(f"Applied correction: segment {idx} speaker {old_speaker} -> {corrected_speaker}")
            corrections_applied += 1

    # Mark multiple_speakers segments
    for multi in hints.get('multiple_speakers_segments', []):
        idx = multi.get('segment_idx')
        speaker_ids = multi.get('speaker_ids', [])
        if idx is not None and idx < len(segments):
            segments[idx]['multiple_speakers'] = True
            segments[idx]['possible_speakers'] = speaker_ids
            logger.info(f"Marked segment {idx} as multiple speakers: {speaker_ids}")

    logger.info(f"Applied {corrections_applied} speaker corrections from hints")
    return transcript


def process_episode(audio_path: Path, transcript_path: Path, hf_token: str,
                    num_speakers: Optional[int] = None, use_voice_library: bool = True,
                    hints: Optional[Dict] = None) -> Dict:
    """Process a single episode: diarize and align with transcript

    Args:
        audio_path: Path to audio file
        transcript_path: Path to transcript JSON
        hf_token: HuggingFace API token
        num_speakers: Expected number of speakers (None = auto-detect, recommended)
        use_voice_library: Whether to use voice library for speaker identification
        hints: Optional human correction hints dict

    Returns:
        Enhanced transcript with speaker labels
    """
    # Load transcript
    with open(transcript_path, 'r') as f:
        transcript = json.load(f)

    # Use num_speakers from hints if not explicitly set
    if num_speakers is None and hints and hints.get('num_speakers_hint'):
        num_speakers = hints['num_speakers_hint']
        logger.info(f"Using num_speakers_hint from hints: {num_speakers}")

    # Run diarization
    diarizer = SpeakerDiarizer(hf_token, use_voice_library=use_voice_library)
    diarization = diarizer.diarize(audio_path, num_speakers=num_speakers)

    # Identify speakers using voice library (if available)
    speaker_mapping = {}
    if use_voice_library and diarizer.voice_library:
        speaker_mapping = diarizer.identify_speakers(diarization, audio_path)

    # Align with transcript
    enhanced_transcript = diarizer.align_with_transcript(
        diarization, transcript, speaker_mapping
    )

    # Apply human correction hints after alignment
    if hints:
        enhanced_transcript = apply_hints_to_transcript(enhanced_transcript, hints)

    # Save enhanced transcript
    output_path = transcript_path.parent / f"{transcript_path.stem}_with_speakers.json"
    with open(output_path, 'w') as f:
        json.dump(enhanced_transcript, f, indent=2)

    print(f"\n✅ Speaker diarization complete!")
    print(f"   Speakers found: {diarization['num_speakers']}")
    print(f"   Segments: {diarization['total_segments']}")
    if speaker_mapping:
        print(f"   Identified speakers:")
        for label, name in speaker_mapping.items():
            print(f"      {label} → {name}")
    if hints:
        print(f"   Hints applied: {len(hints.get('corrections', []))} corrections")
    print(f"   Output: {output_path}")

    return enhanced_transcript


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Add speaker diarization to podcast transcripts")
    parser.add_argument("audio", type=Path, help="Path to audio file")
    parser.add_argument("transcript", type=Path, help="Path to transcript JSON")
    parser.add_argument("--token", required=True, help="HuggingFace API token")
    parser.add_argument("--speakers", type=int, default=None,
                       help="Expected number of speakers (default: auto-detect)")
    parser.add_argument("--no-voice-library", action="store_true",
                       help="Disable voice library identification")
    parser.add_argument("--hints-file", type=Path, default=None,
                       help="JSON hints file with human corrections for re-diarization")

    args = parser.parse_args()

    # Set up logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )

    # Load hints if provided
    hints = load_hints(args.hints_file) if args.hints_file else None

    process_episode(
        args.audio,
        args.transcript,
        args.token,
        num_speakers=args.speakers,
        use_voice_library=not args.no_voice_library,
        hints=hints,
    )
