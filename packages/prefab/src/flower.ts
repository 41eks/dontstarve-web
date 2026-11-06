import { Transform } from './transform';
import { SpriteState } from '@dontstarve-web/display';
import type { PickActor } from '@dontstarve-web/stategraphs/pick';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Pickable } from './components/pickable';
import type { SpawnGroundItem } from './groundPrefab';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import { DefaultBurnFn, DefaultBurntFn, DefaultExtinguishFn } from './standardcomponents';
import { TILE_SIZE } from './tile';
import { BurnableBinding, type FireFxHost } from './treeFire';
import type { WorldEventEmitter } from './worldContext';

/** What the scene injects into every flower. */
export interface FlowerWorld {
  scheduler: GameTimeScheduler;
  /** The fire art's owner, injected and disposed by the application. */
  fire: FireFxHost;
  spawnGroundItem: SpawnGroundItem;
  worldEvents?: WorldEventEmitter;
  random?: () => number;
}

export const FLOWER_ANIMATIONS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'rose'] as const;
export type FlowerAnimation = typeof FLOWER_ANIMATIONS[number];
export const FLOWER_SPAWN_IDS = ['flower', 'flower_rose', 'planted_flower'] as const;
export type FlowerSpawnId = typeof FLOWER_SPAWN_IDS[number];
export const FLOWER_PICK_SANITY = 5;
export const ROSE_DAMAGE = 1;
export interface FlowerSaveState { animation: FlowerAnimation; planted?: true }

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

  constructor(world: FlowerWorld, random = Math.random) {
    super('flower', new SpriteState({ name: 'f1', none: true, billboard: true }), Transform.stationary());
    const { scheduler } = world;
    this.worldServices = { worldEvents: world.worldEvents };
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
    // MakeSmallBurnable(inst) + MakeSmallPropagator(inst).
    const burn = new BurnableBinding(this, { propagator: 'small', burnTime: 10, fxLevel: 2,
      onIgnite: () => DefaultBurnFn(this), onExtinguish: () => DefaultExtinguishFn(this), onBurnt: () => DefaultBurntFn(this, world) }, world);
    this.onRemove(() => { pickable.dispose(); burn.dispose(); });
    this.OnSave = onsave;
    this.OnLoad = onload;
    setflowertype(this);
  }
}

function rosefn(inst: FlowerInstance): void {
  setflowertype(inst, 'rose');
  inst.DoRoseBounceAnim = () => DoRoseBounceAnim(inst);
}

function plantedflowerfn(inst: FlowerInstance): void { inst.planted = true; }

/** The Prefab table flower.lua returns. */
export function flowerPrefabs(world: FlowerWorld): Readonly<Record<FlowerSpawnId, PrefabEntityDefinition<FlowerInstance>>> {
  const random = world.random ?? Math.random;
  const definition = (postinit?: (inst: FlowerInstance) => void): PrefabEntityDefinition<FlowerInstance> => ({
    fn: () => { const inst = new FlowerInstance(world, random); postinit?.(inst); return inst; },
    assets: { animationArchive: 'flowers.zip', buildArchives: ['flowers.zip'], bank: 'flowers' },
    assetOptions: { instancedAnimations: 'all', staticBillboard: true },
    rayTestOnBB: true,
  });
  return { flower: definition(), flower_rose: definition(rosefn), planted_flower: definition(plantedflowerfn) };
}
