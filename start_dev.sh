#!/bin/bash
# Start both backend and frontend servers together for development

set -e

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

cd "$SCRIPT_DIR"

echo "🚀 Starting Tripy Development Environment"
echo "=========================================="
echo ""

# Check if backend is already running
if curl -s http://localhost:8000/healthz > /dev/null 2>&1; then
    echo "✅ Backend is already running on http://localhost:8000"
    echo "   Starting frontend only..."
    echo ""
    cd frontend
    npm run dev
    exit 0
fi

# Check if npm/node is available
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found. Please install Node.js"
    exit 1
fi

# Install concurrently if not already installed (in root or globally)
if ! npm list concurrently > /dev/null 2>&1 && ! npm list -g concurrently > /dev/null 2>&1; then
    echo "📦 Installing concurrently to run both servers..."
    npm install --save-dev concurrently > /dev/null 2>&1 || true
fi

# Use concurrently to run both servers
echo "⚙️  Starting backend and frontend servers..."
echo ""
echo "   Backend:  http://localhost:8000"
echo "   Frontend: http://localhost:3000"
echo ""
echo "   Press Ctrl+C to stop both servers"
echo ""

npx concurrently \
    --names "BACKEND,FRONTEND" \
    --prefix-colors "blue,green" \
    --kill-others-on-fail \
    "cd backend && ./start_server.sh" \
    "sleep 3 && cd frontend && npm run dev"
