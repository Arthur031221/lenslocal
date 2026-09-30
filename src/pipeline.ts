// Model loading and inference. Everything here runs in the browser through
// transformers.js: no network calls except fetching model weights from the
// Hugging Face CDN (cached by the browser after the first run) and no
// analytics of any kind.

import {
  Florence2ForConditionalGeneration,
  AutoProcessor,
  AutoTokenizer,
  AutoModelForSeq2SeqLM,
  RawImage,
} from "@huggingface/transformers";
import { OCR_MODEL_ID, type LanguageOption } from "./languages.ts";
import { buildRegions, mergeAdjacentRegions, type OcrRegion } from "./merge.ts";

export type Device = "webgpu" | "wasm";

export interface ProgressEvent {
  stage: "ocr-model" | "translation-model";
  file: string;
  percent: number;
}

export type ProgressListener = (event: ProgressEvent) => void;

/**
 * WebGPU is required for Florence-2 and opus-mt to run at usable speed in the
 * browser. Probe for a real adapter (not just the presence of navigator.gpu,
 * which can exist but fail to produce an adapter in some headless or
 * software-rendered environments) and fall back to the wasm execution
 * provider when it is unavailable.
 */
export async function detectDevice(): Promise<Device> {
  const nav = globalThis.navigator as (Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }) | undefined;
  if (!nav || !("gpu" in nav) || !nav.gpu) return "wasm";
  try {
    const adapter = await nav.gpu.requestAdapter();
    return adapter ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

// dtype/device split verified in feasibility/main.ts: fp16 embeddings with q8
// everywhere else is the combination that both loads and produces sane OCR
// output in transformers.js 4.3.0 for onnx-community/Florence-2-base-ft.
const OCR_DTYPE = {
  embed_tokens: "fp16",
  vision_encoder: "q8",
  encoder_model: "q8",
  decoder_model_merged: "q8",
} as const;

interface OcrHandles {
  model: Awaited<ReturnType<typeof Florence2ForConditionalGeneration.from_pretrained>>;
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
}

interface TranslationHandles {
  model: Awaited<ReturnType<typeof AutoModelForSeq2SeqLM.from_pretrained>>;
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
}

let ocrHandles: OcrHandles | undefined;
let ocrDevice: Device | undefined;
const translationCache = new Map<string, TranslationHandles>();

function progressCallback(stage: ProgressEvent["stage"], onProgress?: ProgressListener) {
  return (p: { status: string; file?: string; progress?: number }) => {
    if (p.status === "progress" && onProgress) {
      onProgress({ stage, file: p.file ?? "", percent: Math.round(p.progress ?? 0) });
    }
  };
}

/** Load (or reuse the already-loaded) OCR model. Safe to call once per session. */
export async function loadOcrModel(device: Device, onProgress?: ProgressListener): Promise<void> {
  if (ocrHandles && ocrDevice === device) return;
  const dev = device === "webgpu" ? undefined : "wasm"; // undefined lets transformers.js pick webgpu
  const model = await Florence2ForConditionalGeneration.from_pretrained(OCR_MODEL_ID, {
    dtype: OCR_DTYPE,
    device: dev,
    progress_callback: progressCallback("ocr-model", onProgress),
  });
  const processor = await AutoProcessor.from_pretrained(OCR_MODEL_ID);
  const tokenizer = await AutoTokenizer.from_pretrained(OCR_MODEL_ID);
  ocrHandles = { model, processor, tokenizer };
  ocrDevice = device;
}

/** Load (or reuse) the opus-mt translation model for one source language. */
export async function loadTranslationModel(
  lang: LanguageOption,
  device: Device,
  onProgress?: ProgressListener,
): Promise<void> {
  if (translationCache.has(lang.code)) return;
  const dev = device === "webgpu" ? undefined : "wasm";
  const model = await AutoModelForSeq2SeqLM.from_pretrained(lang.model, {
    dtype: "q8",
    device: dev,
    progress_callback: progressCallback("translation-model", onProgress),
  });
  const tokenizer = await AutoTokenizer.from_pretrained(lang.model);
  translationCache.set(lang.code, { model, tokenizer });
}

export interface OcrResult {
  regions: OcrRegion[];
  elapsedMs: number;
}

/** Read `source` (any input RawImage.read accepts: a File/Blob, a canvas, or a URL) and run OCR_WITH_REGION. */
export async function runOcr(source: RawImage | Blob | HTMLCanvasElement | string): Promise<OcrResult> {
  if (!ocrHandles) throw new Error("OCR model not loaded, call loadOcrModel first");
  const { model, processor, tokenizer } = ocrHandles;
  const image = source instanceof RawImage ? source : await RawImage.read(source);

  const task = "<OCR_WITH_REGION>";
  // transformers.js's Florence-2 helpers are typed loosely (any) in 4.3.0.
  const proc = processor as any;
  const prompts = proc.construct_prompts(task);
  const visionInputs = await proc(image);
  const textInputs = tokenizer(prompts);

  const t0 = performance.now();
  const generatedIds = await (model as any).generate({
    ...textInputs,
    ...visionInputs,
    max_new_tokens: 512,
  });
  const generatedText = tokenizer.batch_decode(generatedIds, { skip_special_tokens: false })[0];
  const result = proc.post_process_generation(generatedText, task, [image.width, image.height]);
  const elapsedMs = performance.now() - t0;

  const regionResult = result[task] ?? {};
  const labels: string[] = regionResult.labels ?? [];
  const quadBoxes: number[][] = regionResult.quad_boxes ?? [];
  const regions = mergeAdjacentRegions(buildRegions(labels, quadBoxes));
  return { regions, elapsedMs };
}

export interface TranslateResult {
  regions: OcrRegion[];
  elapsedMs: number;
}

/** Translate every region's `text` into English using the given source language's model. */
export async function translateRegions(regions: OcrRegion[], lang: LanguageOption): Promise<TranslateResult> {
  const handles = translationCache.get(lang.code);
  if (!handles) throw new Error(`Translation model for ${lang.code} not loaded`);
  const { model, tokenizer } = handles;

  const t0 = performance.now();
  const translated: OcrRegion[] = [];
  for (const region of regions) {
    if (!region.text) {
      translated.push(region);
      continue;
    }
    const inputs = tokenizer(region.text);
    const out = await (model as any).generate({ ...inputs, max_new_tokens: 96 });
    const decoded = tokenizer.batch_decode(out, { skip_special_tokens: true })[0];
    translated.push({ ...region, translated: decoded });
  }
  const elapsedMs = performance.now() - t0;
  return { regions: translated, elapsedMs };
}

export { RawImage };
