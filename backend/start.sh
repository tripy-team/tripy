#!/bin/bash
# Startup script for App Runner
# This script ensures we're in the right directory and sets PYTHONPATH

cd /app/backend/src
export PYTHONPATH=/app/backend/src:$PYTHONPATH
exec python -m uvicorn app:app --host 0.0.0.0 --port 8000
