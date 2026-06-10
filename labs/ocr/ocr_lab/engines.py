from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from typing import Any

import numpy as np
import torch

from .preprocess import Variant, make_variants


@dataclass
class OcrOutput:
    engine: str
    image: str
    raw_text: str
    duration_ms: int
    metadata: dict[str, Any] = field(default_factory=dict)


class BaseEngine:
    name = "base"

    def __init__(self, device: str = "auto", variant_set: str = "core") -> None:
        self.device = device
        self.variant_set = variant_set

    @classmethod
    def availability(cls) -> tuple[bool, str]:
        return True, "available"

    def recognize(self, image_path: Path) -> OcrOutput:
        raise NotImplementedError

    def _variants(self, image_path: Path) -> list[Variant]:
        return make_variants(image_path, self.variant_set)


class TesseractCliEngine(BaseEngine):
    name = "tesseract-cli"

    @classmethod
    def availability(cls) -> tuple[bool, str]:
        if shutil.which("tesseract"):
            return True, "tesseract binary found"
        return False, "tesseract binary not found"

    def recognize(self, image_path: Path) -> OcrOutput:
        started = time.perf_counter()
        texts = []
        for variant in self._variants(image_path):
            with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
                variant.image.save(tmp.name)
                for psm in ["6", "11"]:
                    command = ["tesseract", tmp.name, "stdout", "--psm", psm, "-l", "eng"]
                    completed = subprocess.run(command, check=False, capture_output=True, text=True)
                    if completed.stdout.strip():
                        texts.append(f"[{variant.variant_id} psm={psm}]\n{completed.stdout.strip()}")
        return OcrOutput(self.name, str(image_path), "\n".join(texts), round((time.perf_counter() - started) * 1000))


class EasyOcrEngine(BaseEngine):
    name = "easyocr"

    @classmethod
    def availability(cls) -> tuple[bool, str]:
        try:
            import easyocr  # noqa: F401
        except Exception as exc:
            return False, f"easyocr import failed: {exc}"
        return True, "easyocr import ok"

    def __init__(self, device: str = "auto", variant_set: str = "core") -> None:
        super().__init__(device, variant_set)
        import easyocr

        gpu = torch.cuda.is_available() if device == "auto" else device == "cuda"
        self.reader = easyocr.Reader(["en"], gpu=gpu, verbose=False)
        self.gpu = gpu

    def recognize(self, image_path: Path) -> OcrOutput:
        started = time.perf_counter()
        texts = []
        variant_stats = []
        for variant in self._variants(image_path):
            rows = self.reader.readtext(np.array(variant.image), detail=1, paragraph=False)
            lines = [str(row[1]) for row in rows if len(row) >= 2 and str(row[1]).strip()]
            if lines:
                texts.append(f"[{variant.variant_id}]\n" + "\n".join(lines))
            variant_stats.append({"variant": variant.variant_id, "lines": len(lines)})
        return OcrOutput(
            self.name,
            str(image_path),
            "\n".join(texts),
            round((time.perf_counter() - started) * 1000),
            {"gpu": self.gpu, "variants": variant_stats},
        )


class DocTrEngine(BaseEngine):
    name = "doctr"

    @classmethod
    def availability(cls) -> tuple[bool, str]:
        try:
            import doctr  # noqa: F401
        except Exception as exc:
            return False, f"doctr import failed: {exc}"
        return True, "doctr import ok"

    def __init__(self, device: str = "auto", variant_set: str = "core") -> None:
        super().__init__(device, variant_set)
        from doctr.models import ocr_predictor

        self.torch_device = "cuda" if (device == "auto" and torch.cuda.is_available()) else device
        if self.torch_device not in {"cuda", "cpu"}:
            self.torch_device = "cpu"
        self.predictor = ocr_predictor(pretrained=True)
        if hasattr(self.predictor, "to"):
            self.predictor = self.predictor.to(self.torch_device)

    def recognize(self, image_path: Path) -> OcrOutput:
        from doctr.io import DocumentFile

        started = time.perf_counter()
        document = DocumentFile.from_images(str(image_path))
        result = self.predictor(document)
        exported = result.export()
        lines = []
        for page in exported.get("pages", []):
            for block in page.get("blocks", []):
                for line in block.get("lines", []):
                    words = [word.get("value", "") for word in line.get("words", [])]
                    text = " ".join(word for word in words if word)
                    if text:
                        lines.append(text)
        return OcrOutput(
            self.name,
            str(image_path),
            "\n".join(lines),
            round((time.perf_counter() - started) * 1000),
            {"device": self.torch_device},
        )


class TrOcrEngine(BaseEngine):
    name = "trocr"

    @classmethod
    def availability(cls) -> tuple[bool, str]:
        try:
            from transformers import TrOCRProcessor, VisionEncoderDecoderModel  # noqa: F401
        except Exception as exc:
            return False, f"transformers TrOCR import failed: {exc}"
        return True, "transformers TrOCR import ok"

    def __init__(self, device: str = "auto", variant_set: str = "core", model_id: str = "microsoft/trocr-base-printed") -> None:
        super().__init__(device, variant_set)
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel

        self.torch_device = "cuda" if (device == "auto" and torch.cuda.is_available()) else device
        if self.torch_device not in {"cuda", "cpu"}:
            self.torch_device = "cpu"
        self.processor = TrOCRProcessor.from_pretrained(model_id)
        self.model = VisionEncoderDecoderModel.from_pretrained(model_id).to(self.torch_device)
        self.model.eval()
        self.model_id = model_id

    def recognize(self, image_path: Path) -> OcrOutput:
        started = time.perf_counter()
        texts = []
        variant_stats = []
        with torch.inference_mode():
            for variant in self._variants(image_path):
                inputs = self.processor(images=variant.image, return_tensors="pt").pixel_values.to(self.torch_device)
                generated_ids = self.model.generate(inputs, max_new_tokens=96)
                text = self.processor.batch_decode(generated_ids, skip_special_tokens=True)[0].strip()
                if text:
                    texts.append(f"[{variant.variant_id}]\n{text}")
                variant_stats.append({"variant": variant.variant_id, "chars": len(text)})
        if self.torch_device == "cuda":
            torch.cuda.synchronize()
        return OcrOutput(
            self.name,
            str(image_path),
            "\n".join(texts),
            round((time.perf_counter() - started) * 1000),
            {"device": self.torch_device, "model": self.model_id, "variants": variant_stats},
        )


ENGINE_REGISTRY = {
    TesseractCliEngine.name: TesseractCliEngine,
    EasyOcrEngine.name: EasyOcrEngine,
    DocTrEngine.name: DocTrEngine,
    TrOcrEngine.name: TrOcrEngine,
}


def resolve_engines(names: str) -> list[type[BaseEngine]]:
    requested = [name.strip() for name in names.split(",") if name.strip()]
    unknown = [name for name in requested if name not in ENGINE_REGISTRY]
    if unknown:
        raise ValueError(f"Unknown engines: {', '.join(unknown)}")
    return [ENGINE_REGISTRY[name] for name in requested]
