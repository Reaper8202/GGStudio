/**
 * Minimal generic pool — obstacles and coins are recycled so the run loop
 * allocates nothing per frame.
 */
export class ObjectPool<T> {
  private free: T[] = [];

  constructor(
    private readonly create: () => T,
    private readonly onRelease: (item: T) => void,
  ) {}

  acquire(): T {
    return this.free.pop() ?? this.create();
  }

  release(item: T): void {
    this.onRelease(item);
    this.free.push(item);
  }
}
