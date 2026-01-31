#!/bin/bash

# Tripy Local Development Startup Script
# Starts both backend and frontend servers

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Tripy Local Development Startup${NC}"
echo -e "${BLUE}========================================${NC}"

# Cleanup function to kill background processes on exit
cleanup() {
    echo -e "\n${YELLOW}Shutting down servers...${NC}"
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    # Kill any child processes
    pkill -P $$ 2>/dev/null || true
    echo -e "${GREEN}Servers stopped.${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# ========================================
# Backend Setup
# ========================================
echo -e "\n${YELLOW}[1/4] Setting up backend...${NC}"

cd "$BACKEND_DIR"

# Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}Creating Python virtual environment...${NC}"
    python3 -m venv venv
fi

# Activate venv
source venv/bin/activate

# Install/update dependencies
echo -e "${YELLOW}Installing backend dependencies...${NC}"
pip install -q -r requirements.txt

# Setup backend .env if it doesn't exist
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}Creating backend .env file...${NC}"
    if [ -f "$SCRIPT_DIR/.env" ]; then
        # Copy from root .env if it exists
        cp "$SCRIPT_DIR/.env" .env
        echo -e "${GREEN}Copied .env from project root${NC}"
    elif [ -f "env.example" ]; then
        cp env.example .env
        echo -e "${RED}Created .env from template - please edit with your credentials!${NC}"
    fi
fi

# ========================================
# Frontend Setup
# ========================================
echo -e "\n${YELLOW}[2/4] Setting up frontend...${NC}"

cd "$FRONTEND_DIR"

# Install dependencies if node_modules doesn't exist or package.json changed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing frontend dependencies...${NC}"
    npm install
fi

# Setup frontend .env.local if it doesn't exist
if [ ! -f ".env.local" ]; then
    echo -e "${YELLOW}Creating frontend .env.local file...${NC}"
    echo "NEXT_PUBLIC_BACKEND_URL=http://localhost:8000" > .env.local
    echo -e "${GREEN}Created .env.local pointing to localhost:8000${NC}"
fi

# ========================================
# Start Backend
# ========================================
echo -e "\n${YELLOW}[3/4] Starting backend server...${NC}"

cd "$BACKEND_DIR"
source venv/bin/activate

# Start backend in background
python -m uvicorn src.app:app --reload --port 8000 &
BACKEND_PID=$!

# Wait for backend to be ready
echo -e "${YELLOW}Waiting for backend to start...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        echo -e "${GREEN}Backend is ready!${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Backend failed to start within 30 seconds${NC}"
        cleanup
        exit 1
    fi
    sleep 1
done

# ========================================
# Start Frontend
# ========================================
echo -e "\n${YELLOW}[4/4] Starting frontend server...${NC}"

cd "$FRONTEND_DIR"
npm run dev &
FRONTEND_PID=$!

# Wait a moment for frontend to start
sleep 3

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  Both servers are running!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e ""
echo -e "  ${BLUE}Frontend:${NC} http://localhost:3000"
echo -e "  ${BLUE}Backend:${NC}  http://localhost:8000"
echo -e "  ${BLUE}API Docs:${NC} http://localhost:8000/docs"
echo -e ""
echo -e "${YELLOW}Press Ctrl+C to stop both servers${NC}"
echo -e ""

# Wait for either process to exit
wait
