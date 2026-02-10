#!/usr/bin/env python3
"""
Background Transcription Worker
Processes transcription queue from database

Usage:
    python transcription_worker.py                    # Start worker with default settings
    python transcription_worker.py --model medium     # Use medium model
    python transcription_worker.py --check-interval 30 # Check every 30 seconds

The worker will:
- Poll database for queued episodes
- Process episodes in priority order
- Update database with transcription status
- Log all activity to transcription_worker.log
- Resume from where it left off if interrupted

Check status:
    tail -f transcription_worker.log
"""

import argparse
import gc
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import psutil
import re
import requests
import signal
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

# Import database
try:
    from database import DatabaseManager, Episode, TranscriptionQueue as DBQueue
    DATABASE_AVAILABLE = True
except ImportError:
    DATABASE_AVAILABLE = False
    print("ERROR: Database module not available. Run: pip install sqlalchemy")

# Load configuration
try:
    from config import config
    DEFAULT_MODEL = config.transcription.model if config else "medium"
    DEFAULT_CHECK_INTERVAL = config.worker.check_interval if config else 60
    DEFAULT_EPISODES_DIR = config.paths.episodes if config else Path("episodes")
    DEFAULT_TRANSCRIPTS_DIR = config.paths.transcripts if config else Path("transcripts")
except (ImportError, AttributeError):
    print("Warning: Could not load config module. Using defaults.")
    DEFAULT_MODEL = "medium"
    DEFAULT_CHECK_INTERVAL = 60
    DEFAULT_EPISODES_DIR = Path("episodes")
    DEFAULT_TRANSCRIPTS_DIR = Path("transcripts")

# Import UI manager
try:
    from ui_manager import TranscriptionUI, SimpleUI
    UI_AVAILABLE = True
except ImportError:
    UI_AVAILABLE = False
    print("Warning: Rich UI not available. Install with: pip install rich")

# Setup logging
LOG_FILE = Path("transcription_worker.log")
QUEUE_FILE = Path("transcription_queue.json")
STATUS_FILE = Path("transcription_status.json")

# Configure logger with rotation
logger = logging.getLogger("TranscriptionWorker")
logger.setLevel(logging.DEBUG)  # Changed to DEBUG to support different log levels

# File handler with rotation (max 10MB per file, keep 3 backups)
file_handler = RotatingFileHandler(
    LOG_FILE,
    maxBytes=10*1024*1024,  # 10MB
    backupCount=3
)
file_handler.setLevel(logging.DEBUG)
file_formatter = logging.Formatter(
    '%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
file_handler.setFormatter(file_formatter)

# Console handler (only if not using Rich UI)
if not UI_AVAILABLE:
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_formatter = logging.Formatter('%(asctime)s - %(message)s', datefmt='%H:%M:%S')
    console_handler.setFormatter(console_formatter)
    logger.addHandler(console_handler)

logger.addHandler(file_handler)


def sanitize_filename(filename: str) -> str:
    """Remove/replace characters that are problematic in filenames"""
    # Remove or replace problematic characters
    filename = re.sub(r'[<>:"/\\|?*]', '', filename)
    filename = filename.replace('\n', ' ').replace('\r', ' ')
    # Collapse multiple spaces
    filename = re.sub(r'\s+', ' ', filename).strip()
    # Limit length
    if len(filename) > 200:
        filename = filename[:200]
    return filename


def download_audio_file(episode, output_dir: Path) -> Optional[Path]:
    """Download audio file for an episode

    Args:
        episode: Episode database object with audio_url
        output_dir: Directory to save the audio file

    Returns:
        Path to downloaded file, or None if download failed
    """
    if not episode.audio_url:
        logger.warning(f"Episode {episode.id} has no audio URL")
        return None

    try:
        # Create safe filename
        ep_num = episode.episode_number or episode.id
        safe_title = sanitize_filename(episode.title)

        # Determine extension from URL
        audio_url = episode.audio_url
        if ".mp3" in audio_url.lower():
            ext = ".mp3"
        elif ".m4a" in audio_url.lower():
            ext = ".m4a"
        else:
            ext = ".mp3"  # Default

        filename = f"{ep_num} - {safe_title}{ext}"
        output_path = output_dir / filename

        # Skip if already exists
        if output_path.exists():
            logger.info(f"Audio file already exists: {filename}")
            return output_path

        # Download
        logger.info(f"Downloading audio: {filename}")
        output_dir.mkdir(parents=True, exist_ok=True)

        response = requests.get(audio_url, stream=True, timeout=30)
        response.raise_for_status()

        total_size = int(response.headers.get("content-length", 0))
        downloaded = 0

        with open(output_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
                downloaded += len(chunk)
                if total_size > 0 and downloaded % (1024 * 1024) == 0:  # Log every MB
                    progress = (downloaded / total_size) * 100
                    logger.debug(f"Download progress: {progress:.1f}%")

        logger.info(f"Downloaded: {filename} ({downloaded / 1024 / 1024:.1f} MB)")
        return output_path

    except Exception as e:
        logger.error(f"Error downloading audio for episode {episode.id}: {e}")
        if output_path and output_path.exists():
            output_path.unlink()  # Clean up partial download
        return None


class TranscriptionQueue:
    """Manages the queue of files to transcribe - Database-backed version"""

    def __init__(self, queue_file: Path = None):
        """Initialize database-backed queue

        Args:
            queue_file: Ignored - kept for compatibility with old interface
        """
        if not DATABASE_AVAILABLE:
            raise RuntimeError("Database not available. Install SQLAlchemy.")

        self.db = None
        self.current_queue_item = None
        self.current_episode = None
        logger.info("Initialized database-backed transcription queue")

    def _get_session(self):
        """Get a fresh database session"""
        if self.db:
            self.db.close()
        self.db = DatabaseManager.get_session()
        return self.db

    def add_file(self, file_path: str):
        """Add a file to the pending queue (legacy compatibility - not used with DB)"""
        # This method is kept for compatibility but not used
        # Episodes are added to queue via the API
        logger.debug(f"add_file called (not used in DB mode): {file_path}")

    def get_next(self) -> Optional[str]:
        """Get next file to process from database queue"""
        try:
            db = self._get_session()

            # Get next pending item ordered by priority (high to low), then by date
            queue_item = db.query(DBQueue).filter(
                DBQueue.status == 'pending'
            ).order_by(
                DBQueue.priority.desc(),
                DBQueue.added_to_queue_date.asc()
            ).first()

            if not queue_item:
                return None

            # Get the episode details
            episode = db.query(Episode).filter(Episode.id == queue_item.episode_id).first()

            if not episode:
                logger.error(f"Queue item {queue_item.id} references non-existent episode {queue_item.episode_id}")
                # Remove invalid queue item
                db.delete(queue_item)
                db.commit()
                return None

            # Update queue item status to processing
            queue_item.status = 'processing'
            queue_item.started_date = datetime.now()

            # Update episode status
            episode.transcription_status = 'processing'

            db.commit()

            # Store current item for later updates
            self.current_queue_item = queue_item.id
            self.current_episode = episode.id

            # Get or download audio file path
            audio_path = episode.audio_file_path

            if not audio_path or not Path(audio_path).exists():
                # No local file - try to download
                logger.info(f"Episode {episode.id} not downloaded. Attempting download...")

                downloaded_path = download_audio_file(episode, Path(DEFAULT_EPISODES_DIR))

                if downloaded_path:
                    # Update episode with downloaded file path
                    episode.audio_file_path = str(downloaded_path)
                    episode.is_downloaded = True
                    episode.downloaded_date = datetime.now()
                    episode.file_size = downloaded_path.stat().st_size
                    db.commit()

                    audio_path = str(downloaded_path)
                    logger.info(f"Successfully downloaded: {downloaded_path.name}")
                else:
                    # Download failed
                    logger.error(f"Failed to download audio for episode {episode.id}")
                    self.mark_failed(None, "Failed to download audio file")
                    return None

            logger.info(f"Processing queue item {queue_item.id}: {episode.title} (priority: {queue_item.priority})")
            return audio_path

        except Exception as e:
            logger.error(f"Error getting next queue item: {e}")
            if db:
                db.rollback()
            return None

    def mark_completed(self, file_path: str):
        """Mark file as completed in database"""
        try:
            db = self._get_session()

            if not self.current_queue_item or not self.current_episode:
                logger.warning("No current queue item to mark as completed")
                return

            # Update queue item
            queue_item = db.query(DBQueue).filter(DBQueue.id == self.current_queue_item).first()
            if queue_item:
                queue_item.status = 'completed'
                queue_item.completed_date = datetime.now()

            # Update episode
            episode = db.query(Episode).filter(Episode.id == self.current_episode).first()
            if episode:
                episode.transcription_status = 'completed'
                episode.is_transcribed = True
                episode.is_in_queue = False
                episode.transcribed_date = datetime.now()

                # Set transcript path
                transcript_name = Path(file_path).stem
                episode.transcript_path = str(Path(DEFAULT_TRANSCRIPTS_DIR) / f"{transcript_name}.json")

            db.commit()
            logger.info(f"Marked as completed: {Path(file_path).name}")

            # Clear current tracking
            self.current_queue_item = None
            self.current_episode = None

        except Exception as e:
            logger.error(f"Error marking as completed: {e}")
            if db:
                db.rollback()

    def mark_failed(self, file_path: str, error: str, max_retries: int = 3):
        """Mark file as failed or retry in database"""
        try:
            db = self._get_session()

            if not self.current_queue_item or not self.current_episode:
                logger.warning("No current queue item to mark as failed")
                return

            # Update queue item
            queue_item = db.query(DBQueue).filter(DBQueue.id == self.current_queue_item).first()
            if not queue_item:
                return

            retry_count = queue_item.retry_count

            if retry_count < max_retries:
                # Retry
                queue_item.status = 'pending'
                queue_item.retry_count = retry_count + 1
                queue_item.error_message = error
                queue_item.started_date = None
                logger.warning(f"Failed: {Path(file_path).name if file_path else 'unknown'} - {error}. "
                             f"Retry {retry_count + 1}/{max_retries}")
            else:
                # Max retries exceeded
                queue_item.status = 'failed'
                queue_item.error_message = error
                queue_item.completed_date = datetime.now()
                logger.error(f"Failed permanently: {Path(file_path).name if file_path else 'unknown'} - {error} "
                           f"(after {retry_count} retries)")

            # Update episode
            episode = db.query(Episode).filter(Episode.id == self.current_episode).first()
            if episode:
                episode.transcription_status = 'failed' if retry_count >= max_retries else 'queued'
                episode.transcription_error = error
                if retry_count >= max_retries:
                    episode.is_in_queue = False

            db.commit()

            # Clear current tracking
            self.current_queue_item = None
            self.current_episode = None

        except Exception as e:
            logger.error(f"Error marking as failed: {e}")
            if db:
                db.rollback()

    def get_status(self) -> dict:
        """Get queue status from database"""
        try:
            db = self._get_session()

            pending = db.query(DBQueue).filter(DBQueue.status == 'pending').count()
            processing = db.query(DBQueue).filter(DBQueue.status == 'processing').count()
            completed = db.query(DBQueue).filter(DBQueue.status == 'completed').count()
            failed = db.query(DBQueue).filter(DBQueue.status == 'failed').count()

            # Get current processing item if any
            processing_item = db.query(DBQueue).filter(DBQueue.status == 'processing').first()
            processing_file = None
            if processing_item:
                episode = db.query(Episode).filter(Episode.id == processing_item.episode_id).first()
                if episode:
                    processing_file = episode.title

            return {
                "pending": pending,
                "processing": processing_file,
                "completed": completed,
                "failed": failed
            }

        except Exception as e:
            logger.error(f"Error getting queue status: {e}")
            return {
                "pending": 0,
                "processing": None,
                "completed": 0,
                "failed": 0
            }

    def __del__(self):
        """Cleanup database connection"""
        if hasattr(self, 'db') and self.db:
            self.db.close()


class TranscriptionWorker:
    """Background worker that monitors and transcribes audio files"""

    def __init__(self, episodes_dir: Path, transcripts_dir: Path,
                 model: str, check_interval: int, use_rich_ui: bool = True,
                 idle_timeout: Optional[int] = None, max_retries: int = 3):
        self.episodes_dir = episodes_dir
        self.transcripts_dir = transcripts_dir
        self.model = model
        self.check_interval = check_interval
        self.idle_timeout = idle_timeout  # Minutes before auto-shutdown
        self.max_retries = max_retries
        self.queue = TranscriptionQueue(QUEUE_FILE)
        self.running = True
        self.whisper_model = None
        self.last_activity = datetime.now()
        self.model_loaded_at = None
        self.idle_check_count = 0  # Track how many times we've been idle
        self.process = psutil.Process()  # For resource monitoring

        # Initialize UI
        if use_rich_ui and UI_AVAILABLE:
            self.ui = TranscriptionUI()
        else:
            self.ui = SimpleUI(logger)

        # Setup signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

    def _signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        logger.info("Shutdown signal received. Finishing current task...")
        self.running = False

    def _get_memory_usage(self) -> dict:
        """Get current memory usage in MB"""
        mem_info = self.process.memory_info()
        return {
            "rss_mb": mem_info.rss / 1024 / 1024,  # Resident Set Size
            "vms_mb": mem_info.vms / 1024 / 1024,  # Virtual Memory Size
            "percent": self.process.memory_percent()
        }

    def _unload_whisper_model(self):
        """Unload the Whisper model to free memory"""
        if self.whisper_model is not None:
            mem_before = self._get_memory_usage()
            logger.info(f"Unloading Whisper model (current memory: {mem_before['rss_mb']:.1f} MB)...")
            self.whisper_model = None
            self.model_loaded_at = None
            gc.collect()  # Force garbage collection
            mem_after = self._get_memory_usage()
            freed = mem_before['rss_mb'] - mem_after['rss_mb']
            logger.info(f"Model unloaded. Freed {freed:.1f} MB "
                       f"(current memory: {mem_after['rss_mb']:.1f} MB)")

    def _load_whisper_model(self):
        """Load the Whisper model (lazy loading)"""
        if self.whisper_model is None:
            try:
                from faster_whisper import WhisperModel
                mem_before = self._get_memory_usage()
                logger.info(f"Loading Whisper model: {self.model} "
                          f"(current memory: {mem_before['rss_mb']:.1f} MB)")
                logger.info("(This may take a moment on first run as model downloads...)")
                self.whisper_model = WhisperModel(self.model, device="auto", compute_type="auto")
                self.model_loaded_at = datetime.now()
                mem_after = self._get_memory_usage()
                used = mem_after['rss_mb'] - mem_before['rss_mb']
                logger.info(f"Model loaded successfully! Used {used:.1f} MB "
                          f"(current memory: {mem_after['rss_mb']:.1f} MB)")
                self.last_activity = datetime.now()
            except Exception as e:
                logger.error(f"Failed to load Whisper model: {e}")
                raise

    def _check_idle_timeout(self):
        """Check if we should shutdown due to idle timeout"""
        if self.idle_timeout is None:
            return False

        idle_minutes = (datetime.now() - self.last_activity).total_seconds() / 60
        if idle_minutes >= self.idle_timeout:
            logger.info(f"Idle timeout reached ({idle_minutes:.1f} minutes). Shutting down...")
            return True
        return False

    def _check_model_unload(self):
        """Unload model if idle for 10 minutes"""
        if self.whisper_model is not None and self.model_loaded_at is not None:
            idle_minutes = (datetime.now() - self.model_loaded_at).total_seconds() / 60
            if idle_minutes >= 10:
                self._unload_whisper_model()

    def _scan_for_new_files(self):
        """Scan episodes directory for new audio files"""
        if not self.episodes_dir.exists():
            logger.warning(f"Episodes directory does not exist: {self.episodes_dir}")
            return

        audio_extensions = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm"}

        for file_path in self.episodes_dir.iterdir():
            if file_path.suffix.lower() in audio_extensions:
                # Check if already transcribed
                transcript_json = self.transcripts_dir / f"{file_path.stem}.json"
                if not transcript_json.exists():
                    self.queue.add_file(str(file_path))

    def _transcribe_file(self, file_path: str) -> bool:
        """Transcribe a single file with error handling"""
        try:
            # Import transcription function
            from transcribe import transcribe_audio, save_transcript

            logger.info(f"Starting transcription: {Path(file_path).name}")
            self.last_activity = datetime.now()  # Update activity timestamp

            # Ensure model is loaded
            self._load_whisper_model()

            # Get memory usage before transcription
            mem_before = self._get_memory_usage()
            logger.debug(f"Memory before transcription: {mem_before['rss_mb']:.1f} MB "
                        f"({mem_before['percent']:.1f}%)")

            # Transcribe
            transcript_data = transcribe_audio(file_path, self.whisper_model)

            # Get memory usage after transcription
            mem_after = self._get_memory_usage()
            logger.debug(f"Memory after transcription: {mem_after['rss_mb']:.1f} MB "
                        f"({mem_after['percent']:.1f}%)")

            # Save results
            self.transcripts_dir.mkdir(parents=True, exist_ok=True)
            save_transcript(transcript_data, self.transcripts_dir, Path(file_path).stem)

            # Run speaker diarization if HF_TOKEN is available
            hf_token = os.environ.get('HF_TOKEN')
            if hf_token:
                try:
                    from speaker_diarization import process_episode
                    logger.info("Running speaker diarization...")

                    transcript_path = self.transcripts_dir / f"{Path(file_path).stem}.json"
                    enhanced_transcript = process_episode(
                        Path(file_path),
                        transcript_path,
                        hf_token,
                        num_speakers=2  # Default for Ice Cream Social (Matt & Paul)
                    )
                    logger.info("✅ Speaker diarization completed")
                except ImportError:
                    logger.warning("Speaker diarization module not available. Install with: pip install pyannote.audio")
                except Exception as e:
                    logger.warning(f"Speaker diarization failed (continuing anyway): {e}")
            else:
                logger.debug("Skipping speaker diarization (HF_TOKEN not set)")

            # Update status and activity
            self._update_status(file_path, "completed", transcript_data)
            self.last_activity = datetime.now()
            self.model_loaded_at = datetime.now()  # Reset model idle timer

            return True

        except MemoryError as e:
            error_msg = f"Out of memory during transcription: {e}"
            logger.error(f"Transcription failed for {Path(file_path).name}: {error_msg}")
            self._update_status(file_path, "failed", {"error": error_msg})
            # Try to free memory
            self._unload_whisper_model()
            gc.collect()
            return False

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Transcription failed for {Path(file_path).name}: {error_msg}")
            logger.debug(f"Full error details:", exc_info=True)
            self._update_status(file_path, "failed", {"error": error_msg})
            return False

    def _update_status(self, file_path: str, status: str, data: dict):
        """Update status file with latest info"""
        status_data = {
            "last_updated": datetime.now().isoformat(),
            "current_file": Path(file_path).name,
            "status": status,
            "queue_status": self.queue.get_status()
        }

        if status == "completed":
            status_data["processing_time"] = data.get("processing_time", 0)
            status_data["duration"] = data.get("duration", 0)
        elif status == "failed":
            status_data["error"] = data.get("error", "Unknown error")

        with open(STATUS_FILE, 'w') as f:
            json.dump(status_data, f, indent=2)

    def run(self):
        """Main worker loop"""
        # Show UI banner
        self.ui.show_banner()
        self.ui.show_config({
            "Watching": str(self.episodes_dir),
            "Output": str(self.transcripts_dir),
            "Model": self.model,
            "Check Interval": f"{self.check_interval}s",
        })

        # Also log to file
        logger.info("=" * 60)
        logger.info("Transcription Worker Started")
        logger.info(f"Watching: {self.episodes_dir}")
        logger.info(f"Output: {self.transcripts_dir}")
        logger.info(f"Model: {self.model}")
        logger.info(f"Check interval: {self.check_interval} seconds")
        logger.info("=" * 60)

        # NO AUTO-SCAN - User controls queue via UI
        self.ui.show_info("Worker ready. Waiting for episodes to be added to queue via UI...")
        logger.info("Worker ready - no auto-scan. Episodes must be added via UI.")

        # Report initial status
        status = self.queue.get_status()
        self.ui.update_queue_stats(status['pending'])
        logger.info(f"Initial queue status: {status['pending']} pending, "
                   f"{status['completed']} completed, {status['failed']} failed")

        # Main loop
        while self.running:
            try:
                # Process next file in queue
                next_file = self.queue.get_next()

                if next_file:
                    success = self._transcribe_file(next_file)
                    if success:
                        self.queue.mark_completed(next_file)
                    else:
                        self.queue.mark_failed(next_file, "Transcription failed",
                                             max_retries=self.max_retries)
                    # Reset idle counter on activity
                    self.idle_check_count = 0
                else:
                    # No files in queue - wait for user to add via UI
                    # NO AUTO-SCAN anymore

                    # Wait
                    status = self.queue.get_status()
                    if status['pending'] == 0:
                        self.idle_check_count += 1

                        # Log at reduced frequency when idle
                        # Only log every 30 checks (5 minutes if check_interval=10s)
                        if self.idle_check_count % 30 == 1:
                            mem = self._get_memory_usage()
                            logger.info(f"Idle - no files to process. "
                                      f"Memory: {mem['rss_mb']:.1f} MB ({mem['percent']:.1f}%)")
                            self.ui.show_waiting()
                        else:
                            # Use DEBUG level for frequent idle checks
                            logger.debug(f"No files to process. Waiting {self.check_interval}s...")

                        # Check if we should unload model to free memory
                        self._check_model_unload()

                        # Check idle timeout (if configured)
                        if self._check_idle_timeout():
                            logger.info("Auto-shutdown due to idle timeout.")
                            self.running = False
                            break

                        # Sleep longer when idle to reduce CPU usage
                        # Progressive backoff: use longer intervals after extended idle
                        if self.idle_check_count > 60:  # More than 10 minutes idle
                            sleep_time = min(self.check_interval * 3, 300)  # Max 5 minutes
                        else:
                            sleep_time = self.check_interval

                        time.sleep(sleep_time)

            except KeyboardInterrupt:
                logger.info("Keyboard interrupt received")
                break
            except Exception as e:
                logger.error(f"Error in main loop: {e}")
                logger.debug("Full error details:", exc_info=True)
                time.sleep(5)

        # Show final summary
        self.ui.show_final_summary()

        logger.info("=" * 60)
        logger.info("Transcription Worker Stopped")
        final_status = self.queue.get_status()
        logger.info(f"Final status: {final_status['completed']} completed, "
                   f"{final_status['pending']} pending, {final_status['failed']} failed")
        logger.info("=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="Background transcription worker for Ice Cream Social podcasts",
        epilog="Examples:\n"
               "  python transcription_worker.py --model medium\n"
               "  python transcription_worker.py --idle-timeout 30  # Auto-shutdown after 30 min\n"
               "  python transcription_worker.py --max-retries 5    # Retry failed files up to 5 times\n",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--episodes-dir",
        type=Path,
        default=DEFAULT_EPISODES_DIR,
        help=f"Directory to watch for audio files (default: {DEFAULT_EPISODES_DIR})"
    )
    parser.add_argument(
        "--transcripts-dir",
        type=Path,
        default=DEFAULT_TRANSCRIPTS_DIR,
        help=f"Directory for transcripts (default: {DEFAULT_TRANSCRIPTS_DIR})"
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        choices=["tiny", "base", "small", "medium", "large-v2", "large-v3"],
        help=f"Whisper model size (default: {DEFAULT_MODEL})"
    )
    parser.add_argument(
        "--check-interval",
        type=int,
        default=DEFAULT_CHECK_INTERVAL,
        help=f"Seconds between checks for new files (default: {DEFAULT_CHECK_INTERVAL})"
    )
    parser.add_argument(
        "--idle-timeout",
        type=int,
        default=None,
        help="Minutes of idle time before auto-shutdown (default: never shutdown)"
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=3,
        help="Maximum retry attempts for failed transcriptions (default: 3)"
    )
    parser.add_argument(
        "--no-ui",
        action="store_true",
        help="Disable Rich terminal UI (use simple logging)"
    )

    args = parser.parse_args()

    # Create worker and run
    worker = TranscriptionWorker(
        episodes_dir=args.episodes_dir,
        transcripts_dir=args.transcripts_dir,
        model=args.model,
        check_interval=args.check_interval,
        use_rich_ui=not args.no_ui,
        idle_timeout=args.idle_timeout,
        max_retries=args.max_retries
    )

    worker.run()


if __name__ == "__main__":
    main()
