#!/usr/bin/env python3
"""
Fix Database Inconsistencies
Addresses issues with episode statuses and duplicate entries
"""

from database import DatabaseManager, Episode, TranscriptionQueue
from datetime import datetime

def fix_episode_1_status():
    """Fix Episode ID 1 transcription_status from 'pending' to 'completed'"""
    db = DatabaseManager.get_session()

    print("=" * 80)
    print("FIXING EPISODE ID 1 STATUS")
    print("=" * 80)

    episode = db.query(Episode).filter(Episode.id == 1).first()

    if episode:
        print(f"\nEpisode: {episode.title}")
        print(f"  Current status: {episode.transcription_status}")
        print(f"  is_transcribed: {episode.is_transcribed}")
        print(f"  Transcript exists: {episode.transcript_path is not None}")

        if episode.is_transcribed and episode.transcript_path:
            # Fix the status
            episode.transcription_status = 'completed'
            db.commit()
            print(f"\n✅ FIXED: Updated transcription_status to 'completed'")
        else:
            print("\n⚠️  Episode doesn't appear to be fully transcribed")

    db.close()


def analyze_duplicates():
    """Identify duplicate episodes"""
    db = DatabaseManager.get_session()

    print("\n" + "=" * 80)
    print("DUPLICATE EPISODES ANALYSIS")
    print("=" * 80)

    # Find episodes with "1270" in title
    episodes_1270 = db.query(Episode).filter(
        Episode.title.like('%1270%')
    ).all()

    print(f"\nFound {len(episodes_1270)} episodes with '1270' in title:")
    for ep in episodes_1270:
        print(f"\n  ID {ep.id}: {ep.title}")
        print(f"    Episode Number: {ep.episode_number}")
        print(f"    Feed Source: {ep.feed_source}")
        print(f"    Transcribed: {ep.is_transcribed}")
        print(f"    Audio Path: {ep.audio_file_path}")

    db.close()


def cleanup_failed_queue_items():
    """Report on failed queue items"""
    db = DatabaseManager.get_session()

    print("\n" + "=" * 80)
    print("FAILED QUEUE ITEMS")
    print("=" * 80)

    failed_items = db.query(TranscriptionQueue).filter(
        TranscriptionQueue.status == 'failed'
    ).all()

    print(f"\nFound {len(failed_items)} failed items:")
    for item in failed_items:
        ep = db.query(Episode).filter(Episode.id == item.episode_id).first()
        print(f"\n  Queue ID {item.id}: Episode ID {item.episode_id}")
        if ep:
            print(f"    Title: {ep.title}")
            print(f"    Episode #: {ep.episode_number}")
        print(f"    Error: {item.error_message}")
        print(f"    Retry Count: {item.retry_count}")

    print("\n  Note: Failed items are kept in queue for reference.")
    print("  They won't be retried (retry_count >= 3).")

    db.close()


def verify_fixes():
    """Verify that fixes were applied correctly"""
    db = DatabaseManager.get_session()

    print("\n" + "=" * 80)
    print("VERIFICATION")
    print("=" * 80)

    # Check Episode ID 1
    episode = db.query(Episode).filter(Episode.id == 1).first()
    print(f"\nEpisode ID 1:")
    print(f"  is_transcribed: {episode.is_transcribed}")
    print(f"  transcription_status: {episode.transcription_status}")
    print(f"  Match: {'✅' if episode.transcription_status == 'completed' else '❌'}")

    # Count stats
    total = db.query(Episode).count()
    transcribed = db.query(Episode).filter(Episode.is_transcribed == True).count()
    in_queue = db.query(Episode).filter(Episode.is_in_queue == True).count()

    print(f"\nDatabase Stats:")
    print(f"  Total Episodes: {total}")
    print(f"  Transcribed: {transcribed}")
    print(f"  In Queue: {in_queue}")

    # Queue stats
    pending = db.query(TranscriptionQueue).filter(TranscriptionQueue.status == 'pending').count()
    processing = db.query(TranscriptionQueue).filter(TranscriptionQueue.status == 'processing').count()
    completed = db.query(TranscriptionQueue).filter(TranscriptionQueue.status == 'completed').count()
    failed = db.query(TranscriptionQueue).filter(TranscriptionQueue.status == 'failed').count()

    print(f"\nQueue Stats:")
    print(f"  Pending: {pending}")
    print(f"  Processing: {processing}")
    print(f"  Completed: {completed}")
    print(f"  Failed: {failed}")

    db.close()


if __name__ == "__main__":
    print("\n🔧 Database Issue Fixer\n")

    # Run fixes
    fix_episode_1_status()
    analyze_duplicates()
    cleanup_failed_queue_items()
    verify_fixes()

    print("\n" + "=" * 80)
    print("✅ Database analysis and fixes complete!")
    print("=" * 80)
