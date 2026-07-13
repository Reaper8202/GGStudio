/**
 * UI/economy timing tuning (Agent D: UI & Progression). All animation
 * durations for HUD feedback (money popups, banners, flashes) live here so
 * TS and CSS share a single source of truth — components set
 * `style.animationDuration` from these values instead of hardcoding
 * durations in `hud.css` keyframes.
 *
 * Owned by Agent D (`docs/STATUS.md` ownership table).
 */
export const EconomyUiConfig = {
  /** "+$N" floating popup near the money readout. */
  moneyPopupDurationMs: 900,
  /** Center banners: wave start / wave complete / purchase confirmation. */
  bannerDurationMs: 1800,
  /** Red screen-edge vignette flash on `vehicle:damaged`. */
  damageFlashDurationMs: 450,
  /** Pop-in animation for the 3-2-1 countdown digit. */
  countdownPopDurationMs: 500,
  /** "GO!" flash shown on the Countdown -> WaveActive transition. */
  goFlashDurationMs: 700,
} as const;
