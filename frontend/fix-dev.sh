#!/bin/bash
# Fix npm run dev permission issues

echo "=== Fixing npm run dev issues ==="
echo ""

cd "$(dirname "$0")"

# Step 1: Check if we need to fix permissions
echo "Step 1: Checking node_modules permissions..."
if [ -d "node_modules" ]; then
    echo "Found node_modules directory"
    # Try to fix permissions
    echo "Attempting to fix permissions..."
    sudo chmod -R u+w node_modules 2>/dev/null || echo "Note: May need to run manually with sudo"
else
    echo "No node_modules directory found"
fi

# Step 2: Remove node_modules if permissions allow
echo ""
echo "Step 2: Cleaning up node_modules..."
if [ -d "node_modules" ]; then
    rm -rf node_modules || {
        echo "WARNING: Could not delete node_modules automatically"
        echo "Please run manually: sudo rm -rf node_modules"
    }
fi

# Step 3: Remove package-lock.json
echo ""
echo "Step 3: Cleaning package-lock.json..."
rm -f package-lock.json

# Step 4: Clear npm cache
echo ""
echo "Step 4: Clearing npm cache..."
npm cache clean --force

# Step 5: Reinstall dependencies
echo ""
echo "Step 5: Reinstalling dependencies..."
npm install

echo ""
echo "=== Done! ==="
echo "Try running: npm run dev"
