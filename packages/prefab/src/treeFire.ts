import * as THREE from 'three';
import { createEffect, getBoundWatchWorldContent } from '@dontstarve-web/signals';
import { loadAnim, loadBuild } from '@dontstarve-web/animation/animationAssets';
import {
  createSpriteFactory, type AnimatedSpriteFactory, type TransientSpriteAnimationController,
} from '@dontstarve-web/animation/sprite';
import { Burnable, type BurnableInst } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PlaySound, PreloadSounds, type SoundEventPath, type SoundHandle } from './sound';
import { setPrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';

/** tuning.lua TREE_BURN_TIME. */
export const TREE_BURN_TIME = 45;

/** fire.lua firelevels; Burnable:SetFXLevel(n) selects entry n. */
const FIRE_LEVELS: readonly {
  anim: string; sound: SoundEventPath; radius: number; intensity: number; falloff: number; colour: readonly [number, number, number];
}[] = [
  { anim: 'level1', sound: 'dontstarve/common/campfire', radius: 2, intensity: .75, falloff: .33, colour: [197 / 255, 197 / 255, 170 / 255] },
  { anim: 'level2', sound: 'dontstarve/common/campfire', radius: 3, intensity: .8, falloff: .33, colour: [1, 1, 192 / 255] },
  { anim: 'level3', sound: 'dontstarve/common/campfire', radius: 4, intensity: .8, falloff: .33, colour: [1, 1, 192 / 255] },
  { anim: 'level4', sound: 'dontstarve/common/campfire', radius: 5, intensity: .9, falloff: .25, colour: [1, 190 / 255, 121 / 255] },
  { anim: 'level4', sound: 'dontstarve/common/forestfire', radius: 6, intensity: .9, falloff: .2, colour: [1, 190 / 255, 121 / 255] },
  { anim: 'level5', sound: 'dontstarve/common/forestfire', radius: 7, intensity: .9, falloff: .2, colour: [1, 190 / 255, 121 / 255] },
];

export interface FireHandle { stop(extinguished: boolean): void }

/** The fire.lua prefab spawned by Burnable:SpawnFX: sprite, loop sound and local light at a ground point. */
export class FireFxHost {
  private readonly fires = new Map<THREE.Group, THREE.Vector3>();
  private readonly owners = new Map<THREE.Group, THREE.Object3D>();
  private readonly factory: AnimatedSpriteFactory;
  private disposed = false;
  private constructor(factory: AnimatedSpriteFactory) { this.factory = factory; }

  static async load(assetBaseUrl: string): Promise<FireFxHost> {
    const [build, anim] = await Promise.all([
      loadBuild('fire.zip', assetBaseUrl), loadAnim('fire.zip', assetBaseUrl),
      PreloadSounds('dontstarve/common/campfire', 'dontstarve/common/forestfire', 'dontstarve/common/fireOut'),
    ]);
    return new FireFxHost(createSpriteFactory(build, anim));
  }

  start(parent: THREE.Object3D, position: THREE.Vector3, fxLevel: number, owner?: THREE.Object3D): FireHandle {
    if (this.disposed) throw new Error('Fire effects have been disposed');
    const level = FIRE_LEVELS[Math.min(fxLevel, FIRE_LEVELS.length) - 1];
    const fire = this.factory.create({ initialAnimation: level.anim, name: 'fire' });
    fire.position.set(position.x, 0, position.z);
    fire.userData.tags = ['FX', 'NOCLICK'];
    setPrefabLocalLight(fire, { colour: level.colour, radius: level.radius * (TILE_SIZE / 4), intensity: level.intensity, falloff: level.falloff });
    parent.add(fire);
    this.fires.set(fire, fire.position);
    if (owner) this.owners.set(fire, owner);
    let sound: SoundHandle | undefined = PlaySound(level.sound, fire.position);
    return {
      stop: extinguished => {
        if (!this.fires.delete(fire)) return;
        this.owners.delete(fire);
        fire.removeFromParent(); sound?.stop(); sound = undefined;
        setPrefabLocalLight(fire, null);
        this.factory.disposeSprite(fire);
        if (extinguished && !this.disposed) PlaySound('dontstarve/common/fireOut', position);
      },
    };
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    for (const fire of this.fires.keys()) {
      fire.quaternion.copy(cameraQuaternion);
      (fire.userData.animationController as TransientSpriteAnimationController).update(dt);
    }
  }

  get renderEntities(): { object: THREE.Group; footPosition: THREE.Vector3; cameraDepth: number; sortGroup?: number; sortLayer: number }[] {
    // A fire sharing an owner joins its sort group, so it takes the owner's depth and draws after it.
    return [...this.fires].map(([object, footPosition]) => ({ object, footPosition, cameraDepth: 0,
      sortGroup: this.owners.get(object)?.id, sortLayer: 2 }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const fire of [...this.fires.keys()]) { fire.removeFromParent(); setPrefabLocalLight(fire, null); this.factory.disposeSprite(fire); }
    this.fires.clear();
    this.factory.dispose();
  }
}

export interface BurnEnvironment {
  readonly scheduler: GameTimeScheduler;
  /** The scene searched for propagator neighbours and receiving the fire effects. */
  readonly root: THREE.Object3D;
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

/** MakeXBurnable + MakeXPropagator on an inst, with fire.lua shown while it burns. */
export class BurnableBinding {
  readonly burnable: Burnable;
  readonly propagator: Propagator;
  private fire?: FireHandle;
  private readonly stopEffect: () => void;
  private readonly inst: BurnableInst;
  private disposed = false;

  constructor(inst: BurnableInst, spec: BurnSpec, env: BurnEnvironment) {
    this.inst = inst;
    this.burnable = new Burnable(inst, env.scheduler);
    this.burnable.SetBurnTime(spec.burnTime);
    this.burnable.SetOnIgniteFn(spec.onIgnite ? () => spec.onIgnite!() : undefined);
    this.burnable.SetOnExtinguishFn(spec.onExtinguish ? () => spec.onExtinguish!() : undefined);
    this.burnable.SetOnBurntFn(() => spec.onBurnt());
    this.propagator = new Propagator(inst, spec.propagator, radius => {
      const origin = inst.getPosition(), neighbours: BurnableInst[] = [], radiusSquared = radius ** 2;
      env.root.traverse(object => {
        const other = object.userData.actionEntity as BurnableInst | undefined;
        if (!other?.components.propagator || other.isRemoved || other.hasTag('INLIMBO')) return;
        if (other.getPosition().distanceToSquared(origin) <= radiusSquared) neighbours.push(other);
      });
      return neighbours;
    }, TILE_SIZE / 4, env.scheduler, getBoundWatchWorldContent(), spec.propagatorValues);
    inst.components.burnable = this.burnable;
    inst.components.propagator = this.propagator;
    this.stopEffect = createEffect(() => {
      if (this.burnable.burning.get()) this.fire ??= env.fire.start(env.root, inst.getPosition(), spec.fxLevel, (inst as { model?: THREE.Object3D }).model);
      else if (this.fire) { this.fire.stop(true); this.fire = undefined; }
    });
  }

  /** RemoveComponent("burnable") / RemoveComponent("propagator"): extinguishes, without extinguish effects. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopEffect();
    this.fire?.stop(false); this.fire = undefined;
    this.burnable.SetOnExtinguishFn(undefined);
    this.burnable.dispose(); this.propagator.dispose();
    if (this.inst.components.burnable === this.burnable) delete this.inst.components.burnable;
    if (this.inst.components.propagator === this.propagator) delete this.inst.components.propagator;
  }
}
