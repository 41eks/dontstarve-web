import { FindEntities } from './actionEntity';
import type * as THREE from 'three';
import { getBoundWatchWorldContent } from '@dontstarve-web/signals';
import { prefabInstance, PrefabInstance } from './prefabInstance';
import { SpriteResources, type LoadedSpriteSource } from '@dontstarve-web/display';
import { addComponent, removeComponent } from './components';
import type { Burnable, BurnableInst } from '../../componets/src/burnable';
import type { Propagator } from '../../componets/src/propagator';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Fire, FIRE_ARCHIVE, FIRE_ID } from './fire';
import { TILE_SIZE } from './tile';

/** tuning.lua TREE_BURN_TIME. */
export const TREE_BURN_TIME = 45;

/** Owner of fire.lua's shared art; the managers whose burnables add the fire hold one. */
export class FireFxHost {
  readonly source: LoadedSpriteSource;
  private readonly fires = new Set<Fire>();
  private readonly resources: SpriteResources;
  private disposed = false;
  private constructor(assetBaseUrl?: string) {
    this.resources = new SpriteResources(assetBaseUrl);
    this.source = this.resources.factory({ animationArchive: FIRE_ARCHIVE, buildArchive: FIRE_ARCHIVE });
  }

  /** Each fire is spawned at once; its display draws it when the shared art has loaded. */
  static create(assetBaseUrl?: string): FireFxHost { return new FireFxHost(assetBaseUrl); }

  /** SpawnPrefab("fire") for a Burnable:SpawnFX on `owner`. */
  spawn(owner: PrefabInstance): Fire {
    if (this.disposed) throw new Error('Fire effects have been disposed');
    for (const fire of this.fires) if (fire.instance.status.peek() === 'removed') this.fires.delete(fire);
    const fire = new Fire(this.source, owner);
    this.fires.add(fire);
    return fire;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const fire of this.fires) fire.Remove();
    this.fires.clear();
    this.resources.dispose();
  }
}

export interface BurnEnvironment {
  readonly scheduler: GameTimeScheduler;
  readonly fire: FireFxHost;
}

export interface BurnSpec {
  /** MakeSmallPropagator / MakeMediumPropagator. */
  readonly propagator: 'small' | 'medium' | 'large';
  readonly propagatorValues?: { propagaterange?: number; heatoutput?: number };
  readonly burnTime: number;
  readonly fxLevel: number;
  readonly onIgnite?: () => void;
  readonly onExtinguish?: () => void;
  readonly onBurnt: () => void;
}

/** MakeXBurnable + MakeXPropagator on an inst; its Burnable:SpawnFX adds fire.lua while it burns. */
export class BurnableBinding {
  readonly burnable: Burnable;
  readonly propagator: Propagator;
  private readonly inst: PrefabInstance;
  private disposed = false;

  constructor(inst: BurnableInst, spec: BurnSpec, env: Pick<BurnEnvironment, 'fire'> & Partial<Pick<BurnEnvironment, 'scheduler'>>) {
    const owner = inst instanceof PrefabInstance ? inst : prefabInstance((inst as { model?: THREE.Object3D }).model);
    if (!owner) throw new Error('Burnable fire effects need a logical prefab owner');
    this.inst = owner;
    this.burnable = addComponent(owner, 'burnable', env.scheduler);
    this.burnable.SetFXLevel(spec.fxLevel);
    this.burnable.SetBurnTime(spec.burnTime);
    this.burnable.SetFXSpawner(data => data.prefab === FIRE_ID ? env.fire.spawn(owner) : undefined);
    this.burnable.AddBurnFX(FIRE_ID, { x: 0, y: 0, z: 0 });
    this.burnable.SetOnIgniteFn(spec.onIgnite ? () => spec.onIgnite!() : undefined);
    this.burnable.SetOnExtinguishFn(spec.onExtinguish ? () => spec.onExtinguish!() : undefined);
    this.burnable.SetOnBurntFn(() => spec.onBurnt());
    this.propagator = addComponent(owner, 'propagator', spec.propagator, radius => {
      return FindEntities(owner.getPosition(), radius).filter(other => other.components.propagator && !other.hasTag('INLIMBO'));
    }, TILE_SIZE / 4, env.scheduler, getBoundWatchWorldContent(), spec.propagatorValues);
  }

  /** StartUpdatingComponent of the fire's firefx: its light flickers each frame. */
  update(dt: number): void { this.burnable.UpdateFX(dt); }

  /** RemoveComponent("burnable") / RemoveComponent("propagator"): extinguishes, without the extinguish callback. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.burnable.SetOnExtinguishFn(undefined);
    if (this.inst.components.burnable === this.burnable) removeComponent(this.inst, 'burnable');
    if (this.inst.components.propagator === this.propagator) removeComponent(this.inst, 'propagator');
  }
}
