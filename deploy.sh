#!/bin/bash
#
# Deploy Tripy CDK infrastructure.
#
# Both prod and dev App Runner backends share the same AWS account and
# infrastructure (Cognito, DynamoDB, etc.).  Branch-based switching only
# affects the frontend (handled automatically by amplify.yml).
#
# Usage:
#   ./deploy.sh          Deploy CDK stacks
#   ./deploy.sh diff     Show what would change (dry run)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ACTION="${1:-deploy}"

case "$ACTION" in
  deploy)
    echo "Deploying CDK stacks..."
    cd infra
    npx cdk deploy --all --require-approval never
    echo ""
    echo "CDK deploy complete."
    echo "Frontend deploys automatically when you push to origin (main → prod, dev → dev)."
    ;;
  diff)
    echo "Showing CDK diff..."
    cd infra
    npx cdk diff
    ;;
  *)
    echo "Usage: ./deploy.sh [deploy|diff]"
    exit 1
    ;;
esac
