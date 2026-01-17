#!/bin/bash
# Startup script for App Runner
# This script ensures we're in the right directory and sets PYTHONPATH

set -e  # Exit on error

# Change to the backend directory (parent of src)
cd /app/backend || {
    echo "ERROR: Failed to change to /app/backend"
    exit 1
}

# Set PYTHONPATH to include backend directory (parent of src)
# This allows imports like "from src.repos import ..." to work
export PYTHONPATH=/app/backend:$PYTHONPATH

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
