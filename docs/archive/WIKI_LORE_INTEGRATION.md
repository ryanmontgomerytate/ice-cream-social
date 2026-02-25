# Wiki Lore Integration for Ice Cream Social App

This document outlines the process and components for integrating Wiki lore into the Ice Cream Social App, enabling a "seeder" or "context LLM injector" based on structured data extracted from the Fandom Wiki. This system aims to create structured data (Lore) from unstructured text (Transcripts) in a three-part system: Wiki Lore Extractor, Lore Matcher, and a dedicated Database Schema.

## Part 1: The Wiki Lore Extractor (`scripts/pull_wiki_data.py` and `scripts/sync_wiki_lore.py`)

These Python scripts are responsible for fetching existing "Inside Jokes," "Bits," and "Segments" from the Wiki.

### `scripts/pull_wiki_data.py`

This script scrapes the MediaWiki API to extract structured data from "Infoboxes" and "Summary" sections for every episode.

```python
import requests
import re
import json

class ScoopsWikiScraper:
    def __init__(self):
        self.api_url = "https://heyscoops.fandom.com/api.php"
        self.episodes_data = []

    def get_all_episodes(self):
        """Fetch a list of all pages in the 'Episodes' category."""
        params = {
            "action": "query",
            "list": "categorymembers",
            "cmtitle": "Category:Episodes",
            "cmlimit": "max",
            "format": "json"
        }
        response = requests.get(self.api_url, params=params).json()
        return response['query']['categorymembers']

    def get_page_content(self, page_id):
        """Get the raw wikitext of a specific page."""
        params = {
            "action": "query",
            "prop": "revisions",
            "rvprop": "content",
            "pageids": page_id,
            "format": "json"
        }
        res = requests.get(self.api_url, params=params).json()
        page = res['query']['pages'][str(page_id)]
        return page['revisions'][0]['*']

    def parse_infobox(self, wikitext):
        """Extract key-value pairs from the {{Episode Infobox}}."""
        data = {}
        # Find the infobox block
        infobox = re.search(r"{{Episode Infobox(.*?)}}", wikitext, re.DOTALL)
        if infobox:
            content = infobox.group(1)
            # Find all lines like | guest = Matt Young
            matches = re.findall(r"\|\s*(\w+)\s*=\s*(.*)", content)
            for key, value in matches:
                data[key.strip()] = value.strip().replace("[[", "").replace("]]", "")
        return data

    def run(self):
        print("Scouring the Wiki for Scoops lore...")
        episodes = self.get_all_episodes()
        
        for ep in episodes:
            print(f"Processing {ep['title']}...")
            raw_text = self.get_page_content(ep['pageid'])
            
            structured_info = self.parse_infobox(raw_text)
            # Add basic metadata
            structured_info['wiki_title'] = ep['title']
            structured_info['page_id'] = ep['pageid']
            
            self.episodes_data.append(structured_info)

        # Save to a JSON file to use as LLM Context
        with open('wiki_lore_base.json', 'w') as f:
            json.dump(self.episodes_data, f, indent=4)
        print("Done! Lore saved to wiki_lore_base.json")

if __name__ == "__main__":
    scraper = ScoopsWikiScraper()
    scraper.run()
```

### `scripts/sync_wiki_lore.py`

This script builds a library of lore (Bits, Guests, Segments) from the Fandom Wiki categories.

```python
import requests
import json

class WikiLoreArchive:
    def __init__(self):
        self.api_url = "https://heyscoops.fandom.com/api.php"
        self.lore_map = {
            "Bits": "Category:Recurring_Bits",
            "Guests": "Category:Guests",
            "Segments": "Category:Segments"
        }

    def get_category_members(self, category):
        params = {
            "action": "query",
            "list": "categorymembers",
            "cmtitle": category,
            "cmlimit": "max",
            "format": "json"
        }
        response = requests.get(self.api_url, params=params).json()
        return [item['title'] for item in response['query'].get('categorymembers', [])]

    def build_lore_library(self):
        library = {}
        for lore_type, category in self.lore_map.items():
            print(f"Syncing {lore_type}...")
            library[lore_type] = self.get_category_members(category)
        
        with open('wiki_lore_library.json', 'w') as f:
            json.dump(library, f, indent=4)
        print("Successfully created wiki_lore_library.json")

if __name__ == "__main__":
    archive = WikiLoreArchive()
    archive.build_lore_library()
```

## Part 2: The "Lore Matcher" (Entity Extraction) (`scripts/process_transcript.py`)

This script takes a raw transcript and uses the Lore Library built by `sync_wiki_lore.py` to find every mention of a "Bit" or "Segment."

```python
import json

def find_lore_in_transcript(transcript_text):
    # Load the Wiki lore we pulled
    with open('wiki_lore_library.json', 'r') as f:
        lore_library = json.load(f)

    found_lore = []

    # Simple matching logic (Can be upgraded to LLM later)
    for category, items in lore_library.items():
        for item in items:
            if item.lower() in transcript_text.lower():
                found_lore.append({
                    "entity": item,
                    "type": category,
                    "status": "Verified via Wiki"
                })

    return found_lore

# Example Usage:
sample_transcript = "And then Matt started talking about The Arena and how the Scoops were reacting."
results = find_lore_in_transcript(sample_transcript)
print(json.dumps(results, indent=2))
```

## Part 3: The "Better Wiki" Database Schema

To track relationships between episodes and lore, the database needs to include these tables.

```sql
-- The main table for Lore (Inside Jokes, Segments, etc.)
CREATE TABLE LoreEntities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    category TEXT, -- 'Bit', 'Guest', 'Location'
    wiki_url TEXT,
    first_appeared_episode_id INTEGER,
    FOREIGN KEY (first_appeared_episode_id) REFERENCES episodes(id)
);

-- The 'Mapping' table: Links specific clips to Lore
CREATE TABLE LoreMentions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lore_id INTEGER REFERENCES LoreEntities(id),
    episode_id INTEGER,
    timestamp_start TEXT,
    timestamp_end TEXT,
    context_snippet TEXT, -- The surrounding text
    sentiment_score REAL, -- Was the bit well-received?
    FOREIGN KEY (episode_id) REFERENCES episodes(id)
);
```

**Note on SQL Schema:**
- `SERIAL PRIMARY KEY` has been changed to `INTEGER PRIMARY KEY AUTOINCREMENT` for SQLite compatibility.
- `FOREIGN KEY` constraints are included, assuming an `episodes` table with an `id` column exists. Ensure this table and column are correctly named, or adjust/remove the foreign key constraints as needed for your specific database schema.

## Implementation Suggestions for the Project:

1.  **Run `scripts/sync_wiki_lore.py`:** This generates `wiki_lore_library.json`, which serves as your "Source of Truth" for lore entities.
2.  **Update Backend:** After an episode finishes transcribing, call the `find_lore_in_transcript` function from `scripts/process_transcript.py` to identify lore mentions.
3.  **"Timeline" Feature:** In your React frontend, create a "Lore Timeline" page. Fetch all `LoreMentions` for a specific entity (e.g., "The Arena") and display them chronologically, showing its evolution across episodes.
4.  **"Gaps" Feature:** Compare AI-found lore mentions with existing Wiki metadata. If the AI identifies "The Arena" in Episode 602, but the Wiki page for 602 doesn't list it, flag this as "Missing from Wiki" to highlight potential updates for the Fandom page.
