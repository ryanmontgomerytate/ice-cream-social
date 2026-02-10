#!/usr/bin/env python3
"""
Ice Cream Social Podcast Episode Downloader
Downloads episodes from the podcast RSS feed

Usage:
    python download_episodes.py                    # List recent episodes
    python download_episodes.py --download 5      # Download 5 most recent
    python download_episodes.py --download-all    # Download all episodes
    python download_episodes.py --episode 450     # Download specific episode

Requirements:
    pip install feedparser requests tqdm
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    import feedparser
    import requests
    from tqdm import tqdm
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install with: pip install feedparser requests tqdm")
    sys.exit(1)

# Load configuration
try:
    from config import config
    RSS_FEED_URL = config.podcast.rss_feed_url if config else "https://www.patreon.com/rss/heyscoops?auth=REDACTED_PATREON_AUTH_TOKEN&show=876202"
    DOWNLOAD_DIR = config.paths.episodes if config else Path("episodes")
    # Get all configured feeds
    FEEDS = getattr(config.podcast, 'feeds', {}) if config else {}
except ImportError:
    print("Warning: Could not load config module. Using defaults.")
    RSS_FEED_URL = "https://www.patreon.com/rss/heyscoops?auth=REDACTED_PATREON_AUTH_TOKEN&show=876202"
    DOWNLOAD_DIR = Path("episodes")
    FEEDS = {}

METADATA_FILE = Path("episode_metadata.json")


def sanitize_filename(name: str) -> str:
    """Remove invalid characters from filename"""
    # Remove or replace invalid characters
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name[:200]  # Limit length


def parse_feed(feed_url: str):
    """Parse RSS feed and return episode list"""
    print(f"Fetching feed: {feed_url}")
    feed = feedparser.parse(feed_url)
    
    if feed.bozo:
        print(f"Warning: Feed parsing had issues: {feed.bozo_exception}")
    
    episodes = []
    for i, entry in enumerate(feed.entries):
        # Find audio URL (usually in enclosures)
        audio_url = None
        audio_type = None
        audio_length = None
        
        for enclosure in entry.get("enclosures", []):
            if "audio" in enclosure.get("type", ""):
                audio_url = enclosure.get("href") or enclosure.get("url")
                audio_type = enclosure.get("type")
                audio_length = enclosure.get("length")
                break
        
        # Sometimes audio is in media_content
        if not audio_url:
            for media in entry.get("media_content", []):
                if "audio" in media.get("type", ""):
                    audio_url = media.get("url")
                    break
        
        # Parse published date
        published = None
        if hasattr(entry, "published_parsed") and entry.published_parsed:
            published = datetime(*entry.published_parsed[:6]).isoformat()
        
        episode = {
            "index": i,
            "title": entry.get("title", f"Episode {i}"),
            "description": entry.get("summary", ""),
            "published": published,
            "duration": entry.get("itunes_duration", ""),
            "audio_url": audio_url,
            "audio_type": audio_type,
            "audio_length": audio_length,
            "link": entry.get("link", ""),
            "guid": entry.get("id", ""),
        }
        
        # Try to extract episode number from title
        ep_match = re.search(r'(?:episode|ep\.?|#)\s*(\d+)', entry.get("title", ""), re.I)
        if ep_match:
            episode["episode_number"] = int(ep_match.group(1))
        
        episodes.append(episode)
    
    print(f"Found {len(episodes)} episodes")
    return episodes


def parse_all_feeds():
    """Parse all configured feeds and return combined episode list"""
    all_episodes = []

    if FEEDS:
        for feed_name, feed_config in FEEDS.items():
            if feed_config.get('enabled', True):
                try:
                    feed_url = feed_config.get('url')
                    if not feed_url:
                        continue

                    print(f"\nFetching {feed_config.get('name', feed_name)}...")
                    episodes = parse_feed(feed_url)

                    # Tag episodes with source
                    for ep in episodes:
                        ep['source'] = feed_name
                        ep['source_name'] = feed_config.get('name', feed_name)

                    all_episodes.extend(episodes)
                except Exception as e:
                    print(f"Error fetching {feed_name}: {e}")
    else:
        # Fallback to default feed
        all_episodes = parse_feed(RSS_FEED_URL)
        for ep in all_episodes:
            ep['source'] = 'default'
            ep['source_name'] = 'Default Feed'

    # Remove duplicates based on audio URL or GUID
    seen = set()
    unique_episodes = []
    for ep in all_episodes:
        key = ep.get('audio_url') or ep.get('guid')
        if key and key not in seen:
            seen.add(key)
            unique_episodes.append(ep)

    return unique_episodes


def download_episode(episode: dict, output_dir: Path, skip_existing: bool = True) -> Optional[Path]:
    """Download a single episode"""
    if not episode.get("audio_url"):
        print(f"  No audio URL for: {episode['title']}")
        return None
    
    # Create filename
    ep_num = episode.get("episode_number", episode["index"])
    safe_title = sanitize_filename(episode["title"])
    
    # Determine extension from URL or content type
    audio_url = episode["audio_url"]
    if ".mp3" in audio_url.lower():
        ext = ".mp3"
    elif ".m4a" in audio_url.lower():
        ext = ".m4a"
    elif episode.get("audio_type") == "audio/mpeg":
        ext = ".mp3"
    else:
        ext = ".mp3"  # Default
    
    filename = f"{ep_num:04d} - {safe_title}{ext}"
    output_path = output_dir / filename
    
    # Skip if exists
    if skip_existing and output_path.exists():
        print(f"  Skipping (exists): {filename}")
        return output_path
    
    # Download with progress bar
    print(f"  Downloading: {filename}")
    
    try:
        response = requests.get(audio_url, stream=True)
        response.raise_for_status()
        
        total_size = int(response.headers.get("content-length", 0))
        
        output_dir.mkdir(parents=True, exist_ok=True)
        
        with open(output_path, "wb") as f:
            with tqdm(total=total_size, unit="B", unit_scale=True, desc="    ") as pbar:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
                    pbar.update(len(chunk))
        
        return output_path
        
    except Exception as e:
        print(f"  Error downloading: {e}")
        if output_path.exists():
            output_path.unlink()
        return None


def save_metadata(episodes, output_path: Path):
    """Save episode metadata to JSON"""
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({
            "fetched_at": datetime.now().isoformat(),
            "episode_count": len(episodes),
            "episodes": episodes
        }, f, indent=2, ensure_ascii=False)
    print(f"Saved metadata to: {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Download Ice Cream Social podcast episodes"
    )
    parser.add_argument(
        "--feed",
        default=RSS_FEED_URL,
        help="RSS feed URL"
    )
    parser.add_argument(
        "--download",
        type=int,
        metavar="N",
        help="Download N most recent episodes"
    )
    parser.add_argument(
        "--download-all",
        action="store_true",
        help="Download all episodes"
    )
    parser.add_argument(
        "--episode",
        type=int,
        help="Download specific episode number"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DOWNLOAD_DIR,
        help=f"Output directory (default: {DOWNLOAD_DIR})"
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Just list episodes, don't download"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download even if file exists"
    )
    
    args = parser.parse_args()
    
    # Parse feed
    episodes = parse_feed(args.feed)
    
    if not episodes:
        print("No episodes found!")
        sys.exit(1)
    
    # Save metadata
    save_metadata(episodes, METADATA_FILE)
    
    # List mode
    if args.list or (not args.download and not args.download_all and not args.episode):
        print("\nRecent episodes:")
        for ep in episodes[:20]:
            ep_num = ep.get("episode_number", "?")
            print(f"  [{ep_num}] {ep['title']}")
            if ep.get("published"):
                print(f"       Published: {ep['published'][:10]}")
        
        if len(episodes) > 20:
            print(f"\n  ... and {len(episodes) - 20} more episodes")
        
        print(f"\nUse --download N to download episodes, or --download-all for everything")
        return
    
    # Determine which episodes to download
    to_download = []
    
    if args.episode:
        # Find specific episode
        for ep in episodes:
            if ep.get("episode_number") == args.episode:
                to_download = [ep]
                break
        if not to_download:
            print(f"Episode {args.episode} not found")
            sys.exit(1)
    elif args.download_all:
        to_download = episodes
    elif args.download:
        to_download = episodes[:args.download]
    
    # Download
    print(f"\nDownloading {len(to_download)} episodes to {args.output_dir}")
    
    successful = 0
    for ep in to_download:
        result = download_episode(
            ep,
            args.output_dir,
            skip_existing=not args.force
        )
        if result:
            successful += 1
    
    print(f"\nDownloaded {successful}/{len(to_download)} episodes")


if __name__ == "__main__":
    main()
