#!/usr/bin/env bash
# Deploy backend/cactus_server/ to the EC2 Cactus host and restart the systemd service.
#
# Usage:
#   EC2_HOST=44.215.37.26 EC2_KEY=~/Downloads/eric-keypair.pem ./scripts/deploy-cactus-ec2.sh
#
# Defaults target the current Tripy prototype instance. Override with env vars above.

set -euo pipefail

EC2_HOST="${EC2_HOST:-44.215.37.26}"
EC2_USER="${EC2_USER:-ubuntu}"
EC2_KEY="${EC2_KEY:-$HOME/Downloads/eric-keypair.pem}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/tripy/backend/cactus_server}"
SERVICE_NAME="${SERVICE_NAME:-cactus-server}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_SRC="$REPO_ROOT/backend/cactus_server/"
UNIT_SRC="$REPO_ROOT/scripts/cactus-server.service"

SSH_OPTS=(-i "$EC2_KEY" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)

echo "→ Syncing cactus_server/ to $EC2_USER@$EC2_HOST:$REMOTE_DIR"
rsync -avz --delete --exclude '__pycache__' --exclude '*.pyc' --exclude '.env' \
  -e "ssh ${SSH_OPTS[*]}" \
  "$LOCAL_SRC" "$EC2_USER@$EC2_HOST:$REMOTE_DIR/"

echo "→ Installing systemd unit"
scp "${SSH_OPTS[@]}" "$UNIT_SRC" "$EC2_USER@$EC2_HOST:/tmp/${SERVICE_NAME}.service"
ssh "${SSH_OPTS[@]}" "$EC2_USER@$EC2_HOST" "
  set -e
  sudo mv /tmp/${SERVICE_NAME}.service /etc/systemd/system/${SERVICE_NAME}.service
  sudo systemctl daemon-reload
  sudo systemctl enable ${SERVICE_NAME}
  sudo systemctl restart ${SERVICE_NAME}
  sleep 2
  sudo systemctl --no-pager status ${SERVICE_NAME} | head -15
"

echo "→ Waiting for /health on port 8765"
for i in {1..30}; do
  if curl -sfm 2 "http://$EC2_HOST:8765/health" >/dev/null; then
    echo "✓ Healthy: $(curl -sm 2 "http://$EC2_HOST:8765/health")"
    exit 0
  fi
  sleep 2
done

echo "✗ /health did not respond in time. Last 40 log lines:" >&2
ssh "${SSH_OPTS[@]}" "$EC2_USER@$EC2_HOST" "sudo journalctl -u ${SERVICE_NAME} -n 40 --no-pager" >&2
exit 1
