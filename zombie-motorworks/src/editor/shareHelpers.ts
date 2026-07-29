export function buildShareLink(
  code: string,
  origin = location.origin,
  pathname = location.pathname,
): string {
  return `${origin}${pathname}?build=${encodeURIComponent(code)}`;
}

export function extractShareCode(input: string): string {
  const value = input.trim();
  try {
    const url = new URL(value);
    return url.searchParams.get('build')?.trim() ?? '';
  } catch {
    return value;
  }
}

export function sharedSlotName(
  name: string,
  existing: readonly string[],
): string {
  const used = new Set(existing);
  const base = `${name} (shared)`;
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${name} (shared ${index})`)) index += 1;
  return `${name} (shared ${index})`;
}
