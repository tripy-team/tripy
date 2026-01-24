#!/bin/bash
# Startup script for App Runner
# With SourceDirectory=backend, App Runner places backend contents at /app.
# This script finds its own directory so it works for /app or /app/backend.

set -e  # Exit on error

# Use the directory containing this script as the app root (e.g. /app when run as /app/start.sh)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || {
    echo "ERROR: Failed to change to $SCRIPT_DIR"
    exit 1
}

# PYTHONPATH so "from src.xxx" and "import src" work
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
echo "Python version: $(python --version)"
echo "Checking if src/app.py exists:"
ls -la src/app.py || echo "ERROR: src/app.py not found"
echo "Checking if src/services exists:"
ls -la src/services || echo "ERROR: src/services not found"

# Start uvicorn using src.app:app module path
# Running from /app/backend with src.app:app means:
# - PYTHONPATH includes /app/backend, so Python can find "src" as a top-level package
# - src.app is the app module
# - All imports using "from src.repos import ..." will work correctly
exec python -m uvicorn src.app:app --host 0.0.0.0 --port 8000
