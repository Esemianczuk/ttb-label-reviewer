#!/usr/bin/env bash
set -euo pipefail

REPO="${TTB_GITHUB_REPO:-Esemianczuk/ttb-label-reviewer}"
BACKEND_URL="${TTB_PROD_BACKEND_URL:-https://demo.sherpa-map.com}"
REF="${TTB_GITHUB_REF:-main}"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI is not installed. Install gh, then rerun this script." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  cat >&2 <<'EOF'
GitHub CLI is installed but not authenticated.

Run this once, then rerun this script:

  gh auth login

Use an account with admin access to the repository. The token needs enough
permission to manage repository variables, workflows, and GitHub Pages.
EOF
  exit 1
fi

echo "Configuring hosted frontend for ${REPO}"
echo "Backend URL: ${BACKEND_URL}"

echo "Setting repository variable TTB_PROD_BACKEND_URL..."
gh variable set TTB_PROD_BACKEND_URL --repo "${REPO}" --body "${BACKEND_URL}"

echo "Checking GitHub Pages status..."
if gh api "repos/${REPO}/pages" >/dev/null 2>&1; then
  echo "GitHub Pages exists; ensuring workflow build mode..."
  if ! gh api -X PUT "repos/${REPO}/pages" -f build_type=workflow >/dev/null; then
    cat >&2 <<'EOF'
GitHub did not accept the Pages API update.

Open the repository in GitHub:
  Settings -> Pages -> Build and deployment -> Source -> GitHub Actions

Then rerun this script or trigger the Pages workflow manually.
EOF
    exit 1
  fi
else
  echo "GitHub Pages is not enabled; creating a workflow-based Pages site..."
  if ! gh api -X POST "repos/${REPO}/pages" -f build_type=workflow >/dev/null; then
    cat >&2 <<'EOF'
GitHub did not allow Pages to be enabled through the API.

Open the repository in GitHub:
  Settings -> Pages -> Build and deployment -> Source -> GitHub Actions

Then rerun this script or trigger the Pages workflow manually.
EOF
    exit 1
  fi
fi

echo "Triggering frontend deploy workflow..."
gh workflow run pages.yml --repo "${REPO}" --ref "${REF}"

cat <<EOF

GitHub hosting setup requested.

Watch the deploy:
  gh run list --repo ${REPO} --workflow pages.yml --limit 5
  gh run watch --repo ${REPO}

Expected frontend:
  https://esemianczuk.github.io/ttb-label-reviewer/

Expected backend:
  ${BACKEND_URL}
EOF
