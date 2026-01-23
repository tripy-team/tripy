#!/bin/bash
# Start the FastAPI backend server for Tripy

# Navigate to backend directory
cd "$(dirname "$0")"

# Check if virtual environment exists
if [ -d "venv" ]; then
    echo "Activating virtual environment..."
    source venv/bin/activate
elif [ -d ".venv" ]; then
    echo "Activating virtual environment..."
    source .venv/bin/activate
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "Warning: .env file not found. You may need to create one with your configuration."
fi

# Check if uvicorn is installed
if ! python -c "import uvicorn" 2>/dev/null; then
    echo "Installing dependencies..."
    pip install -r requirements.txt
fi

# Set PYTHONPATH to include backend directory (parent of src)
# This allows imports like "from src.repos import ..." to work
export PYTHONPATH="$(pwd):$PYTHONPATH"

# Start the server
echo "Starting FastAPI server on http://localhost:8000"
echo "API docs available at http://localhost:8000/docs"
echo ""
uvicorn src.app:app --reload --host 0.0.0.0 --port 8000
