#!/bin/bash
# Convenient script to run Python scripts with automatic venv activation
# Usage: ./run.sh script_name.py [arguments...]

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

# Check if a script was provided
if [ $# -eq 0 ]; then
    echo "Usage: ./run.sh <python_script> [arguments...]"
    echo ""
    echo "Examples:"
    echo "  ./run.sh test_jfk_fll.py"
    echo "  ./run.sh check_env.py"
    echo "  ./run.sh src/app.py"
    echo ""
    exit 1
fi

# Activate virtual environment
source venv/bin/activate

# Set PYTHONPATH to include the backend directory
export PYTHONPATH="$(pwd):${PYTHONPATH}"

# Show what we're running
echo "🐍 Running: python3 $@"
echo "📂 Working directory: $(pwd)"
echo "🔧 PYTHONPATH: $PYTHONPATH"
echo ""

# Run the Python script with all arguments
python3 "$@"
