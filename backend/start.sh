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
# This allows both absolute imports (from services) and relative imports (from ..repos) to work
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
# - src is the top-level package
# - src.app is the app module
# - src.services.trip_service can use "from ..repos" (relative import)
# - src.app can use "from services import" because PYTHONPATH includes /app/backend/src
exec python -m uvicorn src.app:app --host 0.0.0.0 --port 8000
