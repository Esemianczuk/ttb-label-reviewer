# syntax=docker/dockerfile:1.7

FROM python:3.10-slim-bookworm

ARG PADDLEPADDLE_PACKAGE=paddlepaddle==3.2.2
ARG TORCH_CPU_PACKAGE=torch==2.4.1

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    TTB_WORKER_ENABLE_HEAVY_OCR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      libgl1 \
      libglib2.0-0 \
      libgomp1 \
      libjpeg62-turbo \
      libpng16-16 \
      libsm6 \
      libxext6 \
      libxrender1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN python -m pip install --upgrade pip setuptools wheel \
    && python -m pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu "${TORCH_CPU_PACKAGE}" \
    && python -m pip install --no-cache-dir \
      "beautifulsoup4>=4.12,<5" \
      "requests>=2.31,<3" \
      "httpx>=0.27,<1" \
      "Pillow>=10,<12" \
      "paddleocr==3.2.0" \
      "paddlex==3.2.0" \
      "transformers>=4.40,<6" \
    && python -m pip install --no-cache-dir "${PADDLEPADDLE_PACKAGE}"

COPY pyproject.toml README.md ./
COPY ttb_validation ./ttb_validation
COPY tools ./tools
COPY apps/worker ./apps/worker

RUN python -m pip install --no-cache-dir --no-deps -e . -e ./apps/worker

COPY docker/worker-entrypoint.sh /usr/local/bin/ttb-worker-entrypoint
RUN chmod +x /usr/local/bin/ttb-worker-entrypoint

VOLUME ["/worker-cache"]

ENTRYPOINT ["ttb-worker-entrypoint"]
