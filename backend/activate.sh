#!/bin/bash
# Source this script to activate the virtual environment
# Usage: source activate.sh

cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -d "venv" ]; then
    echo "❌ Virtual environment not found!"
    echo ""
    echo "Please run setup first:"
    echo "  ./setup_venv.sh"
    echo ""
    return 1
fi

source venv/bin/activate
export PYTHONPATH="$(pwd):${PYTHONPATH}"

echo "✅ Virtual environment activated"
echo "📂 Working directory: $(pwd)"
echo "🔧 PYTHONPATH: $PYTHONPATH"
echo ""
echo "You can now run Python scripts directly:"
echo "  python3 test_jfk_fll.py"
echo "  python3 check_env.py"
echo ""
echo "To deactivate: deactivate"
echo ""
