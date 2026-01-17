#!/bin/bash
# Helper script to guide you through getting Cognito credentials

echo "🔍 AWS Cognito Credentials Guide"
echo "================================"
echo ""
echo "This script will help you find your Cognito credentials."
echo ""
echo "📋 Step-by-Step Instructions:"
echo ""
echo "1️⃣  Open AWS Console:"
echo "   https://console.aws.amazon.com/cognito/home"
echo ""
echo "2️⃣  If you DON'T have a User Pool yet:"
echo "   → Click 'Create user pool'"
echo "   → Follow the wizard (see AWS_COGNITO_SETUP.md for details)"
echo "   → Important: Uncheck 'Generate client secret' in app client setup"
echo ""
echo "3️⃣  If you ALREADY have a User Pool:"
echo "   → Click on your User Pool name"
echo ""
echo "4️⃣  Get USER_POOL_ID:"
echo "   → Look at the top of the page"
echo "   → Copy the 'User pool ID' (format: us-west-2_XXXXXXXXX)"
echo ""
echo "5️⃣  Get USER_POOL_CLIENT_ID:"
echo "   → Click 'App integration' tab (left sidebar)"
echo "   → Scroll to 'App client list'"
echo "   → Click on your app client name"
echo "   → Copy the 'Client ID' value"
echo ""
echo "6️⃣  Get AWS_REGION:"
echo "   → Note the region shown in the URL or top of page"
echo "   → Common regions: us-west-2, us-east-1, eu-west-1"
echo ""
echo "7️⃣  Add to backend/.env file:"
echo ""
echo "   USER_POOL_ID=<your-pool-id>"
echo "   USER_POOL_CLIENT_ID=<your-client-id>"
echo "   AWS_REGION=<your-region>"
echo ""
echo "8️⃣  Verify your configuration:"
echo "   cd backend && python3 check_env.py"
echo ""
echo ""
read -p "Press Enter when you've added the credentials to backend/.env..."

# Check if .env exists
if [ ! -f ".env" ]; then
    echo ""
    echo "❌ .env file not found!"
    echo "   Run: ./setup_env.sh first"
    exit 1
fi

# Check if credentials are set (simple check)
cd "$(dirname "$0")"
if grep -q "USER_POOL_ID=$" .env 2>/dev/null || grep -q "^USER_POOL_ID=$" .env 2>/dev/null; then
    echo ""
    echo "⚠️  USER_POOL_ID is still empty in .env"
    echo "   Please add your Cognito User Pool ID"
    exit 1
fi

if grep -q "USER_POOL_CLIENT_ID=$" .env 2>/dev/null || grep -q "^USER_POOL_CLIENT_ID=$" .env 2>/dev/null; then
    echo ""
    echo "⚠️  USER_POOL_CLIENT_ID is still empty in .env"
    echo "   Please add your Cognito Client ID"
    exit 1
fi

echo ""
echo "✅ Credentials found in .env file!"
echo ""
echo "Now verify your configuration:"
echo "   python3 check_env.py"
