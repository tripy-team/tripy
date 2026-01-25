#!/bin/bash
# Start the FastAPI development server with automatic venv activation

set -e

cd "$(dirname "$0")"

# Check if venv exists
if [ ! -d "venv" ]; then
    echo "❌ Virtual environment not found!"
    echo ""
    echo "Please run setup first:"
    echo "  ./setup_venv.sh"
    echo ""
    exit 1
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found"
    echo ""
    echo "Run './setup_env.sh' to create one, or continue without it."
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
fi

# Activate virtual environment
source venv/bin/activate

# Set PYTHONPATH
export PYTHONPATH="$(pwd):${PYTHONPATH}"

echo "🚀 Starting FastAPI development server..."
echo "📂 Working directory: $(pwd)"
echo "🔧 PYTHONPATH: $PYTHONPATH"
echo ""
echo "Server will be available at: http://localhost:8000"
echo "API docs will be available at: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Start uvicorn with reload for development
uvicorn src.app:app --host 0.0.0.0 --port 8000 --reload
