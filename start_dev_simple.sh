#!/bin/bash
# Simple launcher - runs all services in background from current terminal
# Logs are saved to logs/ directory

PROJECT_ROOT="/Users/ryan/Desktop/Projects/ice-cream-social-app"
cd "$PROJECT_ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}🍦 Ice Cream Social Development Stack (Simple Mode)${NC}"
echo "======================================"
echo ""

# Validate environment first
echo -e "${YELLOW}Validating environment...${NC}"
source venv/bin/activate
python scripts/validate_environment.py

if [ $? -ne 0 ]; then
    echo -e "\n${RED}❌ Environment validation failed!${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Environment validated!${NC}"
echo ""

# Create logs directory
mkdir -p logs

# Start Backend
echo -e "${BLUE}→${NC} Starting Backend Server (port 8000)..."
cd scripts
python dashboard_server.py > ../logs/backend.log 2>&1 &
BACKEND_PID=$!
echo "   PID: $BACKEND_PID"
sleep 2

# Check if backend started
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo -e "${RED}❌ Backend failed to start. Check logs/backend.log${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Backend running${NC}"

# Start Frontend
echo -e "${BLUE}→${NC} Starting React Frontend (port 3000)..."
cd dashboard-react
npm run dev > ../../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "   PID: $FRONTEND_PID"
sleep 2
echo -e "${GREEN}✅ Frontend running${NC}"

# Start Worker
echo -e "${BLUE}→${NC} Starting Transcription Worker..."
cd ..
python transcription_worker.py --idle-timeout 30 > ../logs/worker.log 2>&1 &
WORKER_PID=$!
echo "   PID: $WORKER_PID"
echo -e "${GREEN}✅ Worker running${NC}"

# Save PIDs
cat > ../logs/dev.pids <<EOF
BACKEND_PID=$BACKEND_PID
FRONTEND_PID=$FRONTEND_PID
WORKER_PID=$WORKER_PID
EOF

echo ""
echo -e "${GREEN}✅ All services started!${NC}"
echo ""
echo -e "${YELLOW}Access your app:${NC}"
echo "  • React Dashboard: ${BLUE}http://localhost:3000${NC}"
echo "  • Backend API:     ${BLUE}http://localhost:8000${NC}"
echo ""
echo -e "${YELLOW}View logs:${NC}"
echo "  • Backend:  tail -f logs/backend.log"
echo "  • Frontend: tail -f logs/frontend.log"
echo "  • Worker:   tail -f logs/worker.log"
echo ""
echo -e "${YELLOW}View all logs together:${NC}"
echo "  tail -f logs/*.log"
echo ""
echo -e "${YELLOW}To stop all services:${NC}"
echo "  ./stop_dev.sh"
echo ""
