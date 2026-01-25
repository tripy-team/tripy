# Backend Development Guide

This guide explains how to easily set up and run Python scripts in the backend.

## Quick Start

### 1. Initial Setup (One-time)

Run the setup script to create a virtual environment and install all dependencies:

```bash
cd backend
./setup_venv.sh
```

This will:
- Create a Python virtual environment in `backend/venv/`
- Install all dependencies from `requirements.txt`
- Prepare your development environment

### 2. Running Python Scripts

You have three options for running Python scripts:

#### Option A: Use the `run.sh` helper script (Recommended)

The easiest way - automatically activates venv and sets up paths:

```bash
./run.sh test_jfk_fll.py
./run.sh check_env.py
./run.sh best_roundtrip.py
```

#### Option B: Activate the virtual environment manually

If you want to run multiple scripts in the same session:

```bash
source activate.sh
python3 test_jfk_fll.py
python3 check_env.py
# ... run more scripts
deactivate  # when done
```

#### Option C: Standard venv activation

Traditional approach:

```bash
source venv/bin/activate
export PYTHONPATH="$(pwd):${PYTHONPATH}"
python3 test_jfk_fll.py
deactivate  # when done
```

### 3. Starting the Development Server

To run the FastAPI server locally:

```bash
./start_server.sh
```

The server will be available at:
- API: http://localhost:8000
- Documentation: http://localhost:8000/docs
- Interactive API: http://localhost:8000/redoc

## Available Scripts

| Script | Description |
|--------|-------------|
| `setup_venv.sh` | Initial setup - creates venv and installs dependencies |
| `run.sh <script>` | Run any Python script with automatic venv activation |
| `start_server.sh` | Start the FastAPI development server |
| `activate.sh` | Source this to manually activate the venv |
| `setup_env.sh` | Configure environment variables in `.env` |
| `check_env.py` | Verify your environment configuration |

## Configuration

### Environment Variables

Create a `.env` file for local configuration:

```bash
./setup_env.sh
```

Then edit `backend/.env` to add your AWS credentials and API keys.

### Requirements

If you add new Python dependencies:

1. Add them to `requirements.txt`
2. Reinstall dependencies:
   ```bash
   source venv/bin/activate
   pip install -r requirements.txt
   ```

Or just re-run `./setup_venv.sh`

## Testing

Run test scripts easily:

```bash
# Test specific functionality
./run.sh test_jfk_fll.py
./run.sh test_ilp_optimality.py
./run.sh test_city_search.py

# Test with arguments
./run.sh best_roundtrip.py --help
```

## Troubleshooting

### "Virtual environment not found"

Run the setup script:
```bash
./setup_venv.sh
```

### "Module not found" errors

Make sure PYTHONPATH is set (automatic with `run.sh` or `activate.sh`):
```bash
export PYTHONPATH="$(pwd):${PYTHONPATH}"
```

### Dependency issues

Reinstall dependencies:
```bash
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### Permission denied

Make scripts executable:
```bash
chmod +x *.sh
```

## IDE Integration

### VS Code / Cursor

Select the Python interpreter from the venv:
1. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
2. Type "Python: Select Interpreter"
3. Choose `./backend/venv/bin/python`

### PyCharm

1. Go to Settings → Project → Python Interpreter
2. Click the gear icon → Add
3. Choose "Existing environment"
4. Select `backend/venv/bin/python`

## Best Practices

1. **Always use the virtual environment** - Don't install packages globally
2. **Use `run.sh` for quick scripts** - It handles activation automatically
3. **Keep `requirements.txt` updated** - Add dependencies as you use them
4. **Use `.env` for secrets** - Never commit API keys to git
5. **Test locally before deploying** - Use `start_server.sh` to verify changes

## Directory Structure

```
backend/
├── venv/                   # Virtual environment (auto-generated)
├── src/                    # Main application code
│   ├── app.py             # FastAPI application
│   ├── handlers/          # API route handlers
│   ├── services/          # Business logic
│   ├── repos/             # Data access layer
│   └── utils/             # Utility functions
├── files/                 # Static data files
├── requirements.txt       # Python dependencies
├── .env                   # Local configuration (create with setup_env.sh)
├── setup_venv.sh         # Setup virtual environment
├── run.sh                # Run scripts with venv
├── start_server.sh       # Start development server
└── activate.sh           # Activate venv manually
```
