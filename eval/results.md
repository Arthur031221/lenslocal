# Eval results

Method: `eval/run.mjs` drives `eval.html` (which calls the same `src/pipeline.ts` the app uses) headless in the Playwright-managed Chrome for Testing build, against the 20 photos in `eval/photos/` (sourced from Wikimedia Commons, CC0 or a permissive Creative Commons license, citations in `eval/CITATIONS.md`). For each photo: load (or reuse) the OCR model, load (or reuse) the source language's translation model, run `<OCR_WITH_REGION>`, merge adjacent regions (`src/merge.ts`), translate every merged region, and time OCR inference and translation inference separately. Model load and download time is excluded from the per-photo time, matching how a real session amortizes it across many photos (the OCR model and each of the eight translation models are loaded once and reused). Machine: MacBook Air, Apple M5, 24 GB, macOS 26.6, Chrome for Testing 153.0.8010.12, WebGPU (Metal backend), 2026-09-30. Raw output: `eval/results.json`.

**Median 14.6s from photo to translated overlay (n=20, range 10.2 to 24.0s), inference only.** OCR dominates: median OCR time 13.9s versus a median translation time of 0.1s. 2 of 20 photos produced zero OCR regions at all, both Chinese-language signs.

## Per-photo results

| # | Photo | Language | Regions found | OCR (s) | Translate (s) | Total (s) |
|---|-------|----------|---------------|---------|----------------|-----------|
| 1 | 01-okinawa-seafood-menu.jpg | ja | 1 | 19.8 | 0.1 | 19.9 |
| 2 | 02-tokyo-restaurant-facade.jpg | ja | 1 | 10.1 | 0.0 | 10.2 |
| 3 | 03-tokyo-sweet-shop.jpg | ja | 1 | 10.3 | 0.0 | 10.4 |
| 4 | 04-taipei-shop-sign.jpg | zh | 0 | 18.9 | 0.0 | 19.0 |
| 5 | 05-beijing-duck-restaurant-sign.jpg | zh | 2 | 10.5 | 0.1 | 10.6 |
| 6 | 06-hongkong-restaurant-sign.jpg | zh | 0 | 19.1 | 0.0 | 19.1 |
| 7 | 07-paris-champs-elysees-sign.jpg | fr | 4 | 11.1 | 0.2 | 11.3 |
| 8 | 08-paris-rue-saint-honore-sign.jpg | fr | 3 | 10.9 | 0.1 | 11.1 |
| 9 | 09-france-restaurant-menu-board.jpg | fr | 9 | 14.3 | 1.1 | 15.4 |
| 10 | 10-madrid-menu-del-dia.jpg | es | 11 | 13.5 | 0.9 | 14.4 |
| 11 | 11-madrid-restaurant-menu.jpg | es | 18 | 20.4 | 3.5 | 24.0 |
| 12 | 12-madrid-jamon-menu.jpg | es | 33 | 20.6 | 1.6 | 22.3 |
| 13 | 13-berlin-street-sign.jpg | de | 2 | 10.8 | 0.1 | 10.9 |
| 14 | 14-rothenburg-shop-sign.jpg | de | 1 | 10.8 | 0.1 | 11.0 |
| 15 | 15-rome-shop-sign.jpg | it | 2 | 12.0 | 0.1 | 12.2 |
| 16 | 16-livorno-tobacco-shop-sign.jpg | it | 7 | 15.7 | 0.6 | 16.4 |
| 17 | 17-seoul-starbucks-sign.jpg | ko | 1 | 12.4 | 0.2 | 12.6 |
| 18 | 18-seoul-myeongdong-shop-signs.jpg | ko | 6 | 16.2 | 0.7 | 17.0 |
| 19 | 19-moscow-bakery-ghost-sign.jpg | ru | 4 | 20.0 | 2.7 | 22.8 |
| 20 | 20-moscow-sewing-shop-sign.jpg | ru | 2 | 14.5 | 0.1 | 14.7 |

## Accuracy, reviewed by hand

Method: one pass by the builder reading every region's OCR text and its translation side by side against the source photo (`eval/results.json` has the full text). No automated metric, since there is no ground-truth transcription for these photos. Each photo is scored usable (the OCR text is recognizably the sign's real words and the translation is something a reader could act on), partial (at least one real word or phrase came through, alongside noise or a wrong translation), or failed (zero regions, or the output has no recognizable relationship to the source text).

| Outcome | Count | Photos |
|---|---|---|
| Usable | 5 / 20 | 03, 11, 13, 14, 16 |
| Partial | 5 / 20 | 07, 08, 10, 12, 15 |
| Failed | 10 / 20 | 01, 02, 04, 05, 06, 09, 17, 18, 19, 20 |

By script: the four Latin-script languages (French, Spanish, German, Italian, 12 photos) were usable or partial on 9 of 12 (75 percent). The four non-Latin-script languages (Japanese, Chinese, Korean, Russian, 8 photos) were usable or partial on 1 of 8 (12.5 percent), and that one case (photo 03) is a single kanji character.

Representative examples (full list in `eval/results.json`):

- Usable: photo 14, `Hasi's Laden` correctly translated to `Hasi's shop`. Photo 16, `TABACCHI` correctly translated to `TOBACCO`.
- Partial: photo 10, `Primero:` correctly translated to `First:` in the same menu where `Ensalada Mixta` was misread by OCR as `Eusalada Mixta` and left partly untranslated.
- Failed: photo 17, a Starbucks sign whose only real text is the Latin brand name. OCR read it correctly (`STARBUCKS COFFEE`), but feeding Latin, already-English text into the Korean opus-mt model produced an unrelated sentence, since that model was never trained on English input. Photos 18 to 20 (Korean and Russian) show the same pattern for non-Latin scripts: the OCR step itself garbles the characters before translation gets a chance.

## Known limitations this run surfaced

- Florence-2-base-ft's `<OCR_WITH_REGION>` output is substantially worse on Chinese, Korean and Russian text than on Latin-script text, both at finding regions at all (2 of 3 Chinese photos found zero) and at reading the characters correctly inside the regions it does find.
- On Latin-script signs, region detection is reliable but character-level OCR still misreads accented and stylized text (for example a chalkboard menu in photo 09), which then propagates into a nonsense translation even though the model itself is being fed real photo content.
- When OCR captures text in a language other than the model expects (the Latin brand name on photo 17's Korean sign), the translation model can produce a fluent-looking but entirely unrelated sentence rather than failing visibly. This is worth a confidence indicator or a language-detection guard in a future version, see the open issues.
- None of this is a training or fine-tuning problem to fix here: it reflects the accuracy ceiling of the specific small, quantized models chosen for feasibility (`onnx-community/Florence-2-base-ft`, `Xenova/opus-mt-<lang>-en`) so the app can run entirely client side. A larger OCR model would likely help non-Latin scripts substantially, at a much larger download and slower inference.
