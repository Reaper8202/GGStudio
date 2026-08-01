export interface TypewriterOptions {
  /** Delay between visible letters. */
  readonly intervalMs?: number;
  /** Small pause before speech begins. */
  readonly initialDelayMs?: number;
  /** Called once after each complete word becomes visible. */
  readonly onWord?: () => void;
  readonly onCharacter?: () => void;
  readonly onDone?: () => void;
}

/**
 * Writes one Unicode character at a time. Returns a cancellation callback so
 * changing tutorial steps cannot leave an old sentence typing in the new one.
 */
export function startTypewriter(
  target: HTMLElement,
  text: string,
  options: TypewriterOptions = {},
): () => void {
  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
  target.setAttribute('aria-label', text);
  target.textContent = reducedMotion ? text : '';

  if (reducedMotion || text.length === 0) {
    options.onDone?.();
    return () => undefined;
  }

  const characters = Array.from(text);
  const intervalMs = options.intervalMs ?? 24;
  const initialDelayMs = options.initialDelayMs ?? 90;
  let index = 0;
  let pendingWord = false;
  let cancelled = false;
  let timer = 0;

  const tick = (): void => {
    if (cancelled) return;
    const character = characters[index] ?? '';
    index += 1;
    target.textContent += character;
    options.onCharacter?.();

    if (/\s/u.test(character)) {
      if (pendingWord) options.onWord?.();
      pendingWord = false;
    } else {
      pendingWord = true;
    }

    if (index >= characters.length) {
      if (pendingWord) options.onWord?.();
      options.onDone?.();
      return;
    }
    timer = window.setTimeout(tick, intervalMs);
  };

  timer = window.setTimeout(tick, initialDelayMs);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
  };
}
