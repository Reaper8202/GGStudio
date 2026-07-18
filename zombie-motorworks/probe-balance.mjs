// Balance probe: Probe A (stationary) + Probe B (kiting).
// Handles the wave-clear -> build-phase -> re-enter-survival cycle so multi-wave
// runs can be tracked, and distinguishes build-phase transitions from game-over
// via runState() (build phase keeps a run; game-over nulls it).
import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:4183';
const MAX_STEPS = 60_000;
const STEP_CHUNK = 15;

async function bootAndEnterSurvival(page) {
  await page.goto(`${BASE_URL}/?debug=1`);
  await page.waitForFunction(() => window.__scrapRig !== undefined, null, { timeout: 20000 });
  const continued = await page.evaluate(() => window.__scrapRig.continueGame());
  if (!continued) {
    const started = await page.evaluate(() => window.__scrapRig.newGame());
    if (!started) throw new Error('newGame failed');
  }
  await page.waitForFunction(() => window.__scrapRig.mode() === 'editor');
  await page.evaluate(() => window.__scrapRig.grantMoney(5000));
  const entered = await page.evaluate(() => window.__scrapRig.enterSurvival());
  if (!entered) throw new Error('enterSurvival failed');
  await page.evaluate(() => window.__scrapRig.setSimPaused(true));
}

async function resumeAfterBuildPhase(page) {
  const entered = await page.evaluate(() => window.__scrapRig.enterSurvival());
  if (!entered) throw new Error('resume enterSurvival failed');
  await page.evaluate(() => window.__scrapRig.setSimPaused(true));
}

/**
 * @param page
 * @param applyControls async (page) => void, called once per resume and whenever asked to refresh
 * @param maxWave stop once this wave boundary is reached (inclusive cap)
 */
async function runProbe(page, applyControls, maxWave) {
  await bootAndEnterSurvival(page);
  await applyControls(page, 1);

  const waveBoundaries = [];
  let lastWave = 0;
  let gameOverWave = null;
  let steps = 0;
  let steerPhaseSteps = 0;
  let steerSign = 1;

  while (steps < MAX_STEPS) {
    const mode = await page.evaluate(() => window.__scrapRig.mode());
    if (mode !== 'survival') {
      const runState = await page.evaluate(() => window.__scrapRig.runState());
      if (runState === null) {
        // Game over: finishRun() nulled the active run.
        break;
      }
      // Build phase: wave cleared, resume into the next wave.
      await resumeAfterBuildPhase(page);
      await applyControls(page, steerSign);
      continue;
    }

    await page.evaluate((n) => window.__scrapRig.stepSim(n), STEP_CHUNK);
    steps += STEP_CHUNK;
    steerPhaseSteps += STEP_CHUNK;
    if (steerPhaseSteps >= 300) {
      steerPhaseSteps = 0;
      steerSign *= -1;
      await applyControls(page, steerSign);
    }

    const telemetry = await page.evaluate(() => window.__scrapRig.survivalTelemetry());
    if (!telemetry) continue;
    if (telemetry.wave !== lastWave) {
      waveBoundaries.push({ wave: telemetry.wave, integrityPct: telemetry.integrityPct, atStep: steps });
      lastWave = telemetry.wave;
    }
    if (telemetry.phase === 'gameOver') {
      gameOverWave = telemetry.wave;
      break;
    }
    if (telemetry.wave >= maxWave) break;
  }

  return { waveBoundaries, gameOverWave, steps };
}

async function main() {
  const browser = await chromium.launch();

  console.log('=== PROBE A: stationary (hands off) ===');
  const pageA = await browser.newPage();
  const resultA = await runProbe(
    pageA,
    async (page) => {
      await page.evaluate(() => window.__scrapRig.setControls({ throttle: 0, steer: 0 }));
    },
    11,
  );
  console.log(JSON.stringify(resultA, null, 2));
  await pageA.close();

  console.log('=== PROBE B: kiting (throttle 1, steer flips every 300 steps) ===');
  const pageB = await browser.newPage();
  const resultB = await runProbe(
    pageB,
    async (page, sign) => {
      await page.evaluate((s) => window.__scrapRig.setControls({ throttle: 1, steer: s }), sign);
    },
    5,
  );
  console.log(JSON.stringify(resultB, null, 2));
  await pageB.close();

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
