/**
 * Minimal DOM stand-ins for the cash HUD that `SurvivalMode.popCashGain`
 * writes to.
 *
 * The reward tests drive `SurvivalMode` through the prototype seam in a plain
 * node environment — there is no jsdom in this project — so every DOM handle
 * the code path touches has to be handed to it. Banking a kill now floats a
 * `+$N` chit off the counter, which means the pure money maths cannot be
 * exercised without these. Kept here rather than copied into each harness so a
 * future HUD flourish is stubbed once.
 */

/** The `document.createElement` result `popCashGain` builds a chit out of. */
function createChitStub(): Record<string, unknown> {
  return {
    className: '',
    textContent: '',
    style: { setProperty: () => {} },
    addEventListener: () => {},
    remove: () => {},
  };
}

/**
 * The fields to `Object.assign` onto a seam-built `SurvivalMode`, plus the
 * global `document` the chit is created from. Call the returned `restore` in
 * an `afterEach` so the stub does not leak into another file's run.
 */
export function installCashHudStub(): {
  fields: Record<string, unknown>;
  restore(): void;
} {
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: () => createChitStub(),
  };
  return {
    fields: {
      lastCashGain: null,
      lastCashGainAt: 0,
      cashGains: { appendChild: () => {} },
      cashCounter: {
        offsetWidth: 0,
        classList: { add: () => {}, remove: () => {} },
      },
    },
    restore() {
      if (previous === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = previous;
      }
    },
  };
}
