#!/bin/bash
#
# Build a clean, Linux-compatible Lambda deployment package for the FastAPI backend.
#
# Why this exists:
#   - The backend has native deps (cryptography, pydantic-core, Pillow, pulp) whose
#     compiled wheels are platform-specific. Installing them on macOS produces Mac
#     binaries that crash on Lambda (Linux x86_64). We download manylinux wheels instead.
#   - The raw backend/ folder contains virtualenvs (venv/, .venv/, tripyvenv/) and tests
#     that must NOT ship in the Lambda zip. We stage a clean copy.
#
# Output: backend/.lambda-build/  (consumed by infra/lib/apiStackLambda.ts)
#
# No Docker required. If a dependency ever lacks a manylinux wheel, install Docker
# Desktop and switch the CDK asset to standard PythonFunction bundling instead.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$SCRIPT_DIR/backend"
STAGE="$BACKEND/.lambda-build"

PY_VERSION="3.12"   # must match lambda.Runtime.PYTHON_3_12 in the CDK
PLATFORM="manylinux2014_x86_64"

echo "==> Cleaning staging dir: $STAGE"
rm -rf "$STAGE"
mkdir -p "$STAGE"

echo "==> Copying application code (excluding venvs, tests, caches)"
rsync -a \
  --exclude '.lambda-build' \
  --exclude '.venv' --exclude 'venv' --exclude 'tripyvenv' --exclude 'tripyvenv/' \
  --exclude '__pycache__' --exclude '*.pyc' \
  --exclude '.pytest_cache' \
  --exclude 'tests' --exclude 'test_*.py' \
  --exclude '.env' \
  --exclude 'node_modules' \
  "$BACKEND/" "$STAGE/"

echo "==> Downloading Linux ($PLATFORM, cp$PY_VERSION) wheels into the package"
python3 -m pip install \
  --target "$STAGE" \
  --platform "$PLATFORM" \
  --implementation cp \
  --python-version "$PY_VERSION" \
  --only-binary=:all: \
  --upgrade \
  -r "$BACKEND/requirements.txt"

echo "==> Stripping bundle bloat (saves zip space / cold start)"
# NOTE: do NOT delete *.dist-info — packages like email-validator read their own
# version via importlib.metadata at import time and fail without it.
find "$STAGE" -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
find "$STAGE" -type d -name 'tests' -prune -exec rm -rf {} + 2>/dev/null || true

echo "==> Done. Package staged at: $STAGE"
du -sh "$STAGE" 2>/dev/null || true
