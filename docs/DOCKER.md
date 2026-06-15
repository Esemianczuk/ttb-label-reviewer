# Docker Quick Start

The Docker path is the easiest evaluator setup: one command starts the backend-served console, FastAPI coordinator, seeded public COLA fixtures, and one PaddleOCR worker.

## Recommended Command

```bash
./scripts/docker-demo.sh
```

Open:

```text
http://127.0.0.1:8000/
```

On Linux, the launcher probes Docker GPU passthrough. If NVIDIA GPU access works, it starts the CUDA worker overlay. Otherwise it starts the CPU PaddleOCR worker. In both cases the reviewer sees the same product.

## Linux CPU

```bash
TTB_DOCKER_ACCELERATOR=cpu ./scripts/docker-demo.sh
```

Equivalent direct command:

```bash
docker compose up --build
```

## Linux CUDA

```bash
TTB_DOCKER_ACCELERATOR=cuda ./scripts/docker-demo.sh
```

Equivalent direct command:

```bash
docker compose -f docker-compose.yml -f docker-compose.cuda.yml up --build
```

Requirements:

- NVIDIA driver installed on the host.
- Docker GPU passthrough working for `docker run --gpus all ... nvidia-smi`.

The CUDA overlay builds `ttb-label-reviewer-worker-cuda:local` and registers the worker as `compose-paddleocr-cuda`.

## macOS With Metal

```bash
./scripts/docker-mac-metal.sh
```

This mode intentionally runs the API in Docker and the worker as a native macOS process:

- Docker container: FastAPI, SQLite demo data, static console.
- Native macOS worker: PaddleOCR runtime.
- Accelerator behavior: Linux CUDA is used when Docker GPU passthrough is available; macOS worker falls back to CPU when no compatible PaddleOCR accelerator is available.

Why hybrid? Docker Desktop on macOS runs Linux containers. Keeping the worker native avoids container-specific OCR limitations and keeps setup simple.

Requirements:

- Docker Desktop or Colima with Docker Compose v2.
- Python 3.10 or newer.

If the Mac only has Apple’s system Python 3.9, install a newer Python first:

```bash
brew install python@3.12
```

Docker-only Mac diagnostic mode is available, but it does not expose Metal to the worker and is not the recommended Mac evaluator path:

```bash
TTB_DOCKER_ACCELERATOR=container ./scripts/docker-demo.sh
```

## Runtime Shape

The compose stack uses:

- `api`: FastAPI coordinator serving `apps/console/dist`.
- `worker`: local PaddleOCR worker.
- Named volumes for API data, worker secrets, and model caches.
- Read-only bind mount for `./models` so optional local OCR artifacts can be used without committing model weights.

The backend path is:

```text
PaddleOCR full-image OCR -> conservative field alignment -> deterministic validators
```

Evidence crops are generated from aligned OCR token boxes. The deterministic validators remain the authority for pass/fail.

## Reset

From the UI, use **Reset Demo**.

For a full container and volume reset:

```bash
docker compose down -v
```

For CUDA overlay cleanup:

```bash
docker compose -f docker-compose.yml -f docker-compose.cuda.yml down -v
```

## Troubleshooting

- If Linux auto mode starts CPU on a GPU machine, run `docker run --rm --gpus all --entrypoint nvidia-smi nvidia/cuda:12.6.3-cudnn-runtime-ubuntu22.04`.
- If that command fails, install or repair Docker/NVIDIA Container Toolkit integration.
- If the worker cannot register, clear the worker cache volume or run `docker compose down -v`.
- If first startup is slow, let PaddleOCR download/cache its pretrained models; later runs reuse Docker volumes.
- If macOS Metal mode exits immediately, install Docker Compose v2 and Python 3.10+.
