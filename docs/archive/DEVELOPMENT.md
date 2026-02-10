# Development Guide - Ice Cream Social App

## System Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                     Development Stack                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────┐      ┌──────────────────────┐    │
│  │   React Frontend    │─────▶│  Python Backend      │    │
│  │   (Vite dev server) │      │  (Flask + SocketIO)  │    │
│  │   Port: 3000/3001   │      │  Port: 8000          │    │
│  └─────────────────────┘      └──────────────────────┘    │
│           │                            │                    │
│           │                            ▼                    │
│           │                   ┌──────────────────────┐    │
│           │                   │ Transcription Worker │    │
│           │                   │ (Background process)  │    │
│           │                   └──────────────────────┘    │
│           │                            │                    │
│           ▼                            ▼                    │
│   Proxy to Backend             Status Files (.json)        │
│   (/api, /socket.io)           & Log Files                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Quick Start: Getting Everything Running

### Method 1: Full Stack (Recommended for Development)

**Terminal 1: Start Backend Server**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app/scripts
source ../venv/bin/activate
python dashboard_server.py
```
Expected output:
```
Dashboard server starting...
 * Running on http://0.0.0.0:8000
Press CTRL+C to quit
```

**Terminal 2: Start React Frontend**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app/scripts/dashboard-react
npm run dev
```
Expected output:
```
VITE v5.4.21  ready in 103 ms
➜  Local:   http://localhost:3000/
```

**Terminal 3: Start Transcription Worker**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app/scripts
source ../venv/bin/activate
python transcription_worker.py --model medium --idle-timeout 30
```

**Access the app:**
- React Dashboard: http://localhost:3000 (or 3001 if 3000 is in use)
- Backend API: http://localhost:8000

---

### Method 2: Backend Only (Python Dashboard)

**Terminal 1: Start Backend + Legacy Dashboard**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app/scripts
source ../venv/bin/activate
python dashboard_server.py
```

**Terminal 2: Start Worker**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app/scripts
source ../venv/bin/activate
python transcription_worker.py --model medium
```

**Access the app:**
- Legacy Dashboard: http://localhost:8000

---

### Method 3: Worker Only (No UI)

```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app/scripts
source ../venv/bin/activate
python transcription_worker.py --model medium --idle-timeout 60
```

Monitor via:
- Logs: `tail -f transcription_worker.log`
- Status: `python check_status.py --watch`

---

## Common Startup Errors & Solutions

### Error: "Port 3000 is in use, trying another one..."

**Symptom:**
```
Port 3000 is in use, trying another one...
VITE v5.4.21  ready in 103 ms
➜  Local:   http://localhost:3001/
```

**Cause:** Another process is using port 3000 (common with other React dev servers)

**Solution:**
- Option A: Use the new port (e.g., 3001) - Vite auto-adjusts
- Option B: Kill the other process:
  ```bash
  lsof -ti:3000 | xargs kill -9
  npm run dev
  ```

---

### Error: "Connection refused" or "Failed to connect to backend"

**Symptom:** React app loads but shows connection errors in browser console

**Cause:** Backend server (port 8000) is not running

**Solution:**
```bash
# Terminal 1: Start backend first
cd /Users/ryan/Desktop/Projects/ice-cream-social-app/scripts
source ../venv/bin/activate
python dashboard_server.py

# Then in Terminal 2: Start frontend
cd /Users/ryan/Desktop/Projects/ice-cream-social-app/scripts/dashboard-react
npm run dev
```

**Verification:**
```bash
# Check if backend is running
curl http://localhost:8000/api/status
# Should return JSON, not connection error
```

---

### Error: "ModuleNotFoundError: No module named 'X'"

**Symptom:**
```
ModuleNotFoundError: No module named 'psutil'
```

**Cause:** Missing Python dependencies or not using venv

**Solution:**
```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app
source venv/bin/activate
pip install -r requirements.txt
```

**Verification:**
```bash
# Should show (venv) prefix
which python
# Should be: /Users/ryan/Desktop/Projects/ice-cream-social-app/venv/bin/python
```

---

### Error: "npm: command not found" or "Cannot find module"

**Symptom:**
```
npm run dev
-bash: npm: command not found
```
OR
```
Error: Cannot find module 'vite'
```

**Cause:** Node.js not installed or missing npm packages

**Solution:**
```bash
# Install Node.js (if needed)
# Visit: https://nodejs.org/ or use:
brew install node

# Install dependencies
cd /Users/ryan/Desktop/Projects/ice-cream-social-app/scripts/dashboard-react
npm install
```

---

### Error: "Worker consuming too much RAM/CPU"

**Symptom:** System slows down, Activity Monitor shows high usage

**Cause:** Old version without resource optimizations

**Solution:** Use v0.2.0 with resource management:
```bash
# Recommended settings for your M4 Mac (24GB RAM)
python transcription_worker.py \
  --model medium \
  --idle-timeout 30 \
  --check-interval 30 \
  --max-retries 3
```

**Monitor resource usage:**
```bash
# Watch logs for memory reports
tail -f transcription_worker.log | grep -i "memory\|idle"
```

---

### Error: "Excessive log file growth"

**Symptom:** `transcription_worker.log` grows to 100s of MB

**Cause:** Old version or very verbose logging

**Solution:**
1. **Upgrade to v0.2.0** (has log rotation)
2. **Clean old logs:**
   ```bash
   cd scripts
   mv transcription_worker.log transcription_worker.log.old
   ```
3. **Restart worker** - new rotation system will manage size

---

## Industry-Standard Error Detection Practices

To help catch errors faster in the future, implement these practices:

### 1. Health Check Endpoints

**What:** Add `/health` endpoints to all services

**Implementation:**
```python
# In dashboard_server.py
@app.route('/health')
def health_check():
    return jsonify({
        "status": "healthy",
        "backend": "running",
        "worker_status": get_worker_status(),
        "timestamp": datetime.now().isoformat()
    })
```

**Usage:**
```bash
# Check backend health
curl http://localhost:8000/health

# Check frontend is serving
curl http://localhost:3000
```

---

### 2. Startup Validation Script

**What:** Script that validates all dependencies before starting

**Create:** `scripts/validate_environment.py`
```python
#!/usr/bin/env python3
"""Validate development environment before starting"""

import sys
import subprocess
from pathlib import Path

def check_python_version():
    """Check Python version >= 3.9"""
    version = sys.version_info
    if version.major < 3 or (version.major == 3 and version.minor < 9):
        print("❌ Python 3.9+ required")
        return False
    print(f"✅ Python {version.major}.{version.minor}")
    return True

def check_venv():
    """Check if virtual environment is activated"""
    if sys.prefix == sys.base_prefix:
        print("❌ Virtual environment not activated")
        print("   Run: source venv/bin/activate")
        return False
    print("✅ Virtual environment activated")
    return True

def check_dependencies():
    """Check if all Python packages are installed"""
    required = ['flask', 'faster_whisper', 'psutil', 'rich']
    missing = []
    for pkg in required:
        try:
            __import__(pkg.replace('-', '_'))
            print(f"✅ {pkg} installed")
        except ImportError:
            print(f"❌ {pkg} missing")
            missing.append(pkg)

    if missing:
        print(f"\n   Run: pip install {' '.join(missing)}")
        return False
    return True

def check_node():
    """Check if Node.js is installed"""
    try:
        result = subprocess.run(['node', '--version'],
                              capture_output=True, text=True)
        print(f"✅ Node.js {result.stdout.strip()}")
        return True
    except FileNotFoundError:
        print("❌ Node.js not installed")
        return False

def check_npm_deps():
    """Check if npm dependencies are installed"""
    react_dir = Path(__file__).parent / 'dashboard-react'
    if not (react_dir / 'node_modules').exists():
        print("❌ npm dependencies not installed")
        print(f"   Run: cd {react_dir} && npm install")
        return False
    print("✅ npm dependencies installed")
    return True

def check_ports():
    """Check if required ports are available"""
    import socket
    ports = {'Backend': 8000, 'Frontend': 3000}
    issues = []

    for name, port in ports.items():
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        result = sock.connect_ex(('localhost', port))
        sock.close()

        if result == 0:
            print(f"⚠️  {name} port {port} already in use")
            issues.append(f"{name} on port {port}")
        else:
            print(f"✅ Port {port} available")

    if issues:
        print(f"\n   Note: {', '.join(issues)} already running")
    return True  # Not fatal

if __name__ == "__main__":
    print("🔍 Validating Ice Cream Social Development Environment\n")

    checks = [
        check_python_version(),
        check_venv(),
        check_dependencies(),
        check_node(),
        check_npm_deps(),
        check_ports()
    ]

    print("\n" + "="*60)
    if all(checks):
        print("✅ All checks passed! Ready to start development.")
        print("\nNext steps:")
        print("  Terminal 1: python dashboard_server.py")
        print("  Terminal 2: cd dashboard-react && npm run dev")
        print("  Terminal 3: python transcription_worker.py --model medium")
        sys.exit(0)
    else:
        print("❌ Some checks failed. Fix issues above before starting.")
        sys.exit(1)
```

**Usage:**
```bash
cd scripts
python validate_environment.py
```

---

### 3. Process Management with Supervisor

**What:** Use process manager to ensure all services stay running

**Implementation:** Create `scripts/start_all.sh`
```bash
#!/bin/bash
# Start all services for development

set -e  # Exit on error

PROJECT_ROOT="/Users/ryan/Desktop/Projects/ice-cream-social-app"
cd "$PROJECT_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🍦 Starting Ice Cream Social Development Stack${NC}\n"

# Validate environment first
echo "Validating environment..."
source venv/bin/activate
python scripts/validate_environment.py
if [ $? -ne 0 ]; then
    echo -e "${RED}Environment validation failed. Exiting.${NC}"
    exit 1
fi

# Start backend
echo -e "\n${YELLOW}Starting Backend (port 8000)...${NC}"
cd scripts
python dashboard_server.py > ../logs/backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# Wait for backend to start
sleep 2
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo -e "${RED}Backend failed to start. Check logs/backend.log${NC}"
    exit 1
fi

# Start frontend
echo -e "${YELLOW}Starting Frontend (port 3000)...${NC}"
cd dashboard-react
npm run dev > ../../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

# Start worker
echo -e "${YELLOW}Starting Transcription Worker...${NC}"
cd ..
python transcription_worker.py --model medium --idle-timeout 30 > ../logs/worker.log 2>&1 &
WORKER_PID=$!
echo "Worker PID: $WORKER_PID"

# Save PIDs
cat > ../logs/dev.pids <<EOF
BACKEND_PID=$BACKEND_PID
FRONTEND_PID=$FRONTEND_PID
WORKER_PID=$WORKER_PID
EOF

echo -e "\n${GREEN}✅ All services started!${NC}"
echo -e "\nAccess the app:"
echo -e "  Frontend: ${GREEN}http://localhost:3000${NC}"
echo -e "  Backend:  ${GREEN}http://localhost:8000${NC}"
echo -e "\nView logs:"
echo -e "  Backend:  tail -f logs/backend.log"
echo -e "  Frontend: tail -f logs/frontend.log"
echo -e "  Worker:   tail -f logs/worker.log"
echo -e "\nStop all: ${YELLOW}./scripts/stop_all.sh${NC}"
```

**Create:** `scripts/stop_all.sh`
```bash
#!/bin/bash
# Stop all development services

PROJECT_ROOT="/Users/ryan/Desktop/Projects/ice-cream-social-app"
PIDS_FILE="$PROJECT_ROOT/logs/dev.pids"

if [ ! -f "$PIDS_FILE" ]; then
    echo "No PIDs file found. Services may not be running."
    exit 0
fi

source "$PIDS_FILE"

echo "Stopping services..."
kill -TERM $BACKEND_PID 2>/dev/null && echo "✅ Backend stopped"
kill -TERM $FRONTEND_PID 2>/dev/null && echo "✅ Frontend stopped"
kill -TERM $WORKER_PID 2>/dev/null && echo "✅ Worker stopped"

rm -f "$PIDS_FILE"
echo "All services stopped."
```

**Usage:**
```bash
# Create logs directory
mkdir -p logs

# Make scripts executable
chmod +x scripts/start_all.sh scripts/stop_all.sh

# Start everything
./scripts/start_all.sh

# Stop everything
./scripts/stop_all.sh
```

---

### 4. Automated Error Logging

**What:** Centralized error tracking across all services

**Implementation:** Already done with:
- `transcription_worker.log` - Worker errors
- Backend logs to console (can redirect to file)
- Frontend errors in browser console

**Best Practice:** Create `logs/` directory for all logs:
```bash
mkdir -p logs
cd scripts
python dashboard_server.py > ../logs/backend.log 2>&1 &
cd dashboard-react
npm run dev > ../../logs/frontend.log 2>&1 &
```

---

### 5. Pre-flight Checks in Scripts

**What:** Add validation at the start of each script

**Example:** Add to `transcription_worker.py`:
```python
def validate_environment():
    """Check environment before starting"""
    issues = []

    # Check model directory exists
    if not Path("models").exists():
        issues.append("Models directory missing")

    # Check episodes directory
    if not episodes_dir.exists():
        logger.warning(f"Episodes directory does not exist: {episodes_dir}")
        episodes_dir.mkdir(parents=True, exist_ok=True)

    # Check write permissions
    try:
        test_file = transcripts_dir / ".write_test"
        test_file.touch()
        test_file.unlink()
    except Exception as e:
        issues.append(f"Cannot write to transcripts directory: {e}")

    if issues:
        for issue in issues:
            logger.error(f"❌ {issue}")
        return False

    logger.info("✅ Environment validation passed")
    return True

# Add to worker start:
def run(self):
    if not validate_environment():
        logger.error("Environment validation failed. Exiting.")
        sys.exit(1)
    # ... rest of run logic
```

---

## Development Workflow Best Practices

### Starting a Development Session

1. **Always validate first:**
   ```bash
   cd scripts
   python validate_environment.py
   ```

2. **Start in correct order:**
   - Backend first (Flask server)
   - Frontend second (React)
   - Worker last (can run independently)

3. **Check logs immediately:**
   ```bash
   # In separate terminal
   tail -f logs/backend.log logs/frontend.log scripts/transcription_worker.log
   ```

### Stopping Services

**Graceful shutdown:**
```bash
# Press Ctrl+C in each terminal
# Worker will finish current transcription before stopping
```

**Force stop if needed:**
```bash
# Kill by port
lsof -ti:8000 | xargs kill -9  # Backend
lsof -ti:3000 | xargs kill -9  # Frontend

# Or kill all Python/Node processes (nuclear option)
pkill -f "dashboard_server.py"
pkill -f "transcription_worker.py"
pkill -f "vite"
```

### Debugging Tips

1. **Check all logs:**
   ```bash
   # Worker
   tail -50 scripts/transcription_worker.log

   # Backend
   cat logs/backend.log

   # Frontend (browser console)
   # Open DevTools: Cmd+Option+I
   ```

2. **Test each component independently:**
   ```bash
   # Test backend API
   curl http://localhost:8000/api/status

   # Test worker
   python transcription_worker.py --no-ui

   # Test frontend build
   cd dashboard-react && npm run build
   ```

3. **Check resource usage:**
   ```bash
   # Watch memory in real-time
   watch -n 2 'ps aux | grep python | grep -v grep'

   # Or use Activity Monitor (Cmd+Space, type "Activity Monitor")
   ```

---

## Quick Reference: All Commands

### Python Backend & Worker
```bash
# Activate venv (always do this first!)
source venv/bin/activate

# Start backend
python scripts/dashboard_server.py

# Start worker (basic)
python scripts/transcription_worker.py --model medium

# Start worker (production settings)
python scripts/transcription_worker.py --model medium --idle-timeout 30 --max-retries 3

# Check status
python scripts/check_status.py

# Download episodes
python scripts/download_episodes.py --download 5
```

### React Frontend
```bash
# Install dependencies (first time only)
cd scripts/dashboard-react
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Troubleshooting
```bash
# Check what's using a port
lsof -i :3000
lsof -i :8000

# Kill process on port
lsof -ti:3000 | xargs kill -9

# Check if services are running
curl http://localhost:8000/health
curl http://localhost:3000

# View logs
tail -f scripts/transcription_worker.log
tail -f logs/backend.log
tail -f logs/frontend.log
```

---

## Next Steps

After getting everything running:

1. ✅ Backend health checks implemented
2. ✅ Resource monitoring in worker
3. ⏳ Create `validate_environment.py` script
4. ⏳ Create `start_all.sh` and `stop_all.sh` scripts
5. ⏳ Set up centralized logging directory
6. ⏳ Add pre-flight checks to all scripts

See [TODO.md](TODO.md) for the full project roadmap.
