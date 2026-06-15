# Docker Quick Start

Docker is the easiest repeatable setup for evaluator machines. It starts the backend-served console, FastAPI coordinator, seeded public COLA fixtures, and one PaddleOCR worker.

## One Command

```bash
./scripts/docker-demo.sh
```

Open:

```text
http://127.0.0.1:8000/
```

The launcher chooses the best available local path:

- Linux with working NVIDIA Docker GPU passthrough: CUDA PaddleOCR worker.
- Linux without Docker GPU passthrough: CPU PaddleOCR worker.
- macOS: API in Docker and native macOS PaddleOCR worker through `scripts/docker-mac-metal.sh`.

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
- NVIDIA Container Toolkit configured.
- Docker Compose v2 available.
- This command succeeds:

```bash
docker run --rm --gpus all --entrypoint nvidia-smi nvidia/cuda:12.6.3-cudnn-runtime-ubuntu22.04
```

The CUDA overlay builds `ttb-label-reviewer-worker-cuda:local` and registers the worker as `compose-paddleocr-cuda`.

## macOS

```bash
./scripts/docker-mac-metal.sh
```

This mode runs:

- Docker container: FastAPI, SQLite demo data, static console.
- Native macOS process: PaddleOCR worker.

Docker Desktop on macOS runs Linux containers and does not expose Apple Metal to the Linux worker container. Keeping the OCR worker native avoids that limitation and gives PaddleOCR the best available local runtime, with CPU fallback.

Requirements:

- Docker Desktop or Colima with Docker Compose v2.
- Python 3.10 or newer, with Python 3.11 or 3.12 preferred.

If the Mac only has Apple’s system Python 3.9, install a newer Python:

```bash
brew install python@3.12
```

Docker-only Mac diagnostic mode is available, but it is not the recommended evaluator path:

```bash
TTB_DOCKER_ACCELERATOR=container ./scripts/docker-demo.sh
```

## Ports And Resets

Use another port:

```bash
TTB_DOCKER_API_PORT=8010 ./scripts/docker-demo.sh
```

Reset container state and seeded demo data:

```bash
docker compose down -v
```

CUDA reset:

```bash
docker compose -f docker-compose.yml -f docker-compose.cuda.yml down -v
```

## Images

The default Compose files build local images:

```text
ttb-label-reviewer-api:local
ttb-label-reviewer-worker:local
ttb-label-reviewer-worker-cuda:local
```

Image sources:

```text
docker/api.Dockerfile
docker/worker.Dockerfile
docker/worker-cuda.Dockerfile
```

The repository is designed to run from source without relying on prebuilt images. If a repository owner wants prebuilt images, `.github/workflows/docker-images.yml` publishes these Dockerfiles to GitHub Container Registry on a tag or manual workflow run. Deployment-specific Compose files can then override the image names.

## Models And Caches

No custom model weights are required. The worker installs PaddleOCR and PaddlePaddle, then PaddleOCR downloads pretrained English OCR assets on first use.

Caches:

- `worker-model-cache`: Paddle/PaddleX model cache inside Docker.
- `worker-cache`: persistent worker secret and worker runtime cache.
- `api-data`: SQLite demo database and uploaded assets.

Optional custom PaddleOCR exports can be mounted through `./models`, but the default demo does not depend on them.

## Runtime Shape

```text
PaddleOCR full-image OCR -> conservative field alignment -> deterministic validators
```

Evidence crops are generated from aligned OCR token boxes. The deterministic validators remain the authority for pass/fail.

## Troubleshooting

- If Linux auto mode starts CPU on a GPU machine, run the `nvidia-smi` Docker command above.
- If Docker says the daemon is not reachable, start Docker Desktop or the Docker service and rerun the launcher.
- If first startup is slow, let PaddleOCR download and cache its pretrained models.
- If the worker cannot register, run `docker compose down -v` and restart.
- If macOS setup fails while installing PaddleOCR, install Python 3.11 or 3.12, remove `.venv`, and rerun `./scripts/docker-mac-metal.sh`.
