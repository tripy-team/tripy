#!/usr/bin/env bash
# Startup script for App Runner
# Runs from the directory containing this script (e.g., /app/backend)
set -euo pipefail

# Use the directory containing this script as the app root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || {
  echo "ERROR: Failed to change to $SCRIPT_DIR"
  exit 1
}

# Pick a Python executable that exists (App Runner python311 often has python3 but not python)
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "ERROR: Neither python3 nor python found on PATH"
  echo "PATH=$PATH"
  exit 1
fi

# --- Dependencies ---
# Dependencies are installed at BUILD time (see apprunner.yaml `build` phase) and
# baked into the image, so we do NOT reinstall on every boot — that reinstall was
# the dominant backend cold-start "bake time". We only fall back to installing if
# the deps are somehow missing (e.g. running this script outside App Runner), so a
# misconfigured environment degrades gracefully instead of crash-looping.
if ! "$PY" -c "import uvicorn" >/dev/null 2>&1; then
  echo "Dependencies not found in the image — installing as a fallback..."
  "$PY" -m pip install --upgrade pip -q
  "$PY" -m pip install -r "$SCRIPT_DIR/requirements.txt" -q
else
  echo "Dependencies already present (baked at build time) — skipping install."
fi

# PYTHONPATH so "import src" works
export PYTHONPATH="$SCRIPT_DIR${PYTHONPATH:+:$PYTHONPATH}"

# Verify src/app.py exists
if [ ! -f "src/app.py" ]; then
  echo "ERROR: src/app.py not found in $(pwd)"
  ls -la
  exit 1
fi

# Verify src/services directory exists
if [ ! -d "src/services" ]; then
  echo "ERROR: src/services directory not found in $(pwd)"
  ls -la
  exit 1
fi

# Debug: Print environment info
echo "Current directory: $(pwd)"
echo "PYTHONPATH: $PYTHONPATH"
echo "Using Python: $($PY --version 2>&1)"
echo "Which python: $(command -v $PY)"
echo "Checking if src/app.py exists:"
ls -la src/app.py
echo "Checking if src/services exists:"
ls -la src/services

# Start uvicorn (make sure uvicorn is in requirements.txt)
exec "$PY" -m uvicorn src.app:app --host 0.0.0.0 --port "${PORT:-8000}"
