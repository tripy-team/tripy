#!/usr/bin/env bash
set -euo pipefail
pip3 install -r requirements.txt
exec /bin/bash start.sh
