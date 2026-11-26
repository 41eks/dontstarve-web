import { LazySignal, type ReadonlySignal } from '@dontstarve-web/signals';

/** inst.Light's settings; `radius` is in this scene's world units. */
export interface LightJson {
  readonly radius: number;
  readonly intensity: number;
  readonly falloff: number;
  readonly colour: readonly [number, number, number];
}

const EMPTY_SLOTS: ReadonlyMap<string, ReadonlySignal<LightJson | undefined>> = new Map();

/**
 * inst.entity:AddLight(): the light an entity declares. The prefab writes it; the entity's display lists it for the
 * renderer while the entity is active, so a sleeping or removed entity emits nothing. The light and the parented
 * slots hold no signal until they are first declared: the display follows each one from its `when*Declared`.
 */
export class LightState {
  private readonly state = new LazySignal<LightJson | undefined>(undefined);
  private readonly slotState = new LazySignal(EMPTY_SLOTS);
  get json(): ReadonlySignal<LightJson | undefined> {
    return this.state;
  }
  /** Lights of other entities parented to this one, by key. */
  get slots(): ReadonlySignal<ReadonlyMap<string, ReadonlySignal<LightJson | undefined>>> {
    return this.slotState;
  }

  /** Runs `listener` once the entity first declares its light; the returned stop cancels a pending one. */
  whenDeclared(listener: () => void): () => void {
    return this.state.whenDeclared(listener);
  }

  /** Runs `listener` once another entity first parents a light here. */
  whenSlotsDeclared(listener: () => void): () => void {
    return this.slotState.whenDeclared(listener);
  }

  /** Light:Enable(true) with these settings; `null` is Light:Enable(false). */
  set(light: LightJson | null): void {
    this.state.set(light ?? undefined);
  }

  peek(): LightJson | undefined {
    return this.state.value;
  }

  /**
   * Another entity's inst.Light, by its json signal, parented here with entity:SetParent: this entity's display lists it at
   * this entity's position while this entity is active. Undefined takes it away.
   */
  declare(key: string, light: ReadonlySignal<LightJson | undefined> | undefined): void {
    const slots = new Map(this.slotState.value);
    if (light) {
      if (slots.get(key) === light) {
        return;
      }
      slots.set(key, light);
    } else if (!slots.delete(key)) {
      return;
    }
    this.slotState.set(slots);
  }
}
