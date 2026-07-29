// Scripted playthrough: resume a scored run -> forced game over -> game-over
// screen + leaderboard, then confirm the garage reset kept unlocks.
// Score *accrual* is covered deterministically by unit/run-score.test.ts; this
// proves the plumbing (run state -> SurvivalMode -> leaderboard -> reset).
// Usage: node verify-leaderboard.mjs <url>   (server must already be running)
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:5173';
const shots = 'docs/screenshots';
const SEEDED = { wave: 5, kills: 42, score: 7350 };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const seam = async (fn, ...args) =>
  page.evaluate(([f, a]) => window.__scrapRig[f](...a), [fn, args]);
const boot = async () =>
  page.waitForFunction(() => window.__scrapRig !== undefined, {
    timeout: 30_000,
  });

await page.goto(`${url}/?debug=1`, { waitUntil: 'networkidle' });
await boot();

// Seed progression we expect to survive death.
await page.evaluate(() => {
  const key = 'scraprig.profile.v1';
  const p = JSON.parse(localStorage.getItem(key) ?? '{}');
  p.schemaVersion = 1;
  p.money = 5000;
  p.unlockedDefIds = [...new Set([...(p.unlockedDefIds ?? []), 'mine-sweeper'])];
  p.highestWaveCleared = 8;
  localStorage.setItem(key, JSON.stringify(p));
});
await page.reload({ waitUntil: 'networkidle' });
await boot();

if (!(await seam('continueGame'))) throw new Error('continueGame refused');
await page.waitForTimeout(800);

// Seed a mid-run save carrying a known score, then resume straight into it.
const blueprint = JSON.parse(await seam('getBlueprintJson'));
await page.evaluate(
  ([bp, seeded]) => {
    localStorage.setItem(
      'scraprig.run.v1',
      JSON.stringify({
        schemaVersion: 3,
        wave: seeded.wave,
        kills: seeded.kills,
        score: seeded.score,
        bankedEarnings: 300,
        blueprint: bp,
        partHp: {},
        savedAt: Date.now(),
      }),
    );
  },
  [blueprint, SEEDED],
);
// The run store caches its first read, so the seeded save must be present
// before the app boots.
await page.reload({ waitUntil: 'networkidle' });
await boot();
if (!(await seam('resumeSavedRun'))) throw new Error('resumeSavedRun refused');
await page.waitForTimeout(2000);

const resumed = await seam('survivalTelemetry');
console.log('resumed ->', {
  wave: resumed?.wave,
  kills: resumed?.kills,
  score: resumed?.score,
});

await seam('forceGameOver');
await page.waitForTimeout(1500);

await page
  .locator('.survival-gameover')
  .waitFor({ state: 'visible', timeout: 10_000 });
await page.screenshot({ path: `${shots}/gameover-leaderboard.png` });

const shown = {
  score: (await page.locator('.survival-gameover__score').textContent())?.trim(),
  rows: await page.locator('.survival-gameover .leaderboard tbody tr').count(),
  highlighted: await page
    .locator('.survival-gameover .leaderboard tr.is-current-run')
    .count(),
  best: await page.locator('.survival-gameover__best').isVisible(),
  reset: (await page.locator('.survival-gameover__reset').textContent())?.trim(),
};

await page.locator('.survival-gameover__actions button').click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${shots}/gameover-garage-after-reset.png` });

const profile = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('scraprig.profile.v1') ?? '{}'),
);
const board = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('scraprig.leaderboard.v1') ?? '[]'),
);
const runSaveCleared = await page.evaluate(
  () => localStorage.getItem('scraprig.run.v1') === null,
);

console.log(
  JSON.stringify(
    {
      resumedScore: resumed?.score,
      shown,
      moneyAfter: profile.money,
      unlocksKept: (profile.unlockedDefIds ?? []).includes('mine-sweeper'),
      highestWaveKept: profile.highestWaveCleared,
      runSaveCleared,
      topEntry: board[0],
      pageErrors: errors,
    },
    null,
    2,
  ),
);

const fail = [];
if (resumed?.score !== SEEDED.score) fail.push('resumed run lost its score');
if (shown.score !== SEEDED.score.toLocaleString()) {
  fail.push(`overlay showed "${shown.score}", expected ${SEEDED.score.toLocaleString()}`);
}
if (shown.rows < 1) fail.push('leaderboard table empty');
if (shown.highlighted !== 1) {
  fail.push(`expected 1 highlighted row, got ${shown.highlighted}`);
}
if (!shown.best) fail.push('first run should be flagged a personal best');
if (board[0]?.score !== SEEDED.score) fail.push('recorded entry has wrong score');
if (board[0]?.wave !== SEEDED.wave) fail.push('recorded entry has wrong wave');
if (profile.money !== 200) fail.push(`money not reset (${profile.money})`);
if (!(profile.unlockedDefIds ?? []).includes('mine-sweeper')) {
  fail.push('unlocks were wiped (should persist)');
}
if (profile.highestWaveCleared !== 8) fail.push('highestWaveCleared was wiped');
if (!runSaveCleared) fail.push('run save survived a finished run');
if (errors.length > 0) fail.push(`page errors: ${errors.join(' | ')}`);

await browser.close();
if (fail.length > 0) {
  console.error('\nFAILED:\n- ' + fail.join('\n- '));
  process.exit(1);
}
console.log('\nPASS: score recorded and shown, garage reset, unlocks kept.');
