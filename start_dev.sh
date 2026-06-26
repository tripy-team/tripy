#!/bin/bash
#
# One-command local dev launcher for Tripy.
#
#   ./start_dev.sh
#
# Brings up the full stack and tears it down cleanly on Ctrl-C:
#   • moto DynamoDB emulator   →  http://localhost:8001  (in-memory, no AWS)
#   • FastAPI backend          →  http://localhost:8000
#   • Next.js frontend         →  http://localhost:3000
#
# It is idempotent and self-healing: it creates the backend venv + installs deps
# if missing, frees stale ports, repoints config, and (re)creates the local
# DynamoDB tables on every boot (moto is in-memory, so they vanish on shutdown).
#
# The backend and the DynamoDB emulator must run on SEPARATE ports — they both
# historically defaulted to :8000, which is the collision this script avoids.

set -uo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

BACKEND_PORT=8000
DYNAMODB_PORT=8001
FRONTEND_PORT=3000
DYNAMODB_ENDPOINT="http://localhost:${DYNAMODB_PORT}"

PY="$BACKEND_DIR/venv/bin/python"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
say()  { echo -e "${BLUE}▸${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
die()  { echo -e "${RED}✗ $*${NC}" >&2; exit 1; }

# ── Cleanup: kill everything we spawned on Ctrl-C / exit ──────────────────────
PIDS=()
cleanup() {
  echo ""
  say "Shutting down..."
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  # Belt and suspenders: free the ports we own in case a child re-forked.
  for port in "$BACKEND_PORT" "$DYNAMODB_PORT"; do
    lsof -ti:"$port" 2>/dev/null | xargs kill 2>/dev/null || true
  done
  ok "Servers stopped."
  exit 0
}
trap cleanup SIGINT SIGTERM

free_port() {  # free_port <port> <label>
  local port="$1" label="$2" held
  held="$(lsof -ti:"$port" 2>/dev/null || true)"
  if [ -n "$held" ]; then
    warn "Port $port ($label) is in use — freeing it (pid $held)."
    echo "$held" | xargs kill 2>/dev/null || true
    sleep 1
  fi
}

wait_for_http() {  # wait_for_http <url> <label> <max_seconds>
  local url="$1" label="$2" max="$3" i
  for ((i=1; i<=max; i++)); do
    if curl -sS -m 3 -o /dev/null "$url" 2>/dev/null; then
      ok "$label ready (~${i}s)."
      return 0
    fi
    sleep 1
  done
  return 1
}

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Tripy local dev${NC}"
echo -e "${BLUE}========================================${NC}"

# ── 1. Backend venv + dependencies ───────────────────────────────────────────
say "[1/6] Backend environment"
if [ ! -x "$PY" ]; then
  warn "No venv found — creating backend/venv and installing dependencies (one-time)."
  python3 -m venv "$BACKEND_DIR/venv" || die "Failed to create venv (need python3)."
  "$PY" -m pip install --upgrade pip -q
  "$PY" -m pip install -q -r "$BACKEND_DIR/requirements.txt" || die "pip install failed."
fi
# moto[server] provides the moto_server binary used for local DynamoDB.
if [ ! -x "$BACKEND_DIR/venv/bin/moto_server" ]; then
  warn "moto_server missing — installing moto[server]."
  "$PY" -m pip install -q 'moto[server]' || die "Failed to install moto[server]."
fi
ok "Backend venv ready."

# ── 2. Backend .env: ensure it exists and points DynamoDB at the right port ───
say "[2/6] Backend config"
ENV_FILE="$BACKEND_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$BACKEND_DIR/env.example" ]; then
    cp "$BACKEND_DIR/env.example" "$ENV_FILE"
    warn "Created backend/.env from env.example — review credentials if needed."
  else
    touch "$ENV_FILE"
  fi
fi
# Idempotently pin DYNAMODB_ENDPOINT_URL to the emulator port (8001, not 8000).
if grep -qE '^[[:space:]]*DYNAMODB_ENDPOINT_URL=' "$ENV_FILE"; then
  # Use a temp file so this works identically on macOS/BSD and GNU sed.
  tmp="$(mktemp)"
  sed "s|^[[:space:]]*DYNAMODB_ENDPOINT_URL=.*|DYNAMODB_ENDPOINT_URL=${DYNAMODB_ENDPOINT}|" "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
else
  printf '\nDYNAMODB_ENDPOINT_URL=%s\n' "$DYNAMODB_ENDPOINT" >> "$ENV_FILE"
fi
ok "DynamoDB endpoint pinned to ${DYNAMODB_ENDPOINT}."

# ── 3. Start the moto DynamoDB emulator on :8001 ─────────────────────────────
say "[3/6] DynamoDB emulator (moto)"
free_port "$DYNAMODB_PORT" "dynamodb"
DYNAMODB_LOCAL_PORT="$DYNAMODB_PORT" "$BACKEND_DIR/local/run_dynamodb_local.sh" \
  > "$BACKEND_DIR/local/.moto.log" 2>&1 &
PIDS+=("$!")
wait_for_http "$DYNAMODB_ENDPOINT/" "moto" 20 \
  || die "moto failed to start — see backend/local/.moto.log"

# ── 4. (Re)create local DynamoDB tables (moto is in-memory) ──────────────────
say "[4/6] Creating local DynamoDB tables"
( cd "$BACKEND_DIR" && DYNAMODB_ENDPOINT_URL="$DYNAMODB_ENDPOINT" "$PY" local/create_local_tables.py ) \
  || die "Failed to create local tables."

# ── 5. Start the FastAPI backend on :8000 ────────────────────────────────────
say "[5/6] Backend (FastAPI)"
free_port "$BACKEND_PORT" "backend"
# Postgres is used by the Next.js API routes; warn (non-fatal) if it's down.
if command -v pg_isready >/dev/null 2>&1; then
  pg_isready -h localhost -p 5432 >/dev/null 2>&1 \
    || warn "Postgres not reachable on :5432 — login/seed-data features may fail."
fi
(
  cd "$BACKEND_DIR"
  export PYTHONPATH="$BACKEND_DIR${PYTHONPATH:+:$PYTHONPATH}"
  exec "$PY" -m uvicorn src.app:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload
) > "$BACKEND_DIR/local/.backend.log" 2>&1 &
PIDS+=("$!")
# /healthz is the backend's liveness endpoint.
wait_for_http "http://localhost:${BACKEND_PORT}/healthz" "backend" 40 \
  || die "Backend failed to start — see backend/local/.backend.log"

# ── 6. Start the Next.js frontend on :3000 ───────────────────────────────────
say "[6/6] Frontend (Next.js)"
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  warn "Installing frontend dependencies (one-time)..."
  ( cd "$FRONTEND_DIR" && npm install ) || die "npm install failed."
fi
if [ ! -f "$FRONTEND_DIR/.env.local" ]; then
  printf 'NEXT_PUBLIC_BACKEND_URL=http://localhost:%s\n' "$BACKEND_PORT" > "$FRONTEND_DIR/.env.local"
  warn "Created frontend/.env.local pointing at the local backend."
fi
free_port "$FRONTEND_PORT" "frontend"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Stack is up${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "  ${BLUE}Frontend:${NC}  http://localhost:${FRONTEND_PORT}"
echo -e "  ${BLUE}Backend:${NC}   http://localhost:${BACKEND_PORT}   (docs: /docs)"
echo -e "  ${BLUE}DynamoDB:${NC}  ${DYNAMODB_ENDPOINT}   (moto, in-memory)"
echo -e "  ${BLUE}Logs:${NC}      backend/local/.backend.log, .moto.log"
echo ""
echo -e "${YELLOW}Press Ctrl-C to stop everything.${NC}"
echo ""

# Run the frontend in the foreground so its logs stream here and Ctrl-C reaches
# the trap, which tears down moto + backend too.
( cd "$FRONTEND_DIR" && exec npm run dev ) &
PIDS+=("$!")
wait
