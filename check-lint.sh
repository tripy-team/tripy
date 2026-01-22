#!/bin/bash

# Script to check ESLint errors in the frontend
# Usage: ./check-lint.sh

set -e

echo "🔍 Checking ESLint errors..."
echo ""

cd frontend

# Run ESLint
npm run lint

echo ""
echo "✅ ESLint check completed!"
