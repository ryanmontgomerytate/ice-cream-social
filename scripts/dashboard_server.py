#!/usr/bin/env python3
"""
Web Dashboard Server for Ice Cream Social Transcription Worker
Industry-standard web interface inspired by Sonarr/Radarr
"""

import json
import sys
import threading
from datetime import datetime
from pathlib import Path
from flask import Flask, render_template, jsonify, send_from_directory, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

# Import download module
try:
    from scripts import download_episodes
except ImportError:
    import download_episodes

# Import enhanced API
try:
    from api_episodes import register_api
    API_V2_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Enhanced API not available: {e}")
    API_V2_AVAILABLE = False

app = Flask(__name__, static_folder='dashboard/static', template_folder='dashboard/templates')
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# Register enhanced API if available
if API_V2_AVAILABLE:
    register_api(app)

# Paths
STATUS_FILE = Path("transcription_status.json")
QUEUE_FILE = Path("transcription_queue.json")
LOG_FILE = Path("transcription_worker.log")
EPISODES_DIR = Path("episodes")
TRANSCRIPTS_DIR = Path("transcripts")


def load_status():
    """Load current worker status"""
    if STATUS_FILE.exists():
        with open(STATUS_FILE, 'r') as f:
            return json.load(f)
    return {
        "last_updated": datetime.now().isoformat(),
        "status": "not_started",
        "current_file": None,
        "queue_status": {"pending": 0, "completed": 0, "failed": 0}
    }


def load_queue():
    """Load queue data"""
    if QUEUE_FILE.exists():
        with open(QUEUE_FILE, 'r') as f:
            return json.load(f)
    return {"pending": [], "processing": None, "completed": [], "failed": []}


def load_recent_logs(lines=50):
    """Load recent log entries"""
    if not LOG_FILE.exists():
        return []

    try:
        with open(LOG_FILE, 'r') as f:
            all_lines = f.readlines()
            return [line.strip() for line in all_lines[-lines:]]
    except:
        return []


def get_episode_list():
    """Get list of episodes with metadata"""
    episodes = []

    if not EPISODES_DIR.exists():
        return episodes

    for audio_file in EPISODES_DIR.iterdir():
        if audio_file.suffix.lower() in ['.mp3', '.wav', '.m4a', '.ogg']:
            # Check if transcribed
            transcript_json = TRANSCRIPTS_DIR / f"{audio_file.stem}.json"
            transcript_exists = transcript_json.exists()

            episode = {
                "filename": audio_file.name,
                "size_mb": round(audio_file.stat().st_size / (1024 * 1024), 2),
                "added_date": datetime.fromtimestamp(audio_file.stat().st_mtime).isoformat(),
                "transcribed": transcript_exists,
            }

            if transcript_exists:
                try:
                    with open(transcript_json, 'r') as f:
                        data = json.load(f)
                        episode["duration"] = data.get("duration", 0)
                        episode["language"] = data.get("language", "unknown")
                        episode["processing_time"] = data.get("processing_time", 0)
                except:
                    pass

            episodes.append(episode)

    return sorted(episodes, key=lambda x: x["added_date"], reverse=True)


def get_stats():
    """Get overall statistics"""
    queue = load_queue()
    episodes = get_episode_list()

    transcribed = sum(1 for e in episodes if e.get("transcribed"))
    total_episodes = len(episodes)

    return {
        "total_episodes": total_episodes,
        "transcribed": transcribed,
        "pending": len(queue.get("pending", [])),
        "failed": len(queue.get("failed", [])),
        "completion_rate": round((transcribed / total_episodes * 100) if total_episodes > 0 else 0, 1)
    }


# Routes
@app.route('/')
def index():
    """Serve main dashboard"""
    return render_template('dashboard.html')


@app.route('/api/status')
def api_status():
    """Get current worker status"""
    return jsonify(load_status())


@app.route('/api/queue')
def api_queue():
    """Get queue information"""
    return jsonify(load_queue())


@app.route('/api/episodes')
def api_episodes():
    """Get list of episodes"""
    return jsonify(get_episode_list())


@app.route('/api/stats')
def api_stats():
    """Get overall statistics"""
    return jsonify(get_stats())


@app.route('/api/logs')
def api_logs():
    """Get recent log entries"""
    lines = int(request.args.get('lines', 100))
    return jsonify(load_recent_logs(lines))


@app.route('/api/episodes/<path:episode_name>/transcript')
def api_episode_transcript(episode_name):
    """Get transcript for an episode"""
    transcript_path = TRANSCRIPTS_DIR / f"{episode_name}.json"

    if not transcript_path.exists():
        return jsonify({"error": "Transcript not found"}), 404

    try:
        with open(transcript_path, 'r') as f:
            return jsonify(json.load(f))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/episodes/<path:episode_name>/download/<format>')
def api_download_transcript(episode_name, format):
    """Download transcript in specified format"""
    valid_formats = ['json', 'txt', 'srt', 'md']

    if format not in valid_formats:
        return jsonify({"error": "Invalid format"}), 400

    file_path = TRANSCRIPTS_DIR / f"{episode_name}.{format}"

    if not file_path.exists():
        return jsonify({"error": "File not found"}), 404

    return send_from_directory(
        TRANSCRIPTS_DIR,
        f"{episode_name}.{format}",
        as_attachment=True
    )


# RSS Feed & Queue Management APIs
@app.route('/api/feeds/episodes')
def api_feed_episodes():
    """Get all episodes from RSS feeds"""
    try:
        # Parse all configured feeds
        episodes = download_episodes.parse_all_feeds()

        # Check which are already downloaded
        for ep in episodes:
            ep_num = ep.get("episode_number", ep["index"])
            safe_title = download_episodes.sanitize_filename(ep["title"])

            # Check for existing file with various extensions
            found = False
            for ext in ['.mp3', '.m4a', '.wav', '.ogg']:
                filename = f"{ep_num:04d} - {safe_title}{ext}"
                if (EPISODES_DIR / filename).exists():
                    ep['downloaded'] = True
                    ep['filename'] = filename
                    found = True
                    break

            if not found:
                ep['downloaded'] = False

        return jsonify({
            "total": len(episodes),
            "episodes": episodes
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/episodes/download', methods=['POST'])
def api_download_episode():
    """Download and queue an episode for transcription"""
    try:
        data = request.get_json()
        episode = data.get('episode')

        if not episode:
            return jsonify({"error": "No episode provided"}), 400

        # Download in background thread
        def download_task():
            try:
                result = download_episodes.download_episode(
                    episode,
                    EPISODES_DIR,
                    skip_existing=True
                )

                if result:
                    # Episode downloaded, worker will pick it up automatically
                    socketio.emit('download_complete', {
                        'filename': result.name,
                        'episode': episode['title']
                    }, broadcast=True)
            except Exception as e:
                print(f"Download error: {e}")
                socketio.emit('download_error', {
                    'episode': episode['title'],
                    'error': str(e)
                }, broadcast=True)

        thread = threading.Thread(target=download_task)
        thread.daemon = True
        thread.start()

        return jsonify({"status": "downloading", "episode": episode['title']})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/episodes/batch-download', methods=['POST'])
def api_batch_download():
    """Download multiple episodes"""
    try:
        data = request.get_json()
        episodes = data.get('episodes', [])

        if not episodes:
            return jsonify({"error": "No episodes provided"}), 400

        def batch_download_task():
            for episode in episodes:
                try:
                    result = download_episodes.download_episode(
                        episode,
                        EPISODES_DIR,
                        skip_existing=True
                    )

                    if result:
                        socketio.emit('download_complete', {
                            'filename': result.name,
                            'episode': episode['title']
                        }, broadcast=True)
                except Exception as e:
                    print(f"Download error for {episode['title']}: {e}")
                    socketio.emit('download_error', {
                        'episode': episode['title'],
                        'error': str(e)
                    }, broadcast=True)

        thread = threading.Thread(target=batch_download_task)
        thread.daemon = True
        thread.start()

        return jsonify({"status": "downloading", "count": len(episodes)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/queue/cancel', methods=['POST'])
def api_cancel_queue_item():
    """Cancel a queued item"""
    try:
        data = request.get_json()
        filename = data.get('filename')

        if not filename:
            return jsonify({"error": "No filename provided"}), 400

        # Load queue
        if QUEUE_FILE.exists():
            with open(QUEUE_FILE, 'r') as f:
                queue = json.load(f)

            # Remove from pending
            queue['pending'] = [f for f in queue.get('pending', []) if f != filename]

            # Save queue
            with open(QUEUE_FILE, 'w') as f:
                json.dump(queue, f, indent=2)

            socketio.emit('queue_update', queue, broadcast=True)
            return jsonify({"status": "cancelled", "filename": filename})

        return jsonify({"error": "Queue file not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/queue/retry', methods=['POST'])
def api_retry_failed():
    """Retry a failed transcription"""
    try:
        data = request.get_json()
        filename = data.get('filename')

        if not filename:
            return jsonify({"error": "No filename provided"}), 400

        # Load queue
        if QUEUE_FILE.exists():
            with open(QUEUE_FILE, 'r') as f:
                queue = json.load(f)

            # Move from failed to pending
            if filename in queue.get('failed', []):
                queue['failed'].remove(filename)
                if filename not in queue.get('pending', []):
                    queue['pending'].append(filename)

                # Save queue
                with open(QUEUE_FILE, 'w') as f:
                    json.dump(queue, f, indent=2)

                socketio.emit('queue_update', queue, broadcast=True)
                return jsonify({"status": "retrying", "filename": filename})

        return jsonify({"error": "Queue file not found or item not failed"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# WebSocket events
@socketio.on('connect')
def handle_connect():
    """Client connected"""
    emit('status_update', load_status())
    emit('queue_update', load_queue())


@socketio.on('request_update')
def handle_update_request():
    """Client requested update"""
    emit('status_update', load_status())
    emit('queue_update', load_queue())
    emit('stats_update', get_stats())


# Background task to push updates
def background_updates():
    """Push updates to connected clients"""
    import time
    while True:
        socketio.sleep(5)  # Update every 5 seconds
        socketio.emit('status_update', load_status())
        socketio.emit('queue_update', load_queue())
        socketio.emit('stats_update', get_stats())


def main():
    """Start the dashboard server"""
    print("=" * 60)
    print("🍦 ICE CREAM SOCIAL - WEB DASHBOARD")
    print("=" * 60)
    print()
    print("Dashboard URL: http://localhost:8000")
    print("API Endpoints:")
    print("  - http://localhost:8000/api/status")
    print("  - http://localhost:8000/api/queue")
    print("  - http://localhost:8000/api/episodes")
    print("  - http://localhost:8000/api/stats")
    print()
    print("Press Ctrl+C to stop the server")
    print("=" * 60)
    print()

    # Start background update task
    socketio.start_background_task(background_updates)

    # Run server
    socketio.run(app, host='0.0.0.0', port=8000, debug=False, allow_unsafe_werkzeug=True)


if __name__ == '__main__':
    main()
