/**
 * Headless smoke test: serves dist/ via `vite preview`, loads the game in
 * Chrome, and fails on any page error, console error, or failed request.
 * Also asserts the UI mounted and the WebGL canvas is live, then screenshots.
 *
 *   node scripts/smoke-test.mjs [--url-only]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4174;
const URL = `http://localhost:${PORT}/`;
const SETTLE_MS = 12_000;

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new globalThis.URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});

const problems = [];
let browser;
try {
  await sleep(1500); // let preview bind

  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
  });
  page.on('requestfailed', (req) => {
    problems.push(`requestfailed: ${req.url()} (${req.failure()?.errorText})`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`http ${res.status()}: ${res.url()}`);
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30_000 });
  await sleep(SETTLE_MS); // boot phase load + game:ready + background streaming starts

  const state = await page.evaluate(() => {
    const canvas = document.getElementById('game-canvas');
    const gl =
      canvas instanceof HTMLCanvasElement
        ? canvas.getContext('webgl2') ?? canvas.getContext('webgl')
        : null;
    return {
      uiChildren: document.getElementById('ui-root')?.children.length ?? 0,
      canvasSized: canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0,
      webgl: !!gl,
      title: document.title,
    };
  });

  if (state.uiChildren === 0) problems.push('assert: #ui-root has no children (UI did not mount)');
  if (!state.canvasSized) problems.push('assert: #game-canvas has zero size');
  if (!state.webgl) problems.push('assert: #game-canvas has no WebGL context');

  await page.screenshot({ path: 'smoke-screenshot.png' });
  console.log('state:', JSON.stringify(state));
} catch (e) {
  problems.push(`fatal: ${e.message}`);
} finally {
  await browser?.close().catch(() => {});
  preview.kill('SIGTERM');
}

if (problems.length) {
  console.error(`SMOKE TEST FAILED (${problems.length} problems):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('SMOKE TEST PASSED — screenshot at smoke-screenshot.png');
