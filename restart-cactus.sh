#!/bin/bash
# Restart the full Tripy local stack: Cactus live-transcription server,
# main backend, and frontend. Kills anything on ports 8765/8000/3000 first,
# then brings them all up and streams their logs.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
CACTUS_PORT=8765
BACKEND_PORT=8000
FRONTEND_PORT=3000
CACTUS_MODEL="${CACTUS_STT_MODEL:-nvidia/parakeet-ctc-1.1b}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

CACTUS_PID=""
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"
    [ -n "$CACTUS_PID" ] && kill $CACTUS_PID 2>/dev/null || true
    [ -n "$BACKEND_PID" ] && kill $BACKEND_PID 2>/dev/null || true
    [ -n "$FRONTEND_PID" ] && kill $FRONTEND_PID 2>/dev/null || true
    pkill -P $$ 2>/dev/null || true
    echo -e "${GREEN}Stopped.${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM

free_port() {
    local port=$1
    local pids
    pids=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo -e "    ${YELLOW}port $port held by PIDs $pids — killing${NC}"
        kill -9 $pids 2>/dev/null || true
        sleep 1
    fi
    if lsof -i :"$port" >/dev/null 2>&1; then
        echo -e "    ${RED}port $port still in use${NC}" >&2
        lsof -i :"$port" >&2
        exit 1
    fi
}

echo -e "${BLUE}==> Freeing ports${NC}"
free_port $CACTUS_PORT
free_port $BACKEND_PORT
free_port $FRONTEND_PORT

# ========================================
# Cactus server (port 8765)
# ========================================
echo -e "${BLUE}==> Starting Cactus server (port $CACTUS_PORT, model: $CACTUS_MODEL)${NC}"
cd "$BACKEND_DIR"
if [ ! -d "venv" ]; then
    echo -e "${RED}ERROR: backend venv not found at $BACKEND_DIR/venv${NC}" >&2
    exit 1
fi
# shellcheck disable=SC1091
source venv/bin/activate

if ! python -c "import websockets" 2>/dev/null; then
    echo -e "    ${YELLOW}installing websockets...${NC}"
    pip install -q websockets
fi

CACTUS_STT_MODEL="$CACTUS_MODEL" python -m cactus_server.server &
CACTUS_PID=$!

# ========================================
# Main backend (port 8000)
# ========================================
echo -e "${BLUE}==> Starting main backend (port $BACKEND_PORT)${NC}"
python -m uvicorn src.app:app --reload --port $BACKEND_PORT &
BACKEND_PID=$!

echo -e "    waiting for backend health check..."
for i in {1..30}; do
    if curl -s http://localhost:$BACKEND_PORT/health >/dev/null 2>&1; then
        echo -e "    ${GREEN}backend ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "    ${RED}backend failed to start within 30s${NC}" >&2
        cleanup
    fi
    sleep 1
done

# ========================================
# Frontend (port 3000)
# ========================================
echo -e "${BLUE}==> Starting frontend (port $FRONTEND_PORT)${NC}"
cd "$FRONTEND_DIR"
if [ ! -d "node_modules" ]; then
    echo -e "    ${YELLOW}installing frontend dependencies...${NC}"
    npm install
fi
npm run dev &
FRONTEND_PID=$!

echo ""
echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}  All services running${NC}"
echo -e "${GREEN}==========================================${NC}"
echo -e "  ${BLUE}Cactus:${NC}   ws://localhost:$CACTUS_PORT/ws/live-transcribe"
echo -e "  ${BLUE}Backend:${NC}  http://localhost:$BACKEND_PORT"
echo -e "  ${BLUE}Frontend:${NC} http://localhost:$FRONTEND_PORT"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

wait
