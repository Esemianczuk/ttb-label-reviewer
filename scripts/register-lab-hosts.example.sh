#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COORDINATOR_URL="${TTB_WORKER_COORDINATOR:-http://127.0.0.1:8000}"
REMOTE_DIR="${TTB_REMOTE_DIR:-~/ttb-label-reviewer}"
HOSTS=(
  "eric@bigbertha.sherpa-map.internal"
  "eric@thevault.sherpa-map.internal"
  "mac"
)

cat <<EOF
TTB Label Reviewer lab host helper

This script only prints copyable commands. It does not SSH, install packages, or start workers for you.

1. Create a coordinator join token locally:

   curl -sS -X POST "$COORDINATOR_URL/api/cluster/join-token" \\
     -H 'Content-Type: application/json' \\
     -d '{"ttlSeconds":900}' | python -m json.tool

2. Copy the token value into:

   export TTB_WORKER_JOIN_TOKEN="<token from coordinator>"
   export TTB_WORKER_COORDINATOR="$COORDINATOR_URL"

EOF

for HOST in "${HOSTS[@]}"; do
  cat <<EOF
--- $HOST ---

Detect OS:
  ssh $HOST 'uname -a'

Sync repo:
  rsync -az --delete \\
    --exclude .git \\
    --exclude browser-demo/node_modules \\
    --exclude browser-demo/dist \\
    --exclude .venv \\
    --exclude .worker-cache \\
    --exclude data \\
    "$ROOT_DIR/" "$HOST:$REMOTE_DIR/"

Create Python environment and install worker/API dependencies:
  ssh $HOST 'cd $REMOTE_DIR && python3 -m venv .venv && . .venv/bin/activate && python -m pip install -U pip && python -m pip install -r requirements-dev.txt'

Start a worker:
  ssh $HOST 'cd $REMOTE_DIR && . .venv/bin/activate && TTB_WORKER_COORDINATOR="'"\$TTB_WORKER_COORDINATOR"'" TTB_WORKER_JOIN_TOKEN="'"\$TTB_WORKER_JOIN_TOKEN"'" ./scripts/dev-worker.sh --name "'"$(echo "$HOST" | tr '@/.' '____')"'"'

EOF
done
