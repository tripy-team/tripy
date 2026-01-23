#!/bin/bash
# Test script to verify backend airport API is working

echo "Testing Backend Airport Autocomplete API..."
echo ""

# Test with common queries
echo "1. Testing with 'SEA' (Seattle):"
curl -s "http://localhost:8000/api/airports/autocomplete?q=SEA&limit=5" | jq '.' || curl -s "http://localhost:8000/api/airports/autocomplete?q=SEA&limit=5"

echo ""
echo "2. Testing with 'JFK' (New York):"
curl -s "http://localhost:8000/api/airports/autocomplete?q=JFK&limit=5" | jq '.' || curl -s "http://localhost:8000/api/airports/autocomplete?q=JFK&limit=5"

echo ""
echo "3. Testing with 'a' (single letter):"
curl -s "http://localhost:8000/api/airports/autocomplete?q=a&limit=5" | jq '.' || curl -s "http://localhost:8000/api/airports/autocomplete?q=a&limit=5"

echo ""
echo "Done! Check if airports array has results."
