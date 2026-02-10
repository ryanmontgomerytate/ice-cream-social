#!/bin/bash
# Quick Dashboard Health Check

echo "======================================"
echo "🍦 Dashboard Health Check"
echo "======================================"
echo ""

# Check Backend (Flask on port 8000)
if lsof -i :8000 | grep -q LISTEN; then
    BACKEND_CPU=$(ps aux | grep dashboard_server.py | grep -v grep | awk '{print $3}')
    echo "✅ Backend: Running (CPU: ${BACKEND_CPU}%)"

    # Test API endpoint
    if curl -s http://localhost:8000/api/v2/stats > /dev/null 2>&1; then
        echo "   └─ API responding ✓"
    else
        echo "   └─ API not responding ✗"
    fi
else
    echo "❌ Backend: Not running"
fi

# Check Vite (React dev server on port 3000)
if lsof -i :3000 | grep -q LISTEN; then
    echo "✅ Vite: Running"
else
    echo "❌ Vite: Not running"
fi

# Check Worker
if ps aux | grep transcription_worker.py | grep -v grep > /dev/null; then
    WORKER_CPU=$(ps aux | grep transcription_worker.py | grep -v grep | awk '{print $3}')
    echo "✅ Worker: Running (CPU: ${WORKER_CPU}%)"
else
    echo "ℹ️  Worker: Not running"
fi

# Check Speaker Diarization
if ps aux | grep speaker_diarization.py | grep -v grep > /dev/null; then
    DIAR_CPU=$(ps aux | grep speaker_diarization.py | grep -v grep | awk '{print $3}')
    DIAR_MEM=$(ps aux | grep speaker_diarization.py | grep -v grep | awk '{print $4}')
    echo "✅ Diarization: Running (CPU: ${DIAR_CPU}%, MEM: ${DIAR_MEM}%)"
else
    echo "ℹ️  Diarization: Not running"
fi

echo ""
echo "Dashboard: http://localhost:3000"
echo "Backend API: http://localhost:8000"
echo ""
