// Drives eval.html headless with the Playwright Chromium-for-Testing build
// (same browser feasibility/run.mjs used) and writes eval/results.json.
//
// Usage: FEAS_URL=http://localhost:PORT/eval.html node eval/run.mjs

import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, ".pw-profile");

const CHROME_PATH =
  "/Users/arthur/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const URL_ = process.env.FEAS_URL ?? "http://localhost:5173/eval.html";
const forceWasm = process.env.FORCE_WASM === "1";
const headed = process.env.HEADED === "1";

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  executablePath: CHROME_PATH,
  headless: !headed,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal", "--ignore-gpu-blocklist"],
});

const page = await context.newPage();
page.on("console", (msg) => console.log(`[page] ${msg.text()}`));
page.on("pageerror", (err) => console.error(`[pageerror] ${err}`));

if (forceWasm) {
  await page.addInitScript(() => {
    window.__forceWasm = true;
  });
}

const t0 = Date.now();
await page.goto(URL_);
await page.waitForFunction(() => window.__done === true, undefined, { timeout: 30 * 60 * 1000 });
const wallClockMs = Date.now() - t0;

const results = await page.evaluate(() => window.__results);
const error = await page.evaluate(() => window.__error);

const outPath = path.join(__dirname, "results.json");
writeFileSync(outPath, JSON.stringify({ results, error, wallClockMs, device: forceWasm ? "wasm" : "auto" }, null, 2));
console.log(`wrote ${outPath}`);
console.log(`wall clock: ${(wallClockMs / 1000).toFixed(1)}s`);

await context.close();
if (error) process.exit(1);
