import "./style.css";
import { LANGUAGES, findLanguage } from "./languages.ts";
import type { OcrRegion } from "./merge.ts";
import { rectToOverlayBox } from "./layout.ts";
import { detectDevice, loadOcrModel, loadTranslationModel, runOcr, translateRegions, type Device } from "./pipeline.ts";

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <header class="app-header">
    <div class="title-row">
      <h1>lenslocal</h1>
      <a class="gh-link" href="https://github.com/Arthur031221/lenslocal" target="_blank" rel="noopener">Source</a>
    </div>
    <p class="tagline">Point your camera or drop a photo of foreign text. Everything runs on this device.</p>
  </header>

  <section class="panel controls">
    <label for="lang-select">
      Source language
      <select id="lang-select"></select>
    </label>
    <button id="camera-btn" class="btn" type="button">Use camera</button>
  </section>

  <section class="panel">
    <div id="dropzone" class="dropzone" tabindex="0" role="button" aria-label="Drop a photo here or choose a file">
      Drag a photo here, or <span class="browse">choose a file</span>
      <input id="file-input" type="file" accept="image/*" />
    </div>
  </section>

  <section id="stage">
    <video id="video" muted playsinline autoplay></video>
    <img id="photo" alt="Selected photo" />
    <div id="overlay-root" aria-hidden="true"></div>
  </section>

  <div class="capture-row">
    <button id="capture-btn" class="btn primary" type="button" hidden>Capture</button>
    <button id="cancel-camera-btn" class="btn" type="button" hidden>Cancel</button>
  </div>

  <section class="panel status-bar" id="status-bar" data-state="idle">
    <div class="status-line">
      <span id="status-text">Choose or capture a photo to begin.</span>
      <span id="status-time"></span>
    </div>
    <div class="progress-track"><div id="progress-fill" class="progress-fill"></div></div>
  </section>

  <section class="panel" id="results-panel" hidden>
    <h2>Text found</h2>
    <div id="result-list" class="result-list"></div>
  </section>

  <footer class="app-footer">
    Nothing in this photo leaves your device. Model weights are fetched once from Hugging Face and cached by the browser.
    <a href="https://github.com/Arthur031221/lenslocal#how-it-works" target="_blank" rel="noopener">How it works</a>
  </footer>
`;

const langSelect = document.querySelector<HTMLSelectElement>("#lang-select")!;
const cameraBtn = document.querySelector<HTMLButtonElement>("#camera-btn")!;
const dropzone = document.querySelector<HTMLDivElement>("#dropzone")!;
const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
const stage = document.querySelector<HTMLDivElement>("#stage")!;
const video = document.querySelector<HTMLVideoElement>("#video")!;
const photo = document.querySelector<HTMLImageElement>("#photo")!;
const overlayRoot = document.querySelector<HTMLDivElement>("#overlay-root")!;
const captureBtn = document.querySelector<HTMLButtonElement>("#capture-btn")!;
const cancelCameraBtn = document.querySelector<HTMLButtonElement>("#cancel-camera-btn")!;
const statusBar = document.querySelector<HTMLDivElement>("#status-bar")!;
const statusText = document.querySelector<HTMLSpanElement>("#status-text")!;
const statusTime = document.querySelector<HTMLSpanElement>("#status-time")!;
const progressFill = document.querySelector<HTMLDivElement>("#progress-fill")!;
const resultsPanel = document.querySelector<HTMLElement>("#results-panel")!;
const resultList = document.querySelector<HTMLDivElement>("#result-list")!;

for (const lang of LANGUAGES) {
  const option = document.createElement("option");
  option.value = lang.code;
  option.textContent = lang.name;
  langSelect.appendChild(option);
}

let mediaStream: MediaStream | undefined;
let busy = false;
let device: Device | undefined;
let lastNaturalSize = { width: 0, height: 0 };
let lastRegions: OcrRegion[] = [];
let resizeScheduled = false;
let lastObjectUrl: string | undefined;

function setStatus(text: string, state: "idle" | "busy" | "error" | "done" = "busy") {
  statusText.textContent = text;
  statusBar.dataset.state = state;
}

function setProgress(percent: number) {
  progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
}

function setControlsDisabled(disabled: boolean) {
  langSelect.disabled = disabled;
  cameraBtn.disabled = disabled;
  dropzone.setAttribute("aria-disabled", String(disabled));
  fileInput.disabled = disabled;
}

// --- Camera capture -------------------------------------------------------

cameraBtn.addEventListener("click", async () => {
  if (busy) return;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    video.srcObject = mediaStream;
    stage.classList.add("visible");
    video.style.display = "block";
    photo.style.display = "none";
    captureBtn.hidden = false;
    cancelCameraBtn.hidden = false;
    setStatus("Camera ready. Frame the text and capture.", "idle");
  } catch (err) {
    setStatus(`Could not open the camera: ${describeError(err)}`, "error");
  }
});

cancelCameraBtn.addEventListener("click", stopCamera);

function stopCamera() {
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = undefined;
  video.style.display = "none";
  captureBtn.hidden = true;
  cancelCameraBtn.hidden = true;
}

captureBtn.addEventListener("click", async () => {
  if (!mediaStream || busy) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(video, 0, 0);
  stopCamera();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (blob) await handleImageBlob(blob);
});

// --- File drop / picker ----------------------------------------------------

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});
dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("drag-over");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("drag-over");
  const file = event.dataTransfer?.files?.[0];
  if (file) void handleImageBlob(file);
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void handleImageBlob(file);
  fileInput.value = "";
});

// --- Pipeline orchestration --------------------------------------------------

async function handleImageBlob(blob: Blob) {
  if (busy) return;
  busy = true;
  setControlsDisabled(true);
  clearOverlay();
  resultsPanel.hidden = true;
  statusTime.textContent = "";

  try {
    stopCamera();
    stage.classList.add("visible");
    photo.style.display = "block";
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = URL.createObjectURL(blob);
    photo.src = lastObjectUrl;
    await photo.decode();
    lastNaturalSize = { width: photo.naturalWidth, height: photo.naturalHeight };

    if (!device) {
      setStatus("Checking for WebGPU...");
      device = await detectDevice();
    }

    const lang = findLanguage(langSelect.value);

    setStatus(`Loading OCR model (device: ${device})...`);
    setProgress(0);
    await loadOcrModel(device, (event) => setProgress(event.percent));

    setStatus(`Loading ${lang.name} translation model...`);
    setProgress(0);
    await loadTranslationModel(lang, device, (event) => setProgress(event.percent));

    setStatus("Reading text in the photo...");
    setProgress(0);
    const t0 = performance.now();
    const ocrResult = await runOcr(blob);

    if (ocrResult.regions.length === 0) {
      setStatus("No text found in this photo.", "done");
      busy = false;
      setControlsDisabled(false);
      return;
    }

    setStatus(`Translating ${ocrResult.regions.length} region(s)...`);
    const translateResult = await translateRegions(ocrResult.regions, lang);
    const totalMs = performance.now() - t0;

    lastRegions = translateResult.regions;
    renderOverlay();
    renderResultList(translateResult.regions);
    resultsPanel.hidden = false;

    setStatus(`Done. ${translateResult.regions.length} region(s) found.`, "done");
    statusTime.textContent = `${(totalMs / 1000).toFixed(1)}s (OCR ${(ocrResult.elapsedMs / 1000).toFixed(1)}s, translate ${(translateResult.elapsedMs / 1000).toFixed(1)}s)`;
    setProgress(100);
  } catch (err) {
    setStatus(`Something went wrong: ${describeError(err)}`, "error");
  } finally {
    busy = false;
    setControlsDisabled(false);
  }
}

function clearOverlay() {
  overlayRoot.innerHTML = "";
  lastRegions = [];
}

function renderOverlay() {
  overlayRoot.innerHTML = "";
  const containerSize = { width: stage.clientWidth, height: stage.clientHeight };
  for (const region of lastRegions) {
    const box = rectToOverlayBox(region.rect, lastNaturalSize, containerSize);
    const el = document.createElement("div");
    el.className = "ocr-box";
    el.style.left = `${box.left}px`;
    el.style.top = `${box.top}px`;
    el.style.width = `${box.width}px`;
    el.style.height = `${box.height}px`;
    el.style.fontSize = `${box.fontSize}px`;
    el.textContent = region.translated || region.text;
    el.title = region.text;
    overlayRoot.appendChild(el);
  }
}

function renderResultList(regions: OcrRegion[]) {
  resultList.innerHTML = "";
  for (const region of regions) {
    const row = document.createElement("div");
    row.className = "result-row";
    const translated = document.createElement("div");
    translated.className = "translated";
    translated.textContent = region.translated || region.text;
    const original = document.createElement("div");
    original.className = "original";
    original.textContent = region.text;
    row.appendChild(translated);
    row.appendChild(original);
    resultList.appendChild(row);
  }
}

window.addEventListener("resize", () => {
  if (resizeScheduled || lastRegions.length === 0) return;
  resizeScheduled = true;
  requestAnimationFrame(() => {
    renderOverlay();
    resizeScheduled = false;
  });
});

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// --- Service worker (app-shell caching only, see public/sw.js) -------------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline app-shell caching is a nice-to-have; the translate flow still
      // works without it as long as the model weights are already cached.
    });
  });
}
