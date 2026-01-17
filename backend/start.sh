#!/bin/bash
# Startup script for App Runner
# This script ensures we're in the right directory and sets PYTHONPATH

set -e  # Exit on error

# Change to the backend directory (parent of src)
cd /app/backend || {
    echo "ERROR: Failed to change to /app/backend"
    exit 1
}

# Set PYTHONPATH to include src directory
export PYTHONPATH=/app/backend/src:$PYTHONPATH

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

# Start uvicorn using src.app:app module path
# This allows relative imports to work correctly
exec python -m uvicorn src.app:app --host 0.0.0.0 --port 8000
