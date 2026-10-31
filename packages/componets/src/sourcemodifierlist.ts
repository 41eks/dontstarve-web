import { createEffect, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';

/** util/sourcemodifierlist.lua: keyed modifiers and removal of an entity's contributions. */
export class SourceModifierList {
  private readonly base: number;
  private readonly combine: (a: number, b: number) => number;
  private readonly sources = new Map<unknown, { values: Map<unknown, number>; stop?: () => void }>();
  constructor(base = 1, combine = (a: number, b: number) => a * b) { this.base = base; this.combine = combine; }
  Get(): number {
    let result = this.base;
    for (const { values } of this.sources.values()) for (const value of values.values()) result = this.combine(result, value);
    return result;
  }
  IsEmpty(): boolean { return this.sources.size === 0; }
  SetModifier(source: unknown, value: number | undefined, key: unknown = 'key'): void {
    if (source == null) return;
    if (value === undefined || value === this.base) { this.RemoveModifier(source, key); return; }
    if (!Number.isFinite(value)) throw new RangeError('Modifier must be finite');
    let entry = this.sources.get(source);
    if (!entry) {
      entry = { values: new Map() };
      this.sources.set(source, entry);
      const removal = (source as { removal?: ReadonlySignal<boolean> }).removal;
      if (removal) {
        const removed = watchSignal(removal, stop => { entry!.stop = stop; });
        createEffect(() => { if (removed.get()) this.RemoveModifier(source); });
      }
    }
    entry.values.set(key, value);
  }
  RemoveModifier(source: unknown, key?: unknown): void {
    const entry = this.sources.get(source);
    if (!entry) return;
    if (key !== undefined) { entry.values.delete(key); if (entry.values.size) return; }
    entry.stop?.(); this.sources.delete(source);
  }
  Reset(): void { for (const source of this.sources.keys()) this.RemoveModifier(source); }
}
