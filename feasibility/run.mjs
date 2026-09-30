import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, ".pw-profile");

const CHROME_PATH =
  "/Users/arthur/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const URL = process.env.FEAS_URL ?? "http://localhost:5173/feasibility.html";
const forceWasm = process.env.FORCE_WASM === "1";
const headed = process.env.HEADED === "1";

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  executablePath: CHROME_PATH,
  headless: !headed,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--use-angle=metal",
    "--ignore-gpu-blocklist",
  ],
});

const page = await context.newPage();
page.on("console", (msg) => console.log(`[page] ${msg.text()}`));
page.on("pageerror", (err) => console.error(`[pageerror] ${err}`));

await page.goto(URL);
const gpuInfo = await page.evaluate(async () => {
  if (!("gpu" in navigator)) return { available: false, reason: "navigator.gpu missing" };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { available: false, reason: "requestAdapter returned null" };
    return { available: true };
  } catch (e) {
    return { available: false, reason: String(e) };
  }
});
console.log("WebGPU probe:", JSON.stringify(gpuInfo));

const useWasm = forceWasm || !gpuInfo.available;
console.log(`Running with device=${useWasm ? "wasm" : "webgpu"} (forceWasm=${forceWasm}, gpuAvailable=${gpuInfo.available})`);

if (useWasm) {
  await page.addInitScript(() => {
    window.__forceWasm = true;
  });
  await page.reload();
}

const t0 = Date.now();
await page.goto(URL);
await page.waitForFunction(() => window.__done === true, undefined, { timeout: 600000 });
const wallClockMs = Date.now() - t0;

const result = await page.evaluate(() => window.__result);
const error = await page.evaluate(() => window.__error);

console.log("=== FEASIBILITY RESULT ===");
console.log(JSON.stringify({ result, error, wallClockMs, gpuInfo, deviceUsed: useWasm ? "wasm" : "webgpu" }, null, 2));

await context.close();

if (error) process.exit(1);
