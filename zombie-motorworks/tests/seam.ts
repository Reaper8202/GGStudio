/** Shared helpers for driving the app through the ?debug=1 seam. */

import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __scrapRig: {
      mode(): 'title' | 'editor' | 'chamber' | 'survival';
      newGame(): boolean;
      continueGame(): boolean;
      getBlueprintJson(): string;
      loadBlueprintJson(json: string): void;
      place(
        defId: string,
        pos: { x: number; y: number; z: number },
        orient?: number,
        config?: Record<string, unknown>,
      ): { ok: boolean; issues: string[] };
      startTutorial(): void;
      tutorialState():
        { active: boolean; stepIndex: number; total: number } | undefined;
      configureAt(
        pos: { x: number; y: number; z: number },
        config: Record<string, unknown>,
      ): boolean;
      undo(): void;
      redo(): void;
      validate(): { errors: { code: string }[]; warnings: unknown[] };
      analyze(): Record<string, unknown> & { warnings: { code: string }[] };
      enterTest(): boolean;
      enterSurvival(): boolean;
      backToEditor(): void;
      setControls(c: Record<string, unknown>): void;
      stepSim(steps: number): void;
      setSimPaused(paused: boolean): void;
      telemetry(): {
        speedKmh: number;
        rpm: number;
        fuel: number;
        ammo: number;
        groundedWheels: number;
        totalWheels: number;
        aliveParts: number;
        detachedParts: number;
        position: { x: number; y: number; z: number };
        rotation: { x: number; y: number; z: number; w: number };
        angvel: { x: number; y: number; z: number };
      };
      survivalTelemetry(): {
        mode: 'survival';
        kills: number;
        wave: number;
        zombiesAlive: number;
        runMoney: number;
        money: number;
        phase: 'countdown' | 'active' | 'cleared' | 'gameOver';
        partHp: Record<string, number>;
        integrityPct: number;
        vehiclePos: [number, number, number];
        rotation: [number, number, number, number];
        angvel: [number, number, number];
        cameraPos: [number, number, number];
        groundedWheels: number;
        weapons: {
          partId: string;
          aimMode: 'auto' | 'manual';
          shotsFired: number;
        }[];
        wheels: {
          partId: string;
          worldCentre: [number, number, number];
        }[];
      } | null;
      profile(): { money: number; unlocks: string[] };
      grantMoney(amount: number): boolean;
      buyUpgrade(partId: string): boolean;
      sellPart(partId: string): boolean;
      unlockPart(defId: string): boolean;
      runState(): { wave: number; inBuildPhase: boolean } | null;
      zombiePositions(): [number, number, number][];
      debugStartWave(wave: number): void;
      debugKillAllZombies(): void;
      forceWaveComplete(): void;
      setScenario(s: string): void;
      resetVehicle(): void;
      orient: { yaw90: number; yaw180: number; rollX90: number };
      composeOrient(a: number, b: number): number;
    };
  }
}

export async function orientOf(
  page: Page,
  name: 'yaw90' | 'yaw180' | 'rollX90',
): Promise<number> {
  return page.evaluate((n) => window.__scrapRig.orient[n as 'yaw90'], name);
}

export async function boot(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await page.waitForFunction(() => window.__scrapRig !== undefined, null, {
    timeout: 20000,
  });
  await advanceToEditor(page);
  await page.waitForTimeout(400);
}

/** Advance an already-loaded debug title screen using the available save. */
export async function advanceToEditor(page: Page): Promise<void> {
  const continued = await page.evaluate(() => window.__scrapRig.continueGame());
  if (!continued) {
    const started = await page.evaluate(() => window.__scrapRig.newGame());
    if (!started) {
      throw new Error('New Game unexpectedly requires confirmation');
    }
  }
  await page.waitForFunction(() => window.__scrapRig.mode() === 'editor');
}

/** Replace the starter blueprint with an empty one and build via seam. */
export async function newBlueprint(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__scrapRig.loadBlueprintJson(
      JSON.stringify({ schemaVersion: 2, id: 'test', name: 'test', parts: [] }),
    );
  });
}

export type P = { x: number; y: number; z: number };

export async function place(
  page: Page,
  defId: string,
  pos: P,
  orient = 0,
  config: Record<string, unknown> = {},
): Promise<{ ok: boolean; issues: string[] }> {
  return page.evaluate(
    ([d, p, o, c]) =>
      window.__scrapRig.place(
        d as string,
        p as P,
        o as number,
        c as Record<string, unknown>,
      ),
    [defId, pos, orient, config] as const,
  );
}

/** A minimal valid drivable rig (mirrors the starter layout, fewer frames). */
export async function buildBasicRig(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__scrapRig.grantMoney(5_000);
    window.__scrapRig.unlockPart('frame-reinforced');
  });
  await newBlueprint(page);
  const steps: [string, P, number?][] = [
    ['chassis-core', { x: 0, y: 1, z: 0 }],
    ['driver-seat', { x: 0, y: 2, z: 0 }],
    ['frame-box', { x: 0, y: 1, z: 1 }],
    ['frame-box', { x: 0, y: 1, z: 2 }],
    ['frame-box', { x: 0, y: 1, z: -1 }],
    ['frame-box', { x: 1, y: 1, z: 0 }],
    ['frame-box', { x: -1, y: 1, z: 0 }],
    ['frame-box', { x: 1, y: 1, z: 1 }],
    ['frame-box', { x: -1, y: 1, z: 1 }],
    ['frame-box', { x: 1, y: 1, z: -1 }],
    ['frame-box', { x: -1, y: 1, z: -1 }],
    ['frame-box', { x: 1, y: 1, z: 2 }],
    ['frame-box', { x: -1, y: 1, z: 2 }],
    ['frame-box', { x: 1, y: 1, z: -2 }],
    ['frame-box', { x: -1, y: 1, z: -2 }],
    ['frame-box', { x: 0, y: 1, z: -2 }],
    ['engine-small', { x: 0, y: 2, z: -2 }],
    ['fuel-tank', { x: 0, y: 2, z: -1 }],
  ];
  for (const [d, p, o] of steps) {
    const r = await place(page, d, p, o ?? 0);
    if (!r.ok)
      throw new Error(
        `place ${d} at ${JSON.stringify(p)} failed: ${r.issues.join(', ')}`,
      );
  }
  // Wheels: right side (x>0) needs yaw-180 so its inner socket faces the mount.
  const yaw180 = await orientOf(page, 'yaw180');
  const wheels: [P, number][] = [
    [{ x: 2, y: 1, z: 2 }, yaw180],
    [{ x: -2, y: 1, z: 2 }, 0],
    [{ x: 2, y: 1, z: -2 }, yaw180],
    [{ x: -2, y: 1, z: -2 }, 0],
  ];
  for (const [p, o] of wheels) {
    const r = await place(page, 'wheel-standard', p, o);
    if (!r.ok)
      throw new Error(
        `wheel at ${JSON.stringify(p)} failed: ${r.issues.join(', ')}`,
      );
  }
}

export async function settle(page: Page, ms = 1200): Promise<void> {
  await page.waitForTimeout(ms);
}
