#!/usr/bin/env python3
"""
Ice Cream Social Wiki Scraper
Fetches episode metadata from heyscoops.fandom.com

Provides context for speaker identification and segment detection
"""

import re
import requests
from bs4 import BeautifulSoup
import json
from pathlib import Path
from typing import Optional, Dict
import logging

logger = logging.getLogger(__name__)


class WikiScraper:
    """Scrapes Ice Cream Social wiki for episode metadata"""

    BASE_URL = "https://heyscoops.fandom.com"
    WIKI_URL = f"{BASE_URL}/wiki"

    # Known speakers from wiki research
    KNOWN_SPEAKERS = {
        "Matt Donnelly": {
            "role": "host",
            "aliases": ["Matt", "Matthew Donnelly"],
            "typical_position": 0  # Usually SPEAKER_00
        },
        "Paul Mattingly": {
            "role": "host",
            "aliases": ["Mattingly", "Paul"],
            "typical_position": 1  # Usually SPEAKER_01
        },
        "Jacob": {
            "role": "audio_engineer",
            "aliases": ["Jacob the Audio Guy", "Jacob"],
            "typical_position": 2  # Usually SPEAKER_02 when present
        }
    }

    # Known segments from wiki
    KNOWN_SEGMENTS = [
        "Scoopmail",
        "Jock vs Nerd",
        "Jock vs. Nerd",
        "Fatty Rabbit Holes",
        "Jingles",
        "Production Meeting",
        "Accolades",
        "Obelisk"
    ]

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
        })

    def get_episode_by_number(self, episode_number: str) -> Optional[Dict]:
        """Fetch episode metadata from wiki by episode number

        Args:
            episode_number: Episode number (e.g., "1270", "001")

        Returns:
            Dictionary with episode metadata or None if not found
        """
        # Try different episode page formats
        page_names = [
            f"{episode_number}",  # "1270"
            f"Episode_{episode_number}",  # "Episode_1270"
            f"Episode {episode_number}",  # "Episode 1270"
        ]

        for page_name in page_names:
            try:
                url = f"{self.WIKI_URL}/{page_name.replace(' ', '_')}"
                response = self.session.get(url, timeout=10)

                if response.status_code == 200:
                    return self._parse_episode_page(response.text, episode_number)

            except Exception as e:
                logger.debug(f"Failed to fetch {page_name}: {e}")
                continue

        logger.warning(f"Episode {episode_number} not found on wiki")
        return None

    def _parse_episode_page(self, html: str, episode_number: str) -> Dict:
        """Parse episode wiki page HTML

        Args:
            html: Raw HTML content
            episode_number: Episode number

        Returns:
            Dictionary with extracted metadata
        """
        soup = BeautifulSoup(html, 'html.parser')

        # Extract title
        title_elem = soup.find('h1', class_='page-header__title')
        title = title_elem.get_text(strip=True) if title_elem else f"Episode {episode_number}"

        # Extract guests from title (e.g., "1148: ... with RJ Owens")
        guests = []
        guest_match = re.search(r'with\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)', title)
        if guest_match:
            guests.append(guest_match.group(1))

        # Try to extract more metadata from infobox
        infobox = soup.find('aside', class_='portable-infobox')
        metadata = {
            'episode_number': episode_number,
            'title': title,
            'guests': guests,
            'url': f"{self.WIKI_URL}/{episode_number}",
            'has_guest': len(guests) > 0
        }

        # Extract date if available
        if infobox:
            date_elem = infobox.find('div', {'data-source': 'date'})
            if date_elem:
                date_value = date_elem.find('div', class_='pi-data-value')
                if date_value:
                    metadata['date'] = date_value.get_text(strip=True)

        # Look for segment mentions in content
        content = soup.find('div', class_='mw-parser-output')
        if content:
            content_text = content.get_text()
            detected_segments = []
            for segment in self.KNOWN_SEGMENTS:
                if segment.lower() in content_text.lower():
                    detected_segments.append(segment)

            if detected_segments:
                metadata['segments'] = detected_segments

        logger.info(f"✅ Found wiki data for Episode {episode_number}: {title}")
        return metadata

    def get_speaker_mapping(self, num_speakers: int, has_guest: bool = False) -> Dict[str, str]:
        """Get likely speaker mapping based on number of speakers

        Args:
            num_speakers: Number of speakers detected by diarization
            has_guest: Whether episode has a known guest

        Returns:
            Dictionary mapping SPEAKER_XX to likely names
        """
        mapping = {}

        if num_speakers >= 1:
            mapping["SPEAKER_00"] = "Matt Donnelly"
        if num_speakers >= 2:
            mapping["SPEAKER_01"] = "Paul Mattingly"
        if num_speakers >= 3:
            if has_guest:
                mapping["SPEAKER_02"] = "Guest"
            else:
                mapping["SPEAKER_02"] = "Jacob"
        if num_speakers >= 4:
            mapping["SPEAKER_03"] = "Guest" if has_guest else "Unknown"

        return mapping

    def enhance_transcript_with_wiki(self, transcript: Dict, episode_number: str) -> Dict:
        """Enhance transcript with wiki metadata

        Args:
            transcript: Transcript dictionary with diarization
            episode_number: Episode number

        Returns:
            Enhanced transcript with speaker names and metadata
        """
        # Fetch wiki data
        wiki_data = self.get_episode_by_number(episode_number)

        if not wiki_data:
            logger.warning(f"No wiki data found for episode {episode_number}")
            return transcript

        # Add wiki metadata
        transcript['wiki_metadata'] = wiki_data

        # Map speakers if diarization exists
        if 'diarization' in transcript:
            num_speakers = transcript['diarization']['num_speakers']
            has_guest = wiki_data.get('has_guest', False)

            speaker_mapping = self.get_speaker_mapping(num_speakers, has_guest)

            # Apply mapping to all segments
            for segment in transcript.get('segments', []):
                speaker_id = segment.get('speaker')
                if speaker_id and speaker_id in speaker_mapping:
                    segment['speaker_name'] = speaker_mapping[speaker_id]

                    # If guest, try to use actual name from wiki
                    if speaker_mapping[speaker_id] == "Guest" and wiki_data.get('guests'):
                        segment['speaker_name'] = wiki_data['guests'][0]

            # Add mapping to diarization metadata
            transcript['diarization']['speaker_mapping'] = speaker_mapping

        logger.info("✅ Enhanced transcript with wiki data")
        return transcript


def test_wiki_scraper():
    """Test wiki scraper with a known episode"""
    scraper = WikiScraper()

    # Test with Episode 1270
    print("Testing wiki scraper with Episode 1270...")
    result = scraper.get_episode_by_number("1270")

    if result:
        print(json.dumps(result, indent=2))
    else:
        print("❌ Failed to fetch episode data")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    test_wiki_scraper()
