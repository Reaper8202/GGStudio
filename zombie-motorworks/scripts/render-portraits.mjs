// Renders every zombie/character voxel model to a high-res transparent PNG
// portrait via the portraitRig three.js scene, for use as UI art.
//
// Usage: node scripts/render-portraits.mjs [name...]
//   With no args, renders every character in CHARACTERS.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public/assets/zombies/portraits');
mkdirSync(outDir, { recursive: true });

const SIZE = 1600;

const CHARACTERS = [
  // Walker variants get a dynamic reaching/lunging pose: arms bent forward
  // and spread from the shoulder, plus a forward body lean. See
  // applyLungeArms in portraitRig.ts for why this is a whole-triangle
  // transform rather than a per-vertex one.
  { name: 'zed-1', asset: 'Zed_1', pose: 'lunge' },
  { name: 'zed-2', asset: 'Zed_2', pose: 'lunge' },
  { name: 'zed-3', asset: 'Zed_3', pose: 'lunge' },
  { name: 'zed-4', asset: 'Zed_4', pose: 'lunge' },
  { name: 'zed-5', asset: 'Zed_5', pose: 'lunge' },
  { name: 'zed-6', asset: 'Zed_6', pose: 'lunge' },
  // Asymmetric throwing-reach pose self-shadows badly at the default 35°
  // yaw; a near-front angle reads far more clearly.
  { name: 'zombie-city-thrower', asset: 'zombie_city', yaw: 5 },
  { name: 'zombie-worker', asset: 'zombie_worker' },
  { name: 'phone-addict-woman', asset: 'PhoneAddict-0-Woman' },
  { name: 'phone-addict-man', asset: 'PhoneAddict-1-Man' },
];

const requested = process.argv.slice(2);
const targets = requested.length
  ? CHARACTERS.filter((c) => requested.includes(c.name) || requested.includes(c.asset))
  : CHARACTERS;

if (!targets.length) {
  console.error('No matching characters for:', requested.join(', '));
  process.exit(1);
}

async function main() {
  const server = await createServer({ root, server: { port: 0 }, logLevel: 'error' });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : null;
  if (!port) throw new Error('render-portraits: could not determine dev server port');
  const baseUrl = `http://localhost:${port}`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('[console.error]', m.text());
  });

  for (const { name, asset, ...extra } of targets) {
    const url = new URL('/portrait.html', baseUrl);
    url.searchParams.set('asset', `/assets/zombies/${asset}`);
    url.searchParams.set('w', String(SIZE));
    url.searchParams.set('h', String(SIZE));
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    await page.goto(url.toString());
    await page.waitForFunction(() => window.__portraitReady === true, null, { timeout: 20000 });
    const dataUrl = await page.evaluate(() => window.__capturePortrait());
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const outPath = path.join(outDir, `${name}.png`);
    writeFileSync(outPath, Buffer.from(base64, 'base64'));
    console.log('rendered', name, '->', path.relative(root, outPath));
  }

  await browser.close();
  await server.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
