#!/usr/bin/env python3
"""
Dashboard Error Monitor
Watches backend and frontend logs for errors and reports them in real-time
"""

import time
import subprocess
from pathlib import Path
from datetime import datetime

# Log files to monitor
BACKEND_LOG = Path("/tmp/backend.log")
VITE_LOG = Path("/tmp/vite_clean.log")
WORKER_LOG = Path("transcription_worker.log")

# Track last read positions
file_positions = {}

def tail_file(filepath, num_lines=50):
    """Get last N lines from a file"""
    try:
        with open(filepath, 'r') as f:
            lines = f.readlines()
            return lines[-num_lines:]
    except FileNotFoundError:
        return []

def monitor_log(filepath, label, error_patterns):
    """Monitor a log file for errors"""
    if not filepath.exists():
        return []

    # Get current file size
    current_size = filepath.stat().st_size

    # Initialize position if first time
    if filepath not in file_positions:
        file_positions[filepath] = max(0, current_size - 1000)  # Start near end

    # Read new content
    errors = []
    with open(filepath, 'r') as f:
        f.seek(file_positions[filepath])
        new_lines = f.readlines()
        file_positions[filepath] = f.tell()

        # Check for error patterns
        for line in new_lines:
            for pattern in error_patterns:
                if pattern.lower() in line.lower():
                    errors.append({
                        'source': label,
                        'time': datetime.now().strftime('%H:%M:%S'),
                        'message': line.strip()
                    })

    return errors

def check_services():
    """Check if services are running"""
    status = {}

    # Check backend (port 8000)
    result = subprocess.run(['lsof', '-i', ':8000'], capture_output=True, text=True)
    status['backend'] = 'LISTEN' in result.stdout

    # Check Vite (port 3000)
    result = subprocess.run(['lsof', '-i', ':3000'], capture_output=True, text=True)
    status['vite'] = 'LISTEN' in result.stdout

    # Check worker process
    result = subprocess.run(['ps', 'aux'], capture_output=True, text=True)
    status['worker'] = 'transcription_worker.py' in result.stdout

    return status

def main():
    """Main monitoring loop"""
    print("=" * 60)
    print("🔍 DASHBOARD ERROR MONITOR")
    print("=" * 60)
    print("Monitoring:")
    print(f"  - Backend: {BACKEND_LOG}")
    print(f"  - Vite:    {VITE_LOG}")
    print(f"  - Worker:  {WORKER_LOG}")
    print()
    print("Watching for errors... (Ctrl+C to stop)")
    print("=" * 60)
    print()

    error_patterns = [
        'error', 'exception', 'traceback', 'failed', 'ECONNREFUSED',
        'TypeError', 'ValueError', 'AttributeError', 'sqlite3.OperationalError'
    ]

    last_status_check = 0

    try:
        while True:
            # Check service status every 10 seconds
            if time.time() - last_status_check > 10:
                status = check_services()
                issues = []
                if not status['backend']:
                    issues.append("⚠️  Backend not running on port 8000")
                if not status['vite']:
                    issues.append("⚠️  Vite not running on port 3000")
                if not status['worker']:
                    issues.append("ℹ️  Worker not running")

                if issues:
                    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] SERVICE STATUS:")
                    for issue in issues:
                        print(f"  {issue}")
                    print()

                last_status_check = time.time()

            # Monitor logs
            all_errors = []
            all_errors.extend(monitor_log(BACKEND_LOG, "Backend", error_patterns))
            all_errors.extend(monitor_log(VITE_LOG, "Vite", error_patterns))
            all_errors.extend(monitor_log(WORKER_LOG, "Worker", error_patterns))

            # Report errors
            for error in all_errors:
                print(f"[{error['time']}] 🔴 {error['source']}: {error['message']}")

            time.sleep(2)  # Check every 2 seconds

    except KeyboardInterrupt:
        print("\n\nMonitoring stopped.")

if __name__ == "__main__":
    main()
