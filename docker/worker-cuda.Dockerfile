# syntax=docker/dockerfile:1.7

FROM nvidia/cuda:12.6.3-cudnn-runtime-ubuntu22.04

ARG PADDLEPADDLE_VERSION=3.2.2
ARG PADDLE_GPU_INDEX=https://www.paddlepaddle.org.cn/packages/stable/cu126/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    TTB_WORKER_ENABLE_HEAVY_OCR=1 \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      python3 \
      python3-pip \
      python3-venv \
      libgl1 \
      libglib2.0-0 \
      libgomp1 \
      libjpeg-turbo8 \
      libpng16-16 \
      libsm6 \
      libxext6 \
      libxrender1 \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m pip install --upgrade pip setuptools wheel

WORKDIR /app

RUN python3 -m pip install --no-cache-dir \
      "beautifulsoup4>=4.12,<5" \
      "requests>=2.31,<3" \
      "httpx>=0.27,<1" \
      "Pillow>=10,<12" \
      "paddleocr==3.2.0" \
      "paddlex==3.2.0" \
    && python3 -m pip install --no-cache-dir "paddlepaddle-gpu==${PADDLEPADDLE_VERSION}" -i "${PADDLE_GPU_INDEX}"

COPY pyproject.toml README.md ./
COPY ttb_validation ./ttb_validation
COPY tools ./tools
COPY apps/worker ./apps/worker

RUN python3 -m pip install --no-cache-dir --no-deps -e . -e ./apps/worker

COPY docker/worker-entrypoint.sh /usr/local/bin/ttb-worker-entrypoint
RUN chmod +x /usr/local/bin/ttb-worker-entrypoint

VOLUME ["/worker-cache"]

ENTRYPOINT ["ttb-worker-entrypoint"]
