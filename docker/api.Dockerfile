# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS console-build
WORKDIR /app

COPY apps/console/package.json apps/console/package-lock.json ./apps/console/
COPY browser-demo/package.json browser-demo/package-lock.json ./browser-demo/
RUN npm ci --prefix apps/console \
    && npm ci --prefix browser-demo

COPY apps/console ./apps/console
COPY browser-demo/src ./browser-demo/src
COPY browser-demo/public ./browser-demo/public
COPY fixtures/public-cola-registry ./fixtures/public-cola-registry
COPY packages ./packages

ARG VITE_TTB_BACKEND_URL=http://127.0.0.1:8000
ARG VITE_BASE_PATH=/
ENV VITE_TTB_BACKEND_URL=${VITE_TTB_BACKEND_URL}
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
RUN npm --prefix apps/console run build

FROM python:3.10-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      libjpeg62-turbo \
      libpng16-16 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml README.md ./
COPY ttb_validation ./ttb_validation
COPY tools ./tools
COPY apps/api ./apps/api
COPY scripts/seed-backend-demo-fixtures.py ./scripts/seed-backend-demo-fixtures.py
COPY fixtures/public-cola-registry ./fixtures/public-cola-registry
COPY --from=console-build /app/apps/console/dist ./apps/console/dist
COPY docker/api-entrypoint.sh /usr/local/bin/ttb-api-entrypoint

RUN chmod +x /usr/local/bin/ttb-api-entrypoint \
    && python -m pip install --upgrade pip setuptools wheel \
    && python -m pip install --no-cache-dir -e . -e ./apps/api

EXPOSE 8000

ENTRYPOINT ["ttb-api-entrypoint"]
CMD ["python", "-m", "uvicorn", "apps.api.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
