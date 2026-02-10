#!/usr/bin/env python3
"""
Database models and operations for Ice Cream Social App
Following SQLAlchemy ORM patterns with SQLite backend
"""

import os
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict
import json

from sqlalchemy import (
    create_engine, Column, Integer, String, Float, Boolean,
    DateTime, Text, Index, ForeignKey
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship, Session
from sqlalchemy.pool import StaticPool

# Load config for database path
try:
    from config import config
    DB_PATH = config.paths.database if config else Path("data/ice_cream_social.db")
except (ImportError, AttributeError):
    DB_PATH = Path("data/ice_cream_social.db")

# Create data directory if it doesn't exist
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# SQLAlchemy setup
Base = declarative_base()

# Create engine with connection pooling for better performance
engine = create_engine(
    f'sqlite:///{DB_PATH}',
    echo=False,  # Set to True for SQL debugging
    connect_args={
        'check_same_thread': False,  # Allow multi-threading
        'timeout': 30  # Wait up to 30 seconds for locked database
    },
    poolclass=StaticPool  # Keep connection alive
)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Episode(Base):
    """Episode model - represents a podcast episode"""
    __tablename__ = 'episodes'

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Basic Info
    episode_number = Column(String(50), nullable=True, index=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)

    # Media Info
    audio_url = Column(String(1000), nullable=False, unique=True)
    audio_file_path = Column(String(500), nullable=True)  # Local file path if downloaded
    duration = Column(Float, nullable=True)  # Duration in seconds
    file_size = Column(Integer, nullable=True)  # Size in bytes

    # Dates
    published_date = Column(DateTime, nullable=True, index=True)
    added_date = Column(DateTime, default=datetime.utcnow, nullable=False)
    downloaded_date = Column(DateTime, nullable=True)
    transcribed_date = Column(DateTime, nullable=True)

    # Status flags
    is_downloaded = Column(Boolean, default=False, index=True)
    is_transcribed = Column(Boolean, default=False, index=True)
    is_in_queue = Column(Boolean, default=False, index=True)

    # Transcription info
    transcript_path = Column(String(500), nullable=True)
    transcription_status = Column(String(50), default='pending')  # pending, processing, completed, failed
    transcription_error = Column(Text, nullable=True)
    processing_time = Column(Float, nullable=True)  # Time taken to transcribe in seconds

    # Feed source
    feed_source = Column(String(50), default='patreon', index=True)  # patreon, apple, etc.

    # Metadata (JSON field for flexible data)
    metadata_json = Column(Text, nullable=True)  # Store additional metadata as JSON

    # Relationships
    transcripts = relationship("Transcript", back_populates="episode", cascade="all, delete-orphan")

    # Indexes for performance
    __table_args__ = (
        Index('idx_status_feed', 'transcription_status', 'feed_source'),
        Index('idx_queue_status', 'is_in_queue', 'transcription_status'),
    )

    def to_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization"""
        return {
            'id': self.id,
            'episode_number': self.episode_number,
            'title': self.title,
            'description': self.description,
            'audio_url': self.audio_url,
            'audio_file_path': self.audio_file_path,
            'duration': self.duration,
            'file_size': self.file_size,
            'published_date': self.published_date.isoformat() if self.published_date else None,
            'added_date': self.added_date.isoformat() if self.added_date else None,
            'downloaded_date': self.downloaded_date.isoformat() if self.downloaded_date else None,
            'transcribed_date': self.transcribed_date.isoformat() if self.transcribed_date else None,
            'is_downloaded': self.is_downloaded,
            'is_transcribed': self.is_transcribed,
            'is_in_queue': self.is_in_queue,
            'transcript_path': self.transcript_path,
            'transcription_status': self.transcription_status,
            'transcription_error': self.transcription_error,
            'processing_time': self.processing_time,
            'feed_source': self.feed_source,
            'metadata': json.loads(self.metadata_json) if self.metadata_json else {}
        }


class Transcript(Base):
    """Transcript model - stores transcription results"""
    __tablename__ = 'transcripts'

    id = Column(Integer, primary_key=True, autoincrement=True)
    episode_id = Column(Integer, ForeignKey('episodes.id'), nullable=False, index=True)

    # Transcription data
    full_text = Column(Text, nullable=False)
    segments_json = Column(Text, nullable=True)  # JSON array of segments with timestamps

    # Metadata
    language = Column(String(10), default='en')
    language_probability = Column(Float, nullable=True)
    model_used = Column(String(50), nullable=True)  # e.g., "medium", "large-v3"
    created_date = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    episode = relationship("Episode", back_populates="transcripts")

    def to_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization"""
        return {
            'id': self.id,
            'episode_id': self.episode_id,
            'full_text': self.full_text,
            'segments': json.loads(self.segments_json) if self.segments_json else [],
            'language': self.language,
            'language_probability': self.language_probability,
            'model_used': self.model_used,
            'created_date': self.created_date.isoformat()
        }


class TranscriptionQueue(Base):
    """Queue model - manages transcription queue"""
    __tablename__ = 'transcription_queue'

    id = Column(Integer, primary_key=True, autoincrement=True)
    episode_id = Column(Integer, ForeignKey('episodes.id'), nullable=False, index=True, unique=True)

    # Queue info
    added_to_queue_date = Column(DateTime, default=datetime.utcnow, nullable=False)
    priority = Column(Integer, default=0, index=True)  # Higher = process first
    retry_count = Column(Integer, default=0)

    # Status
    status = Column(String(50), default='pending', index=True)  # pending, processing, completed, failed
    started_date = Column(DateTime, nullable=True)
    completed_date = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)

    __table_args__ = (
        Index('idx_queue_priority', 'status', 'priority'),
    )

    def to_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization"""
        return {
            'id': self.id,
            'episode_id': self.episode_id,
            'added_to_queue_date': self.added_to_queue_date.isoformat(),
            'priority': self.priority,
            'retry_count': self.retry_count,
            'status': self.status,
            'started_date': self.started_date.isoformat() if self.started_date else None,
            'completed_date': self.completed_date.isoformat() if self.completed_date else None,
            'error_message': self.error_message
        }


# Database operations class
class DatabaseManager:
    """Manages database operations with proper session handling"""

    @staticmethod
    def init_db():
        """Initialize database - create all tables"""
        Base.metadata.create_all(bind=engine)
        print(f"✅ Database initialized at {DB_PATH}")

    @staticmethod
    def get_session() -> Session:
        """Get a new database session"""
        return SessionLocal()

    # Episode operations
    @staticmethod
    def add_episode(session: Session, **kwargs) -> Episode:
        """Add a new episode to the database"""
        episode = Episode(**kwargs)
        session.add(episode)
        session.commit()
        session.refresh(episode)
        return episode

    @staticmethod
    def get_episode_by_url(session: Session, audio_url: str) -> Optional[Episode]:
        """Get episode by audio URL"""
        return session.query(Episode).filter(Episode.audio_url == audio_url).first()

    @staticmethod
    def get_all_episodes(session: Session, feed_source: Optional[str] = None,
                        transcribed_only: bool = False,
                        sort_by: str = 'published_date',
                        sort_desc: bool = True) -> List[Episode]:
        """Get all episodes with optional filtering"""
        query = session.query(Episode)

        if feed_source:
            query = query.filter(Episode.feed_source == feed_source)

        if transcribed_only:
            query = query.filter(Episode.is_transcribed == True)

        # Sort
        if sort_desc:
            query = query.order_by(getattr(Episode, sort_by).desc())
        else:
            query = query.order_by(getattr(Episode, sort_by).asc())

        return query.all()

    @staticmethod
    def update_episode_status(session: Session, episode_id: int, **kwargs):
        """Update episode status"""
        episode = session.query(Episode).filter(Episode.id == episode_id).first()
        if episode:
            for key, value in kwargs.items():
                setattr(episode, key, value)
            session.commit()
            session.refresh(episode)
        return episode

    # Queue operations
    @staticmethod
    def add_to_queue(session: Session, episode_id: int, priority: int = 0) -> TranscriptionQueue:
        """Add episode to transcription queue"""
        # Check if already in queue
        existing = session.query(TranscriptionQueue).filter(
            TranscriptionQueue.episode_id == episode_id
        ).first()

        if existing:
            return existing

        queue_item = TranscriptionQueue(episode_id=episode_id, priority=priority)
        session.add(queue_item)

        # Update episode status
        episode = session.query(Episode).filter(Episode.id == episode_id).first()
        if episode:
            episode.is_in_queue = True
            episode.transcription_status = 'queued'

        session.commit()
        return queue_item

    @staticmethod
    def remove_from_queue(session: Session, episode_id: int):
        """Remove episode from queue"""
        session.query(TranscriptionQueue).filter(
            TranscriptionQueue.episode_id == episode_id
        ).delete()

        # Update episode status
        episode = session.query(Episode).filter(Episode.id == episode_id).first()
        if episode and episode.transcription_status != 'completed':
            episode.is_in_queue = False
            episode.transcription_status = 'pending'

        session.commit()

    @staticmethod
    def get_next_in_queue(session: Session) -> Optional[Episode]:
        """Get next episode to process from queue"""
        queue_item = session.query(TranscriptionQueue).filter(
            TranscriptionQueue.status == 'pending'
        ).order_by(
            TranscriptionQueue.priority.desc(),
            TranscriptionQueue.added_to_queue_date.asc()
        ).first()

        if queue_item:
            return session.query(Episode).filter(Episode.id == queue_item.episode_id).first()

        return None

    @staticmethod
    def get_queue_status(session: Session) -> Dict:
        """Get queue statistics"""
        pending = session.query(TranscriptionQueue).filter(
            TranscriptionQueue.status == 'pending'
        ).count()

        processing = session.query(TranscriptionQueue).filter(
            TranscriptionQueue.status == 'processing'
        ).count()

        completed = session.query(TranscriptionQueue).filter(
            TranscriptionQueue.status == 'completed'
        ).count()

        failed = session.query(TranscriptionQueue).filter(
            TranscriptionQueue.status == 'failed'
        ).count()

        return {
            'pending': pending,
            'processing': processing,
            'completed': completed,
            'failed': failed,
            'total': pending + processing + completed + failed
        }


# Initialize database on import
if __name__ == "__main__":
    DatabaseManager.init_db()
    print("Database initialized successfully!")
