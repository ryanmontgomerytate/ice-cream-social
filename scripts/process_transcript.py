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
