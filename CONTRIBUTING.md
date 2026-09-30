# Contributing

## Setup

```sh
npm install
npm run dev       # site at http://localhost:5173/lenslocal/
npm test          # vitest
npm run lint      # eslint
npm run build     # typecheck and build to dist/
```

## Adding a source language

1. Add an entry to `LANGUAGES` in `src/languages.ts` with the language code, display name, and the `Xenova/opus-mt-<code>-en` model id. Check first that the model exists on Hugging Face and has ONNX weights.
2. Add one photo of a sign or menu in that language to `eval/photos/`, a citation in `eval/CITATIONS.md`, and an entry in `eval/manifest.json`.
3. Re-run the eval harness (`npm run dev` in one terminal, `FEAS_URL=http://localhost:5173/lenslocal/eval.html node eval/run.mjs` in another) and update `eval/results.md` with the new numbers.

## Changing the OCR or translation model

Any change to `OCR_MODEL_ID` in `src/languages.ts` or to a translation model id needs a pass through `feasibility/`: confirm the model still loads and runs in transformers.js (`npm run dev`, then `node feasibility/run.mjs`), and note the measured load and inference time in your pull request.

## Code layout

- `src/merge.ts` and `src/layout.ts` are pure functions with no DOM and no model calls. Any change to region merging or overlay positioning needs a test in `tests/` with a value you worked out by hand.
- `src/pipeline.ts` holds all model loading and inference. `src/main.ts` is DOM wiring only.
- `eval/` and `feasibility/` are development tools, not part of the shipped app. Vite does not build them.

## Prose

Write like an engineer, not marketing copy. No hype. Any number that is not read directly from a test or the eval harness must say how it was measured.
