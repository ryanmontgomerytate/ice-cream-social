#!/usr/bin/env python3
"""
Database Initialization Script
Creates database tables and optionally imports existing data
"""

import argparse
import json
from pathlib import Path
from datetime import datetime

# Import database module
from database import DatabaseManager, Episode, engine, Base

# Import config
try:
    from config import config
    EPISODES_DIR = config.paths.episodes if config else Path("episodes")
    TRANSCRIPTS_DIR = config.paths.transcripts if config else Path("transcripts")
except (ImportError, AttributeError):
    EPISODES_DIR = Path("episodes")
    TRANSCRIPTS_DIR = Path("transcripts")


def init_tables():
    """Create all database tables"""
    print("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    print("✅ Tables created successfully")


def import_existing_episodes():
    """Import existing episodes from episodes/ directory"""
    if not EPISODES_DIR.exists():
        print(f"⚠️  Episodes directory not found: {EPISODES_DIR}")
        return 0

    print(f"\nScanning {EPISODES_DIR} for existing episodes...")

    audio_files = list(EPISODES_DIR.glob("*"))
    audio_files = [f for f in audio_files if f.suffix.lower() in ['.mp3', '.wav', '.m4a', '.ogg', '.flac']]

    print(f"Found {len(audio_files)} audio files")

    db = DatabaseManager.get_session()
    imported = 0
    updated = 0

    try:
        for audio_file in audio_files:
            # Check if transcript exists
            transcript_json = TRANSCRIPTS_DIR / f"{audio_file.stem}.json"
            transcript_exists = transcript_json.exists()

            # Try to extract episode number from filename
            import re
            match = re.search(r'(\d{3,4})', audio_file.stem)
            episode_number = match.group(1) if match else None

            # Create file:// URL for local file
            audio_url = f"file://{audio_file.absolute()}"

            # Check if episode already exists
            existing = DatabaseManager.get_episode_by_url(db, audio_url)

            episode_data = {
                'episode_number': episode_number,
                'title': audio_file.stem,
                'audio_url': audio_url,
                'audio_file_path': str(audio_file),
                'file_size': audio_file.stat().st_size,
                'is_downloaded': True,
                'downloaded_date': datetime.fromtimestamp(audio_file.stat().st_mtime),
                'feed_source': 'local',
                'is_transcribed': transcript_exists,
                'transcription_status': 'completed' if transcript_exists else 'pending'
            }

            # If transcript exists, add more metadata
            if transcript_exists:
                try:
                    with open(transcript_json, 'r') as f:
                        trans_data = json.load(f)
                        episode_data['duration'] = trans_data.get('duration', 0)
                        episode_data['transcript_path'] = str(transcript_json)
                        episode_data['transcribed_date'] = datetime.fromtimestamp(transcript_json.stat().st_mtime)
                        episode_data['processing_time'] = trans_data.get('processing_time', 0)
                except Exception as e:
                    print(f"  Warning: Could not read transcript for {audio_file.name}: {e}")

            if existing:
                # Update existing episode
                for key, value in episode_data.items():
                    if key not in ['id', 'added_date'] and value is not None:
                        setattr(existing, key, value)
                updated += 1
            else:
                # Add new episode
                DatabaseManager.add_episode(db, **episode_data)
                imported += 1

            if (imported + updated) % 10 == 0:
                print(f"  Processed {imported + updated} episodes...")

        db.commit()

    except Exception as e:
        db.rollback()
        print(f"❌ Error importing episodes: {e}")
    finally:
        db.close()

    print(f"✅ Import complete: {imported} added, {updated} updated")
    return imported + updated


def fetch_rss_feeds():
    """Fetch and import episodes from RSS feeds"""
    print("\nFetching episodes from RSS feeds...")

    try:
        import download_episodes

        # Get RSS feed URL from config
        try:
            from config import config
            feed_url = config.podcast.rss_feed_url
        except Exception:
            print("⚠️  No RSS feed URL configured in config.yaml")
            return 0

        print(f"Fetching from RSS feed...")
        feed_data = download_episodes.parse_feed(feed_url)
        print(f"Found {len(feed_data)} episodes in feed")

        db = DatabaseManager.get_session()
        imported = 0
        updated = 0

        try:
            for entry in feed_data:
                # Extract episode number
                import re
                title = entry.get('title', '')
                match = re.search(r'#?(\d{3,4})', title)
                episode_number = match.group(1) if match else None

                audio_url = entry.get('audio_url', '')
                if not audio_url:
                    continue

                # Check if exists
                existing = DatabaseManager.get_episode_by_url(db, audio_url)

                episode_data = {
                    'episode_number': episode_number,
                    'title': title,
                    'description': entry.get('description', ''),
                    'audio_url': audio_url,
                    'duration': entry.get('duration', 0),
                    'file_size': entry.get('audio_length', 0),
                    'published_date': entry.get('published'),
                    'feed_source': 'patreon',
                    'metadata_json': json.dumps({
                        'guid': entry.get('guid'),
                        'author': entry.get('author'),
                        'link': entry.get('link')
                    })
                }

                if existing:
                    for key, value in episode_data.items():
                        if key not in ['id', 'added_date'] and value is not None:
                            setattr(existing, key, value)
                    updated += 1
                else:
                    DatabaseManager.add_episode(db, **episode_data)
                    imported += 1

                if (imported + updated) % 50 == 0:
                    print(f"  Processed {imported + updated} episodes...")

            db.commit()

        except Exception as e:
            db.rollback()
            print(f"❌ Error importing from RSS: {e}")
        finally:
            db.close()

        print(f"✅ RSS import complete: {imported} added, {updated} updated")
        return imported + updated

    except ImportError:
        print("⚠️  download_episodes module not found")
        return 0
    except Exception as e:
        print(f"❌ Error fetching RSS: {e}")
        return 0


def show_statistics():
    """Show database statistics"""
    print("\n" + "=" * 60)
    print("DATABASE STATISTICS")
    print("=" * 60)

    db = DatabaseManager.get_session()
    try:
        total_episodes = db.query(Episode).count()
        transcribed = db.query(Episode).filter(Episode.is_transcribed == True).count()
        downloaded = db.query(Episode).filter(Episode.is_downloaded == True).count()
        in_queue = db.query(Episode).filter(Episode.is_in_queue == True).count()

        print(f"\nEpisodes:")
        print(f"  Total: {total_episodes}")
        print(f"  Transcribed: {transcribed} ({transcribed/total_episodes*100 if total_episodes > 0 else 0:.1f}%)")
        print(f"  Downloaded: {downloaded}")
        print(f"  In Queue: {in_queue}")

        # By source
        sources = db.query(Episode.feed_source).distinct().all()
        print(f"\nBy Source:")
        for (source,) in sources:
            count = db.query(Episode).filter(Episode.feed_source == source).count()
            print(f"  {source}: {count}")

    finally:
        db.close()

    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="Initialize Ice Cream Social database"
    )
    parser.add_argument(
        '--import-existing',
        action='store_true',
        help='Import existing episodes from episodes/ directory'
    )
    parser.add_argument(
        '--fetch-rss',
        action='store_true',
        help='Fetch episodes from RSS feed'
    )
    parser.add_argument(
        '--all',
        action='store_true',
        help='Do everything: init, import, and fetch'
    )
    parser.add_argument(
        '--stats',
        action='store_true',
        help='Show database statistics'
    )

    args = parser.parse_args()

    # If no args, just init tables
    if not any([args.import_existing, args.fetch_rss, args.all, args.stats]):
        args.all = True  # Default to doing everything

    print("🍦 ICE CREAM SOCIAL - DATABASE INITIALIZATION")
    print("=" * 60)

    # Always init tables first
    init_tables()

    if args.all or args.import_existing:
        import_existing_episodes()

    if args.all or args.fetch_rss:
        fetch_rss_feeds()

    # Always show stats at the end
    show_statistics()

    print("\n✅ Database initialization complete!")
    print(f"Database location: {Path('data/ice_cream_social.db').absolute()}")


if __name__ == '__main__':
    main()
