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
