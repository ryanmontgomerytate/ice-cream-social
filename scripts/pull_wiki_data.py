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
