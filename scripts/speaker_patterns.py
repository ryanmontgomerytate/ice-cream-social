#!/usr/bin/env python3
"""
Speaker Pattern Recognition
Uses catchphrases and intro patterns to identify speakers

Based on show format:
1. Audio drop (Sally & Jonny intro)
2. Matt introduces Paul
3. Paul introduces Matt
4. Matt introduces Jacob
5. Sometimes guest intro
"""

import re
from typing import Dict, List, Optional
import logging

logger = logging.getLogger(__name__)


class SpeakerPatternMatcher:
    """Identifies speakers using catchphrases and intro patterns"""

    # Known catchphrases and patterns
    # These identify the SPEAKER (not who they're talking about)
    SPEAKER_PATTERNS = {
        "Jacob": [
            r"oh hello there",
            r"oh\s+hello\s+there",
            r"jacob.*audio guy",
            r"i'?m jacob",
            # Add more Jacob patterns
        ],
        "Matt Donnelly": [
            r"i'?m matt donnelly",
            r"this is matt",
            r"matt donnelly here",
            # Add more Matt patterns
        ],
        "Paul Mattingly": [
            r"i'?m paul mattingly",
            r"this is paul",
            r"paul mattingly here",
            # Add more Paul patterns
        ]
    }

    # Intro sequence patterns
    INTRO_SEQUENCE = [
        {
            "speaker": "Matt Donnelly",
            "patterns": [
                r"welcome.*ice cream social",
                r"this is.*ice cream social",
                r"i'm matt donnelly"
            ],
            "position": "first"  # Usually speaks first after audio drop
        },
        {
            "speaker": "Paul Mattingly",
            "patterns": [
                r"i'm paul mattingly",
                r"this is paul",
                r"mattingly here"
            ],
            "position": "second"  # Usually second speaker
        },
        {
            "speaker": "Jacob",
            "patterns": [
                r"oh hello there",
                r"jacob.*audio",
                r"audio guy"
            ],
            "position": "third"  # Usually third speaker
        }
    ]

    def __init__(self):
        """Initialize pattern matcher"""
        self.compiled_patterns = {}
        self._compile_patterns()

    def _compile_patterns(self):
        """Pre-compile regex patterns for efficiency"""
        for speaker, patterns in self.SPEAKER_PATTERNS.items():
            self.compiled_patterns[speaker] = [
                re.compile(pattern, re.IGNORECASE) for pattern in patterns
            ]

    def identify_by_catchphrase(self, text: str) -> Optional[str]:
        """Identify speaker by catchphrase in text

        Args:
            text: Segment text to analyze

        Returns:
            Speaker name if identified, None otherwise
        """
        text_lower = text.lower()

        for speaker, patterns in self.compiled_patterns.items():
            for pattern in patterns:
                if pattern.search(text_lower):
                    logger.debug(f"Matched '{speaker}' via pattern: {pattern.pattern}")
                    return speaker

        return None

    def analyze_intro_sequence(self, segments: List[Dict], max_segments: int = 20) -> Dict[str, str]:
        """Analyze first segments to identify speakers by intro pattern

        Args:
            segments: List of transcript segments
            max_segments: Number of initial segments to analyze

        Returns:
            Dictionary mapping SPEAKER_XX to identified names
        """
        mapping = {}

        # Analyze first N segments (intro usually happens here)
        intro_segments = segments[:max_segments]

        # Track speaker appearances and patterns
        speaker_evidence = {}  # SPEAKER_XX -> {speaker_name: confidence_score}

        for i, segment in enumerate(intro_segments):
            text = segment.get('text', '')
            speaker_id = segment.get('speaker')

            if not speaker_id:
                continue

            # Check against intro sequence patterns
            for intro_pattern in self.INTRO_SEQUENCE:
                speaker_name = intro_pattern['speaker']
                patterns = intro_pattern['patterns']
                position = intro_pattern['position']

                # Check if text matches any pattern
                for pattern in patterns:
                    if re.search(pattern, text, re.IGNORECASE):
                        # Found a match!
                        if speaker_id not in speaker_evidence:
                            speaker_evidence[speaker_id] = {}

                        # Higher confidence for earlier segments
                        confidence = 1.0 - (i * 0.05)  # Decreases with segment index

                        # Bonus for matching expected position
                        if position == "first" and i < 5:
                            confidence += 0.3
                        elif position == "second" and 3 < i < 10:
                            confidence += 0.2
                        elif position == "third" and 5 < i < 15:
                            confidence += 0.2

                        # Add evidence
                        if speaker_name in speaker_evidence[speaker_id]:
                            speaker_evidence[speaker_id][speaker_name] += confidence
                        else:
                            speaker_evidence[speaker_id][speaker_name] = confidence

                        logger.debug(f"Intro pattern match: {speaker_id} -> {speaker_name} (confidence: {confidence:.2f})")

        # Convert evidence to final mapping (pick highest confidence)
        for speaker_id, evidence in speaker_evidence.items():
            if evidence:
                best_match = max(evidence.items(), key=lambda x: x[1])
                speaker_name, confidence = best_match

                if confidence > 0.5:  # Threshold for acceptance
                    mapping[speaker_id] = speaker_name
                    logger.info(f"✅ Identified {speaker_id} as {speaker_name} (confidence: {confidence:.2f})")

        return mapping

    def enhance_transcript_with_patterns(self, transcript: Dict) -> Dict:
        """Add pattern-based speaker identification to transcript

        Args:
            transcript: Transcript with diarization

        Returns:
            Enhanced transcript with pattern-matched speaker names
        """
        segments = transcript.get('segments', [])

        # 1. Analyze intro sequence to establish baseline mapping
        intro_mapping = self.analyze_intro_sequence(segments)

        logger.info(f"Intro analysis found: {intro_mapping}")

        # 2. Apply intro mapping to all segments
        for segment in segments:
            speaker_id = segment.get('speaker')

            if speaker_id and speaker_id in intro_mapping:
                segment['speaker_name_pattern'] = intro_mapping[speaker_id]

        # 3. Look for catchphrases to override/confirm
        catchphrase_corrections = 0
        for segment in segments:
            text = segment.get('text', '')

            # Check for catchphrases
            identified = self.identify_by_catchphrase(text)

            if identified:
                speaker_id = segment.get('speaker')

                # If we already have a pattern match, compare
                if 'speaker_name_pattern' in segment:
                    if segment['speaker_name_pattern'] != identified:
                        logger.warning(
                            f"Catchphrase override: {speaker_id} was {segment['speaker_name_pattern']}, "
                            f"now {identified} based on '{text[:50]}...'"
                        )
                        catchphrase_corrections += 1

                segment['speaker_name_pattern'] = identified
                segment['identified_by'] = 'catchphrase'

        # 4. Add pattern metadata
        if 'diarization' not in transcript:
            transcript['diarization'] = {}

        transcript['diarization']['pattern_matching'] = {
            'intro_mapping': intro_mapping,
            'catchphrase_corrections': catchphrase_corrections,
            'method': 'pattern_recognition'
        }

        logger.info(f"✅ Pattern enhancement complete. {catchphrase_corrections} catchphrase corrections made.")
        return transcript

    def merge_with_diarization(self, transcript: Dict) -> Dict:
        """Merge pattern-based names with diarization speaker mapping

        Strategy:
        1. Use pattern-matched names when available (more reliable)
        2. Fall back to diarization mapping for unmatched speakers
        3. Resolve conflicts by favoring pattern matches

        Args:
            transcript: Transcript with both diarization and pattern data

        Returns:
            Transcript with final speaker names
        """
        segments = transcript.get('segments', [])

        for segment in segments:
            # Priority 1: Pattern-matched name
            if 'speaker_name_pattern' in segment:
                segment['speaker_name'] = segment['speaker_name_pattern']
            # Priority 2: Diarization-based name
            elif 'speaker_name' not in segment and 'speaker' in segment:
                # Use diarization mapping if available
                speaker_id = segment['speaker']
                if 'diarization' in transcript and 'speaker_mapping' in transcript['diarization']:
                    mapping = transcript['diarization']['speaker_mapping']
                    if speaker_id in mapping:
                        segment['speaker_name'] = mapping[speaker_id]

        logger.info("✅ Merged pattern matching with diarization")
        return transcript


def test_pattern_matcher():
    """Test pattern matcher with sample segments"""

    # Sample intro sequence
    sample_segments = [
        {"speaker": "SPEAKER_00", "text": "Welcome to Matt and Mattingly's Ice Cream Social"},
        {"speaker": "SPEAKER_01", "text": "I'm Paul Mattingly"},
        {"speaker": "SPEAKER_00", "text": "And I'm Matt Donnelly"},
        {"speaker": "SPEAKER_02", "text": "Oh hello there, this is Jacob the audio guy"},
        {"speaker": "SPEAKER_00", "text": "With me is Paul Mattingly"},
        {"speaker": "SPEAKER_01", "text": "And Matt Donnelly is here too"},
    ]

    transcript = {"segments": sample_segments}

    matcher = SpeakerPatternMatcher()
    enhanced = matcher.enhance_transcript_with_patterns(transcript)

    print("\n✅ Test Results:")
    for seg in enhanced['segments']:
        speaker_id = seg.get('speaker')
        speaker_name = seg.get('speaker_name_pattern', 'Unknown')
        text = seg.get('text')[:50]
        print(f"{speaker_id:12} → {speaker_name:20} | {text}...")

    print(f"\nIntro mapping: {enhanced['diarization']['pattern_matching']['intro_mapping']}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    test_pattern_matcher()
