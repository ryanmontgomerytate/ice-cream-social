#!/usr/bin/env python3
"""
Content Analyzer for Ice Cream Social transcripts.
Uses LLM to detect characters, fake commercials, bits, and other recurring content.

Usage:
    python content_analyzer.py <transcript_path> [--output <output_path>]
    python content_analyzer.py --episode-id <id> --db <db_path>
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Optional, Dict, List, Any
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Known characters and sponsors for pattern matching (bootstrap data)
KNOWN_CHARACTERS = {
    "Sweet Bean": {
        "aliases": ["Sweetbean", "Sweet-Bean", "the Bean"],
        "catchphrases": ["It's me, Sweet Bean"],
        "description": "Matt's lovable character"
    },
    "Duck Duck": {
        "aliases": ["DuckDuck", "Duck-Duck"],
        "catchphrases": [],
        "description": "Recurring character"
    },
    "Gino": {
        "aliases": ["Gino the Intern"],
        "catchphrases": [],
        "description": "Intern character"
    },
}

KNOWN_SPONSORS = {
    "Totino's Pizza Rolls": {
        "is_real": False,
        "tagline": "Pizza in the morning, pizza in the evening",
        "keywords": ["pizza rolls", "totino"]
    },
    "Stamps.com": {
        "is_real": True,
        "tagline": None,
        "keywords": ["stamps.com", "postage"]
    },
}

# Commercial detection patterns
COMMERCIAL_PATTERNS = [
    r"(?i)this (?:episode|show|podcast) is (?:brought to you|sponsored) by",
    r"(?i)brought to you by",
    r"(?i)sponsored by",
    r"(?i)a word from our sponsor",
    r"(?i)(?:fake|faux) commercial",
    r"(?i)commercial break",
    r"(?i)and now,? a (?:word|message) from",
]

# Character introduction patterns
CHARACTER_PATTERNS = [
    r"(?i)it'?s me,?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)",
    r"(?i)I'?m\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*[,!]",
    r"(?i)(?:hello|hey|hi),?\s+it'?s\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)",
    r"(?i)this is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:here|speaking)",
]


class ContentAnalyzer:
    """Analyzes transcript content to detect characters, commercials, and bits."""

    def __init__(self, use_llm: bool = True, llm_provider: str = "ollama"):
        self.use_llm = use_llm
        self.llm_provider = llm_provider
        self.llm_client = None

        if use_llm:
            self._init_llm()

    def _init_llm(self):
        """Initialize LLM client based on provider."""
        if self.llm_provider == "ollama":
            try:
                import ollama
                self.llm_client = ollama
                # Check if Ollama is running
                try:
                    ollama.list()
                    logger.info("Ollama client initialized")
                except Exception as e:
                    logger.warning(f"Ollama not available: {e}")
                    self.use_llm = False
            except ImportError:
                logger.warning("Ollama package not installed, falling back to pattern matching")
                self.use_llm = False

        elif self.llm_provider == "openai":
            try:
                import openai
                api_key = os.getenv("OPENAI_API_KEY")
                if api_key:
                    self.llm_client = openai.OpenAI(api_key=api_key)
                    logger.info("OpenAI client initialized")
                else:
                    logger.warning("OPENAI_API_KEY not set, falling back to pattern matching")
                    self.use_llm = False
            except ImportError:
                logger.warning("OpenAI package not installed, falling back to pattern matching")
                self.use_llm = False

    def analyze_transcript(self, transcript_data: Dict[str, Any]) -> Dict[str, List[Dict]]:
        """
        Analyze a transcript and return detected content.

        Args:
            transcript_data: Transcript JSON data with segments

        Returns:
            Dictionary with detected characters, commercials, bits, etc.
        """
        results = {
            "characters": [],
            "commercials": [],
            "bits": [],
            "catchphrases": [],
            "segments_analyzed": 0,
        }

        segments = transcript_data.get("segments", [])
        if not segments:
            # Try diarized segments
            segments = transcript_data.get("diarized_segments", [])

        if not segments:
            logger.warning("No segments found in transcript")
            return results

        results["segments_analyzed"] = len(segments)

        # First pass: pattern matching for known content
        self._detect_patterns(segments, results)

        # Second pass: LLM analysis for deeper insights
        if self.use_llm and len(segments) > 0:
            self._analyze_with_llm(segments, results)

        # Deduplicate and consolidate results
        self._consolidate_results(results)

        return results

    def _detect_patterns(self, segments: List[Dict], results: Dict):
        """Detect content using pattern matching."""
        full_text = ""
        segment_lookup = []

        for idx, seg in enumerate(segments):
            text = seg.get("text", "")
            start_time = seg.get("start", seg.get("start_time", 0))
            full_text += text + " "
            segment_lookup.append({
                "idx": idx,
                "start": start_time,
                "end": seg.get("end", seg.get("end_time")),
                "text": text,
            })

        # Detect commercials
        for pattern in COMMERCIAL_PATTERNS:
            for match in re.finditer(pattern, full_text):
                # Find the segment containing this match
                char_pos = match.start()
                segment_info = self._find_segment_at_position(segment_lookup, full_text, char_pos)
                if segment_info:
                    results["commercials"].append({
                        "name": "Detected Commercial",
                        "description": f"Commercial detected: '{match.group()}'",
                        "start_time": segment_info["start"],
                        "end_time": segment_info.get("end"),
                        "segment_idx": segment_info["idx"],
                        "confidence": 0.8,
                        "raw_text": segment_info["text"][:200],
                        "detection_method": "pattern",
                    })

        # Detect known characters
        for char_name, char_info in KNOWN_CHARACTERS.items():
            # Search for character name and aliases
            search_terms = [char_name] + char_info.get("aliases", [])
            for term in search_terms:
                pattern = rf"(?i)\b{re.escape(term)}\b"
                for match in re.finditer(pattern, full_text):
                    char_pos = match.start()
                    segment_info = self._find_segment_at_position(segment_lookup, full_text, char_pos)
                    if segment_info:
                        results["characters"].append({
                            "name": char_name,
                            "description": char_info.get("description", ""),
                            "start_time": segment_info["start"],
                            "end_time": segment_info.get("end"),
                            "segment_idx": segment_info["idx"],
                            "confidence": 0.9,
                            "raw_text": segment_info["text"][:200],
                            "detection_method": "known_character",
                        })
                        break  # Only record first mention per character

            # Check for catchphrases
            for catchphrase in char_info.get("catchphrases", []):
                if catchphrase.lower() in full_text.lower():
                    results["catchphrases"].append({
                        "name": catchphrase,
                        "character": char_name,
                        "confidence": 0.95,
                        "detection_method": "known_catchphrase",
                    })

        # Detect character introductions with patterns
        for pattern in CHARACTER_PATTERNS:
            for match in re.finditer(pattern, full_text):
                char_name = match.group(1).strip()
                # Skip common words that aren't character names
                if char_name.lower() in ["here", "there", "this", "that", "what", "who", "your", "matt", "paul"]:
                    continue
                char_pos = match.start()
                segment_info = self._find_segment_at_position(segment_lookup, full_text, char_pos)
                if segment_info:
                    results["characters"].append({
                        "name": char_name,
                        "description": f"Character introduced: '{match.group()}'",
                        "start_time": segment_info["start"],
                        "end_time": segment_info.get("end"),
                        "segment_idx": segment_info["idx"],
                        "confidence": 0.7,
                        "raw_text": segment_info["text"][:200],
                        "detection_method": "pattern",
                    })

        # Detect known sponsors
        for sponsor_name, sponsor_info in KNOWN_SPONSORS.items():
            keywords = [sponsor_name.lower()] + [k.lower() for k in sponsor_info.get("keywords", [])]
            for keyword in keywords:
                if keyword in full_text.lower():
                    pattern = rf"(?i){re.escape(keyword)}"
                    match = re.search(pattern, full_text)
                    if match:
                        char_pos = match.start()
                        segment_info = self._find_segment_at_position(segment_lookup, full_text, char_pos)
                        if segment_info:
                            results["commercials"].append({
                                "name": sponsor_name,
                                "description": sponsor_info.get("tagline", ""),
                                "is_real": sponsor_info.get("is_real", False),
                                "start_time": segment_info["start"],
                                "end_time": segment_info.get("end"),
                                "segment_idx": segment_info["idx"],
                                "confidence": 0.9,
                                "raw_text": segment_info["text"][:200],
                                "detection_method": "known_sponsor",
                            })
                            break

    def _find_segment_at_position(self, segment_lookup: List[Dict], full_text: str, char_pos: int) -> Optional[Dict]:
        """Find which segment contains the given character position in the concatenated text."""
        current_pos = 0
        for seg in segment_lookup:
            seg_end = current_pos + len(seg["text"]) + 1  # +1 for space
            if current_pos <= char_pos < seg_end:
                return seg
            current_pos = seg_end
        return None

    def _analyze_with_llm(self, segments: List[Dict], results: Dict):
        """Use LLM for deeper content analysis."""
        # Sample segments for analysis (to avoid token limits)
        sample_size = min(50, len(segments))
        step = max(1, len(segments) // sample_size)
        sampled_segments = segments[::step][:sample_size]

        # Prepare text for analysis
        text_for_analysis = "\n".join([
            f"[{seg.get('start', seg.get('start_time', 0)):.1f}s] {seg.get('speaker', 'Unknown')}: {seg.get('text', '')}"
            for seg in sampled_segments
        ])

        prompt = f"""Analyze this podcast transcript excerpt and identify:

1. CHARACTER NAMES: Look for fictional characters being performed (not the hosts Matt and Paul). Characters often have silly names and are introduced with catchphrases.

2. FAKE COMMERCIALS: The show has satirical fake commercials/sponsors. Look for obvious jokes about products.

3. RECURRING BITS: Identify any recurring comedy segments or running jokes.

For each finding, provide:
- name: The name of the character/commercial/bit
- description: Brief description
- type: "character", "commercial", or "bit"
- confidence: 0.0-1.0 how confident you are

Respond in JSON format:
{{
  "findings": [
    {{"name": "...", "description": "...", "type": "...", "confidence": 0.8}}
  ]
}}

TRANSCRIPT:
{text_for_analysis[:8000]}
"""

        try:
            if self.llm_provider == "ollama":
                response = self.llm_client.chat(
                    model="llama3.2",  # or another model you have
                    messages=[{"role": "user", "content": prompt}],
                    format="json",
                )
                content = response["message"]["content"]

            elif self.llm_provider == "openai":
                response = self.llm_client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"},
                )
                content = response.choices[0].message.content

            else:
                return

            # Parse LLM response
            llm_results = json.loads(content)
            findings = llm_results.get("findings", [])

            for finding in findings:
                finding_type = finding.get("type", "").lower()
                finding["detection_method"] = "llm"

                if finding_type == "character":
                    results["characters"].append(finding)
                elif finding_type == "commercial":
                    results["commercials"].append(finding)
                elif finding_type == "bit":
                    results["bits"].append(finding)

            logger.info(f"LLM found {len(findings)} content items")

        except Exception as e:
            logger.error(f"LLM analysis failed: {e}")

    def _consolidate_results(self, results: Dict):
        """Remove duplicates and consolidate findings."""
        # Deduplicate characters by name
        seen_chars = set()
        unique_chars = []
        for char in results["characters"]:
            name_lower = char["name"].lower()
            if name_lower not in seen_chars:
                seen_chars.add(name_lower)
                unique_chars.append(char)
        results["characters"] = unique_chars

        # Deduplicate commercials by name
        seen_commercials = set()
        unique_commercials = []
        for comm in results["commercials"]:
            name_lower = comm["name"].lower()
            if name_lower not in seen_commercials:
                seen_commercials.add(name_lower)
                unique_commercials.append(comm)
        results["commercials"] = unique_commercials

        # Sort by confidence
        results["characters"].sort(key=lambda x: x.get("confidence", 0), reverse=True)
        results["commercials"].sort(key=lambda x: x.get("confidence", 0), reverse=True)
        results["bits"].sort(key=lambda x: x.get("confidence", 0), reverse=True)


def analyze_transcript_file(transcript_path: Path, use_llm: bool = True) -> Dict:
    """Analyze a transcript file and return detected content."""
    with open(transcript_path) as f:
        transcript_data = json.load(f)

    analyzer = ContentAnalyzer(use_llm=use_llm)
    results = analyzer.analyze_transcript(transcript_data)

    return results


def main():
    parser = argparse.ArgumentParser(description="Analyze podcast transcripts for content")
    parser.add_argument("transcript_path", nargs="?", help="Path to transcript JSON file")
    parser.add_argument("--output", "-o", help="Output file path for results")
    parser.add_argument("--no-llm", action="store_true", help="Disable LLM analysis, use patterns only")
    parser.add_argument("--llm-provider", default="ollama", choices=["ollama", "openai"],
                        help="LLM provider to use")
    parser.add_argument("--episode-id", type=int, help="Episode ID for database integration")
    parser.add_argument("--db", help="Path to SQLite database")

    args = parser.parse_args()

    if not args.transcript_path:
        parser.print_help()
        sys.exit(1)

    transcript_path = Path(args.transcript_path)
    if not transcript_path.exists():
        logger.error(f"Transcript file not found: {transcript_path}")
        sys.exit(1)

    logger.info(f"Analyzing transcript: {transcript_path}")

    try:
        results = analyze_transcript_file(
            transcript_path,
            use_llm=not args.no_llm
        )

        # Print summary
        logger.info(f"Analysis complete:")
        logger.info(f"  - Characters found: {len(results['characters'])}")
        logger.info(f"  - Commercials found: {len(results['commercials'])}")
        logger.info(f"  - Bits found: {len(results['bits'])}")
        logger.info(f"  - Catchphrases found: {len(results['catchphrases'])}")
        logger.info(f"  - Segments analyzed: {results['segments_analyzed']}")

        # Output results
        output_data = {
            "transcript_path": str(transcript_path),
            "episode_id": args.episode_id,
            "results": results,
        }

        if args.output:
            output_path = Path(args.output)
            with open(output_path, "w") as f:
                json.dump(output_data, f, indent=2)
            logger.info(f"Results saved to: {output_path}")
        else:
            # Print to stdout
            print(json.dumps(output_data, indent=2))

        # Store in database if provided
        if args.db and args.episode_id:
            store_results_in_db(args.db, args.episode_id, results)

    except Exception as e:
        logger.error(f"Analysis failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


def store_results_in_db(db_path: str, episode_id: int, results: Dict):
    """Store analysis results in the SQLite database."""
    import sqlite3

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # Store characters
        for char in results["characters"]:
            cursor.execute("""
                INSERT INTO detected_content
                (episode_id, content_type, name, description, start_time, end_time, segment_idx, confidence, raw_text)
                VALUES (?, 'character', ?, ?, ?, ?, ?, ?, ?)
            """, (
                episode_id,
                char.get("name"),
                char.get("description"),
                char.get("start_time"),
                char.get("end_time"),
                char.get("segment_idx"),
                char.get("confidence", 1.0),
                char.get("raw_text"),
            ))

        # Store commercials
        for comm in results["commercials"]:
            cursor.execute("""
                INSERT INTO detected_content
                (episode_id, content_type, name, description, start_time, end_time, segment_idx, confidence, raw_text)
                VALUES (?, 'commercial', ?, ?, ?, ?, ?, ?, ?)
            """, (
                episode_id,
                comm.get("name"),
                comm.get("description"),
                comm.get("start_time"),
                comm.get("end_time"),
                comm.get("segment_idx"),
                comm.get("confidence", 1.0),
                comm.get("raw_text"),
            ))

        # Store bits
        for bit in results["bits"]:
            cursor.execute("""
                INSERT INTO detected_content
                (episode_id, content_type, name, description, start_time, end_time, segment_idx, confidence, raw_text)
                VALUES (?, 'bit', ?, ?, ?, ?, ?, ?, ?)
            """, (
                episode_id,
                bit.get("name"),
                bit.get("description"),
                bit.get("start_time"),
                bit.get("end_time"),
                bit.get("segment_idx"),
                bit.get("confidence", 1.0),
                bit.get("raw_text"),
            ))

        conn.commit()
        logger.info(f"Stored {len(results['characters'])} characters, {len(results['commercials'])} commercials, {len(results['bits'])} bits in database")

    except Exception as e:
        logger.error(f"Database storage failed: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
