# Tripy Backend

FastAPI backend for the Tripy travel planning application.

## 🚀 Quick Start

### First Time Setup

```bash
# Install dependencies and create virtual environment
./setup_venv.sh
```

### Run a Script

```bash
# Easy way - automatically activates venv
./run.sh test_jfk_fll.py

# Or activate venv manually
source activate.sh
python3 test_jfk_fll.py
```

### Start Development Server

```bash
./start_server.sh
```

Server runs at:
- 🌐 API: http://localhost:8000
- 📚 Docs: http://localhost:8000/docs

## 📖 Documentation

See [DEVELOPMENT.md](./DEVELOPMENT.md) for detailed setup instructions, troubleshooting, and best practices.

## 🧰 Helper Scripts

| Script | Purpose |
|--------|---------|
| `setup_venv.sh` | Create virtual environment and install dependencies |
| `run.sh <script>` | Run any Python script (auto-activates venv) |
| `start_server.sh` | Start the FastAPI development server |
| `activate.sh` | Manually activate the virtual environment |
| `setup_env.sh` | Create and configure `.env` file |

## 📝 Examples

```bash
# Run tests
./run.sh test_jfk_fll.py
./run.sh test_ilp_optimality.py
./run.sh test_city_search.py

# Check environment configuration
./run.sh check_env.py

# Run optimization scripts
./run.sh best_roundtrip.py
```

## 🔧 Configuration

Create a `.env` file for local development:

```bash
./setup_env.sh
```

Then edit `.env` to add your AWS credentials and API keys.

## 🏗️ Project Structure

```
backend/
├── src/               # Application code
│   ├── app.py        # FastAPI app
│   ├── handlers/     # API routes
│   ├── services/     # Business logic
│   ├── repos/        # Data access
│   └── utils/        # Utilities
├── files/            # Static data (airports, cities, etc.)
├── venv/             # Virtual environment (auto-generated)
└── *.sh              # Helper scripts
```

## 📦 Dependencies

All Python dependencies are in `requirements.txt`. To update:

```bash
source venv/bin/activate
pip install <package>
pip freeze > requirements.txt
```

## 🐛 Troubleshooting

See [DEVELOPMENT.md](./DEVELOPMENT.md#troubleshooting) for common issues and solutions.
