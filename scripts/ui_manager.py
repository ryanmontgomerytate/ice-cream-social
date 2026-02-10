#!/usr/bin/env python3
"""
UI Manager for Ice Cream Social Transcription Worker
Provides Rich terminal UI with progress tracking and desktop notifications
"""

import os
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False

from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.progress import (
    Progress,
    SpinnerColumn,
    BarColumn,
    TextColumn,
    TimeRemainingColumn,
    TaskProgressColumn,
)
from rich.table import Table
from rich.text import Text


class TranscriptionUI:
    """Rich terminal UI for transcription worker"""

    def __init__(self):
        self.console = Console()
        self.progress = Progress(
            SpinnerColumn(),
            TextColumn("[bold blue]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            TimeRemainingColumn(),
        )
        self.current_task = None
        self.stats = {
            "total_processed": 0,
            "total_pending": 0,
            "total_failed": 0,
            "start_time": datetime.now(),
        }

    def show_banner(self):
        """Display startup banner"""
        banner = """
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🍦  ICE CREAM SOCIAL TRANSCRIPTION WORKER  🍦             ║
║                                                              ║
║   Automatically transcribing podcast episodes                ║
║   Using Faster-Whisper AI                                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
"""
        self.console.print(banner, style="bold cyan")

    def show_config(self, config_info: dict):
        """Display configuration"""
        table = Table(title="Worker Configuration", show_header=False)
        table.add_column("Setting", style="cyan")
        table.add_column("Value", style="green")

        for key, value in config_info.items():
            table.add_row(key, str(value))

        self.console.print(table)
        self.console.print()

    def show_resource_usage(self, memory_mb: float, memory_percent: float):
        """Display current resource usage"""
        if memory_percent > 80:
            style = "bold red"
        elif memory_percent > 60:
            style = "yellow"
        else:
            style = "green"

        msg = f"💾 Memory: {memory_mb:.1f} MB ({memory_percent:.1f}%)"
        self.console.print(msg, style=style)

    def create_status_panel(self) -> Panel:
        """Create status panel"""
        runtime = datetime.now() - self.stats["start_time"]
        hours, remainder = divmod(int(runtime.total_seconds()), 3600)
        minutes, seconds = divmod(remainder, 60)

        status_text = Text()
        status_text.append("⏱️  Runtime: ", style="bold")
        status_text.append(f"{hours:02d}:{minutes:02d}:{seconds:02d}\n", style="cyan")
        status_text.append("✅ Completed: ", style="bold")
        status_text.append(f"{self.stats['total_processed']}\n", style="green")
        status_text.append("⏳ Pending: ", style="bold")
        status_text.append(f"{self.stats['total_pending']}\n", style="yellow")
        status_text.append("❌ Failed: ", style="bold")
        status_text.append(f"{self.stats['total_failed']}", style="red")

        return Panel(status_text, title="[bold]Worker Status[/bold]", border_style="blue")

    def start_transcription(self, filename: str, duration: Optional[float] = None) -> int:
        """Start tracking a transcription"""
        desc = f"🎙️  {filename}"
        if duration:
            # Estimate total steps based on duration (rough estimate)
            total = int(duration / 10)  # Assume 10 seconds per step
        else:
            total = 100

        self.current_task = self.progress.add_task(desc, total=total)
        return self.current_task

    def update_progress(self, task_id: int, advance: float = 1):
        """Update progress for a task"""
        if task_id is not None:
            self.progress.update(task_id, advance=advance)

    def complete_transcription(self, filename: str, success: bool = True,
                              processing_time: Optional[float] = None):
        """Mark transcription as complete"""
        if success:
            self.stats["total_processed"] += 1
            msg = f"✅ Completed: {filename}"
            if processing_time:
                msg += f" ({processing_time:.1f}s)"
            self.console.print(msg, style="bold green")

            # Send desktop notification
            self.notify_completion(filename, processing_time)
        else:
            self.stats["total_failed"] += 1
            self.console.print(f"❌ Failed: {filename}", style="bold red")

        if self.current_task is not None:
            self.progress.update(self.current_task, completed=True)
            self.current_task = None

    def update_queue_stats(self, pending: int):
        """Update queue statistics"""
        self.stats["total_pending"] = pending

    def show_waiting(self):
        """Show waiting status"""
        self.console.print("💤 No files to process. Waiting for new episodes...",
                          style="dim cyan")

    def show_error(self, message: str):
        """Display error message"""
        self.console.print(f"❌ Error: {message}", style="bold red")

    def show_info(self, message: str):
        """Display info message"""
        self.console.print(f"ℹ️  {message}", style="cyan")

    def notify_completion(self, filename: str, processing_time: Optional[float] = None):
        """Send desktop notification on macOS"""
        try:
            title = "🍦 Transcription Complete"
            msg = f"Finished: {filename}"
            if processing_time:
                minutes = int(processing_time // 60)
                seconds = int(processing_time % 60)
                msg += f"\nTime: {minutes}m {seconds}s"

            # macOS notification
            if os.name == 'posix' and os.uname().sysname == 'Darwin':
                script = f'''
                display notification "{msg}" with title "{title}" sound name "Glass"
                '''
                subprocess.run(['osascript', '-e', script],
                             capture_output=True, timeout=5)
        except Exception:
            # Silently fail if notifications don't work
            pass

    def show_final_summary(self):
        """Display final summary on shutdown"""
        self.console.print("\n" + "=" * 60, style="cyan")
        self.console.print("🍦 TRANSCRIPTION WORKER STOPPED", style="bold cyan")
        self.console.print("=" * 60, style="cyan")

        runtime = datetime.now() - self.stats["start_time"]
        hours, remainder = divmod(int(runtime.total_seconds()), 3600)
        minutes, seconds = divmod(remainder, 60)

        summary = Table(show_header=False)
        summary.add_column("Metric", style="cyan")
        summary.add_column("Value", style="green")

        summary.add_row("Total Runtime", f"{hours:02d}:{minutes:02d}:{seconds:02d}")
        summary.add_row("Completed", str(self.stats["total_processed"]))
        summary.add_row("Pending", str(self.stats["total_pending"]))
        summary.add_row("Failed", str(self.stats["total_failed"]))

        self.console.print(summary)
        self.console.print("=" * 60 + "\n", style="cyan")


# Minimal UI for non-interactive mode
class SimpleUI:
    """Simple logging-based UI for background mode"""

    def __init__(self, logger):
        self.logger = logger
        self.stats = {
            "total_processed": 0,
            "total_pending": 0,
            "total_failed": 0,
        }

    def show_banner(self):
        self.logger.info("=" * 60)
        self.logger.info("ICE CREAM SOCIAL TRANSCRIPTION WORKER")
        self.logger.info("=" * 60)

    def show_config(self, config_info: dict):
        for key, value in config_info.items():
            self.logger.info(f"{key}: {value}")

    def create_status_panel(self):
        return None

    def start_transcription(self, filename: str, duration: Optional[float] = None):
        self.logger.info(f"Starting transcription: {filename}")
        return None

    def update_progress(self, task_id: int, advance: float = 1):
        pass

    def complete_transcription(self, filename: str, success: bool = True,
                              processing_time: Optional[float] = None):
        if success:
            self.stats["total_processed"] += 1
            msg = f"Completed: {filename}"
            if processing_time:
                msg += f" ({processing_time:.1f}s)"
            self.logger.info(msg)
        else:
            self.stats["total_failed"] += 1
            self.logger.error(f"Failed: {filename}")

    def update_queue_stats(self, pending: int):
        self.stats["total_pending"] = pending

    def show_waiting(self):
        self.logger.info("No files to process. Waiting...")

    def show_error(self, message: str):
        self.logger.error(message)

    def show_info(self, message: str):
        self.logger.info(message)

    def show_final_summary(self):
        self.logger.info("=" * 60)
        self.logger.info("Worker stopped")
        self.logger.info(f"Completed: {self.stats['total_processed']}")
        self.logger.info(f"Pending: {self.stats['total_pending']}")
        self.logger.info(f"Failed: {self.stats['total_failed']}")
        self.logger.info("=" * 60)


# Test/demo
if __name__ == "__main__":
    import time

    ui = TranscriptionUI()
    ui.show_banner()
    ui.show_config({
        "Model": "medium",
        "Episodes Dir": "/path/to/episodes",
        "Check Interval": "60 seconds",
    })

    # Simulate transcription
    task = ui.start_transcription("Episode 1270.mp3", duration=4595)

    for i in range(100):
        time.sleep(0.05)
        ui.update_progress(task, advance=1)

    ui.complete_transcription("Episode 1270.mp3", success=True, processing_time=2345.7)
    ui.show_final_summary()
