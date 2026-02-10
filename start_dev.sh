#!/bin/bash
# Ice Cream Social Development Stack Launcher
# Starts all services in separate terminal tabs

PROJECT_ROOT="/Users/ryan/Desktop/Projects/ice-cream-social-app"
cd "$PROJECT_ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}🍦 Ice Cream Social Development Stack${NC}"
echo "======================================"
echo ""

# Validate environment first
echo -e "${YELLOW}Step 1: Validating environment...${NC}"
source venv/bin/activate
python scripts/validate_environment.py

if [ $? -ne 0 ]; then
    echo -e "\n${RED}❌ Environment validation failed!${NC}"
    echo "Fix the issues above, then run this script again."
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Environment validated!${NC}"
echo ""
echo -e "${YELLOW}Step 2: Starting services...${NC}"
echo ""

# Create logs directory
mkdir -p logs

# Function to open new terminal tab and run command
open_terminal_tab() {
    local title="$1"
    local command="$2"

    osascript <<-APPLESCRIPT
		tell application "Terminal"
		    activate
		    tell application "System Events" to keystroke "t" using command down
		    delay 0.5
		    do script "cd '$PROJECT_ROOT' && printf '\\033[1;34m%s\\033[0m\\n' '$title' && echo '======================================' && $command" in front window
		end tell
	APPLESCRIPT
}

# Start Backend Server
echo -e "${BLUE}→${NC} Opening Backend Server (port 8000)..."
open_terminal_tab "🔷 Backend Server (Port 8000)" "source venv/bin/activate && cd scripts && python dashboard_server.py"
sleep 2

# Start Frontend Dev Server
echo -e "${BLUE}→${NC} Opening React Frontend (port 3000)..."
open_terminal_tab "⚛️  React Frontend (Port 3000)" "cd scripts/dashboard-react && npm run dev"
sleep 2

# Start Transcription Worker
echo -e "${BLUE}→${NC} Opening Transcription Worker..."
open_terminal_tab "🎙️  Transcription Worker" "source venv/bin/activate && cd scripts && python transcription_worker.py --model medium --idle-timeout 30"

echo ""
echo -e "${GREEN}✅ All services starting in separate tabs!${NC}"
echo ""
echo -e "${YELLOW}Access your app:${NC}"
echo -e "  • React Dashboard: ${BLUE}http://localhost:3000${NC}"
echo -e "  • Backend API:     ${BLUE}http://localhost:8000${NC}"
echo ""
echo -e "${YELLOW}To stop all services:${NC}"
echo "  Press Ctrl+C in each Terminal tab"
echo -e "  Or run: ${BLUE}./stop_dev.sh${NC}"
echo ""
echo -e "${YELLOW}View logs:${NC}"
echo "  tail -f scripts/transcription_worker.log"
echo ""
