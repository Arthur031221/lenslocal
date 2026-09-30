import {
  Florence2ForConditionalGeneration,
  AutoProcessor,
  AutoTokenizer,
  RawImage,
  AutoModelForSeq2SeqLM,
  AutoTokenizer as AutoTokenizerMT,
  env,
} from "@huggingface/transformers";

const logEl = document.getElementById("log")!;
function log(msg: string) {
  console.log(msg);
  logEl.textContent += msg + "\n";
}

// expose a flag the Playwright harness can poll
(window as any).__done = false;
(window as any).__result = null;

async function main() {
  const device = (window as any).__forceWasm ? "wasm" : undefined;
  log(`device override: ${device ?? "auto (webgpu if available)"}`);
  log(`navigator.gpu present: ${"gpu" in navigator}`);

  const t0 = performance.now();

  const ocrModelId = "onnx-community/Florence-2-base-ft";
  log(`loading OCR model ${ocrModelId} ...`);
  const ocrModel = await Florence2ForConditionalGeneration.from_pretrained(ocrModelId, {
    dtype: {
      embed_tokens: "fp16",
      vision_encoder: "q8",
      encoder_model: "q8",
      decoder_model_merged: "q8",
    },
    device,
    progress_callback: (p: any) => {
      if (p.status === "progress") {
        log(`  ocr ${p.file}: ${Math.round(p.progress ?? 0)}%`);
      }
    },
  });
  const processor = await AutoProcessor.from_pretrained(ocrModelId);
  const tokenizer = await AutoTokenizer.from_pretrained(ocrModelId);
  const tOcrLoaded = performance.now();
  log(`OCR model loaded in ${((tOcrLoaded - t0) / 1000).toFixed(1)}s`);

  const mtModelId = "Xenova/opus-mt-ja-en";
  log(`loading translation model ${mtModelId} ...`);
  const mtModel = await AutoModelForSeq2SeqLM.from_pretrained(mtModelId, {
    dtype: "q8",
    device,
    progress_callback: (p: any) => {
      if (p.status === "progress") {
        log(`  mt ${p.file}: ${Math.round(p.progress ?? 0)}%`);
      }
    },
  });
  const mtTokenizer = await AutoTokenizerMT.from_pretrained(mtModelId);
  const tMtLoaded = performance.now();
  log(`translation model loaded in ${((tMtLoaded - tOcrLoaded) / 1000).toFixed(1)}s`);

  log("running OCR on sample image...");
  const image = await RawImage.fromURL("/feasibility/sample/test-small.jpg");
  const task = "<OCR_WITH_REGION>";
  const prompts = (processor as any).construct_prompts(task);
  const visionInputs = await (processor as any)(image);
  const textInputs = tokenizer(prompts);

  const tOcrStart = performance.now();
  const generatedIds = await (ocrModel as any).generate({
    ...textInputs,
    ...visionInputs,
    max_new_tokens: 512,
  });
  const generatedText = tokenizer.batch_decode(generatedIds, { skip_special_tokens: false })[0];
  const result = (processor as any).post_process_generation(generatedText, task, [image.width, image.height]);
  const tOcrDone = performance.now();
  log(`OCR inference took ${((tOcrDone - tOcrStart) / 1000).toFixed(1)}s`);
  log(`OCR raw result: ${JSON.stringify(result).slice(0, 2000)}`);

  const regionResult = result[task];
  const labels: string[] = regionResult?.labels ?? [];
  log(`found ${labels.length} OCR regions`);

  const tMtStart = performance.now();
  const translations: string[] = [];
  for (const text of labels.slice(0, 5)) {
    const cleaned = text.replace(/<\/?loc_\d+>/g, "").trim();
    if (!cleaned) continue;
    const inputs = mtTokenizer(cleaned);
    const out = await (mtModel as any).generate({ ...inputs, max_new_tokens: 64 });
    const decoded = mtTokenizer.batch_decode(out, { skip_special_tokens: true })[0];
    translations.push(`${cleaned} -> ${decoded}`);
  }
  const tMtDone = performance.now();
  log(`translation of ${translations.length} lines took ${((tMtDone - tMtStart) / 1000).toFixed(1)}s`);
  for (const t of translations) log(`  ${t}`);

  const totalPhotoToOverlay = tMtDone - tOcrStart;
  log(`TOTAL photo-to-overlay time (OCR infer + translate, excludes model download): ${(totalPhotoToOverlay / 1000).toFixed(1)}s`);
  log(`TOTAL including model load: ${((tMtDone - t0) / 1000).toFixed(1)}s`);

  (window as any).__result = {
    device: device ?? (("gpu" in navigator) ? "webgpu-available" : "wasm-only"),
    ocrLoadMs: tOcrLoaded - t0,
    mtLoadMs: tMtLoaded - tOcrLoaded,
    ocrInferMs: tOcrDone - tOcrStart,
    mtInferMs: tMtDone - tMtStart,
    photoToOverlayMs: totalPhotoToOverlay,
    totalWithLoadMs: tMtDone - t0,
    regionsFound: labels.length,
    translations,
  };
  (window as any).__done = true;
}

main().catch((err) => {
  log(`ERROR: ${err?.message ?? err}`);
  log(err?.stack ?? "");
  (window as any).__error = String(err?.stack ?? err);
  (window as any).__done = true;
});
