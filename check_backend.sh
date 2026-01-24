#!/bin/bash
# Quick script to check if backend is running and help diagnose issues

echo "🔍 Checking Backend Server Status..."
echo "====================================="
echo ""

# Check if port 8000 is in use
if lsof -ti:8000 > /dev/null 2>&1; then
    echo "✅ Port 8000 is in use"
    PID=$(lsof -ti:8000)
    echo "   Process ID: $PID"
    echo "   Command: $(ps -p $PID -o command= 2>/dev/null || echo 'Unknown')"
    echo ""
    
    # Test health endpoint
    echo "Testing health endpoint..."
    if curl -s http://localhost:8000/healthz > /dev/null 2>&1; then
        echo "✅ Backend health check: OK"
        curl -s http://localhost:8000/healthz | head -1
    else
        echo "⚠️  Port 8000 is in use but health check failed"
        echo "   The process may not be the backend server"
    fi
else
    echo "❌ Backend server is NOT running on port 8000"
    echo ""
    echo "To start the backend:"
    echo "  1. cd backend"
    echo "  2. ./start_server.sh"
    echo ""
    echo "Or start both servers together:"
    echo "  ./start_dev.sh"
fi

echo ""
echo "====================================="
echo ""

# Check if .env file exists
if [ -f "backend/.env" ]; then
    echo "✅ backend/.env file exists"
else
    echo "❌ backend/.env file NOT found"
    echo "   Run: cd backend && ./setup_env.sh"
fi

# Check frontend .env.local
if [ -f "frontend/.env.local" ]; then
    echo "✅ frontend/.env.local exists"
    if grep -q "NEXT_PUBLIC_BACKEND_URL" frontend/.env.local; then
        echo "✅ NEXT_PUBLIC_BACKEND_URL is configured"
        grep "NEXT_PUBLIC_BACKEND_URL" frontend/.env.local
    else
        echo "⚠️  NEXT_PUBLIC_BACKEND_URL not found in frontend/.env.local"
    fi
else
    echo "⚠️  frontend/.env.local not found (will use default http://localhost:8000)"
fi
