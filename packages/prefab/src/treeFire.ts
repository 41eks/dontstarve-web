import { FindEntities } from './actionEntity';
import type * as THREE from 'three';
import { getBoundWatchWorldContent } from '@dontstarve-web/signals';
import { prefabInstance, PrefabInstance } from './prefabInstance';
import { SpriteResources } from '@dontstarve-web/display';
import { Burnable, type BurnableInst } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Fire, FIRE_ARCHIVE, FIRE_ID } from './fire';
import { TILE_SIZE } from './tile';

/** tuning.lua TREE_BURN_TIME. */
export const TREE_BURN_TIME = 45;

/** Owner of fire.lua's shared art; the managers whose burnables add the fire hold one. */
export class FireFxHost {
  private readonly fires = new Set<Fire>();
  private readonly resources: SpriteResources;
  private disposed = false;
  private constructor(assetBaseUrl: string) { this.resources = new SpriteResources(assetBaseUrl); }

  /** Each fire is spawned at once; its display draws it when the shared art has loaded. */
  static create(assetBaseUrl: string): FireFxHost { return new FireFxHost(assetBaseUrl); }

  /** SpawnPrefab("fire") for a Burnable:SpawnFX on `owner`. */
  spawn(owner: PrefabInstance): Fire {
    if (this.disposed) throw new Error('Fire effects have been disposed');
    for (const fire of this.fires) if (fire.instance.status.peek() === 'removed') this.fires.delete(fire);
    const fire = new Fire(this.resources.factory({ animationArchive: FIRE_ARCHIVE, buildArchive: FIRE_ARCHIVE }), owner);
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
  readonly propagator: 'small' | 'medium';
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
  private readonly inst: BurnableInst;
  private disposed = false;

  constructor(inst: BurnableInst, spec: BurnSpec, env: BurnEnvironment) {
    this.inst = inst;
    const owner = inst instanceof PrefabInstance ? inst : prefabInstance((inst as { model?: THREE.Object3D }).model);
    if (!owner) throw new Error('Burnable fire effects need a logical prefab owner');
    this.burnable = new Burnable(inst, env.scheduler);
    this.burnable.SetFXLevel(spec.fxLevel);
    this.burnable.SetBurnTime(spec.burnTime);
    this.burnable.SetFXSpawner(data => data.prefab === FIRE_ID ? env.fire.spawn(owner) : undefined);
    this.burnable.AddBurnFX(FIRE_ID, { x: 0, y: 0, z: 0 });
    this.burnable.SetOnIgniteFn(spec.onIgnite ? () => spec.onIgnite!() : undefined);
    this.burnable.SetOnExtinguishFn(spec.onExtinguish ? () => spec.onExtinguish!() : undefined);
    this.burnable.SetOnBurntFn(() => spec.onBurnt());
    this.propagator = new Propagator(inst, spec.propagator, radius => {
      return FindEntities(inst.getPosition(), radius).filter(other => other.components.propagator && !other.hasTag('INLIMBO'));
    }, TILE_SIZE / 4, env.scheduler, getBoundWatchWorldContent(), spec.propagatorValues);
    inst.components.burnable = this.burnable;
    inst.components.propagator = this.propagator;
  }

  /** StartUpdatingComponent of the fire's firefx: its light flickers each frame. */
  update(dt: number): void { this.burnable.UpdateFX(dt); }

  /** RemoveComponent("burnable") / RemoveComponent("propagator"): extinguishes, without the extinguish callback. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.burnable.SetOnExtinguishFn(undefined);
    this.burnable.dispose(); this.propagator.dispose();
    if (this.inst.components.burnable === this.burnable) delete this.inst.components.burnable;
    if (this.inst.components.propagator === this.propagator) delete this.inst.components.propagator;
  }
}
