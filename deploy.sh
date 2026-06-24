#!/bin/bash
#
# Deploy Tripy backend on AWS — FREE-TIER path.
#
# This deploys the serverless (Lambda + API Gateway) backend plus Cognito and
# DynamoDB. It intentionally does NOT deploy TripyRdsStack (Aurora Serverless v2,
# ~$43/mo even when idle). The frontend's Postgres should point at a free Neon DB
# via the DATABASE_URL env var in Amplify.
#
# Frontend deploys automatically via Amplify on git push (see amplify.yml).
#
# Usage:
#   ./deploy.sh           Bundle deps + deploy free-tier stacks
#   ./deploy.sh diff      Show what would change (dry run)
#   ./deploy.sh full      Deploy ALL stacks incl. Aurora (PAID — only if you need it)
#
# Override the allowed CORS origins:
#   CORS_ORIGINS="https://traveltripy.com,https://www.traveltripy.com" ./deploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ACTION="${1:-deploy}"

# Free-tier stacks only (no Aurora). USE_LAMBDA=true selects apiStackLambda.ts.
FREE_STACKS="TripyAuthStack TripyDbStack TripyApiStack"
export USE_LAMBDA=true
export CORS_ORIGINS="${CORS_ORIGINS:-https://traveltripy.com,https://www.traveltripy.com}"

case "$ACTION" in
  deploy)
    echo "==> Building Linux Lambda package..."
    ./build-lambda.sh

    echo "==> Deploying free-tier stacks: $FREE_STACKS"
    echo "    (Aurora/TripyRdsStack intentionally skipped — use Neon free Postgres)"
    cd infra
    npx cdk deploy $FREE_STACKS --require-approval never

    echo ""
    echo "CDK deploy complete."
    echo "Next: copy the API_URL output into Amplify env var NEXT_PUBLIC_BACKEND_URL."
    echo "Frontend deploys automatically when you push to origin (main → prod, dev → dev)."
    ;;
  diff)
    echo "==> Building Linux Lambda package (needed for an accurate diff)..."
    ./build-lambda.sh
    cd infra
    npx cdk diff $FREE_STACKS
    ;;
  full)
    echo "WARNING: deploying ALL stacks including Aurora Serverless (PAID ~\$43/mo)."
    ./build-lambda.sh
    cd infra
    npx cdk deploy --all --require-approval never
    ;;
  *)
    echo "Usage: ./deploy.sh [deploy|diff|full]"
    exit 1
    ;;
esac
