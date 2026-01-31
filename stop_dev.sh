#!/bin/bash

# Stop Tripy development servers
# Usage: ./stop_dev.sh

echo "Stopping Tripy development servers..."

# Kill backend (uvicorn on port 8000)
BACKEND_PID=$(lsof -ti:8000 2>/dev/null)
if [ -n "$BACKEND_PID" ]; then
    echo "Stopping backend (PID: $BACKEND_PID)..."
    kill -9 $BACKEND_PID 2>/dev/null
    echo "Backend stopped."
else
    echo "Backend not running."
fi

# Kill frontend (Vite on port 5173)
FRONTEND_PID=$(lsof -ti:5173 2>/dev/null)
if [ -n "$FRONTEND_PID" ]; then
    echo "Stopping frontend (PID: $FRONTEND_PID)..."
    kill -9 $FRONTEND_PID 2>/dev/null
    echo "Frontend stopped."
else
    echo "Frontend not running on port 5173."
fi

# Also check port 3000 (alternative frontend port)
FRONTEND_3000_PID=$(lsof -ti:3000 2>/dev/null)
if [ -n "$FRONTEND_3000_PID" ]; then
    echo "Stopping frontend on port 3000 (PID: $FRONTEND_3000_PID)..."
    kill -9 $FRONTEND_3000_PID 2>/dev/null
    echo "Frontend (3000) stopped."
fi

# Kill any remaining uvicorn or vite processes
pkill -f "uvicorn.*main:app" 2>/dev/null
pkill -f "vite" 2>/dev/null

echo ""
echo "All servers stopped."
