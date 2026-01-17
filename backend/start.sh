#!/bin/bash
# Startup script for App Runner
# This script ensures we're in the right directory and sets PYTHONPATH

set -e  # Exit on error

# Change to the src directory
cd /app/backend/src || {
    echo "ERROR: Failed to change to /app/backend/src"
    exit 1
}

# Set PYTHONPATH
export PYTHONPATH=/app/backend/src:$PYTHONPATH

# Verify app.py exists
if [ ! -f "app.py" ]; then
    echo "ERROR: app.py not found in $(pwd)"
    ls -la
    exit 1
fi

# Verify services directory exists
if [ ! -d "services" ]; then
    echo "ERROR: services directory not found in $(pwd)"
    ls -la
    exit 1
fi

# Start uvicorn
exec python -m uvicorn app:app --host 0.0.0.0 --port 8000
