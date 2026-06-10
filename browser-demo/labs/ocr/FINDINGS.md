# OCR Lab Findings

## 2026-06-10 First Wide-Net Sweep

Scope: stage-one OCR only. The scorer compares raw OCR text against expected label fields with light token boundary handling, enough to rank OCR candidates without replacing the production normalization and fuzzy-matching stages.

Hardware observed by the lab:

- GPU: NVIDIA GeForce RTX 4090
- PyTorch: 2.5.1+cu121
- CUDA available: true

Timings below exclude model download and engine initialization. They measure the selected packet images after the engine is loaded.

## Real Tequila Phone Photos

| Candidate | Variant Set | Score | Time | Read |
|---|---:|---:|---:|---|
| EasyOCR | core | 0.977 | 6231 ms | Best accuracy. Recovers class/type, ABV, net contents, producer, country, and most warning text. |
| EasyOCR | minimal | 0.857 | 1747 ms | Faster, but loses too much hard-photo detail. |
| EasyOCR | wide | 0.976 | 10364 ms | No useful accuracy gain over core. |
| docTR | full image | 0.895 | 326 ms | Very fast and clean, but weaker on warning and alcohol detail than EasyOCR. |
| TrOCR | core crops | 0.131 | 2321 ms | Poor for whole label/crop OCR because it is a recognizer without text detection. |

Initial winner for accuracy before docTR was run on the same crop variants: EasyOCR with the core preprocessing variants.

Initial speed winner: docTR on the original image. The follow-up sweep below adds a stronger adaptive recommendation.

## Multiscale Strategy Sweep

Follow-up scope: test whether external multiscale crops improve detector-recognizer engines that already detect text internally.

Real tequila phone-photo results:

| Candidate | Variant Set | Score | Time | Read |
|---|---:|---:|---:|---|
| EasyOCR | native | 0.939 | 692 ms | Very strong internal detection baseline, but warning text is weaker. |
| EasyOCR | targeted | 0.976 | 3829 ms | Best EasyOCR balance. Adds only lower/detail and warning crops. |
| EasyOCR | cascade | 0.976 | 5353 ms | Same score as targeted, slower on the hard case because it escalates. |
| EasyOCR | core | 0.977 | 6307 ms | Slightly higher than targeted, slower. |
| EasyOCR | multiscale | 0.973 | 13299 ms | Slower and slightly worse than core. |
| docTR | native | 0.895 | 788 ms | Fast, but weaker on alcohol and warning detail. |
| docTR | targeted | 0.985 | 5411 ms | Best practical docTR balance. |
| docTR | cascade | 0.985 | 6246 ms | Same score as targeted, slightly slower on the hard case because it escalates. |
| docTR | core | 0.987 | 9704 ms | Highest practical score, slower than targeted. |
| docTR | multiscale | 0.988 | 23076 ms | Tiny gain over core, not worth the latency. |

Conclusion: the engines do internally detect text, but external targeted high-resolution crops help significantly on curved bottle photos. Full multiscale tiling does not currently pay for itself.

Recommended strategy:

1. Use `targeted` as the practical fixed default for hard phone photos.
2. Use docTR `targeted` when accuracy is the priority; use EasyOCR `targeted` when a slightly faster pass is acceptable.
3. Use docTR `core` as the high-confidence fallback when targeted still leaves required fields weak.
4. Keep `cascade` as the path for future adaptive escalation, but current thresholds are conservative and often escalate.
5. Keep `multiscale` and `wide` as debugging or last-resort research modes.

Best default for a high-accuracy local reviewer right now: docTR `targeted`, with docTR `core` as the high-confidence fallback. EasyOCR `targeted` remains a strong alternative and is faster on the real tequila pair.

## Synthetic Packet Sweep

Using minimal preprocessing across the six synthetic sample packets:

- EasyOCR and docTR are roughly tied on clean synthetic labels.
- docTR is consistently faster on the synthetic packets.
- The hard real tequila photos are the deciding test right now, and EasyOCR handles them better.

## Narrowing Decision

The next default local PyTorch OCR path should be:

1. docTR targeted for high-accuracy local review.
2. docTR core when the targeted pass still leaves required fields weak.
3. EasyOCR targeted as a strong alternate engine.
4. Native OCR and cascade once stage-two normalization can make better escalation decisions.
5. TrOCR only after a detector produces clean text-line crops, or after a fine-tuning experiment focused on cropped text recognition.

The current browser app should not switch directly to PyTorch. The practical browser path is:

1. Train or fine-tune locally with PyTorch.
2. Export the winning detector/recognizer to ONNX.
3. Run it in the browser with ONNX Runtime Web/WebGPU or Transformers.js where supported.

## Training Direction

The synthetic-image idea is worthwhile, but CLIP LoRA should not be the primary OCR model. A better use for CLIP or SigLIP is routing:

- front versus back image
- label family or bottle type
- crop-policy selection
- whether to run fast docTR only or escalate to EasyOCR

For transcription, the better training path is:

1. Generate synthetic front/back labels from known expected fields.
2. Apply distortions: glare, blur, skew, compression, bottle curvature, perspective, low light, and partial occlusion.
3. Take real phone photos and annotate text regions plus expected strings.
4. Fine-tune a detector and/or recognizer, likely docTR or TrOCR on cropped text-line regions.
5. Export the winner to ONNX and benchmark in browser WebGPU.

## Reference Basis

- EasyOCR is a PyTorch OCR package with scene-text recognition roots: https://github.com/JaidedAI/EasyOCR
- docTR uses a two-stage detection then recognition OCR pipeline: https://github.com/mindee/doctr
- TrOCR is a transformer-based text recognition model designed for recognized text images, not detection: https://arxiv.org/abs/2109.10282
- ONNX Runtime Web provides a browser WebGPU execution provider: https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
