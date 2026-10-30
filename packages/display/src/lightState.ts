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
  private readonly slotState = createSignal<ReadonlyMap<string, ReadonlySignal<LightJson | undefined>>>(new Map());
  /** Lights of other entities parented to this one, by key. */
  readonly slots: ReadonlySignal<ReadonlyMap<string, ReadonlySignal<LightJson | undefined>>> = readonlySignal(this.slotState);

  /** Light:Enable(true) with these settings; `null` is Light:Enable(false). */
  set(light: LightJson | null): void { this.state.set(light ?? undefined); }

  peek(): LightJson | undefined { return this.state.peek(); }

  /**
   * Another entity's inst.Light, by its json signal, parented here with entity:SetParent: this entity's display lists it at
   * this entity's position while this entity is active. Undefined takes it away.
   */
  declare(key: string, light: ReadonlySignal<LightJson | undefined> | undefined): void {
    const slots = new Map(this.slotState.peek());
    if (light) {
      if (slots.get(key) === light) return;
      slots.set(key, light);
    } else if (!slots.delete(key)) return;
    this.slotState.set(slots);
  }
}
