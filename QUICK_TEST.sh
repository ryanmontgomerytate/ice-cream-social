#!/bin/bash
# Quick Backend API Testing Script

API="http://localhost:8000/api/v2"
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}🍦 Ice Cream Social - API Quick Test${NC}"
echo "======================================"
echo ""

# Test 1: Health Check
echo -e "${YELLOW}Test 1: Health Check${NC}"
curl -s $API/health | python3 -m json.tool
echo ""
echo ""

# Test 2: Get Episodes
echo -e "${YELLOW}Test 2: Get Episodes${NC}"
curl -s $API/episodes | python3 -m json.tool | head -30
echo ""
echo ""

# Test 3: Queue Status
echo -e "${YELLOW}Test 3: Queue Status${NC}"
curl -s $API/queue/status | python3 -m json.tool
echo ""
echo ""

# Test 4: Feed Sources
echo -e "${YELLOW}Test 4: Feed Sources${NC}"
curl -s $API/feeds/sources | python3 -m json.tool
echo ""
echo ""

# Test 5: Add to Queue
echo -e "${YELLOW}Test 5: Add Episode 1 to Queue${NC}"
curl -s -X POST $API/queue/add \
  -H "Content-Type: application/json" \
  -d '{"episode_id": 1, "priority": 0}' | python3 -m json.tool
echo ""
echo ""

# Test 6: Queue Status After Add
echo -e "${YELLOW}Test 6: Queue Status (After Add)${NC}"
curl -s $API/queue/status | python3 -m json.tool
echo ""
echo ""

# Test 7: Remove from Queue
echo -e "${YELLOW}Test 7: Remove Episode 1 from Queue${NC}"
curl -s -X DELETE $API/queue/remove/1 | python3 -m json.tool
echo ""
echo ""

echo -e "${GREEN}✅ Quick tests complete!${NC}"
echo ""
echo "For full testing, see: BACKEND_TESTING_GUIDE.md"
