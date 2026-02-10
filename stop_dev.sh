#!/bin/bash
# Stop all Ice Cream Social development services

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🛑 Stopping Ice Cream Social services...${NC}"
echo ""

# Kill processes by port
echo "Stopping backend (port 8000)..."
lsof -ti:8000 | xargs kill -TERM 2>/dev/null && echo -e "${GREEN}✅ Backend stopped${NC}" || echo "⚠️  No backend process found"

echo "Stopping frontend (port 3000-3010)..."
for port in {3000..3010}; do
    lsof -ti:$port | xargs kill -TERM 2>/dev/null
done
echo -e "${GREEN}✅ Frontend stopped${NC}"

# Kill processes by name
echo "Stopping transcription worker..."
pkill -TERM -f "transcription_worker.py" 2>/dev/null && echo -e "${GREEN}✅ Worker stopped${NC}" || echo "⚠️  No worker process found"

echo ""
echo -e "${GREEN}✅ All services stopped${NC}"
