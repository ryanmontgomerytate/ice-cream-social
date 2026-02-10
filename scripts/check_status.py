#!/usr/bin/env python3
"""
Check Transcription Worker Status
Quick utility to see what the worker is doing

Usage:
    python check_status.py
    python check_status.py --watch  # Continuously update
"""

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path


def format_seconds(seconds):
    """Format seconds into readable time"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    if hours > 0:
        return f"{hours}h {minutes}m {secs}s"
    elif minutes > 0:
        return f"{minutes}m {secs}s"
    else:
        return f"{secs}s"


def print_status():
    """Print current worker status"""
    status_file = Path("transcription_status.json")
    queue_file = Path("transcription_queue.json")

    print("\n" + "=" * 60)
    print("TRANSCRIPTION WORKER STATUS")
    print("=" * 60)

    # Check if worker is running
    if not status_file.exists():
        print("\n⚠️  Worker has not been started yet")
        print("\nTo start the worker, run:")
        print("  python transcription_worker.py")
        print("\n" + "=" * 60 + "\n")
        return

    # Load status
    try:
        with open(status_file, 'r') as f:
            status = json.load(f)
    except Exception as e:
        print(f"\n❌ Could not read status file: {e}\n")
        return

    # Load queue
    queue_data = {"pending": [], "completed": [], "failed": []}
    if queue_file.exists():
        try:
            with open(queue_file, 'r') as f:
                queue_data = json.load(f)
        except Exception as e:
            print(f"\n⚠️  Could not read queue file: {e}")

    # Display status
    last_updated = status.get("last_updated", "Unknown")
    try:
        last_update_time = datetime.fromisoformat(last_updated)
        time_ago = (datetime.now() - last_update_time).total_seconds()
        last_updated_str = f"{last_updated} ({format_seconds(time_ago)} ago)"
    except:
        last_updated_str = last_updated

    print(f"\n📅 Last Updated: {last_updated_str}")

    # Current activity
    current_status = status.get("status", "unknown")
    current_file = status.get("current_file", "None")

    if current_status == "completed":
        print(f"\n✅ Last Completed: {current_file}")
        if "processing_time" in status:
            print(f"   Processing time: {format_seconds(status['processing_time'])}")
        if "duration" in status:
            print(f"   Audio duration: {format_seconds(status['duration'])}")
    elif current_status == "failed":
        print(f"\n❌ Last Failed: {current_file}")
        print(f"   Error: {status.get('error', 'Unknown')}")
    elif current_status == "processing":
        print(f"\n⏳ Currently Processing: {current_file}")
    else:
        print(f"\n⚠️  Status: {current_status}")

    # Queue status
    queue_status = status.get("queue_status", {})
    pending = queue_status.get("pending", len(queue_data.get("pending", [])))
    completed = queue_status.get("completed", len(queue_data.get("completed", [])))
    failed = queue_status.get("failed", len(queue_data.get("failed", [])))
    processing = queue_status.get("processing")

    print("\n📊 Queue Status:")
    print(f"   ⏳ Pending: {pending}")
    if processing:
        print(f"   🔄 Processing: {Path(processing).name}")
    print(f"   ✅ Completed: {completed}")
    if failed > 0:
        print(f"   ❌ Failed: {failed}")

    # Show pending files
    if pending > 0 and queue_data.get("pending"):
        print("\n📝 Pending Files:")
        for i, file_path in enumerate(queue_data["pending"][:5], 1):
            print(f"   {i}. {Path(file_path).name}")
        if pending > 5:
            print(f"   ... and {pending - 5} more")

    # Show failed files
    if failed > 0 and queue_data.get("failed"):
        print("\n❌ Failed Files:")
        for i, failed_entry in enumerate(queue_data["failed"][-3:], 1):
            if isinstance(failed_entry, dict):
                file_path = failed_entry.get("file", "Unknown")
                error = failed_entry.get("error", "Unknown error")
                print(f"   {i}. {Path(file_path).name}")
                print(f"      Error: {error}")
            else:
                print(f"   {i}. {failed_entry}")

    print("\n💡 Tips:")
    print("   - Watch live logs: tail -f transcription_worker.log")
    print("   - Stop worker: Ctrl+C in the worker terminal")
    print("   - Check this status: python check_status.py")

    print("\n" + "=" * 60 + "\n")


def main():
    parser = argparse.ArgumentParser(description="Check transcription worker status")
    parser.add_argument(
        "--watch",
        action="store_true",
        help="Continuously update status (refresh every 5 seconds)"
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=5,
        help="Update interval in seconds for watch mode (default: 5)"
    )

    args = parser.parse_args()

    if args.watch:
        print("Watching transcription worker status... (Ctrl+C to stop)")
        try:
            while True:
                print("\033[2J\033[H")  # Clear screen
                print_status()
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\n\nStopped watching.\n")
    else:
        print_status()


if __name__ == "__main__":
    main()
