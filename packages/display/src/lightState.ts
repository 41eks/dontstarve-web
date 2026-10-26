import { createSignal, readonlySignal, type ReadonlySignal } from '@dontstarve-web/signals';

/** inst.Light's settings; `radius` is in this scene's world units. */
export interface LightJson {
  readonly radius: number;
  readonly intensity: number;
  readonly falloff: number;
  readonly colour: readonly [number, number, number];
}

/**
 * inst.entity:AddLight(): the light an entity declares. The prefab writes it; the entity's display lists it for the
 * renderer while the entity is active, so a sleeping or removed entity emits nothing.
 */
export class LightState {
  private readonly state = createSignal<LightJson | undefined>(undefined);
  readonly json: ReadonlySignal<LightJson | undefined> = readonlySignal(this.state);

  /** Light:Enable(true) with these settings; `null` is Light:Enable(false). */
  set(light: LightJson | null): void { this.state.set(light ?? undefined); }

  peek(): LightJson | undefined { return this.state.peek(); }
}
