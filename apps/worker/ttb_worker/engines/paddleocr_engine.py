from __future__ import annotations

import os
import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from time import monotonic
from typing import Any, Mapping

from .base import EngineEstimate, EngineHealth, OcrEngine, OcrResult


@dataclass(frozen=True)
class PaddleModelConfig:
    root: Path | None
    det_model_dir: str | None
    rec_model_dir: str | None
    cls_model_dir: str | None
    require_custom: bool = False

    @property
    def custom(self) -> bool:
        return bool(self.det_model_dir or self.rec_model_dir or self.cls_model_dir)

    @property
    def custom_recognition(self) -> bool:
        return bool(self.rec_model_dir)

    @property
    def kwargs(self) -> dict[str, str]:
        values: dict[str, str] = {}
        if self.det_model_dir:
            values["det_model_dir"] = self.det_model_dir
        if self.rec_model_dir:
            values["rec_model_dir"] = self.rec_model_dir
        if self.cls_model_dir:
            values["cls_model_dir"] = self.cls_model_dir
        return values

    @property
    def modern_kwargs(self) -> dict[str, str]:
        values: dict[str, str] = {}
        if self.det_model_dir:
            values["text_detection_model_dir"] = self.det_model_dir
        if self.rec_model_dir:
            values["text_recognition_model_dir"] = self.rec_model_dir
        if self.cls_model_dir:
            values["textline_orientation_model_dir"] = self.cls_model_dir
        return values


@dataclass(frozen=True)
class RecoveryRegion:
    name: str
    box: tuple[int, int, int, int]


class PaddleOcrEngine(OcrEngine):
    id = "paddleocr"
    display_name = "PaddleOCR COLA"
    supports_gpu = True
    supports_cpu = True

    def __init__(self, use_gpu: bool = False, model_config: PaddleModelConfig | None = None):
        self.use_gpu = use_gpu
        self.model_config = model_config or resolve_model_config()
        self._ocr = None
        self._cpu_fallback_ocr = None

    def warmup(self) -> None:
        if not self.healthcheck().available:
            return None
        self._ocr = self._ocr or self._create_ocr()

    def estimate(self, task: dict[str, Any], capabilities: dict[str, Any]) -> EngineEstimate:
        estimated_ms = 1200 if self.use_gpu else 2300
        confidence = 0.94 if self.model_config.custom_recognition else 0.88
        reason_codes = ["authoritative_backend", "full_image_detection"]
        if self.model_config.custom:
            reason_codes.append("custom_cola_model")
        else:
            reason_codes.append("pretrained_baseline")
        if self.use_gpu:
            reason_codes.append("accelerated")
        return EngineEstimate(self.id, estimated_ms, confidence, reason_codes)

    def recognize(self, image_bytes: bytes, options: dict[str, Any] | None = None) -> OcrResult:
        health = self.healthcheck()
        if not health.available:
            raise RuntimeError(health.detail or "PaddleOCR is unavailable.")

        from PIL import Image

        image_pil = Image.open(BytesIO(image_bytes)).convert("RGB")
        started = monotonic()
        ocr = self._ocr or self._create_ocr()
        self._ocr = ocr
        try:
            return self._recognize_with_ocr(ocr, image_pil, started=started, gpu=self.use_gpu)
        except Exception as error:
            if not self.use_gpu or not cuda_device_unavailable(error):
                raise
            fallback = self._cpu_fallback_ocr or self._create_ocr(use_gpu=False)
            self._cpu_fallback_ocr = fallback
            result = self._recognize_with_ocr(fallback, image_pil, started=started, gpu=False)
            result.metadata["gpuFallback"] = True
            result.metadata["gpuFallbackReason"] = str(error)[:500]
            return result

    def _recognize_with_ocr(self, ocr: Any, image_pil: Any, *, started: float, gpu: bool) -> OcrResult:
        import numpy as np

        image_width, image_height = image_pil.size
        image = np.array(image_pil)
        raw_results = run_paddle_ocr(ocr, image)
        lines = []
        words = []
        text_parts = []
        confidences = []

        def append_item(item: dict[str, Any], *, supplemental: bool = False) -> None:
            clean = str(item["text"]).strip()
            if not clean:
                return
            confidence = float(item["confidence"])
            rect = polygon_to_rect(item["bbox"])
            confidences.append(confidence)
            text_parts.append(clean)
            line = {
                "text": clean,
                "confidence": confidence,
                "bbox": rect,
                "polygon": normalize_polygon(item["bbox"]),
            }
            for key in ("method", "orientationCorrected", "sourceRegion", "rotationApplied", "rectifiedBBox"):
                if key in item:
                    line[key] = item[key]
            lines.append(line)
            words.extend(item.get("words") or split_line_words(clean, rect, confidence))

        for item in extract_paddle_items(raw_results):
            append_item(item)

        recovery_metadata = recover_vertical_warning_items(ocr, image_pil, lines)
        for item in recovery_metadata.pop("items", []):
            append_item(item, supplemental=True)

        elapsed_ms = max(0, int((monotonic() - started) * 1000))
        confidence = sum(confidences) / len(confidences) if confidences else 0.0
        joined = "\n".join(text_parts)
        return OcrResult(
            engine_id=self.id,
            text=joined,
            confidence=confidence,
            words=words,
            lines=lines,
            elapsed_ms=elapsed_ms,
            metadata={
                "gpu": gpu,
                "customModel": self.model_config.custom,
                "customRecognition": self.model_config.custom_recognition,
                "modelRoot": str(self.model_config.root) if self.model_config.root else None,
                "modelDirs": self.model_config.kwargs,
                "imageWidth": image_width,
                "imageHeight": image_height,
                "fieldEntityBoxesReady": True,
                "ocrContract": "full-image-paddleocr-lines-and-token-boxes-v2",
                "orientationRecovery": recovery_metadata,
            },
        )

    def healthcheck(self) -> EngineHealth:
        try:
            import paddleocr  # noqa: F401
            import numpy  # noqa: F401
            import PIL  # noqa: F401
        except Exception as error:
            return EngineHealth(self.id, False, "unavailable", f"Missing PaddleOCR dependency: {error}")
        if self.model_config.require_custom and not self.model_config.custom_recognition:
            return EngineHealth(
                self.id,
                False,
                "unavailable",
                "TTB_PADDLEOCR_REQUIRE_CUSTOM=1 but no exported custom recognition model was found.",
            )
        model_note = (
            f"custom COLA model dirs: {', '.join(self.model_config.kwargs)}"
            if self.model_config.custom
            else "pretrained PaddleOCR baseline; custom model dirs not configured"
        )
        return EngineHealth(self.id, True, "ok", f"PaddleOCR dependencies are importable; using {model_note}.")

    def _create_ocr(self, use_gpu: bool | None = None):
        from paddleocr import PaddleOCR

        effective_gpu = self.use_gpu if use_gpu is None else use_gpu
        if effective_gpu:
            try:
                import paddle

                if paddle.device.cuda.device_count():
                    paddle.set_device("gpu:0")
            except Exception:
                pass
        else:
            try:
                import paddle

                paddle.set_device("cpu")
            except Exception:
                pass

        modern_kwargs: dict[str, Any] = {
            "lang": "en",
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
            # PaddleOCR/PaddleX 3.2 is the pinned evaluator runtime because
            # newer CPU builds currently hit a PIR/oneDNN inference regression.
            # Its word-box path can raise KeyError("text_word_region"), so we
            # keep line polygons from Paddle and derive token boxes locally.
            "return_word_box": False,
            **self.model_config.modern_kwargs,
        }
        legacy_kwargs: dict[str, Any] = {
            "use_angle_cls": False,
            "lang": "en",
            "use_gpu": effective_gpu,
            "show_log": False,
            **self.model_config.kwargs,
        }
        errors: list[str] = []
        for kwargs in (modern_kwargs, legacy_kwargs):
            try:
                return PaddleOCR(**kwargs)
            except (TypeError, ValueError) as error:
                errors.append(str(error))
        legacy_kwargs.pop("show_log", None)
        legacy_kwargs.pop("use_gpu", None)
        try:
            return PaddleOCR(**legacy_kwargs)
        except Exception as error:
            errors.append(str(error))
            raise RuntimeError(f"Unable to create PaddleOCR engine: {'; '.join(errors)}") from error


def resolve_model_config() -> PaddleModelConfig:
    root_value = os.environ.get("TTB_PADDLEOCR_MODEL_ROOT")
    default_root = Path(__file__).resolve().parents[4] / "models" / "ocr" / "paddle-cola" / "current"
    root = Path(root_value).expanduser().resolve() if root_value else default_root
    require_custom = os.environ.get("TTB_PADDLEOCR_REQUIRE_CUSTOM", "0") == "1"
    return PaddleModelConfig(
        root=root,
        det_model_dir=_model_dir("TTB_PADDLEOCR_DET_MODEL_DIR", root / "det"),
        rec_model_dir=_model_dir("TTB_PADDLEOCR_REC_MODEL_DIR", root / "rec"),
        cls_model_dir=_model_dir("TTB_PADDLEOCR_CLS_MODEL_DIR", root / "cls"),
        require_custom=require_custom,
    )


def _model_dir(env_key: str, default_path: Path) -> str | None:
    raw = os.environ.get(env_key)
    candidate = Path(raw).expanduser().resolve() if raw else default_path
    return str(candidate) if candidate.exists() and candidate.is_dir() else None


def run_paddle_ocr(ocr: Any, image: Any) -> Any:
    if hasattr(ocr, "predict"):
        try:
            return ocr.predict(image)
        except Exception as predict_error:
            if not hasattr(ocr, "ocr"):
                raise
            try:
                return ocr.ocr(image, cls=True)
            except TypeError:
                return ocr.ocr(image)
            except Exception as legacy_error:
                raise RuntimeError(
                    f"PaddleOCR predict failed ({predict_error}); legacy ocr failed ({legacy_error})."
                ) from legacy_error
    try:
        return ocr.ocr(image, cls=True)
    except TypeError:
        return ocr.ocr(image)


def extract_paddle_items(raw_results: Any) -> list[dict[str, Any]]:
    modern_items: list[dict[str, Any]] = []
    for result in raw_results or []:
        mapping = mapping_from_result(result)
        if not mapping or "rec_texts" not in mapping:
            continue
        texts = as_plain(mapping.get("rec_texts")) or []
        scores = as_plain(mapping.get("rec_scores")) or []
        polygons = as_plain(mapping.get("rec_polys") or mapping.get("dt_polys") or mapping.get("rec_boxes")) or []
        word_tokens = as_plain(mapping.get("text_word")) or []
        word_regions = as_plain(mapping.get("text_word_region") or mapping.get("text_word_boxes")) or []
        for index, text in enumerate(texts):
            confidence = float(scores[index]) if index < len(scores) else 0.0
            bbox = polygons[index] if index < len(polygons) else None
            tokens_for_line = word_tokens[index] if index < len(word_tokens) else []
            regions_for_line = word_regions[index] if index < len(word_regions) else []
            modern_items.append(
                {
                    "bbox": bbox,
                    "text": str(text),
                    "confidence": confidence,
                    "words": words_from_paddle_word_regions(tokens_for_line, regions_for_line, confidence),
                }
            )
    if modern_items:
        return modern_items
    return [
        {"bbox": bbox, "text": text, "confidence": confidence, "words": []}
        for bbox, text, confidence in iter_paddle_items(raw_results)
    ]


def mapping_from_result(result: Any) -> Mapping[str, Any] | None:
    if isinstance(result, Mapping):
        return result
    try:
        return {key: result[key] for key in result.keys()}
    except Exception:
        return None


def as_plain(value: Any) -> Any:
    if hasattr(value, "tolist"):
        return value.tolist()
    return value


def polygon_to_rect(bbox: Any) -> dict[str, float] | None:
    bbox = as_plain(bbox)
    if isinstance(bbox, dict) and {"x", "y", "width", "height"}.issubset(bbox):
        return {
            "x": float(bbox["x"]),
            "y": float(bbox["y"]),
            "width": float(bbox["width"]),
            "height": float(bbox["height"]),
        }
    points: list[tuple[float, float]] = []
    if isinstance(bbox, (list, tuple)) and len(bbox) == 4 and all(is_number(point) for point in bbox):
        x1, y1, x2, y2 = [float(point) for point in bbox]
        return {"x": min(x1, x2), "y": min(y1, y2), "width": abs(x2 - x1), "height": abs(y2 - y1)}
    if isinstance(bbox, (list, tuple)):
        for point in bbox:
            point = as_plain(point)
            if isinstance(point, dict) and {"x", "y"}.issubset(point):
                points.append((float(point["x"]), float(point["y"])))
            elif isinstance(point, (list, tuple)) and len(point) >= 2:
                points.append((float(point[0]), float(point[1])))
    if not points:
        return None
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    left = min(xs)
    top = min(ys)
    return {"x": left, "y": top, "width": max(xs) - left, "height": max(ys) - top}


def iter_paddle_items(raw_results: Any) -> list[tuple[Any, str, float]]:
    items: list[tuple[Any, str, float]] = []
    for page in raw_results or []:
        for item in page or []:
            if not isinstance(item, (list, tuple)) or len(item) < 2:
                continue
            bbox, value = item[0], item[1]
            if not isinstance(value, (list, tuple)) or len(value) < 2:
                continue
            items.append((bbox, str(value[0]), float(value[1])))
    return items


def normalize_polygon(bbox: Any) -> list[dict[str, float]]:
    bbox = as_plain(bbox)
    if isinstance(bbox, (list, tuple)) and len(bbox) == 4 and all(is_number(point) for point in bbox):
        x1, y1, x2, y2 = [float(point) for point in bbox]
        return [
            {"x": x1, "y": y1},
            {"x": x2, "y": y1},
            {"x": x2, "y": y2},
            {"x": x1, "y": y2},
        ]
    points: list[dict[str, float]] = []
    if isinstance(bbox, (list, tuple)):
        for point in bbox:
            point = as_plain(point)
            if isinstance(point, dict) and {"x", "y"}.issubset(point):
                points.append({"x": float(point["x"]), "y": float(point["y"])})
            elif isinstance(point, (list, tuple)) and len(point) >= 2:
                points.append({"x": float(point[0]), "y": float(point[1])})
    return points


def words_from_paddle_word_regions(
    tokens: Any, regions: Any, confidence: float
) -> list[dict[str, Any]]:
    tokens = as_plain(tokens) or []
    regions = as_plain(regions) or []
    output: list[dict[str, Any]] = []
    if not isinstance(tokens, (list, tuple)) or not isinstance(regions, (list, tuple)):
        return output
    for token, region in zip(tokens, regions):
        text = str(token).strip()
        if not text:
            continue
        output.append(
            {
                "text": text,
                "confidence": confidence,
                "bbox": polygon_to_rect(region),
                "polygon": normalize_polygon(region),
            }
        )
    return output


def split_line_words(text: str, bbox: dict[str, float] | None, confidence: float) -> list[dict[str, Any]]:
    tokens = [match.group(0) for match in re.finditer(r"\S+", text)]
    if not tokens:
        return []
    if not bbox:
        return [{"text": token, "confidence": confidence} for token in tokens]
    total_chars = sum(len(token) for token in tokens)
    if total_chars <= 0:
        return [{"text": token, "confidence": confidence, "bbox": bbox} for token in tokens]
    x = float(bbox["x"])
    output = []
    for token in tokens:
        fraction = len(token) / total_chars
        width = float(bbox["width"]) * fraction
        output.append(
            {
                "text": token,
                "confidence": confidence,
                "bbox": {
                    "x": x,
                    "y": float(bbox["y"]),
                    "width": width,
                    "height": float(bbox["height"]),
                },
            }
        )
        x += width
    return output


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def cuda_device_unavailable(error: Exception) -> bool:
    message = str(error).lower()
    return any(
        marker in message
        for marker in (
            "cuda-capable device",
            "cudaerrordevicesunavailable",
            "cudadevicesunavailable",
            "device(s) is/are busy",
            "cuda error(46)",
            "out of memory",
        )
    )


WARNING_TERM_SET = {
    "GOVERNMENT",
    "WARNING",
    "SURGEON",
    "GENERAL",
    "WOMEN",
    "DRINK",
    "ALCOHOLIC",
    "BEVERAGES",
    "PREGNANCY",
    "BIRTH",
    "DEFECTS",
    "CONSUMPTION",
    "IMPAIRS",
    "DRIVE",
    "MACHINERY",
    "HEALTH",
    "PROBLEMS",
}

WARNING_PHRASES = (
    "GOVERNMENT WARNING",
    "SURGEON GENERAL",
    "ALCOHOLIC BEVERAGES",
    "DURING PREGNANCY",
    "BIRTH DEFECTS",
    "CONSUMPTION OF ALCOHOLIC BEVERAGES",
    "OPERATE MACHINERY",
    "HEALTH PROBLEMS",
)


def recover_vertical_warning_items(ocr: Any, image_pil: Any, existing_lines: list[dict[str, Any]]) -> dict[str, Any]:
    """Recover legal warning text that PaddleOCR detected as vertical but misread.

    PaddleOCR's detector often sees the tall side-strip text, but full-image
    recognition may hand the recognizer a sideways crop. Small upright recovery
    passes are cheap after warmup and keep the final evidence tied to original
    image coordinates.
    """

    existing_text = "\n".join(str(line.get("text") or "") for line in existing_lines)
    if warning_text_present(existing_text):
        return {"attempted": False, "applied": False, "reason": "warning-already-present"}

    image_width, image_height = image_pil.size
    regions = vertical_warning_recovery_regions(existing_lines, image_width, image_height)
    if not regions:
        return {"attempted": False, "applied": False, "reason": "no-candidate-regions"}

    import numpy as np

    best: dict[str, Any] | None = None
    attempts = 0
    found_high_confidence_warning = False
    for region in regions:
        crop = image_pil.crop(region.box)
        for rotation in (270, 0, 90, 180):
            attempts += 1
            variant = crop if rotation == 0 else crop.rotate(rotation, expand=True)
            raw_results = run_paddle_ocr(ocr, np.array(variant))
            items = [
                item
                for item in extract_paddle_items(raw_results)
                if str(item.get("text") or "").strip()
            ]
            text = "\n".join(str(item["text"]).strip() for item in items)
            rank = warning_variant_rank(text, items)
            if best is None or rank > best["rank"]:
                best = {
                    "rank": rank,
                    "score": rank[0],
                    "region": region,
                    "rotation": rotation,
                    "items": items,
                    "text": text,
                }
            if rank[0] >= 30 and rank[1] == 1 and rank[2] >= 0.95:
                found_high_confidence_warning = True
                break
        if found_high_confidence_warning:
            break

    if not best or best["score"] < 10:
        return {
            "attempted": True,
            "applied": False,
            "strategy": "vertical-warning-recovery-v1",
            "candidateRegions": len(regions),
            "attempts": attempts,
            "bestScore": best["score"] if best else 0,
        }

    mapped_items = map_recovered_items_to_original(
        best["items"],
        best["region"],
        int(best["rotation"]),
        image_width=image_width,
        image_height=image_height,
    )
    return {
        "attempted": True,
        "applied": True,
        "strategy": "vertical-warning-recovery-v1",
        "candidateRegions": len(regions),
        "attempts": attempts,
        "bestScore": best["score"],
        "region": best["region"].name,
        "rotationApplied": int(best["rotation"]),
        "textLength": len(best["text"]),
        "items": mapped_items,
    }


def vertical_warning_recovery_regions(
    existing_lines: list[dict[str, Any]],
    image_width: int,
    image_height: int,
) -> list[RecoveryRegion]:
    regions: list[RecoveryRegion] = []
    tall_boxes = []
    for line in existing_lines:
        box = normalize_rect(line.get("bbox"))
        if not box:
            continue
        width = max(1.0, box["width"])
        height = max(1.0, box["height"])
        if height >= max(140.0, image_height * 0.28) and height / width >= 4.0 and width <= max(90.0, image_width * 0.12):
            tall_boxes.append(box)
            regions.append(
                RecoveryRegion(
                    "detected-vertical-text",
                    expanded_box(box, image_width, image_height, pad_x=42, pad_y=28),
                )
            )

    if tall_boxes:
        regions.insert(
            0,
            RecoveryRegion(
                "detected-vertical-text-union",
                expanded_box(union_rects(tall_boxes), image_width, image_height, pad_x=54, pad_y=34),
            ),
        )

    edge_width = int(min(max(180, image_width * 0.18), image_width * 0.36))
    regions.extend(
        [
            RecoveryRegion("left-edge-vertical-band", (0, 0, edge_width, image_height)),
            RecoveryRegion("right-edge-vertical-band", (image_width - edge_width, 0, image_width, image_height)),
        ]
    )
    return unique_regions(regions)


def warning_variant_rank(text: str, items: list[dict[str, Any]]) -> tuple[int, int, float, int]:
    normalized = normalize_warning_text(text)
    score = warning_text_score(text)
    heading_at = normalized.find("GOVERNMENT WARNING")
    ability_at = normalized.find("ABILITY")
    ordered = 1 if heading_at >= 0 and (ability_at < 0 or heading_at < ability_at) else 0
    confidences = [float(item.get("confidence") or 0.0) for item in items]
    confidence = sum(confidences) / len(confidences) if confidences else 0.0
    return (score, ordered, confidence, len(normalized))


def warning_text_present(text: str) -> bool:
    return warning_text_score(text) >= 10


def warning_text_score(text: str) -> int:
    normalized = normalize_warning_text(text)
    if not normalized:
        return 0
    tokens = set(normalized.split())
    score = len(tokens & WARNING_TERM_SET)
    score += sum(2 for phrase in WARNING_PHRASES if phrase in normalized)
    return score


def normalize_warning_text(text: Any) -> str:
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", str(text or "").upper()).split())


def map_recovered_items_to_original(
    items: list[dict[str, Any]],
    region: RecoveryRegion,
    rotation: int,
    *,
    image_width: int,
    image_height: int,
) -> list[dict[str, Any]]:
    mapped_items: list[dict[str, Any]] = []
    for item in items:
        clean = str(item.get("text") or "").strip()
        if not clean:
            continue
        confidence = float(item.get("confidence") or 0.0)
        rectified_rect = polygon_to_rect(item.get("bbox")) or variant_full_rect(region, rotation)
        mapped_polygon = map_polygon_to_original(rect_to_polygon(rectified_rect), region, rotation)
        mapped_rect = clamp_rect(polygon_to_rect(mapped_polygon), image_width, image_height)
        mapped_words = [
            map_recovered_word_to_original(word, region, rotation, image_width=image_width, image_height=image_height)
            for word in item.get("words") or []
            if isinstance(word, dict) and str(word.get("text") or "").strip()
        ]
        mapped_words = [word for word in mapped_words if word]
        mapped_items.append(
            {
                "text": clean,
                "confidence": confidence,
                "bbox": mapped_rect,
                "polygon": mapped_polygon,
                "words": mapped_words or split_line_words(clean, mapped_rect, confidence),
                "method": "paddleocr-vertical-warning-recovery",
                "orientationCorrected": True,
                "sourceRegion": region.name,
                "rotationApplied": rotation,
                "rectifiedBBox": rectified_rect,
            }
        )
    return mapped_items


def map_recovered_word_to_original(
    word: dict[str, Any],
    region: RecoveryRegion,
    rotation: int,
    *,
    image_width: int,
    image_height: int,
) -> dict[str, Any] | None:
    clean = str(word.get("text") or "").strip()
    if not clean:
        return None
    rect = polygon_to_rect(word.get("bbox"))
    if not rect:
        return {
            "text": clean,
            "confidence": float(word.get("confidence") or 0.0),
            "method": "paddleocr-vertical-warning-recovery",
            "orientationCorrected": True,
        }
    polygon = map_polygon_to_original(rect_to_polygon(rect), region, rotation)
    mapped_rect = clamp_rect(polygon_to_rect(polygon), image_width, image_height)
    return {
        "text": clean,
        "confidence": float(word.get("confidence") or 0.0),
        "bbox": mapped_rect,
        "polygon": polygon,
        "method": "paddleocr-vertical-warning-recovery",
        "orientationCorrected": True,
        "sourceRegion": region.name,
        "rotationApplied": rotation,
    }


def map_polygon_to_original(
    polygon: list[dict[str, float]],
    region: RecoveryRegion,
    rotation: int,
) -> list[dict[str, float]]:
    x0, y0, x1, y1 = region.box
    crop_width = x1 - x0
    crop_height = y1 - y0
    mapped = []
    for point in polygon:
        x = float(point["x"])
        y = float(point["y"])
        if rotation == 90:
            original_x = crop_width - y
            original_y = x
        elif rotation == 180:
            original_x = crop_width - x
            original_y = crop_height - y
        elif rotation == 270:
            original_x = y
            original_y = crop_height - x
        else:
            original_x = x
            original_y = y
        mapped.append({"x": x0 + original_x, "y": y0 + original_y})
    return mapped


def rect_to_polygon(rect: dict[str, float] | None) -> list[dict[str, float]]:
    if not rect:
        return []
    x = float(rect["x"])
    y = float(rect["y"])
    width = float(rect["width"])
    height = float(rect["height"])
    return [
        {"x": x, "y": y},
        {"x": x + width, "y": y},
        {"x": x + width, "y": y + height},
        {"x": x, "y": y + height},
    ]


def variant_full_rect(region: RecoveryRegion, rotation: int) -> dict[str, float]:
    x0, y0, x1, y1 = region.box
    crop_width = x1 - x0
    crop_height = y1 - y0
    if rotation in {90, 270}:
        return {"x": 0.0, "y": 0.0, "width": float(crop_height), "height": float(crop_width)}
    return {"x": 0.0, "y": 0.0, "width": float(crop_width), "height": float(crop_height)}


def normalize_rect(value: Any) -> dict[str, float] | None:
    if isinstance(value, dict) and {"x", "y", "width", "height"}.issubset(value):
        try:
            return {key: float(value[key]) for key in ("x", "y", "width", "height")}
        except (TypeError, ValueError):
            return None
    return None


def union_rects(boxes: list[dict[str, float]]) -> dict[str, float]:
    left = min(box["x"] for box in boxes)
    top = min(box["y"] for box in boxes)
    right = max(box["x"] + box["width"] for box in boxes)
    bottom = max(box["y"] + box["height"] for box in boxes)
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def expanded_box(
    box: dict[str, float],
    image_width: int,
    image_height: int,
    *,
    pad_x: int,
    pad_y: int,
) -> tuple[int, int, int, int]:
    left = max(0, int(box["x"] - pad_x))
    top = max(0, int(box["y"] - pad_y))
    right = min(image_width, int(box["x"] + box["width"] + pad_x))
    bottom = min(image_height, int(box["y"] + box["height"] + pad_y))
    return (left, top, max(left + 1, right), max(top + 1, bottom))


def clamp_rect(rect: dict[str, float] | None, image_width: int, image_height: int) -> dict[str, float] | None:
    if not rect:
        return None
    left = max(0.0, min(float(image_width), rect["x"]))
    top = max(0.0, min(float(image_height), rect["y"]))
    right = max(left, min(float(image_width), rect["x"] + rect["width"]))
    bottom = max(top, min(float(image_height), rect["y"] + rect["height"]))
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def unique_regions(regions: list[RecoveryRegion]) -> list[RecoveryRegion]:
    seen = set()
    output = []
    for region in regions:
        if region.box in seen:
            continue
        seen.add(region.box)
        output.append(region)
    return output
