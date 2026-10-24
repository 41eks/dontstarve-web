import { createEffect, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';

/**
 * Keeps a drawn sprite's animation equal to a signal the prefab declared (a heat rock's range names its clip).
 * Declaring another source, or none, ends the previous one; disposing ends it with the display.
 */
export class AnimationFollower {
  private readonly apply: (name: string) => void;
  private source: ReadonlySignal<string | number> | undefined;
  private stop = () => {};

  constructor(apply: (name: string) => void) { this.apply = apply; }

  follow(source: ReadonlySignal<string | number> | undefined): void {
    if (source === this.source) return;
    this.stop();
    this.stop = () => {};
    this.source = source;
    if (!source) return;
    // The watched signal owns the effect that reads it: stopping the bridge stops both.
    const local = watchSignal(source, stop => { this.stop = stop; });
    createEffect(() => this.apply(String(local.get())));
  }

  dispose(): void {
    this.stop();
    this.stop = () => {};
    this.source = undefined;
  }
}
