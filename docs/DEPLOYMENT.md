# Deployment

This project has two deployment targets:

- **Evaluator local setup**: everything runs on the reviewer machine using localhost.
- **Hosted demo**: the FastAPI backend serves both the console and `/api/*` from `https://demo.sherpa-map.com`.

The canonical hosted reviewer entry point is:

```text
https://demo.sherpa-map.com/ttb-review-demo.html
```

That URL opens the reviewer workbench, selects the next unclassified demo packet,
and keeps reviewer auto-run enabled for the next application.

## CI

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, and manual dispatch:

- Python environment check
- Python tests
- Browser fallback tests
- Console tests
- Browser fallback build
- Console build
- Docker API build smoke
- Docker CPU worker build smoke

Slow live OCR and Playwright E2E remain opt-in local checks.

## Docker Images

`.github/workflows/docker-images.yml` publishes images to GitHub Container Registry on a published release, version tag, or manual run:

- `ghcr.io/esemianczuk/ttb-label-reviewer-api`
- `ghcr.io/esemianczuk/ttb-label-reviewer-worker`
- `ghcr.io/esemianczuk/ttb-label-reviewer-worker-cuda`

The evaluator path builds images locally by default, so GHCR is an optimization rather than a dependency.

## Hosted Demo

The hosted demo is a same-origin deployment:

```text
Browser
  -> https://demo.sherpa-map.com/ttb-review-demo.html
  -> https://demo.sherpa-map.com/api/*
  -> workstation FastAPI + PaddleOCR worker
```

Using one origin avoids a separate frontend host, mixed-content failures, and
cross-origin preflight fragility. The backend container builds and serves the
console from `apps/console/dist`.

Good verification:

```bash
curl -i https://demo.sherpa-map.com/ttb-review-demo.html
curl -i https://demo.sherpa-map.com/api/health
```

Expected API result:

```json
{"ok": true, "database": "sqlite", "staticReady": true}
```

If `https://demo.sherpa-map.com/api/health` returns a Cloudflare `502`,
Cloudflare can see the DNS record but cannot reach the origin. Fix that with one of:

- Cloudflare Tunnel from `demo.sherpa-map.com` to `http://127.0.0.1:8000`.
- Router/NAT plus a TLS reverse proxy on the workstation.
- Cloudflare DNS-only plus a valid HTTPS reverse proxy reachable on port 443.

## Workstation Backend Service

The hosted backend is a Docker Compose service on the workstation:

```bash
./scripts/install-production-compose-service.sh
```

The installer creates:

```text
~/.config/ttb-label-reviewer/compose-production.env
~/.config/systemd/user/ttb-label-reviewer.service
```

The service runs:

```text
docker-compose.yml + docker-compose.cuda.yml
```

Production defaults:

```text
TTB_DOCKER_BIND_IP=0.0.0.0
TTB_DOCKER_API_PORT=8000
TTB_DOCKER_ACCELERATOR=cuda
TTB_API_LAN_MODE=1
TTB_API_CORS_ORIGINS=https://demo.sherpa-map.com,http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:5174,http://localhost:5174
VITE_TTB_BACKEND_URL=https://demo.sherpa-map.com
```

Useful commands:

```bash
systemctl --user status ttb-label-reviewer.service
journalctl --user -u ttb-label-reviewer.service -f
docker compose --env-file ~/.config/ttb-label-reviewer/compose-production.env -f docker-compose.yml -f docker-compose.cuda.yml logs -f
```

Redeploy after a local pull:

```bash
git pull --ff-only
./scripts/deploy-production-compose.sh
```

## Optional Local Backend Deploy Workflow

`.github/workflows/deploy-local-backend.yml` is manual dispatch only. It expects a self-hosted GitHub Actions runner on the workstation with these labels:

```text
self-hosted
linux
ttb-demo
```

After the runner is registered, the workflow can deploy the local backend from
GitHub. It is not wired to every release by default so releases do not hang when
a self-hosted runner has not been configured yet.

## Evaluator Local Behavior

Fresh clones do not call `demo.sherpa-map.com`.

Default local commands still use localhost:

```bash
./scripts/smart-demo.sh
./scripts/docker-demo.sh
```

Those build the console with:

```text
VITE_TTB_BACKEND_URL=http://127.0.0.1:8000
```

If the backend is absent, the console falls back to the packaged browser OCR path.
