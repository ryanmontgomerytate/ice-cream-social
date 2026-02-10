# 🍦 Monitoring & UI Guide

Your transcription worker now has **two professional interfaces** - terminal and web!

## 🎨 Rich Terminal UI (Default)

Beautiful, real-time terminal interface with progress bars and notifications.

### Features
- ✨ Beautiful ASCII art banner
- 📊 Live progress bars during transcription
- 📈 Real-time statistics
- 🔔 macOS desktop notifications when episodes complete
- 🎯 Professional layout like industry tools (htop, docker)

### Usage

```bash
# Start worker with Rich UI (default)
cd scripts
python transcription_worker.py

# Or explicitly enable it
python transcription_worker.py --model medium
```

### What You'll See

```
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🍦  ICE CREAM SOCIAL TRANSCRIPTION WORKER  🍦             ║
║                                                              ║
║   Automatically transcribing podcast episodes                ║
║   Using Faster-Whisper AI                                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

Worker Configuration
┌──────────────────┬───────────────────────────────┐
│ Watching         │ /path/to/episodes             │
│ Output           │ /path/to/transcripts          │
│ Model            │ medium                        │
│ Check Interval   │ 60s                           │
└──────────────────┴───────────────────────────────┘

🎙️  Episode 1270.mp3 ████████████░░░░░░░░ 65%

✅ Completed: Episode 1270.mp3 (2345.7s)
💤 No files to process. Waiting for new episodes...
```

### Desktop Notifications

When an episode finishes transcribing, you'll get a macOS notification:

```
🍦 Transcription Complete
Finished: Episode 1270.mp3
Time: 39m 5s
```

---

## 🌐 Web Dashboard

Professional web interface inspired by Sonarr/Radarr - monitor from anywhere!

### Features
- 📱 Responsive design (works on phone/tablet/desktop)
- 🔄 Real-time updates via WebSockets
- 📊 Beautiful statistics and progress tracking
- 📋 Queue visualization
- 🎨 Modern dark theme
- 🚀 Industry-standard design

### Starting the Dashboard

**Terminal 1: Start the Worker**
```bash
cd scripts
python transcription_worker.py --model medium
```

**Terminal 2: Start the Dashboard**
```bash
cd scripts
python dashboard_server.py
```

### Accessing the Dashboard

Open in your browser:
```
http://localhost:5000
```

Or from another device on your network:
```
http://YOUR_MAC_IP:5000
```

### Dashboard Features

**Overview Stats**
- Total episodes
- Transcribed count
- Pending queue
- Completion percentage

**Current Activity**
- Live view of what's being transcribed
- Progress indicator
- Processing time

**Queue Management**
- See pending files
- Recent completions
- Failed transcriptions

**Real-Time Updates**
- Updates every 5 seconds
- WebSocket connection for instant changes
- Status badge shows worker health

---

## 🎬 Complete Workflow Examples

### Workflow 1: Terminal Only (Quick & Simple)

```bash
# Just want to monitor in terminal
cd scripts
python transcription_worker.py --model medium

# You'll see rich UI with progress
# Get desktop notifications when done
```

### Workflow 2: Web Dashboard (Professional)

**Terminal 1:**
```bash
cd scripts
python transcription_worker.py --model medium
```

**Terminal 2:**
```bash
cd scripts
python dashboard_server.py
```

**Browser:**
- Open `http://localhost:5000`
- Watch real-time progress
- Check from your phone while working elsewhere

### Workflow 3: Background Mode (Set & Forget)

```bash
# Start worker in background (no UI, just logs)
cd scripts
nohup python transcription_worker.py --model medium --no-ui > worker.out 2>&1 &

# Start dashboard
python dashboard_server.py

# Monitor via web: http://localhost:5000
# Or check logs: tail -f transcription_worker.log
```

---

## 🎛️ Command Line Options

### Worker Options

```bash
# Use different model
python transcription_worker.py --model large-v3

# Check for new files more frequently
python transcription_worker.py --check-interval 30

# Disable Rich UI (use simple logging)
python transcription_worker.py --no-ui

# Custom directories
python transcription_worker.py \
  --episodes-dir ../audio \
  --transcripts-dir ../output
```

### Dashboard Options

The dashboard automatically detects worker status files and updates in real-time.

---

## 📊 What Each Interface Shows

### Terminal UI Shows:
- ✅ Current transcription progress
- ✅ Completion notifications
- ✅ Queue statistics
- ✅ Runtime information
- ❌ Historical data
- ❌ Remote access

### Web Dashboard Shows:
- ✅ All episodes with status
- ✅ Real-time queue updates
- ✅ Overall statistics
- ✅ Remote access
- ✅ Historical completions
- ✅ Mobile-friendly
- ❌ Detailed logs

---

## 🔧 Troubleshooting

### Terminal UI Not Working?
```bash
# Install rich library
pip install rich

# Or disable UI
python transcription_worker.py --no-ui
```

### Dashboard Not Loading?
```bash
# Check if Flask is installed
pip install flask flask-cors flask-socketio

# Check if server is running
curl http://localhost:5000

# Check firewall settings for port 5000
```

### Can't See Notifications?
```bash
# macOS notifications require:
# 1. Terminal has notification permissions
# 2. System Preferences > Notifications > Terminal enabled
```

---

## 🎨 Design Philosophy

Both interfaces follow industry standards:

**Terminal UI:** Like htop, docker CLI, AWS CLI
- Clean ASCII art
- Real-time progress bars
- Minimal distraction
- Professional appearance

**Web Dashboard:** Like Sonarr, Radarr, Portainer
- Dark theme for long viewing
- Card-based layout
- Real-time WebSocket updates
- Mobile-responsive
- Clear information hierarchy

---

## 💡 Pro Tips

1. **Use Both**: Run worker with Rich UI in one terminal, dashboard in another
2. **Remote Monitoring**: Access dashboard from phone while worker runs
3. **Background Mode**: Use `--no-ui` with dashboard for production
4. **Notifications**: Enable macOS notifications for completion alerts
5. **Multiple Terminals**: tmux/screen for persistent sessions

---

## 🚀 Next Steps

- Worker is now running with beautiful UI
- Dashboard provides web access
- Desktop notifications keep you informed
- Ready to process hundreds of episodes!

Want to add more features?
- Custom dashboard themes
- Email notifications
- Slack/Discord integration
- Advanced analytics
- Episode search interface
