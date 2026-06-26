#!/usr/bin/env bash
#
# Run a local DynamoDB emulator (moto) on http://localhost:8001 for local testing.
# Pure Python — no Java, no AWS contact. Speaks the real DynamoDB API incl. GSIs.
#
# NOTE: this runs on :8001, NOT :8000 — :8000 belongs to the FastAPI backend
#       (which the frontend expects there). Override with DYNAMODB_LOCAL_PORT.
#
# NOTE: moto_server is IN-MEMORY — data resets when you stop it. Re-run
#       create_local_tables.py after each restart. (Good enough for functional
#       testing; if you need persistence, install DynamoDB Local with Java 17+.)
#
# Stop with Ctrl-C.
#
set -euo pipefail

PORT="${DYNAMODB_LOCAL_PORT:-8001}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$(cd "$HERE/.." && pwd)"

# Prefer the venv's moto_server so it matches the installed deps.
MOTO="$BACKEND/venv/bin/moto_server"
if [ ! -x "$MOTO" ]; then
  MOTO="$(command -v moto_server || true)"
fi
if [ -z "${MOTO:-}" ]; then
  echo "moto_server not found. Install it:  ./venv/bin/pip install 'moto[server]'" >&2
  exit 1
fi

echo "Starting moto DynamoDB emulator on http://localhost:$PORT"
echo "Press Ctrl-C to stop. (in-memory — data resets on stop)"
exec "$MOTO" -p "$PORT"
