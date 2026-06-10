from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .agent import WorkerAgent, WorkerConfig
from .capabilities import probe_capabilities
from .engines import inspect_engines
from .transport.mdns import discover_coordinators


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m ttb_worker", description="Run a local TTB Label Reviewer worker agent.")
    parser.add_argument("--coordinator", default="http://127.0.0.1:8000", help="Coordinator base URL.")
    parser.add_argument("--discover", action="store_true", help="Discover a LAN coordinator with optional mDNS/zeroconf.")
    parser.add_argument("--join-token", default=None, help="Short-lived coordinator join token for first registration.")
    parser.add_argument("--worker-secret", default=None, help="Persistent worker secret. Prefer --secret-file for normal use.")
    parser.add_argument("--secret-file", default=None, help="Path for storing the persistent worker secret.")
    parser.add_argument("--name", default="auto", help="Worker id, or auto for a generated id.")
    parser.add_argument("--concurrency", default="auto", help="Maximum concurrent jobs, or auto.")
    parser.add_argument("--engines", default="auto", help="Comma-separated OCR engines, or auto.")
    parser.add_argument("--data-dir", default="./.worker-cache", help="Worker cache and calibration directory.")
    parser.add_argument("--session-id", default=None, help="Optional session id to restrict claimed jobs.")
    parser.add_argument("--poll-interval", type=float, default=1.0, help="Seconds to wait when no job is available.")
    parser.add_argument("--heartbeat-interval", type=float, default=5.0, help="Seconds between heartbeat updates.")
    parser.add_argument("--max-jobs", type=int, default=None, help="Stop after this many completed jobs.")
    parser.add_argument("--once", action="store_true", help="Register, attempt one claim, then exit.")
    parser.add_argument("--recalibrate", action="store_true", help="Ignore cached calibration and measure engines again.")
    parser.add_argument("--probe", action="store_true", help="Print capability and engine probe JSON, then exit.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    data_dir = Path(args.data_dir).resolve()
    coordinator = args.coordinator
    if args.discover:
        discovered = discover_coordinators()
        if not discovered:
            print(json.dumps({"discovered": False, "message": "No mDNS coordinator found; use --coordinator and --join-token."}))
            return 2
        coordinator = discovered[0].url

    if args.probe:
        capabilities = probe_capabilities(coordinator, data_dir)
        capabilities["engines"] = inspect_engines(args.engines, capabilities)
        print(json.dumps(capabilities, indent=2, sort_keys=True))
        return 0

    config = WorkerConfig(
        coordinator=coordinator,
        name=args.name,
        concurrency=args.concurrency,
        engines=args.engines,
        data_dir=data_dir,
        session_id=args.session_id,
        join_token=args.join_token,
        worker_secret=args.worker_secret,
        secret_file=Path(args.secret_file).resolve() if args.secret_file else data_dir / "worker-secret.txt",
        poll_interval_seconds=args.poll_interval,
        heartbeat_interval_seconds=args.heartbeat_interval,
        recalibrate=args.recalibrate,
    )
    agent = WorkerAgent(config)
    try:
        if args.once:
            processed = agent.run_once()
            print(json.dumps({"workerId": agent.worker_id, "processedJob": processed}, sort_keys=True))
            return 0
        agent.run_forever(max_jobs=args.max_jobs)
        print(json.dumps({"workerId": agent.worker_id, "stopped": True}, sort_keys=True))
        return 0
    except KeyboardInterrupt:
        print(json.dumps({"workerId": agent.worker_id, "stopped": "keyboard_interrupt"}, sort_keys=True))
        return 130
    finally:
        agent.close()


if __name__ == "__main__":
    sys.exit(main())
