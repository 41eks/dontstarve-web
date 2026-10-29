import type { Vector3 } from 'three';
import { createEffect, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import type { MiniMapJson, MiniMapState } from './minimapState';
import type { TileTracker } from '../../componets/src/tileManager';

/** Live map input shared by prefab declarations and inventory item icons. */
export interface MiniMapMarker extends MiniMapJson {
  readonly position: Vector3;
}

/** The logical entity supplies declarations and its existing foot-position vector. */
interface MiniMapSource {
  readonly position: Vector3;
  readonly status?: ReadonlySignal<'active' | 'asleep' | 'removed'>;
  readonly minimap: MiniMapState;
  readonly tileTracker: TileTracker;
}

const entities = new Set<MiniMapMarker>();
const bindings = new WeakMap<MiniMapSource, MiniMapBinding>();
type MiniMapListener = (marker: MiniMapMarker, present: boolean) => void;
const listeners = new Set<MiniMapListener>();

/** Map-owned subscriptions list icons even when the entity's world sprite is asleep. */
export function miniMapEntities(): ReadonlySet<MiniMapMarker> { return entities; }

/** Subscribe while the map is open. Initial entries and subsequent changes keep the same marker identity. */
export function subscribeMiniMapEntities(listener: MiniMapListener): () => void {
  listeners.add(listener);
  for (const marker of entities) listener(marker, true);
  return () => { listeners.delete(listener); };
}

function notify(marker: MiniMapMarker, present: boolean): void {
  for (const listener of listeners) listener(marker, present);
}

/** Bind once when the logical entity receives its transform; the entity owns the returned cleanup. */
export function watchMiniMapEntity(source: MiniMapSource): () => void {
  let binding = bindings.get(source);
  if (!binding) {
    binding = new MiniMapBinding(source);
    bindings.set(source, binding);
  }
  return binding.dispose;
}

/** A stable marker identity with lifecycle-managed local copies of the entity's signals. */
class MiniMapBinding implements MiniMapMarker {
  readonly position: Vector3;
  private readonly cleanups: (() => void)[] = [];
  private readonly json;
  private readonly status;
  private tile?: ReadonlySignal<number>;
  private readonly source: MiniMapSource;

  constructor(source: MiniMapSource) {
    this.source = source;
    this.position = source.position;
    this.json = watchSignal(source.minimap.json, stop => this.cleanups.push(stop));
    this.status = source.status && watchSignal(source.status, stop => this.cleanups.push(stop));
    createEffect(() => {
      const json = this.json.get();
      if (this.status?.get() === 'removed') { this.dispose(); return; }
      if (!json.icon) {
        if (entities.delete(this)) notify(this, false);
        return;
      }
      // Iconless prefabs need no tracker or tile subscription. Movement inside one tile publishes nothing.
      this.tile ??= watchSignal(source.tileTracker.tile, stop => this.cleanups.push(stop));
      this.tile.get();
      entities.add(this);
      notify(this, true);
    });
  }

  get icon(): string { return this.json.peek().icon; }
  get priority(): number { return this.json.peek().priority; }
  get canUseCache(): boolean { return this.json.peek().canUseCache; }
  get drawOverFogOfWar(): boolean { return this.json.peek().drawOverFogOfWar; }
  get enabled(): boolean { return this.json.peek().enabled; }

  readonly dispose = (): void => {
    if (entities.delete(this)) notify(this, false);
    bindings.delete(this.source);
    for (const stop of this.cleanups.splice(0)) stop();
  };
}
