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

Current winner for accuracy: EasyOCR with the core preprocessing variants.

Current winner for speed: docTR, especially as a first-pass candidate. It may be useful to run docTR first, then escalate to EasyOCR when the stage-one score or required field coverage is low.

## Synthetic Packet Sweep

Using minimal preprocessing across the six synthetic sample packets:

- EasyOCR and docTR are roughly tied on clean synthetic labels.
- docTR is consistently faster on the synthetic packets.
- The hard real tequila photos are the deciding test right now, and EasyOCR handles them better.

## Narrowing Decision

The next default local PyTorch OCR path should be:

1. EasyOCR with core variants for high-accuracy local review.
2. docTR as a fast candidate and possible first-pass filter.
3. TrOCR only after a detector produces clean text-line crops, or after a fine-tuning experiment focused on cropped text recognition.

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
