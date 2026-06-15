from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from ttb_validation.layoutlm_fields import ENTITY_TO_FIELD, ocr_tokens_from_payloads
from .model_gate import model_quality_gate


def layoutlmv3_predictions(ocr_payloads: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    model_dir = resolve_model_dir()
    if not model_dir:
        return None
    try:
        runner = load_runner(str(model_dir))
    except Exception:
        if os.environ.get("TTB_LAYOUTLMV3_REQUIRE_MODEL", "0") == "1":
            raise
        return None
    predictions: list[dict[str, Any]] = []
    offset = 0
    for payload in ocr_payloads:
        tokens = ocr_tokens_from_payloads([payload])
        if not tokens:
            continue
        try:
            predictions.extend(runner.predict(payload, token_offset=offset))
        except Exception:
            if os.environ.get("TTB_LAYOUTLMV3_REQUIRE_MODEL", "0") == "1":
                raise
        offset += len(tokens)
    return predictions


def resolve_model_dir() -> Path | None:
    configured = os.environ.get("TTB_LAYOUTLMV3_MODEL_DIR")
    default = Path(__file__).resolve().parents[4] / "models" / "field-extractor" / "layoutlmv3-cola" / "current"
    candidate = Path(configured).expanduser().resolve() if configured else default
    if not candidate.exists() or not candidate.is_dir():
        return None
    gate = model_quality_gate(candidate)
    if gate["allowed"]:
        return candidate
    if os.environ.get("TTB_LAYOUTLMV3_REQUIRE_MODEL", "0") == "1":
        raise RuntimeError(str(gate["reason"]))
    return None


@lru_cache(maxsize=1)
def load_runner(model_dir: str) -> "LayoutLmV3Runner":
    return LayoutLmV3Runner(Path(model_dir))


class LayoutLmV3Runner:
    def __init__(self, model_dir: Path):
        import torch
        from transformers import AutoProcessor, LayoutLMv3ForTokenClassification

        self.torch = torch
        self.device = layoutlm_device(torch)
        self.processor = AutoProcessor.from_pretrained(str(model_dir), apply_ocr=False)
        self.model = LayoutLMv3ForTokenClassification.from_pretrained(str(model_dir))
        self.model.to(self.device)
        self.model.eval()
        self.id2label = {int(key): value for key, value in self.model.config.id2label.items()}

    def predict(self, payload: dict[str, Any], *, token_offset: int) -> list[dict[str, Any]]:
        from PIL import Image

        tokens = ocr_tokens_from_payloads([payload])
        words = [token.text for token in tokens]
        if not words:
            return []
        width = int((payload.get("metadata") or {}).get("imageWidth") or 1000)
        height = int((payload.get("metadata") or {}).get("imageHeight") or 1000)
        boxes = [bbox_1000(token.bbox, width=width, height=height) for token in tokens]
        image = image_from_payload(payload, width=width, height=height)
        encoding = self.processor(
            image,
            words,
            boxes=boxes,
            truncation=True,
            padding="max_length",
            max_length=512,
            return_tensors="pt",
        )
        model_inputs = {key: value.to(self.device) if hasattr(value, "to") else value for key, value in encoding.items()}
        with self.torch.no_grad():
            logits = self.model(**model_inputs).logits
        predicted_ids = logits.argmax(-1).squeeze(0).tolist()
        word_ids = encoding.word_ids(0)
        labels_by_word: dict[int, str] = {}
        scores_by_word: dict[int, float] = {}
        probabilities = self.torch.softmax(logits.squeeze(0), dim=-1)
        for position, word_id in enumerate(word_ids):
            if word_id is None or word_id in labels_by_word:
                continue
            label = self.id2label.get(int(predicted_ids[position]), "O")
            labels_by_word[word_id] = label
            scores_by_word[word_id] = float(probabilities[position][predicted_ids[position]].item())
        return spans_from_word_labels(labels_by_word, scores_by_word, token_offset=token_offset)


def spans_from_word_labels(labels_by_word: dict[int, str], scores_by_word: dict[int, float], *, token_offset: int) -> list[dict[str, Any]]:
    spans: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for word_index in sorted(labels_by_word):
        label = labels_by_word[word_index]
        if label == "O" or "-" not in label:
            if current:
                spans.append(current)
                current = None
            continue
        prefix, entity = label.split("-", 1)
        if prefix == "B" or not current or current["entity"] != entity:
            if current:
                spans.append(current)
            current = {"entity": entity, "tokenIndexes": [], "scores": []}
        current["tokenIndexes"].append(token_offset + word_index)
        current["scores"].append(scores_by_word.get(word_index, 0.0))
    if current:
        spans.append(current)
    output = []
    for span in spans:
        entity = span["entity"]
        field_key = ENTITY_TO_FIELD.get(entity)
        if not field_key:
            continue
        scores = span.pop("scores")
        output.append(
            {
                "entity": entity,
                "fieldKey": field_key,
                "tokenIndexes": span["tokenIndexes"],
                "confidence": sum(scores) / len(scores) if scores else 0.0,
            }
        )
    return output


def layoutlm_device(torch: Any) -> Any:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(getattr(torch, "backends", None), "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def image_from_payload(payload: dict[str, Any], *, width: int, height: int) -> Any:
    from PIL import Image

    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    for key in ("imagePath", "sourceImagePath", "storagePath"):
        path = Path(str(metadata.get(key) or ""))
        if path.exists() and path.is_file():
            try:
                return Image.open(path).convert("RGB")
            except Exception:
                break
    return Image.new("RGB", (width, height), "white")


def bbox_1000(bbox: dict[str, Any] | None, *, width: int, height: int) -> list[int]:
    if not bbox:
        return [0, 0, 0, 0]
    left = clamp(float(bbox["x"]) / max(width, 1) * 1000)
    top = clamp(float(bbox["y"]) / max(height, 1) * 1000)
    right = clamp((float(bbox["x"]) + float(bbox["width"])) / max(width, 1) * 1000)
    bottom = clamp((float(bbox["y"]) + float(bbox["height"])) / max(height, 1) * 1000)
    return [left, top, max(left, right), max(top, bottom)]


def clamp(value: float) -> int:
    return max(0, min(1000, int(round(value))))
