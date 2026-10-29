import * as THREE from 'three';
import { createEffect, createSignal, getBoundWatchWorldContent } from '@dontstarve-web/signals';
import { createPrefabEntity, prefabInstance, type PrefabInstance } from './prefabInstance';
import { SpriteResources, type ArchiveSpriteCommands } from '@dontstarve-web/display';
import { Burnable, type BurnableInst } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
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
  private readonly fires = new Map<THREE.Group, { entity: ReturnType<typeof createPrefabEntity>; position: THREE.Vector3;
    owner?: THREE.Object3D; instance?: PrefabInstance<ArchiveSpriteCommands>; stop(extinguished: boolean): void }>();
  private readonly resources: SpriteResources;
  private disposed = false;
  private constructor(assetBaseUrl: string) { this.resources = new SpriteResources(assetBaseUrl); }

  /** The host now: each fire is spawned at once and its display draws it when the shared art has loaded. */
  static create(assetBaseUrl: string): FireFxHost { return new FireFxHost(assetBaseUrl); }

  /** Transitional for the tree managers that still await their hosts; it loads nothing. */
  static async load(assetBaseUrl: string): Promise<FireFxHost> { return FireFxHost.create(assetBaseUrl); }

  start(parent: THREE.Object3D, position: THREE.Vector3, fxLevel: number, owner?: THREE.Object3D): FireHandle {
    if (this.disposed) throw new Error('Fire effects have been disposed');
    const level = FIRE_LEVELS[Math.min(fxLevel, FIRE_LEVELS.length) - 1];
    const entity = createPrefabEntity('fire', this.resources.factory({ animationArchive: 'fire.zip', buildArchive: 'fire.zip' }),
      { name: level.anim, billboard: true }, 'fire');
    const fire = entity.display.model; entity.instance.persists = false;
    const instance = owner && prefabInstance(owner), key = `fire:${fire.id}`;
    fire.position.set(position.x, 0, position.z);
    for (const tag of ['FX', 'HASHEATER']) entity.instance.addTag(tag);
    prefabInstance(fire)!.light.set({ colour: level.colour, radius: level.radius * (TILE_SIZE / 4), intensity: level.intensity, falloff: level.falloff });
    if (instance) instance.sprite.attachFx(key, { sprite: entity.instance.sprite, display: entity.display,
      active: createSignal(true), sortLayer: 2 });
    else parent.add(fire);
    let sound: SoundHandle | undefined = PlaySound(level.sound, position);
    const stop = (extinguished: boolean) => {
      if (!this.fires.delete(fire)) return;
      instance?.sprite.detachFx(key);
      entity.instance.remove(); entity.display.dispose(); sound?.stop(); sound = undefined;
      prefabInstance(fire)!.light.set(null);
      if (extinguished && !this.disposed) PlaySound('dontstarve/common/fireOut', position);
    };
    this.fires.set(fire, { entity, position: owner?.position ?? fire.position, owner, instance, stop });
    return { stop };
  }

  update(dt: number, _cameraQuaternion?: THREE.Quaternion): void {
    for (const { entity, instance } of this.fires.values()) {
      // Declared children advance with the owner's display; unattached fire advances here.
      if (!instance) entity.instance.sprite.update(dt);
    }
  }

  get renderEntities(): { object: THREE.Group; footPosition: THREE.Vector3; cameraDepth: number; sortLayer: number }[] {
    // A fire on an owner shares its foot point, so it takes the owner's order and draws after it.
    return [...this.fires].map(([object, { position }]) => ({ object, footPosition: position, cameraDepth: 0, sortLayer: 2 }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { stop } of [...this.fires.values()]) stop(false);
    this.fires.clear();
    this.resources.dispose();
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
  private readonly active = createSignal(true);

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
      const burning = this.burnable.burning.get();
      if (burning && this.active.get()) this.fire ??= env.fire.start(env.root, inst.getPosition(), spec.fxLevel, (inst as { model?: THREE.Object3D }).model);
      else if (this.fire) { this.fire.stop(!burning); this.fire = undefined; }
    });
  }

  /** Gate only fire presentation; the owning components keep their game-time tasks. */
  setActive(active: boolean): void { this.active.set(active); }

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
