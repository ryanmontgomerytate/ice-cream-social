# Getting Started - Ice Cream Social App

**Quick reference for starting development sessions**

## Before You Start

**Run environment validation:**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app/scripts
source ../venv/bin/activate
python validate_environment.py
```

This checks for:
- ✅ Python 3.9+ installed
- ✅ Virtual environment activated
- ✅ All Python dependencies installed
- ✅ Node.js installed
- ✅ npm packages installed
- ✅ Required ports available
- ✅ Required directories exist
- ✅ config.yaml present

---

## Starting Development

### Option 1: Automated Start (Recommended) ⚡

**Start everything with one command:**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app
./start_dev.sh
```

This will:
- ✅ Validate your environment
- ✅ Open 3 new Terminal tabs
- ✅ Start Backend (port 8000)
- ✅ Start Frontend (port 3000)
- ✅ Start Worker with optimized settings

**Stop everything:**
```bash
./stop_dev.sh
```

---

### Option 2: Background Mode (Single Terminal)

**Run all services in background:**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app
./start_dev_simple.sh
```

**View logs:**
```bash
tail -f logs/*.log              # All logs
tail -f logs/backend.log        # Backend only
tail -f logs/frontend.log       # Frontend only
tail -f logs/worker.log         # Worker only
```

**Stop everything:**
```bash
./stop_dev.sh
```

---

### Option 3: Manual (3 Terminals)

**Terminal 1: Backend Server (port 8000)**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app/scripts
source ../venv/bin/activate
python dashboard_server.py
```

**Terminal 2: React Frontend (port 3000)**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app/scripts/dashboard-react
npm run dev
```

**Terminal 3: Transcription Worker**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app/scripts
source ../venv/bin/activate
python transcription_worker.py --model medium --idle-timeout 30
```

---

### Access Your App

- **React Dashboard**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **Logs**: `tail -f scripts/transcription_worker.log`

---

## Common Startup Errors (Quick Fix)

### "Port 3000 is in use"
**What happened:** Another dev server is using port 3000
**Fix:** Vite automatically uses 3001 - just use that URL instead

### "Connection refused" in browser
**What happened:** Backend not running
**Fix:** Start Terminal 1 (backend) first, then Terminal 2

### "ModuleNotFoundError: No module named 'X'"
**What happened:** Forgot to activate venv
**Fix:** Run `source venv/bin/activate` before any Python command

### "npm: command not found"
**What happened:** Node.js not installed
**Fix:** `brew install node`

---

## Stop Everything

**Graceful (Recommended):**
- Press `Ctrl+C` in each terminal window

**Force Stop (if needed):**
```bash
# Kill by port
lsof -ti:8000 | xargs kill -9  # Backend
lsof -ti:3000 | xargs kill -9  # Frontend

# Kill by process name
pkill -f "dashboard_server.py"
pkill -f "transcription_worker.py"
```

---

## Documentation Map

- **[GETTING_STARTED.md](GETTING_STARTED.md)** ← You are here (quick reference)
- **[DEVELOPMENT.md](DEVELOPMENT.md)** - Detailed setup, troubleshooting, industry practices
- **[CLAUDE.md](CLAUDE.md)** - Full project overview and architecture
- **[CHANGELOG.md](CHANGELOG.md)** - Version history and improvements
- **[UPGRADE_GUIDE.md](UPGRADE_GUIDE.md)** - Upgrading to v0.2.0
- **[TODO.md](TODO.md)** - Project roadmap and tasks

---

## Helpful Commands

### Check Status
```bash
# Python worker status
cd scripts
python check_status.py --watch

# View logs in real-time
tail -f transcription_worker.log

# Check what's using ports
lsof -i :8000
lsof -i :3000
```

### Download Episodes
```bash
cd scripts
source ../venv/bin/activate

# List available episodes
python download_episodes.py --list

# Download 5 recent episodes
python download_episodes.py --download 5
```

### Test Components Individually
```bash
# Test backend API
curl http://localhost:8000/api/status

# Test transcription (single file)
python transcribe.py episodes/test.mp3

# Test React build
cd dashboard-react
npm run build
```

---

## Need More Help?

1. **Environment issues?** → [DEVELOPMENT.md](DEVELOPMENT.md#common-startup-errors--solutions)
2. **Resource problems?** → [CHANGELOG.md](CHANGELOG.md) (see v0.2.0 fixes)
3. **npm errors?** → [DEVELOPMENT.md](DEVELOPMENT.md#error-npm-command-not-found-or-cannot-find-module)
4. **Architecture questions?** → [CLAUDE.md](CLAUDE.md)

---

**Last Updated:** December 18, 2025
**Current Version:** 0.2.0
