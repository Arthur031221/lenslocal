// Eval harness: runs the real app pipeline (src/pipeline.ts, the same code
// main.ts uses) against every photo in eval/photos, driven headless by
// eval/run.mjs. Not part of the shipped app, not built by `vite build`.

import { detectDevice, loadOcrModel, loadTranslationModel, runOcr, translateRegions } from "../src/pipeline.ts";
import { findLanguage } from "../src/languages.ts";

interface ManifestEntry {
  file: string;
  lang: string;
}

interface EvalResult {
  file: string;
  lang: string;
  regionsFound: number;
  ocrMs: number;
  translateMs: number;
  totalMs: number;
  regions: { text: string; translated?: string }[];
}

const logEl = document.getElementById("log")!;
function log(msg: string) {
  console.log(msg);
  logEl.textContent += msg + "\n";
}

declare global {
  interface Window {
    __done?: boolean;
    __results?: EvalResult[];
    __error?: string;
    __forceWasm?: boolean;
  }
}

window.__done = false;
window.__results = [];

async function main() {
  const manifestUrl = new URL("./manifest.json", import.meta.url);
  const manifest: ManifestEntry[] = await (await fetch(manifestUrl)).json();
  log(`loaded manifest: ${manifest.length} photos`);

  const device = window.__forceWasm ? "wasm" : await detectDevice();
  log(`device: ${device}`);

  await loadOcrModel(device, (e) => log(`  ocr ${e.file}: ${e.percent}%`));
  log("OCR model ready");

  const results: EvalResult[] = [];
  for (const entry of manifest) {
    const lang = findLanguage(entry.lang);
    await loadTranslationModel(lang, device, (e) => log(`  mt(${lang.code}) ${e.file}: ${e.percent}%`));

    const imgUrl = new URL(`./photos/${entry.file}`, import.meta.url);
    const t0 = performance.now();
    const ocr = await runOcr(imgUrl.href);
    const translated = await translateRegions(ocr.regions, lang);
    const totalMs = performance.now() - t0;

    log(
      `${entry.file} [${lang.code}]: ${ocr.regions.length} region(s), ` +
        `ocr ${(ocr.elapsedMs / 1000).toFixed(1)}s, translate ${(translated.elapsedMs / 1000).toFixed(1)}s, ` +
        `total ${(totalMs / 1000).toFixed(1)}s`,
    );

    results.push({
      file: entry.file,
      lang: entry.lang,
      regionsFound: ocr.regions.length,
      ocrMs: ocr.elapsedMs,
      translateMs: translated.elapsedMs,
      totalMs,
      regions: translated.regions.map((r) => ({ text: r.text, translated: r.translated })),
    });
    window.__results = results;
  }

  log("=== EVAL DONE ===");
  window.__done = true;
}

main().catch((err) => {
  log(`ERROR: ${err?.message ?? err}`);
  log(err?.stack ?? "");
  window.__error = String(err?.stack ?? err);
  window.__done = true;
});
