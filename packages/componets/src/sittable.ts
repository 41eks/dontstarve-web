import { createMemo, createSignal, readonlySignal, type ReadonlySignal } from '@dontstarve-web/signals';
import type { DerivedTags } from './derivedTags';

/** An occupier: the entity components/sittable.lua watches for `onremove` and tells `sittableonfire`. */
export interface SittableOccupier {
  PushEvent(event: 'sittableonfire', data: unknown): void;
}

/** What sittable.lua reads from its inst: events, the event callbacks it keeps, and whether it can burn. */
export interface SittableInst {
  PushEvent(event: 'becomesittable' | 'becomeunsittable'): void;
  ListenForEvent(event: 'onignite', fn: () => void): () => void;
  ListenForEvent(event: 'onremove', fn: () => void, source: SittableOccupier): () => void;
  readonly components: { burnable?: object };
}

const SITTABLE_TAGS: readonly string[] = Object.freeze(['cansit']);
const OCCUPIED_TAGS: readonly string[] = Object.freeze([]);

/**
 * components/sittable.lua. The constructor's `cansit` tag and the occupier setter's add / remove both follow the
 * occupier, so the tag is derived from it; RemoveComponent drops it with the component as OnRemoveFromEntity's
 * RemoveTag does. Sitting itself (the SIT action and the sitter's stategraph) is not ported, so nothing sets an occupier
 * yet.
 */
export class Sittable implements DerivedTags {
  private readonly inst: SittableInst;
  private readonly occupierState = createSignal<SittableOccupier | undefined>(undefined);
  readonly derivedTags: ReadonlySignal<readonly string[]>;
  private stopOccupierListeners: (() => void) | undefined;

  constructor(inst: SittableInst) {
    this.inst = inst;
    this.derivedTags = readonlySignal(
      createMemo(() => (this.occupierState.get() === undefined ? SITTABLE_TAGS : OCCUPIED_TAGS)),
    );
    inst.PushEvent('becomesittable');
  }

  /** self.occupier. */
  get occupier(): SittableOccupier | undefined {
    return this.occupierState.value;
  }

  SetOccupier(occupier: SittableOccupier | undefined): void {
    const previous = this.occupierState.value;
    if (previous === occupier) {
      return;
    }
    if (previous !== undefined) {
      this.stopOccupierListeners?.();
      this.stopOccupierListeners = undefined;
    }
    this.occupierState.set(occupier);
    if (occupier !== undefined) {
      // self._onremoveoccupier on the occupier's onremove, and OnIgnite while the inst can burn.
      const stopRemove = this.inst.ListenForEvent('onremove', () => this.SetOccupier(undefined), occupier);
      const stopIgnite = this.inst.components.burnable
        ? this.inst.ListenForEvent('onignite', () => this.occupier?.PushEvent('sittableonfire', this.inst))
        : undefined;
      this.stopOccupierListeners = () => {
        stopRemove();
        stopIgnite?.();
      };
      this.inst.PushEvent('becomeunsittable');
    } else {
      this.inst.PushEvent('becomesittable');
    }
  }

  IsOccupied(): boolean {
    return this.occupierState.value !== undefined;
  }

  IsOccupiedBy(occupier: SittableOccupier | undefined): boolean {
    return occupier !== undefined && this.occupierState.value === occupier;
  }

  EjectOccupier(): void {
    if (this.occupierState.value !== undefined) {
      this.inst.PushEvent('becomeunsittable');
    }
  }

  OnRemoveFromEntity(): void {
    this.stopOccupierListeners?.();
    this.stopOccupierListeners = undefined;
    this.inst.PushEvent('becomeunsittable');
  }

  /** Lua's Remove calls no OnRemoveEntity for sittable: the removed entity pushes no becomeunsittable. */
  OnRemoveEntity(): void {
    this.stopOccupierListeners?.();
    this.stopOccupierListeners = undefined;
  }
}
