#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CONFIG_DIR="${TTB_PRODUCTION_CONFIG_DIR:-$HOME/.config/ttb-label-reviewer}"
ENV_FILE="${TTB_PRODUCTION_ENV_FILE:-$CONFIG_DIR/compose-production.env}"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/ttb-label-reviewer.service"
SERVICE_NAME="ttb-label-reviewer.service"

mkdir -p "$CONFIG_DIR" "$UNIT_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  SECRET="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
)"
  sed "s#TTB_DEMO_TOKEN_SECRET=replace-me-with-a-generated-secret#TTB_DEMO_TOKEN_SECRET=$SECRET#" \
    .env.production.example >"$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Created production environment file at $ENV_FILE"
else
  echo "Reusing existing production environment file at $ENV_FILE"
fi

cat >"$UNIT_FILE" <<EOF
[Unit]
Description=TTB Label Reviewer production backend
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$ROOT_DIR
Environment=TTB_PRODUCTION_ENV_FILE=$ENV_FILE
ExecStart=$ROOT_DIR/scripts/deploy-production-compose.sh
ExecStop=/usr/bin/docker compose --env-file $ENV_FILE -f $ROOT_DIR/docker-compose.yml -f $ROOT_DIR/docker-compose.cuda.yml down
RemainAfterExit=yes
TimeoutStartSec=0
TimeoutStopSec=120

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE_NAME"

if command -v loginctl >/dev/null 2>&1; then
  LINGER="$(loginctl show-user "$USER" -p Linger 2>/dev/null || true)"
  if [[ "$LINGER" != "Linger=yes" ]]; then
    echo
    echo "User lingering is not enabled. To start this service before login, run:"
    echo "  sudo loginctl enable-linger $USER"
  fi
fi

cat <<EOF

Installed $SERVICE_NAME.

Useful commands:
  systemctl --user status $SERVICE_NAME
  journalctl --user -u $SERVICE_NAME -f
  docker compose --env-file $ENV_FILE -f docker-compose.yml -f docker-compose.cuda.yml logs -f

Health checks:
  curl http://127.0.0.1:8000/api/health
  curl http://10.10.30.242:8000/api/health
EOF
