import { Transform } from './transform';
import type * as THREE from 'three';
import { PrefabDisplayGroup, SpriteResources, SpriteState, type PrefabDisplay } from '@dontstarve-web/display';
import type { PickActor } from '@dontstarve-web/stategraphs/pick';
import type { ReadonlySignal, SeasonState } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Pickable } from './components/pickable';
import { actionEntity } from './actionEntity';
import { bindInstance, PrefabInstance } from './prefabInstance';
import { newEntityId, type PlacementSaveRecord } from './saveRecord';
import { TILE_SIZE } from './tile';
import { watchTileActivity } from './tileActivity';
import { BurnableBinding, FireFxHost } from './treeFire';
import type { PrefabWorldContext, WorldContext, WorldEventEmitter } from './worldContext';

/** flower.lua MakeSmallBurnable + MakeSmallPropagator; the scene's game-time scheduler drives them. */
export interface FlowerBurningWorld {
  scheduler: GameTimeScheduler;
  season?: ReadonlySignal<SeasonState>;
  worldEvents: WorldEventEmitter;
}

export const FLOWER_ANIMATIONS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'rose'] as const;
export type FlowerAnimation = typeof FLOWER_ANIMATIONS[number];
export const FLOWER_SPAWN_IDS = ['flower', 'flower_rose', 'planted_flower'] as const;
export type FlowerSpawnId = typeof FLOWER_SPAWN_IDS[number];
export const FLOWER_PICK_SANITY = 5;
export const ROSE_DAMAGE = 1;
export interface FlowerSaveState { animation: FlowerAnimation; planted?: true }
export interface FlowerSaveRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { flower: FlowerSaveState };
}

/** flower.lua setflowertype: an unspecified type does not reroll an existing flower. */
function setflowertype(inst: FlowerInstance, name?: FlowerAnimation): void {
  if (inst.animname !== undefined && (name === undefined || inst.animname === name)) return;
  if (inst.animname === 'rose') inst.removeTag('thorny');
  inst.animname = name ?? (inst.random() < .01 ? 'rose' : FLOWER_ANIMATIONS[Math.floor(inst.random() * 10)]);
  // PlayAnimation(animname), without looping, even for a single-frame rest pose.
  inst.sprite.playOnce(inst.animname);
  if (inst.animname === 'rose') inst.addTag('thorny');
  OnIsRoseDirty(inst);
}

function OnIsRoseDirty(inst: FlowerInstance): void {
  inst.scrapbook_proxy = inst.animname === 'rose' ? 'flower_rose' : undefined;
}

function onsave(inst: PrefabInstance, data: PlacementSaveRecord['components']): void {
  const flower = inst as FlowerInstance;
  data.flower = { animation: flower.animname!, ...(flower.planted ? { planted: true } : {}) };
}

function onload(inst: PrefabInstance, data: PlacementSaveRecord['components']): void {
  const flower = inst as FlowerInstance;
  setflowertype(flower, data.flower?.animation);
  flower.planted = data.flower?.planted || undefined;
}

function onpickedfn(inst: FlowerInstance, picker?: PickActor): void {
  const pos = inst.position.clone();
  if (picker) {
    if (!picker.hasTag('plantkin')) picker.components.sanity?.DoDelta(FLOWER_PICK_SANITY);
    if (inst.animname === 'rose' && picker.components.combat
      && !picker.components.inventory?.EquipHasTag('bramble_resistant') && !picker.hasTag('shadowminion')) {
      picker.components.combat.GetAttacked(inst, ROSE_DAMAGE);
      picker.PushEvent?.('thorns');
    }
  }
  inst.worldServices?.worldEvents?.emit('plantkilled', { doer: picker, pos });
}

function GetStatus(inst: FlowerInstance): 'ROSE' | undefined {
  return inst.animname === 'rose' ? 'ROSE' : undefined;
}

function DoRoseBounceAnim(inst: FlowerInstance): void {
  inst.sprite.playOnce('rose_bounce');
  inst.sprite.pushAnimation(inst.animname!, false);
}

/** The flower owns its source fields, components and callbacks while its art loads or sleeps. */
export class FlowerInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    pickable: Pickable;
    inspectable: { getstatus(): 'ROSE' | undefined };
  };
  animname?: FlowerAnimation;
  planted?: true;
  scrapbook_proxy?: 'flower_rose';
  /** Only rosefn installs this callback; a randomly selected rose still uses commonfn. */
  DoRoseBounceAnim?: () => void;
  readonly random: () => number;

  constructor(scheduler: GameTimeScheduler, services: Pick<PrefabWorldContext, 'worldEvents'> = {},
    random = Math.random, animation?: FlowerAnimation) {
    super('flower', new SpriteState({ name: 'f1', none: true, billboard: true }), Transform.stationary());
    this.worldServices = services;
    this.random = random;
    this.deploySmartRadius = .375 * (TILE_SIZE / 4);
    this.addTag('flower');
    this.addTag('cattoy');
    this.components.inspectable = { getstatus: () => GetStatus(this) };
    const pickable = this.components.pickable = new Pickable(this, 'petals', 10, 1,
      doer => onpickedfn(this, doer?.picker), undefined, undefined, { scheduler, onRemove: () => this.remove() });
    pickable.picksound = 'dontstarve/wilson/pickup_plants';
    pickable.remove_when_picked = true;
    pickable.quickpick = true;
    pickable.wildfirestarter = true;
    this.onRemove(() => pickable.dispose());
    this.OnSave = onsave;
    this.OnLoad = onload;
    setflowertype(this, animation);
  }
}

function rosefn(inst: FlowerInstance): void {
  setflowertype(inst, 'rose');
  inst.DoRoseBounceAnim = () => DoRoseBounceAnim(inst);
}

function plantedflowerfn(inst: FlowerInstance): void { inst.planted = true; }

/** The supported flower branch of MakeSmallBurnable's default callbacks. */
function makeburnable(inst: FlowerInstance, scheduler: GameTimeScheduler, fire: FireFxHost): BurnableBinding {
  const binding = new BurnableBinding(inst, {
    propagator: 'small', burnTime: 10, fxLevel: 2,
    // standardcomponents.lua DefaultBurnFn / DefaultExtinguishFn / DefaultBurntFn.
    onIgnite: () => { inst.persists = false; },
    onExtinguish: () => { inst.persists = true; },
    onBurnt: () => {
      inst.worldServices?.worldEvents?.emit('spawnAsh', inst.position.clone());
      inst.remove();
    },
  }, { scheduler, fire });
  inst.onRemove(() => binding.dispose());
  return binding;
}

interface DrawnFlower {
  instance: FlowerInstance;
  display: PrefabDisplay;
  burn: BurnableBinding;
}

/** Owns the flower collection and shared art; source callbacks operate on FlowerInstance. */
export class FlowerPlanting {
  private readonly random: () => number;
  private readonly flowers = new Map<string, DrawnFlower>();
  private flowerList?: readonly { readonly id: string; readonly position: THREE.Vector3 }[];
  private readonly displays: PrefabDisplayGroup;
  private readonly resources = new SpriteResources();
  private readonly tickingarea: WorldContext['tickingarea'];
  private readonly services: Pick<PrefabWorldContext, 'worldEvents'>;
  private fireFx?: FireFxHost;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private disposed = false;

  constructor(world: WorldContext, random = Math.random, burning?: FlowerBurningWorld) {
    this.displays = new PrefabDisplayGroup(world.scene);
    this.tickingarea = world.tickingarea;
    this.services = { worldEvents: world.worldEvents ?? burning?.worldEvents };
    this.ownsScheduler = !burning?.scheduler && !world.scheduler;
    this.scheduler = burning?.scheduler ?? world.scheduler ?? new GameTimeScheduler();
    this.random = random;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { instance } of [...this.flowers.values()]) instance.remove();
    if (this.ownsScheduler) this.scheduler.dispose();
    this.displays.dispose();
    this.fireFx?.dispose();
    this.resources.dispose();
  }

  update(cameraQuaternion: THREE.Quaternion, dt = 0): void {
    if (this.ownsScheduler) this.scheduler.advance(dt);
    this.displays.update(dt, cameraQuaternion);
    for (const { burn } of this.flowers.values()) burn.update(dt);
  }

  /** Flower-tagged logical entities for butterflybrain, including natural flowers. */
  get plantedFlowers(): readonly { readonly id: string; readonly position: THREE.Vector3 }[] {
    return this.flowerList ??= [...this.flowers.values()].map(({ instance }) => ({
      id: instance.entityId!, position: instance.position,
    }));
  }

  get renderEntities() {
    return [...this.flowers.values()].filter(({ instance }) => instance.sprite.loaded)
      .flatMap(({ instance, display }) => [{ object: display.model, footPosition: instance.position, cameraDepth: 0 },
        ...display.fxRenderEntries]);
  }

  exportRecords(): FlowerSaveRecord[] {
    return [...this.flowers.values()].filter(({ instance }) => instance.persists).map(({ instance }) => {
      const components: PlacementSaveRecord['components'] = {};
      instance.OnSave!(instance, components);
      return { id: instance.entityId!,
        transform: { position: instance.position.toArray(), rotationY: 0 },
        components: components as FlowerSaveRecord['components'] };
    });
  }

  spawnFromSave(id: string, animation: FlowerAnimation, position: THREE.Vector3, planted = false): THREE.Group {
    const flower = this.createFlower(id, position, animation);
    flower.instance.OnLoad!(flower.instance, { flower: { animation, ...(planted ? { planted: true } : {}) } });
    return flower.display.model;
  }

  spawn(prefab: FlowerSpawnId, position: THREE.Vector3): THREE.Group | undefined {
    if (this.disposed) return undefined;
    return this.createFlower(newEntityId(), position, undefined, prefab).display.model;
  }

  /** SpawnPrefab("planted_flower"): the logical flower exists before any artwork is loaded. */
  spawnPlanted(position: THREE.Vector3): THREE.Group | undefined { return this.spawn('planted_flower', position); }

  private createFlower(id: string, position: THREE.Vector3, animation?: FlowerAnimation, prefab: FlowerSpawnId = 'flower'): DrawnFlower {
    if (this.disposed) throw new Error('Flower planting has been disposed');
    const instance = new FlowerInstance(this.scheduler, this.services, this.random, animation);
    if (prefab === 'flower_rose') rosefn(instance);
    else if (prefab === 'planted_flower') plantedflowerfn(instance);
    const display = this.displays.add({ root: instance.transform.model, name: 'Flower',
      archive: this.resources.archive({ animationArchive: 'flowers.zip', buildArchives: ['flowers.zip'], bank: 'flowers' },
        { instancedAnimations: 'all', staticBillboard: true }),
      sprite: instance.sprite, status: instance.status, light: instance.light });
    bindInstance(display.model, instance);
    instance.setPosition(position.x, position.y, position.z);
    instance.entityId = id;
    // Raycast shape is presentation metadata; prefab state and spacing belong to the instance.
    display.model.userData.rayTestOnBB = true;
    actionEntity(display.model, 'flower');
    this.fireFx ??= FireFxHost.create(`${import.meta.env.BASE_URL}dst/data/anim`);
    const flower: DrawnFlower = { instance, display, burn: makeburnable(instance, this.scheduler, this.fireFx) };
    this.flowers.set(id, flower);
    this.flowerList = undefined;
    const stopActivity = watchTileActivity(display.model, this.tickingarea, active => instance.setActive(active));
    instance.onRemove(() => {
      stopActivity();
      this.flowers.delete(id);
      this.flowerList = undefined;
      display.dispose();
    });
    return flower;
  }
}
