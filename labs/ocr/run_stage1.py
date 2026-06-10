#!/usr/bin/env python3
from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
import platform
import sys
import time
import traceback

import torch

from ocr_lab.dataset import load_cases
from ocr_lab.engines import resolve_engines
from ocr_lab.metrics import score_fields
from ocr_lab.reporting import write_json, write_summary


def repo_root_from_script() -> Path:
    return Path(__file__).resolve().parents[2]


def environment() -> dict[str, str]:
    env = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "torch": torch.__version__,
        "cuda_available": str(torch.cuda.is_available()),
    }
    if torch.cuda.is_available():
        env["cuda_device"] = torch.cuda.get_device_name(0)
    return env


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark local OCR engines for stage-one label extraction.")
    parser.add_argument("--engines", default="easyocr,doctr,trocr,tesseract-cli", help="Comma-separated engines.")
    parser.add_argument("--case", dest="case_id", default="", help="Run only one case id, for example real-tequila.")
    parser.add_argument("--synthetic-only", action="store_true", help="Skip real local photos and use synthetic packets only.")
    parser.add_argument("--real-only", action="store_true", help="Skip synthetic packets and use real local photos only.")
    parser.add_argument("--limit-cases", type=int, default=0, help="Limit number of cases after filtering.")
    parser.add_argument("--variant-set", choices=["minimal", "core", "wide"], default="core")
    parser.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    parser.add_argument("--out-dir", default="", help="Override run output directory.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = repo_root_from_script()
    include_synthetic = not args.real_only
    include_real = not args.synthetic_only
    cases = load_cases(repo_root, include_synthetic=include_synthetic, include_real=include_real)
    if args.case_id:
        cases = [case for case in cases if case.case_id == args.case_id]
    if args.limit_cases:
        cases = cases[: args.limit_cases]
    if not cases:
        print("No cases selected.", file=sys.stderr)
        return 2

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    out_dir = Path(args.out_dir) if args.out_dir else repo_root / "labs" / "ocr" / "runs" / run_id
    out_dir.mkdir(parents=True, exist_ok=True)

    engine_classes = resolve_engines(args.engines)
    engine_status = {}
    engines = []
    for engine_class in engine_classes:
        available, reason = engine_class.availability()
        engine_status[engine_class.name] = {"available": available, "reason": reason}
        if not available:
            print(f"skip {engine_class.name}: {reason}")
            continue
        try:
            print(f"load {engine_class.name}...")
            engines.append(engine_class(device=args.device, variant_set=args.variant_set))
        except Exception as exc:
            engine_status[engine_class.name] = {"available": False, "reason": f"load failed: {exc}"}
            print(f"skip {engine_class.name}: load failed: {exc}")

    if not engines:
        print("No OCR engines available. Install optional dependencies or choose a different engine.", file=sys.stderr)
        write_json(
            out_dir / "results.json",
            {
                "run_id": run_id,
                "environment": environment(),
                "engine_status": engine_status,
                "results": [],
            },
        )
        return 3

    results = []
    for case in cases:
        print(f"case {case.case_id}: {case.title}")
        expected_fields = case.expected_fields()
        for engine in engines:
            started = time.perf_counter()
            image_outputs = []
            status = "ok"
            error = ""
            combined_text = ""
            try:
                for image in case.images:
                    print(f"  {engine.name}: {image.path.name}")
                    output = engine.recognize(image.path)
                    image_outputs.append(asdict(output))
                combined_text = "\n\n--- next image ---\n\n".join(output["raw_text"] for output in image_outputs)
            except Exception as exc:
                status = "error"
                error = f"{type(exc).__name__}: {exc}"
                traceback.print_exc()

            duration_ms = round((time.perf_counter() - started) * 1000)
            scores = score_fields(expected_fields, combined_text)
            results.append(
                {
                    "engine": engine.name,
                    "case_id": case.case_id,
                    "title": case.title,
                    "kind": case.kind,
                    "status": status,
                    "error": error,
                    "duration_ms": duration_ms,
                    "scores": scores,
                    "images": image_outputs,
                    "expected_fields": expected_fields,
                    "combined_text": combined_text,
                }
            )
            print(f"  {engine.name}: score={scores['score']:.3f} ms={duration_ms} status={status}")

    payload = {
        "run_id": run_id,
        "repo_root": str(repo_root),
        "variant_set": args.variant_set,
        "device": args.device,
        "environment": environment(),
        "engine_status": engine_status,
        "results": results,
    }
    write_json(out_dir / "results.json", payload)
    write_summary(out_dir / "summary.md", payload)
    print(f"\nwrote {out_dir / 'summary.md'}")
    print(f"wrote {out_dir / 'results.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
