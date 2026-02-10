#!/usr/bin/env python3
"""
Enhanced API endpoints for episode management
Implements fast feed fetching, caching, and queue control
"""

import json
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, List
from flask import Blueprint, jsonify, request
from threading import Thread, Lock

# Import database and download modules
try:
    from database import DatabaseManager, Episode, TranscriptionQueue
    from sqlalchemy.exc import IntegrityError
    import download_episodes
except ImportError as e:
    print(f"Import error: {e}")
    print("Make sure database.py and download_episodes.py are in the same directory")
    raise

# Create Blueprint
api_bp = Blueprint('api_episodes', __name__, url_prefix='/api/v2')

# Feed cache (in-memory for performance)
class FeedCache:
    """In-memory cache for RSS feed data"""

    def __init__(self):
        self.cache: Dict[str, Dict] = {}
        self.lock = Lock()
        self.cache_duration = 300  # 5 minutes

    def get(self, source: str) -> Optional[Dict]:
        """Get cached feed data if not expired"""
        with self.lock:
            if source in self.cache:
                data, timestamp = self.cache[source]
                if time.time() - timestamp < self.cache_duration:
                    return data
        return None

    def set(self, source: str, data: Dict):
        """Cache feed data"""
        with self.lock:
            self.cache[source] = (data, time.time())

    def clear(self, source: Optional[str] = None):
        """Clear cache for source or all"""
        with self.lock:
            if source:
                self.cache.pop(source, None)
            else:
                self.cache.clear()


# Global cache instance
feed_cache = FeedCache()

# Background refresh status
refresh_status = {
    'is_refreshing': False,
    'last_refresh': {},
    'lock': Lock()
}


def parse_feed_to_episodes(feed_data: List[Dict], source: str = 'patreon') -> List[Dict]:
    """Convert RSS feed data to episode format"""
    episodes = []

    for entry in feed_data:
        # Extract episode number from title if available
        episode_num = None
        title = entry.get('title', '')

        # Try to extract episode number (e.g., "#1270" or "Episode 1270")
        import re
        match = re.search(r'#?(\d{3,4})', title)
        if match:
            episode_num = match.group(1)

        # Convert published date to datetime object
        published_date = entry.get('published')
        if published_date and not isinstance(published_date, datetime):
            # Convert time.struct_time or string to datetime
            import time
            if isinstance(published_date, time.struct_time):
                published_date = datetime.fromtimestamp(time.mktime(published_date))
            elif isinstance(published_date, str):
                try:
                    from dateutil import parser as date_parser
                    published_date = date_parser.parse(published_date)
                except:
                    published_date = None

        # Convert numeric fields safely
        def safe_float(value, default=0.0):
            """Convert to float, handling empty strings and None"""
            if value is None or value == '':
                return default
            try:
                return float(value)
            except (ValueError, TypeError):
                return default

        def safe_int(value, default=0):
            """Convert to int, handling empty strings and None"""
            if value is None or value == '':
                return default
            try:
                return int(value)
            except (ValueError, TypeError):
                return default

        episode = {
            'episode_number': episode_num,
            'title': title,
            'description': entry.get('description', ''),
            'audio_url': entry.get('audio_url', ''),
            'duration': safe_float(entry.get('duration')),
            'file_size': safe_int(entry.get('audio_length')),
            'published_date': published_date,
            'feed_source': source,
            'metadata_json': json.dumps({
                'guid': entry.get('guid'),
                'author': entry.get('author'),
                'link': entry.get('link')
            })
        }
        episodes.append(episode)

    return episodes


def refresh_feed_background(source: str, db_session):
    """Background task to refresh feed from RSS"""
    try:
        with refresh_status['lock']:
            refresh_status['is_refreshing'] = True
            refresh_status['last_refresh'][source] = {
                'status': 'in_progress',
                'started': datetime.now().isoformat()
            }

        # Get RSS feed URL from config
        feed_url = None
        try:
            from config import config
            if source == 'patreon':
                feed_url = config.podcast.rss_feed_url
            # Add other sources as needed
        except Exception:
            pass

        if not feed_url:
            raise ValueError(f"No feed URL configured for source: {source}")

        # Parse feed
        print(f"Fetching feed from {source}...")
        feed_data = download_episodes.parse_feed(feed_url)

        # Convert to episode format
        episodes_data = parse_feed_to_episodes(feed_data, source)

        added = 0
        updated = 0
        errors = 0

        # Update database
        for ep_data in episodes_data:
            try:
                # Check if episode exists by audio_url
                existing = DatabaseManager.get_episode_by_url(db_session, ep_data['audio_url'])

                if existing:
                    # Update existing
                    for key, value in ep_data.items():
                        if key not in ['id', 'added_date']:
                            setattr(existing, key, value)
                    updated += 1
                else:
                    # Add new
                    DatabaseManager.add_episode(db_session, **ep_data)
                    added += 1

            except IntegrityError as e:
                db_session.rollback()
                errors += 1
                print(f"Error adding episode: {e}")
            except Exception as e:
                errors += 1
                print(f"Unexpected error: {e}")

        db_session.commit()

        # Update status
        with refresh_status['lock']:
            refresh_status['last_refresh'][source] = {
                'status': 'completed',
                'completed': datetime.now().isoformat(),
                'added': added,
                'updated': updated,
                'errors': errors,
                'total': len(episodes_data)
            }

        print(f"Feed refresh complete: {added} added, {updated} updated, {errors} errors")

    except Exception as e:
        with refresh_status['lock']:
            refresh_status['last_refresh'][source] = {
                'status': 'error',
                'error': str(e),
                'completed': datetime.now().isoformat()
            }
        print(f"Feed refresh error: {e}")

    finally:
        with refresh_status['lock']:
            refresh_status['is_refreshing'] = False


# ============================================================================
# API ENDPOINTS
# ============================================================================

@api_bp.route('/episodes', methods=['GET'])
def get_episodes():
    """
    Get episodes with filtering and pagination
    Query params:
      - feed_source: patreon | apple
      - transcribed_only: true | false
      - in_queue_only: true | false
      - sort_by: published_date | title | episode_number | transcribed_date
      - sort_desc: true | false
      - limit: number of results (default 50)
      - offset: pagination offset (default 0)
      - search: search term for title/description
    """
    try:
        # Get query parameters
        feed_source = request.args.get('feed_source')
        transcribed_only = request.args.get('transcribed_only', 'false').lower() == 'true'
        in_queue_only = request.args.get('in_queue_only', 'false').lower() == 'true'
        sort_by = request.args.get('sort_by', 'published_date')
        sort_desc = request.args.get('sort_desc', 'true').lower() == 'true'
        limit = int(request.args.get('limit', 50))
        offset = int(request.args.get('offset', 0))
        search = request.args.get('search', '').strip()

        # Get database session
        db = DatabaseManager.get_session()

        try:
            # Build query
            query = db.query(Episode)

            if feed_source:
                query = query.filter(Episode.feed_source == feed_source)

            if transcribed_only:
                query = query.filter(Episode.is_transcribed == True)

            if in_queue_only:
                query = query.filter(Episode.is_in_queue == True)

            if search:
                query = query.filter(
                    (Episode.title.ilike(f'%{search}%')) |
                    (Episode.description.ilike(f'%{search}%'))
                )

            # Count total before pagination
            total = query.count()

            # Sort
            sort_column = getattr(Episode, sort_by, Episode.published_date)
            if sort_desc:
                query = query.order_by(sort_column.desc())
            else:
                query = query.order_by(sort_column.asc())

            # Paginate
            episodes = query.limit(limit).offset(offset).all()

            # Convert to dict
            episodes_data = [ep.to_dict() for ep in episodes]

            return jsonify({
                'episodes': episodes_data,
                'total': total,
                'limit': limit,
                'offset': offset,
                'has_more': (offset + limit) < total
            })

        finally:
            db.close()

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/episodes/<int:episode_id>', methods=['GET'])
def get_episode(episode_id):
    """Get single episode by ID"""
    try:
        db = DatabaseManager.get_session()
        try:
            episode = db.query(Episode).filter(Episode.id == episode_id).first()
            if not episode:
                return jsonify({'error': 'Episode not found'}), 404

            return jsonify(episode.to_dict())
        finally:
            db.close()
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/episodes/refresh-feed', methods=['POST'])
def refresh_feed():
    """
    Refresh episodes from RSS feed
    Body: {source: "patreon" | "apple", force: true/false}
    """
    try:
        data = request.get_json() or {}
        source = data.get('source', 'patreon')
        force = data.get('force', False)

        # Check if already refreshing
        with refresh_status['lock']:
            if refresh_status['is_refreshing']:
                return jsonify({
                    'status': 'already_refreshing',
                    'message': 'Feed refresh already in progress'
                }), 409

        # Check cache first (unless force refresh)
        if not force:
            cached = feed_cache.get(source)
            if cached:
                return jsonify({
                    'status': 'cached',
                    'message': 'Using cached data',
                    'data': cached
                })

        # Start background refresh
        db = DatabaseManager.get_session()
        thread = Thread(target=refresh_feed_background, args=(source, db))
        thread.daemon = True
        thread.start()

        return jsonify({
            'status': 'started',
            'message': f'Feed refresh started for {source}',
            'source': source
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/episodes/refresh-status/<source>', methods=['GET'])
def get_refresh_status(source):
    """Get status of feed refresh"""
    with refresh_status['lock']:
        status = refresh_status['last_refresh'].get(source, {
            'status': 'never_refreshed'
        })
        status['is_refreshing'] = refresh_status['is_refreshing']

    return jsonify(status)


@api_bp.route('/feeds/sources', methods=['GET'])
def get_feed_sources():
    """Get list of available feed sources"""
    sources = [
        {
            'id': 'patreon',
            'name': 'Patreon (Premium)',
            'icon': '💎',
            'enabled': True
        },
        {
            'id': 'apple',
            'name': 'Apple Podcasts',
            'icon': '🎙️',
            'enabled': False  # To be implemented
        }
    ]
    return jsonify(sources)


# ============================================================================
# QUEUE MANAGEMENT ENDPOINTS
# ============================================================================

@api_bp.route('/queue', methods=['GET'])
def get_queue():
    """Get current transcription queue with episode details"""
    try:
        db = DatabaseManager.get_session()
        try:
            # Get all queue items with their episodes
            queue_items = db.query(TranscriptionQueue).order_by(
                TranscriptionQueue.priority.desc(),
                TranscriptionQueue.added_to_queue_date.asc()
            ).all()

            result = {
                'pending': [],
                'processing': [],
                'completed': [],
                'failed': []
            }

            for item in queue_items:
                episode = db.query(Episode).filter(Episode.id == item.episode_id).first()
                if episode:
                    queue_entry = {
                        'queue_item': item.to_dict(),
                        'episode': episode.to_dict()
                    }
                    result[item.status].append(queue_entry)

            # Get status summary
            status = DatabaseManager.get_queue_status(db)

            return jsonify({
                'queue': result,
                'status': status
            })

        finally:
            db.close()

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/queue/add', methods=['POST'])
def add_to_queue():
    """
    Add episode to transcription queue
    Body: {episode_id: number, priority: number (optional)}
    """
    try:
        data = request.get_json()
        episode_id = data.get('episode_id')
        priority = data.get('priority', 0)

        if not episode_id:
            return jsonify({'error': 'episode_id required'}), 400

        db = DatabaseManager.get_session()
        try:
            # Check if episode exists
            episode = db.query(Episode).filter(Episode.id == episode_id).first()
            if not episode:
                return jsonify({'error': 'Episode not found'}), 404

            # Add to queue
            queue_item = DatabaseManager.add_to_queue(db, episode_id, priority)

            return jsonify({
                'message': 'Episode added to queue',
                'queue_item': queue_item.to_dict(),
                'episode': episode.to_dict()
            })

        finally:
            db.close()

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/queue/remove/<int:episode_id>', methods=['DELETE'])
def remove_from_queue(episode_id):
    """Remove episode from queue"""
    try:
        db = DatabaseManager.get_session()
        try:
            DatabaseManager.remove_from_queue(db, episode_id)
            return jsonify({'message': 'Episode removed from queue'})
        finally:
            db.close()

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/queue/stop-current', methods=['POST'])
def stop_current():
    """
    Stop currently processing transcription
    NOTE: This requires worker integration to actually stop the process
    For now, just marks as failed and allows retry
    """
    try:
        db = DatabaseManager.get_session()
        try:
            # Find currently processing item
            processing = db.query(TranscriptionQueue).filter(
                TranscriptionQueue.status == 'processing'
            ).first()

            if not processing:
                return jsonify({'message': 'No transcription currently processing'}), 404

            # Mark as failed (user stopped)
            processing.status = 'failed'
            processing.error_message = 'Stopped by user'
            processing.completed_date = datetime.utcnow()

            # Update episode
            episode = db.query(Episode).filter(Episode.id == processing.episode_id).first()
            if episode:
                episode.transcription_status = 'stopped'
                episode.is_in_queue = False

            db.commit()

            return jsonify({
                'message': 'Transcription stopped',
                'episode_id': processing.episode_id
            })

        finally:
            db.close()

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/queue/retry/<int:episode_id>', methods=['POST'])
def retry_transcription(episode_id):
    """
    Retry a failed transcription
    Resets the queue item from 'failed' to 'pending'
    """
    try:
        db = DatabaseManager.get_session()
        try:
            # Find the failed queue item
            queue_item = db.query(TranscriptionQueue).filter(
                TranscriptionQueue.episode_id == episode_id,
                TranscriptionQueue.status == 'failed'
            ).first()

            if not queue_item:
                return jsonify({'error': 'No failed queue item found for this episode'}), 404

            # Get the episode
            episode = db.query(Episode).filter(Episode.id == episode_id).first()
            if not episode:
                return jsonify({'error': 'Episode not found'}), 404

            # Reset queue item to pending
            queue_item.status = 'pending'
            queue_item.error_message = None
            queue_item.started_date = None
            queue_item.completed_date = None
            # Keep retry_count to track how many times it's been retried

            # Update episode status
            episode.is_in_queue = True
            episode.transcription_status = 'pending'

            db.commit()

            return jsonify({
                'message': 'Episode queued for retry',
                'episode_id': episode_id,
                'retry_count': queue_item.retry_count or 0
            })

        finally:
            db.close()

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/queue/status', methods=['GET'])
def queue_status():
    """Get queue statistics"""
    try:
        db = DatabaseManager.get_session()
        try:
            status = DatabaseManager.get_queue_status(db)
            return jsonify(status)
        finally:
            db.close()

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/stats', methods=['GET'])
def get_stats():
    """Get comprehensive episode statistics"""
    try:
        db = DatabaseManager.get_session()
        try:
            total_episodes = db.query(Episode).count()
            downloaded_episodes = db.query(Episode).filter(Episode.is_downloaded == True).count()
            transcribed_episodes = db.query(Episode).filter(Episode.is_transcribed == True).count()
            in_queue = db.query(Episode).filter(Episode.is_in_queue == True).count()

            # Count failed queue items
            failed = db.query(TranscriptionQueue).filter(TranscriptionQueue.status == 'failed').count()

            # Calculate completion rates
            completion_rate_downloaded = transcribed_episodes / downloaded_episodes if downloaded_episodes > 0 else 0
            completion_rate_total = transcribed_episodes / total_episodes if total_episodes > 0 else 0

            # Calculate storage stats (optional)
            storage_stats = {
                'audio_size_mb': 0,
                'transcript_size_mb': 0
            }

            return jsonify({
                'total_episodes': total_episodes,
                'downloaded_episodes': downloaded_episodes,
                'transcribed_episodes': transcribed_episodes,
                'in_queue': in_queue,
                'failed': failed,
                'completion_rate': {
                    'downloaded': round(completion_rate_downloaded, 4),
                    'total': round(completion_rate_total, 6)
                },
                'storage': storage_stats
            })

        finally:
            db.close()

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/worker/status', methods=['GET'])
def worker_status():
    """Get current worker status and activity"""
    try:
        db = DatabaseManager.get_session()
        try:
            # Check if there's a currently processing item
            processing_item = db.query(TranscriptionQueue).filter(
                TranscriptionQueue.status == 'processing'
            ).first()

            if processing_item:
                episode = db.query(Episode).filter(Episode.id == processing_item.episode_id).first()

                # Calculate elapsed time
                if processing_item.started_date:
                    elapsed = (datetime.now() - processing_item.started_date).total_seconds()
                else:
                    elapsed = 0

                # Estimate progress (rough estimate based on elapsed time)
                # Assuming ~6 minutes per hour of audio with small model
                if episode and episode.duration:
                    expected_total_seconds = (episode.duration / 60) * 6 * 60  # minutes * 6 * 60 seconds
                    progress = min(int((elapsed / expected_total_seconds) * 100), 95) if expected_total_seconds > 0 else 0
                    estimated_remaining = max(0, expected_total_seconds - elapsed)
                else:
                    progress = 0
                    estimated_remaining = None

                return jsonify({
                    'status': 'transcribing',
                    'current_episode': episode.to_dict() if episode else None,
                    'progress': progress,
                    'elapsed_seconds': int(elapsed),
                    'estimated_remaining_seconds': int(estimated_remaining) if estimated_remaining else None,
                    'last_activity': processing_item.started_date.isoformat() if processing_item.started_date else None,
                    'next_check_seconds': None,
                    'worker_info': {
                        'model': 'small',  # TODO: Get from config
                        'memory_mb': None,  # TODO: Get from worker
                        'memory_percent': None,
                        'processed_today': None  # TODO: Calculate
                    }
                })
            else:
                # Worker is idle
                # Get last completed item
                last_completed = db.query(TranscriptionQueue).filter(
                    TranscriptionQueue.status == 'completed'
                ).order_by(TranscriptionQueue.completed_date.desc()).first()

                return jsonify({
                    'status': 'idle',
                    'current_episode': None,
                    'progress': None,
                    'elapsed_seconds': None,
                    'estimated_remaining_seconds': None,
                    'last_activity': last_completed.completed_date.isoformat() if last_completed and last_completed.completed_date else None,
                    'next_check_seconds': 60,  # TODO: Get from config
                    'worker_info': {
                        'model': 'small',
                        'memory_mb': None,
                        'memory_percent': None,
                        'processed_today': None
                    }
                })

        finally:
            db.close()

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/episodes/<int:episode_id>/transcript', methods=['GET'])
def get_transcript(episode_id):
    """Get transcript content for an episode"""
    try:
        db = DatabaseManager.get_session()
        try:
            episode = db.query(Episode).filter(Episode.id == episode_id).first()

            if not episode:
                return jsonify({'error': 'Episode not found'}), 404

            if not episode.is_transcribed or not episode.transcript_path:
                return jsonify({'error': 'Episode not transcribed'}), 404

            transcript_path = Path(episode.transcript_path)

            if not transcript_path.exists():
                return jsonify({'error': 'Transcript file not found'}), 404

            # Read transcript JSON
            with open(transcript_path, 'r') as f:
                transcript_data = json.load(f)

            # Get available formats
            base_path = transcript_path.parent / transcript_path.stem
            formats_available = {
                'json': str(transcript_path) if transcript_path.exists() else None,
                'text': str(base_path.with_suffix('.txt')) if (base_path.with_suffix('.txt')).exists() else None,
                'srt': str(base_path.with_suffix('.srt')) if (base_path.with_suffix('.srt')).exists() else None,
                'markdown': str(base_path.with_suffix('.md')) if (base_path.with_suffix('.md')).exists() else None
            }

            # Extract text from segments
            text = ' '.join([seg.get('text', '') for seg in transcript_data.get('segments', [])])

            # Calculate word count
            word_count = len(text.split())

            return jsonify({
                'episode_id': episode_id,
                'text': text,
                'segments': transcript_data.get('segments', []),
                'metadata': {
                    'duration': transcript_data.get('duration', episode.duration),
                    'word_count': word_count,
                    'processing_time': episode.processing_time,
                    'model': transcript_data.get('model', 'unknown'),
                    'language': transcript_data.get('language', 'en')
                },
                'formats_available': formats_available
            })

        finally:
            db.close()

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/system/status', methods=['GET'])
def system_status():
    """Get system status including active processes and metrics - optimized version"""
    import psutil
    import subprocess

    try:
        processes = []

        # Efficient: use pgrep to find specific processes
        for process_name in ['transcription_worker.py', 'speaker_diarization.py']:
            try:
                result = subprocess.run(
                    ['pgrep', '-f', process_name],
                    capture_output=True,
                    text=True,
                    timeout=1
                )

                pids = result.stdout.strip().split('\n')
                if not pids or pids == ['']:
                    continue

                for pid_str in pids:
                    try:
                        pid = int(pid_str)
                        proc = psutil.Process(pid)

                        # Get basic info
                        create_time = proc.create_time()
                        uptime = time.time() - create_time
                        memory_mb = proc.memory_info().rss / (1024 * 1024)
                        cpu = proc.cpu_percent(interval=0.1)  # Quick sample

                        if 'transcription_worker' in process_name:
                            # Get transcription status from database
                            db = DatabaseManager.get_session()
                            try:
                                processing = db.query(TranscriptionQueue).filter(
                                    TranscriptionQueue.status == 'processing'
                                ).first()

                                if processing:
                                    episode = db.query(Episode).filter(Episode.id == processing.episode_id).first()
                                    elapsed = (datetime.now() - processing.started_date).total_seconds() if processing.started_date else 0

                                    # Estimate progress
                                    if episode and episode.duration:
                                        expected = (episode.duration / 60) * 3 * 60
                                        progress = min(int((elapsed / expected) * 100), 95) if expected > 0 else 0
                                        eta = max(0, expected - elapsed)
                                    else:
                                        progress = 0
                                        eta = None

                                    status = 'running'
                                    current_task = f"Transcribing: {episode.title if episode else 'Unknown'}"
                                else:
                                    status = 'idle'
                                    current_task = None
                                    progress = None
                                    eta = None
                            finally:
                                db.close()

                            processes.append({
                                'name': 'Transcription Worker',
                                'pid': pid,
                                'status': status,
                                'cpu_percent': round(cpu, 1),
                                'memory_mb': round(memory_mb, 1),
                                'uptime_seconds': int(uptime),
                                'current_task': current_task,
                                'progress': progress,
                                'eta_seconds': int(eta) if eta else None
                            })

                        elif 'speaker_diarization' in process_name:
                            # Extract episode from cmdline
                            cmdline = proc.cmdline()
                            episode_name = 'Unknown'
                            for arg in cmdline:
                                if '.mp3' in arg:
                                    episode_name = arg.split('/')[-1].replace('.mp3', '')
                                    break

                            processes.append({
                                'name': 'Speaker Diarization',
                                'pid': pid,
                                'status': 'running',
                                'cpu_percent': round(cpu, 1),
                                'memory_mb': round(memory_mb, 1),
                                'uptime_seconds': int(uptime),
                                'current_task': f"Analyzing: {episode_name}",
                                'progress': None,
                                'eta_seconds': None
                            })

                    except (psutil.NoSuchProcess, psutil.AccessDenied, ValueError):
                        continue
            except subprocess.TimeoutExpired:
                continue

        # System metrics - use non-blocking calls
        system_metrics = {
            'cpu_percent': round(psutil.cpu_percent(interval=0), 1),  # Non-blocking
            'memory_percent': round(psutil.virtual_memory().percent, 1),
            'memory_used': psutil.virtual_memory().used,
            'memory_total': psutil.virtual_memory().total
        }

        return jsonify({
            'processes': processes,
            'system': system_metrics
        })

    except Exception as e:
        return jsonify({'error': str(e), 'processes': [], 'system': {}}), 500


# Health check
@api_bp.route('/health', methods=['GET'])
def health():
    """API health check"""
    return jsonify({
        'status': 'healthy',
        'version': '2.0',
        'timestamp': datetime.now().isoformat()
    })


# Export blueprint
def register_api(app):
    """Register API blueprint with Flask app"""
    app.register_blueprint(api_bp)
    print("✅ Enhanced API v2 registered at /api/v2/")
