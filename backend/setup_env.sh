#!/bin/bash
# Setup script for backend .env file

echo "🔧 Setting up backend environment configuration..."
echo ""

cd "$(dirname "$0")"

# Check if .env already exists
if [ -f ".env" ]; then
    echo "⚠️  .env file already exists"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Keeping existing .env file"
        exit 0
    fi
fi

# Copy template
if [ -f "env_template.txt" ]; then
    cp env_template.txt .env
    echo "✅ Created .env file from template"
else
    # Create basic .env file
    cat > .env << 'EOF'
# REQUIRED - DynamoDB Table Names
USERS_TABLE=tripy-users
TRIPS_TABLE=tripy-trips
TRIP_MEMBERS_TABLE=tripy-trip-members
POINTS_TABLE=tripy-points
DESTINATIONS_TABLE=tripy-destinations
DESTINATION_VOTES_TABLE=tripy-destination-votes
ITINERARY_TABLE=tripy-itinerary

# REQUIRED FOR AUTH - AWS Cognito Configuration
USER_POOL_ID=
USER_POOL_CLIENT_ID=
AWS_REGION=us-west-2

# OPTIONAL - Analytics
ANALYTICS_FIREHOSE_STREAM=tripy-analytics
EOF
    echo "✅ Created .env file with required variables"
fi

echo ""
echo "📝 Next steps:"
echo ""
echo "1. Edit .env file and fill in your values:"
echo "   - USER_POOL_ID: Get from AWS Cognito Console → User Pool → User Pool ID"
echo "   - USER_POOL_CLIENT_ID: Get from AWS Cognito Console → User Pool → App clients"
echo ""
echo "2. If you don't have Cognito set up yet, you can leave them empty for now"
echo "   (but signup/login won't work until you configure Cognito)"
echo ""
echo "3. Verify your setup:"
echo "   python3 check_env.py"
echo ""
echo "4. Start the server:"
echo "   ./start_server.sh"
echo ""
