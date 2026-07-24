/** Tiny dependency-free event emitter (replaces Phaser's). */
export class Emitter {
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, fn: (...args: unknown[]) => void): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn);
  }

  emit(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.forEach((fn) => fn(...args));
  }

  clear(): void {
    this.handlers.clear();
  }
}
