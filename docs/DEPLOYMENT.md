# Deployment

This project has two deployment targets:

- **Evaluator local setup**: everything runs on the reviewer machine using localhost.
- **Hosted demo**: the static console is deployed to GitHub Pages and calls Eric's workstation-backed API at `https://demo.sherpa-map.com`.

The hosted API still runs locally on the workstation with the RTX 4090 worker. The public URL must terminate HTTPS before reaching the local API because GitHub Pages is HTTPS and browsers block HTTPS pages from calling plain HTTP APIs.

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

The evaluator path still builds images locally by default, so GHCR is an optimization rather than a dependency.

## GitHub Pages Frontend

`.github/workflows/pages.yml` deploys `apps/console/dist` on a published release or manual run.

Build-time environment:

```text
VITE_TTB_BACKEND_URL=https://demo.sherpa-map.com
VITE_BASE_PATH=./
```

The expected GitHub Pages URL is:

```text
https://esemianczuk.github.io/ttb-label-reviewer/
```

One-time repository setup, if Pages is not already enabled:

1. Open GitHub repository settings.
2. Go to **Pages**.
3. Set **Build and deployment** source to **GitHub Actions**.
4. Save.

After `gh auth login`, this can also be attempted from the repo:

```bash
./scripts/configure-github-hosting.sh
```

The script sets `TTB_PROD_BACKEND_URL`, enables workflow-based Pages when the
GitHub API allows it, and triggers the Pages workflow. If GitHub rejects the
Pages API update, use the UI once:

1. Open GitHub repository settings.
2. Go to **Pages**.
3. Set **Build and deployment** source to **GitHub Actions**.
4. Save.

Optional repository variable:

```bash
gh variable set TTB_PROD_BACKEND_URL --body "https://demo.sherpa-map.com"
```

The workflow already defaults to that URL when the variable is absent.

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
TTB_API_CORS_ORIGINS=https://esemianczuk.github.io,https://demo.sherpa-map.com,http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:5174,http://localhost:5174
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

After the runner is registered, the workflow can deploy the local backend from GitHub. It is not wired to every release by default so releases do not hang when a self-hosted runner has not been configured yet.

## Public DNS And HTTPS

Current desired API URL:

```text
https://demo.sherpa-map.com
```

Recommended public path:

```text
GitHub Pages frontend
  -> https://demo.sherpa-map.com/api/*
  -> Cloudflare Tunnel or HTTPS reverse proxy
  -> workstation http://127.0.0.1:8000
```

Cloudflare or the router must provide an HTTPS route. A plain `http://demo.sherpa-map.com:8000` API is not suitable for the Pages frontend because browsers block mixed active content.

Good verification:

```bash
curl -i http://127.0.0.1:8000/api/health
curl -i http://10.10.30.242:8000/api/health
curl -i https://demo.sherpa-map.com/api/health
```

Expected hosted API result:

```json
{"ok": true, "database": "sqlite", "staticReady": true}
```

If `https://demo.sherpa-map.com/api/health` returns Cloudflare `502`, Cloudflare can see the DNS record but cannot reach the origin. Fix that with one of:

- Cloudflare Tunnel from `demo.sherpa-map.com` to `http://127.0.0.1:8000`.
- Router/NAT plus a TLS reverse proxy on the workstation.
- Cloudflare DNS-only plus a valid HTTPS reverse proxy reachable on port 443.

If `OPTIONS https://demo.sherpa-map.com/api/...` returns Cloudflare `204`
without `access-control-allow-origin`, the hosted frontend will fail before it
reaches the API. Fix the Cloudflare rule/tunnel/proxy so preflight requests are
forwarded to the origin, or make the Cloudflare OPTIONS response include:

```text
Access-Control-Allow-Origin: https://esemianczuk.github.io
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type, X-Session-Id, X-Join-Token
```

Do not inject a second wildcard `Access-Control-Allow-Origin: *` on proxied API
responses. The FastAPI origin already returns the exact allow-origin header from
`TTB_API_CORS_ORIGINS`.

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
