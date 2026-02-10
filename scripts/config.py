#!/usr/bin/env python3
"""
Configuration Management for Ice Cream Social Fandom App
Loads and validates settings from config.yaml

Usage:
    from config import config

    # Access settings
    rss_url = config.podcast.rss_feed_url
    model = config.transcription.model
    episodes_dir = config.paths.episodes
"""

import os
import sys
from pathlib import Path
from typing import Any, Optional

try:
    import yaml
except ImportError:
    print("PyYAML not installed. Installing...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pyyaml"])
    import yaml


class ConfigSection:
    """Base class for configuration sections"""

    def __init__(self, data: dict):
        for key, value in data.items():
            if isinstance(value, dict):
                setattr(self, key, ConfigSection(value))
            else:
                setattr(self, key, value)

    def get(self, key: str, default: Any = None) -> Any:
        """Get a config value with optional default"""
        return getattr(self, key, default)

    def __repr__(self):
        attrs = {k: v for k, v in self.__dict__.items() if not k.startswith('_')}
        return f"ConfigSection({attrs})"


class Config:
    """Main configuration class"""

    def __init__(self, config_path: Optional[Path] = None):
        self.config_path = self._find_config(config_path)
        self._load_config()

    def _find_config(self, config_path: Optional[Path] = None) -> Path:
        """Find the config.yaml file"""
        if config_path and config_path.exists():
            return config_path

        # Try multiple locations
        search_paths = [
            Path("config.yaml"),                                    # Current directory
            Path(__file__).parent / "config.yaml",                  # Same as this script
            Path(__file__).parent.parent / "config.yaml",           # Project root
            Path.home() / ".ice-cream-social" / "config.yaml",     # User home
        ]

        for path in search_paths:
            if path.exists():
                return path

        # If not found, use project root default
        default_path = Path(__file__).parent.parent / "config.yaml"
        if not default_path.exists():
            raise FileNotFoundError(
                f"Config file not found. Searched: {[str(p) for p in search_paths]}\n"
                f"Please create config.yaml in the project root."
            )
        return default_path

    def _load_config(self):
        """Load configuration from YAML file"""
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f)

            if not data:
                raise ValueError("Config file is empty")

            # Create sections
            for section_name, section_data in data.items():
                if isinstance(section_data, dict):
                    setattr(self, section_name, ConfigSection(section_data))
                else:
                    setattr(self, section_name, section_data)

            # Resolve paths relative to project root
            self._resolve_paths()

        except yaml.YAMLError as e:
            raise ValueError(f"Invalid YAML in config file: {e}")
        except Exception as e:
            raise RuntimeError(f"Failed to load config: {e}")

    def _resolve_paths(self):
        """Convert relative paths to absolute paths"""
        if not hasattr(self, 'paths'):
            return

        project_root = self.config_path.parent

        # Convert all path strings to absolute Path objects
        for key, value in self.paths.__dict__.items():
            if isinstance(value, str):
                path = Path(value)
                if not path.is_absolute():
                    path = project_root / path
                setattr(self.paths, key, path)

    def get_path(self, path_name: str, create: bool = False) -> Path:
        """
        Get a path from config and optionally create it

        Args:
            path_name: Name of the path in config.paths
            create: Whether to create the directory if it doesn't exist

        Returns:
            Path object
        """
        if not hasattr(self.paths, path_name):
            raise ValueError(f"Path '{path_name}' not found in config")

        path = getattr(self.paths, path_name)

        if create and not path.exists():
            if path.suffix:  # It's a file path
                path.parent.mkdir(parents=True, exist_ok=True)
            else:  # It's a directory path
                path.mkdir(parents=True, exist_ok=True)

        return path

    def reload(self):
        """Reload configuration from file"""
        self._load_config()

    def validate(self) -> list[str]:
        """
        Validate configuration and return list of warnings/errors

        Returns:
            List of validation messages (empty if all valid)
        """
        issues = []

        # Check required sections
        required_sections = ['podcast', 'paths', 'transcription']
        for section in required_sections:
            if not hasattr(self, section):
                issues.append(f"Missing required section: {section}")

        # Validate podcast settings
        if hasattr(self, 'podcast'):
            if not self.podcast.get('rss_feed_url'):
                issues.append("podcast.rss_feed_url is not set")

        # Validate transcription model
        if hasattr(self, 'transcription'):
            valid_models = ['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3']
            if self.transcription.model not in valid_models:
                issues.append(
                    f"Invalid transcription.model: {self.transcription.model}. "
                    f"Valid options: {valid_models}"
                )

        # Check if AnythingLLM is enabled but not configured
        if hasattr(self, 'anythingllm'):
            if self.anythingllm.enabled and not self.anythingllm.api_key:
                issues.append("anythingllm.enabled is true but api_key is not set")

        # Check if AssemblyAI is enabled but not configured
        if hasattr(self, 'assemblyai'):
            if self.assemblyai.enabled and not self.assemblyai.api_key:
                issues.append("assemblyai.enabled is true but api_key is not set")

        # Check if diarization is enabled but not configured
        if hasattr(self, 'diarization'):
            if self.diarization.enabled and not self.diarization.huggingface_token:
                issues.append("diarization.enabled is true but huggingface_token is not set")

        return issues

    def print_summary(self):
        """Print a summary of the current configuration"""
        print("=" * 60)
        print("ICE CREAM SOCIAL APP - CONFIGURATION")
        print("=" * 60)
        print(f"\nConfig file: {self.config_path}")
        print(f"\nPodcast: {self.podcast.name}")
        print(f"RSS Feed: {self.podcast.rss_feed_url[:50]}...")
        print(f"\nTranscription Model: {self.transcription.model}")
        print(f"Device: {self.transcription.device}")

        print(f"\nPaths:")
        for key, value in self.paths.__dict__.items():
            if not key.startswith('_'):
                print(f"  {key}: {value}")

        print(f"\nFeatures:")
        if hasattr(self, 'database'):
            print(f"  Database: {'enabled' if self.database.enabled else 'disabled'}")
        if hasattr(self, 'anythingllm'):
            print(f"  AnythingLLM: {'enabled' if self.anythingllm.enabled else 'disabled'}")
        if hasattr(self, 'diarization'):
            print(f"  Speaker Diarization: {'enabled' if self.diarization.enabled else 'disabled'}")
        if hasattr(self, 'assemblyai'):
            print(f"  AssemblyAI: {'enabled' if self.assemblyai.enabled else 'disabled'}")

        # Validation
        issues = self.validate()
        if issues:
            print(f"\n⚠️  Configuration Issues:")
            for issue in issues:
                print(f"  - {issue}")
        else:
            print(f"\n✅ Configuration is valid")

        print("=" * 60)


# Global config instance
# Import this in other modules: from config import config
try:
    config = Config()
except Exception as e:
    print(f"Warning: Could not load config: {e}")
    print("Using default configuration...")
    config = None


# CLI utility for checking config
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Ice Cream Social App Configuration Utility")
    parser.add_argument("--validate", action="store_true", help="Validate configuration")
    parser.add_argument("--print", action="store_true", help="Print configuration summary")
    parser.add_argument("--config", type=Path, help="Path to config file")

    args = parser.parse_args()

    try:
        cfg = Config(args.config) if args.config else config

        if args.validate:
            issues = cfg.validate()
            if issues:
                print("❌ Configuration has issues:")
                for issue in issues:
                    print(f"  - {issue}")
                sys.exit(1)
            else:
                print("✅ Configuration is valid!")
                sys.exit(0)

        if args.print or not (args.validate):
            cfg.print_summary()

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
