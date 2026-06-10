from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any


GOVERNMENT_WARNING_TEXT = (
    "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink "
    "alcoholic beverages during pregnancy because of the risk of birth defects. "
    "(2) Consumption of alcoholic beverages impairs your ability to drive a car or "
    "operate machinery, and may cause health problems."
)

FIELD_KEYS = [
    "brandName",
    "classType",
    "alcoholContent",
    "netContents",
    "producerName",
    "countryOfOrigin",
]


@dataclass(frozen=True)
class ImageItem:
    path: Path
    role: str


@dataclass(frozen=True)
class Case:
    case_id: str
    title: str
    kind: str
    images: list[ImageItem]
    expected: dict[str, Any]

    def expected_fields(self) -> dict[str, str]:
        fields = {key: str(self.expected.get(key, "")).strip() for key in FIELD_KEYS if self.expected.get(key)}
        if self.expected.get("governmentWarningRequired"):
            fields["governmentWarning"] = GOVERNMENT_WARNING_TEXT
        return fields


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_synthetic_cases(repo_root: Path) -> list[Case]:
    manifest_path = repo_root / "public" / "label-packets" / "manifest.json"
    if not manifest_path.exists():
        return []

    manifest = _load_json(manifest_path)
    cases: list[Case] = []
    for packet in manifest.get("packets", []):
        expected_path = repo_root / "public" / packet["expectedPath"]
        expected = _load_json(expected_path)
        images = [
            ImageItem(
                path=repo_root / "public" / image["path"],
                role=image.get("role", image.get("name", "label")),
            )
            for image in packet.get("images", [])
        ]
        cases.append(
            Case(
                case_id=packet["id"],
                title=packet.get("title", packet["id"]),
                kind="synthetic",
                images=images,
                expected=expected,
            )
        )
    return cases


def load_real_tequila_case(repo_root: Path) -> list[Case]:
    project_root = repo_root.parent
    front = project_root / "Media.jpeg"
    back = project_root / "a0854219-90f4-498b-b33b-a841a01e6c89.jpg"
    expected_path = repo_root / "public" / "label-packets" / "tequila-extracted-synthetic" / "expected.json"
    if not front.exists() or not back.exists() or not expected_path.exists():
        return []

    return [
        Case(
            case_id="real-tequila",
            title="Real tequila phone photos",
            kind="real",
            images=[ImageItem(front, "front"), ImageItem(back, "back")],
            expected=_load_json(expected_path),
        )
    ]


def load_cases(repo_root: Path, include_synthetic: bool = True, include_real: bool = True) -> list[Case]:
    cases: list[Case] = []
    if include_real:
        cases.extend(load_real_tequila_case(repo_root))
    if include_synthetic:
        cases.extend(load_synthetic_cases(repo_root))
    return cases
