# Changelog

## 0.1.0 (2026-09-30)

First release.

- Photo-to-overlay translation pipeline running entirely in the browser: `onnx-community/Florence-2-base-ft` for OCR with region detection, one `Xenova/opus-mt-<lang>-en` model per source language for translation, both through transformers.js on WebGPU with an automatic wasm fallback.
- Camera capture (rear camera preferred) and drag-and-drop or file-picker photo input.
- Eight source languages: Japanese, Chinese, French, Spanish, German, Italian, Korean, Russian, all translating into English.
- Translated text overlaid on the original photo, positioned and sized from the OCR region boxes, plus a plain-text results list for touch devices.
- Model download progress bars for the first-use download of each model.
- Service worker for offline app-shell caching.
- No analytics, no telemetry, no third-party scripts.
- `feasibility/` harness confirming the OCR and translation models load and run in transformers.js, with a WebGPU-versus-wasm device probe.
- `eval/` harness measuring OCR and translation output on 20 CC0 and public-domain photos of signs and menus from Wikimedia Commons, with per-photo timing and citations.
- 22 vitest tests against hand-computed values for the region-merging and overlay-layout logic.
