// Scripted playthrough: run -> forced game over -> game-over screen + leaderboard.
// Verifies the score is recorded, the garage is reset, and unlocks survive.
// Run with the dev server already up: node verify-leaderboard.mjs <url>
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:5173';
const shots = 'docs/screenshots';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(`${url}/?debug=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__scrapRig !== undefined, {
  timeout: 30_000,
});

const seam = async (fn, ...args) =>
  page.evaluate(
    ([f, a]) => window.__scrapRig[f](...a),
    [fn, args],
  );

// Give the player a known catalog entry so we can prove unlocks survive death.
await page.evaluate(() => {
  const key = 'scraprig.profile.v1';
  const p = JSON.parse(localStorage.getItem(key) ?? '{}');
  p.schemaVersion = 1;
  p.money = 5000;
  p.unlockedDefIds = [
    ...new Set([...(p.unlockedDefIds ?? []), 'mine-sweeper']),
  ];
  p.highestWaveCleared = 8;
  localStorage.setItem(key, JSON.stringify(p));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__scrapRig !== undefined);

// Into the garage, then start a run.
if (!(await seam('continueGame'))) {
  throw new Error('continueGame refused to open the garage');
}
await page.waitForTimeout(800);
console.log('mode after continue:', await seam('mode'));
if (!(await seam('enterSurvival'))) {
  throw new Error('enterSurvival refused the starter blueprint');
}
await page.waitForTimeout(1500);

// Let the rig's auto-turret make REAL kills. Debug force-kills deliberately
// award no score, so scoring must be proven through ordinary gameplay.
let live = null;
for (let i = 0; i < 45; i++) {
  // Drive: a stationary rig meets nothing. Ramming and turret fire both count.
  await seam('setControls', { throttle: 1, steer: i % 8 < 4 ? 0.25 : -0.25 });
  await page.waitForTimeout(1000);
  live = await seam('survivalTelemetry');
  if (i % 10 === 0) {
    console.log(`  t=${i}s phase=${live?.phase} alive=${live?.zombiesAlive} kills=${live?.kills} score=${live?.score}`);
  }
  if ((live?.kills ?? 0) >= 3 && (live?.score ?? 0) > 0) break;
}
await seam('setControls', { throttle: 0, steer: 0 });
console.log('after real combat -> kills:', live?.kills, 'score:', live?.score);
const scoredInPlay = (live?.score ?? 0) > 0;

await seam('forceGameOver');
await page.waitForTimeout(1200);

const overlay = page.locator('.survival-gameover');
await overlay.waitFor({ state: 'visible', timeout: 10_000 });
await page.screenshot({ path: `${shots}/gameover-leaderboard.png` });

const finalScore = await page.locator('.survival-gameover__score').textContent();
const rows = await page.locator('.survival-gameover .leaderboard tbody tr').count();
const highlighted = await page
  .locator('.survival-gameover .leaderboard tr.is-current-run')
  .count();
const resetNote = await page.locator('.survival-gameover__reset').textContent();

// Back to the garage and confirm the reset actually happened.
await page.locator('.survival-gameover__actions button').click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${shots}/gameover-garage-after-reset.png` });

const profile = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('scraprig.profile.v1') ?? '{}'),
);
const board = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('scraprig.leaderboard.v1') ?? '[]'),
);

const results = {
  finalScoreShown: finalScore,
  leaderboardRows: rows,
  currentRunHighlighted: highlighted,
  resetNote: resetNote?.trim(),
  moneyAfter: profile.money,
  unlocksKept: (profile.unlockedDefIds ?? []).includes('mine-sweeper'),
  highestWaveKept: profile.highestWaveCleared,
  blueprintNameCleared: profile.currentBlueprintName === undefined,
  scoredDuringPlay: scoredInPlay,
  boardEntries: board.length,
  topEntry: board[0],
  pageErrors: errors,
};
console.log(JSON.stringify(results, null, 2));

const fail = [];
if (!finalScore || finalScore.trim() === '') fail.push('no final score shown');
if (rows < 1) fail.push('leaderboard table empty');
if (highlighted !== 1) fail.push(`expected 1 highlighted row, got ${highlighted}`);
if (profile.money !== 200) fail.push(`money not reset (${profile.money})`);
if (!results.unlocksKept) fail.push('unlocks were wiped (should persist)');
if (profile.highestWaveCleared !== 8) fail.push('highestWaveCleared was wiped');
if (board.length < 1) fail.push('nothing recorded on the local board');
if (!scoredInPlay) fail.push('score never accrued from real kills');
if ((board[0]?.score ?? 0) <= 0) fail.push('recorded entry has no score');
if (errors.length > 0) fail.push(`page errors: ${errors.join(' | ')}`);

await browser.close();
if (fail.length > 0) {
  console.error('\nFAILED:\n- ' + fail.join('\n- '));
  process.exit(1);
}
console.log('\nPASS: score recorded, garage reset, unlocks kept.');
