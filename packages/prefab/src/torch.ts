import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { ItemEntity } from '@dontstarve-web/inventory';
import { getBoundWatchWorldContent, WorldContentKey, type EquipmentOwner, type ReadonlySignal } from '@dontstarve-web/signals';
import type * as THREE from 'three';
import type { FollowerFx } from '@dontstarve-web/display';
import { Burnable } from '../../componets/src/burnable';
import { ErodeAway } from '../../componets/src/erodeaway';
import { Lighter } from '../../componets/src/lighter';
import type { WorkInst } from '../../componets/src/workable';
import type { InventoryActor } from '../../componets/src/inventoryitem';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory, type HeldEquipFunctions } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS, groundItemPrefab, type ItemPrefabDefinition } from './groundItems';
import type { ItemPrefabWorld } from './groundPrefab';
import { spawnLightEntity, type PrefabLocalLight } from './localLight';
import type { LootLaunch } from '../../componets/src/inventoryphysics';
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import { TORCH_FIRE_OFFSET_Y, TORCH_FIRE_VFX } from './torchfire';
import type { PrefabInstance } from './prefabInstance';

/** torch.lua fn(): the components the source adds and the callbacks it registers on them, on the item's own instance. */
export function configureTorchEntity(entity: ItemEntity): void {
  entity.components.lighter = entity.component('lighter', () => new Lighter(entity));
  if (entity.components.fueled) return;
  const inst = entity as TorchInst;
  inst.components.inventoryitem.SetOnPutInInventoryFn((_inst, owner) => OnPutInInventory(inst, owner));
  const burnable = inst.components.burnable = inst.component('burnable', () => new Burnable(inst));
  burnable.canlight = false;
  burnable.SetOnExtinguishFn(() => OnExtinguish(inst));
  const fueled = inst.AddFueled();
  fueled.SetSectionCallback(newsection => onfuelchange(newsection, inst));
  fueled.InitializeFuelLevel(TORCH_FUEL);
  fueled.SetDepletedFn(inst => { inst.remove(); });
  fueled.SetFirstPeriod(TURNON_FUELED_CONSUMPTION, TURNON_FULL_FUELED_CONSUMPTION);
  inst.SetFuelRateMult = mult => SetFuelRateMult(inst, mult);
  inst.onRemove(() => { burnable.OnRemoveEntity(); OnRemoveEntity(inst); });
}

export const TORCH_ID = 'torch';
/** tuning.lua: TORCH_FUEL = night_time * 1.25, with a default 30 * 2 second night. */
export const TORCH_FUEL = 30 * 2 * 1.25;
/** tuning.lua TURNON_FUELED_CONSUMPTION / TURNON_FULL_FUELED_CONSUMPTION. */
export const TURNON_FUELED_CONSUMPTION = .5;
export const TURNON_FULL_FUELED_CONSUMPTION = 1 / 60;
/** tuning.lua TORCH_ATTACK_IGNITE_PERCENT / TORCH_RAIN_RATE. */
const TORCH_ATTACK_IGNITE_PERCENT = 1;
const TORCH_RAIN_RATE = 1.5;
/** torchfire_common.lua CreateLight with TUNING.TORCH_RADIUS[1] and TORCH_FALLOFF[1]. */
export const TORCH_LIGHT: PrefabLocalLight = {
  radius: 2 * (TILE_SIZE / 4), falloff: 0.5, intensity: 0.75,
  colour: [180 / 255, 195 / 255, 150 / 255],
};
export const TORCH_SOUNDS = ['dontstarve/wilson/torch_swing', 'dontstarve/common/fireOut'] as const;

/** torch.lua's fields on the inst. */
export interface TorchInst extends ItemEntity {
  /** inst.fires: the torchfire fx with their lights, set by onequip or IgniteTossed until the source removes them. */
  fires?: { remove(): void }[];
  _ignitesoundtask?: () => void;
  _extinguishsoundtask?: () => void;
  /** inst._owner: the owner it is equipped on, which itemranout reaches. */
  _owner?: EquipmentOwner;
  _fuelratemult?: number;
  /** WatchWorldState("israining") and TheWorld.state.precipitationrate, with the watch's cleanup. */
  _preciptype?: ReadonlySignal<string>;
  _precipitationrate?: ReadonlySignal<number>;
  _stopwatchingrain?: (() => void)[];
  SetFuelRateMult(mult: number): void;
}

/** What onequip reaches on the owner: AttachLightTo(owner) and Follower:FollowSymbol(owner.GUID, "swap_object"). */
export interface TorchHolder {
  lightParent?: PrefabInstance;
  followSymbol?(symbol: string, offsetX: number, offsetY: number, fx?: FollowerFx): { node: THREE.Object3D; remove(): void };
}

/** torch.lua's onattack. TryLuckRoll is the plain chance: this project has no luck stat. */
export function onattack(_weapon: object, attacker: object, target: object): void {
  const { isRemoved, components } = target as { isRemoved?: boolean; components?: { burnable?: Burnable } };
  const burnable = components?.burnable;
  if (!isRemoved && burnable && Math.random() < TORCH_ATTACK_IGNITE_PERCENT * burnable.flammability) burnable.Ignite(undefined, attacker as WorkInst);
}

/** (owner or inst).SoundEmitter: a held torch sounds from its owner, one on the ground from its own transform. */
const ownerSound = (owner?: EquipmentOwner) => owner?.getPosition?.();

/** inst:DoTaskInTime(0, ...): the next game-time step, or at once for an inst outside a world. */
function DoTaskInTime0(inst: TorchInst, run: () => void): (() => void) | undefined {
  const scheduler = inst.components.perishable.scheduler;
  if (scheduler) return scheduler.schedule(0, run);
  run();
  return undefined;
}

function DoIgniteSound(inst: TorchInst, position: ReadonlyVector3 | undefined): void {
  inst._ignitesoundtask = undefined;
  PlaySound('dontstarve/wilson/torch_swing', position);
}

function DoExtinguishSound(inst: TorchInst, position: ReadonlyVector3 | undefined): void {
  inst._extinguishsoundtask = undefined;
  PlaySound('dontstarve/common/fireOut', position);
}

function PlayIgniteSound(inst: TorchInst, position: ReadonlyVector3 | undefined, instant: boolean, force: boolean): void {
  if (inst._extinguishsoundtask) {
    inst._extinguishsoundtask();
    inst._extinguishsoundtask = undefined;
    if (!force) return;
  }
  if (instant) {
    inst._ignitesoundtask?.();
    DoIgniteSound(inst, position);
  } else inst._ignitesoundtask ??= DoTaskInTime0(inst, () => DoIgniteSound(inst, position));
}

function PlayExtinguishSound(inst: TorchInst, position: ReadonlyVector3 | undefined, instant: boolean, force: boolean): void {
  if (inst._ignitesoundtask) {
    inst._ignitesoundtask();
    inst._ignitesoundtask = undefined;
    if (!force) return;
  }
  if (instant) {
    inst._extinguishsoundtask?.();
    DoExtinguishSound(inst, position);
  } else inst._extinguishsoundtask ??= DoTaskInTime0(inst, () => DoExtinguishSound(inst, position));
}

function RemoveFires(inst: TorchInst): void {
  for (const fx of inst.fires ?? []) fx.remove();
  inst.fires = undefined;
}

/** OnRemoveEntity: pending sound tasks stop, which also covers an unequip arriving after removal. */
function OnRemoveEntity(inst: TorchInst): void {
  inst._ignitesoundtask?.(); inst._ignitesoundtask = undefined;
  inst._extinguishsoundtask?.(); inst._extinguishsoundtask = undefined;
  for (const stop of inst._stopwatchingrain?.splice(0) ?? []) stop();
  RemoveFires(inst);
  inst._owner = undefined;
}

/**
 * WatchWorldState("israining", onisraining); onisraining(inst, TheWorld.state.israining). Started with the first fire
 * rather than in fn(): only a consuming torch reads the rate, and a saved inventory is configured before its world is bound.
 */
function WatchRain(inst: TorchInst): void {
  const watch = getBoundWatchWorldContent();
  if (inst._preciptype || !watch) return;
  const stops: (() => void)[] = inst._stopwatchingrain = [];
  inst._precipitationrate = watch(WorldContentKey.PrecipitationRate, stop => stops.push(stop));
  const preciptype = inst._preciptype = watch(WorldContentKey.PrecipType, stop => stops.push(stop));
  preciptype.subscribe(type => onisraining(inst, type === 'rain'));
  onisraining(inst, preciptype.peek() === 'rain');
}

function onupdatefueledraining(inst: TorchInst): void {
  const fueled = inst.components.fueled;
  if (!fueled || inst.isRemoved) return;
  const owner = inst.components.inventoryitem.owner as { components?: { sheltered?: { sheltered?: boolean }; rainimmunity?: object } } | null;
  const ownerProtected = owner?.components?.sheltered?.sheltered || owner?.components?.rainimmunity !== undefined;
  const mult = inst._fuelratemult ?? 1;
  fueled.rate = ownerProtected || (inst.components as { rainimmunity?: object }).rainimmunity !== undefined ? mult
    : (1 + TORCH_RAIN_RATE * (inst._precipitationrate?.peek() ?? 0)) * mult;
}

function onisraining(inst: TorchInst, israining: boolean): void {
  const fueled = inst.components.fueled;
  if (!fueled || inst.isRemoved) return;
  if (israining) {
    fueled.SetUpdateFn(() => onupdatefueledraining(inst));
    onupdatefueledraining(inst);
  } else {
    fueled.SetUpdateFn();
    fueled.rate = inst._fuelratemult ?? 1;
  }
}

export function SetFuelRateMult(inst: TorchInst, mult: number): void {
  const next = mult !== 1 ? mult : undefined;
  if (inst._fuelratemult === next) return;
  inst._fuelratemult = next;
  onisraining(inst, inst._preciptype?.peek() === 'rain');
}

/** onequip: torchfire follows the owner's swap_object and AttachLightTo(owner); the swap art is the equippable's visual. */
function onequip(inst: TorchInst, owner: EquipmentOwner | undefined, holder: TorchHolder): void {
  if (inst.isRemoved) return;
  WatchRain(inst);
  inst.components.burnable!.Ignite();
  PlayIgniteSound(inst, ownerSound(owner), true, false);
  if (!inst.fires) {
    inst.fires = [];
    const parent = holder.lightParent;
    if (parent) {
      // torchfire_common.lua CreateLight + AttachLightTo(owner): a player owner's light is also a playerlight.
      const light = spawnLightEntity('torchfire_light', parent);
      if (parent.hasTag('player')) light.instance.addTag('playerlight');
      light.instance.light.set(TORCH_LIGHT);
      // The holder's display loads the particle textures, draws the effect and advances it each frame.
      const fire = holder.followSymbol?.('swap_object', 0, TORCH_FIRE_OFFSET_Y, TORCH_FIRE_VFX);
      inst.fires.push({ remove() { fire?.remove(); light.remove(); } });
    }
  }
  inst._owner = owner;
}

function onunequip(inst: TorchInst): void {
  const owner = inst._owner;
  if (inst.fires) {
    RemoveFires(inst);
    if (!inst.isRemoved) PlayExtinguishSound(inst, ownerSound(owner), false, false);
  }
  inst.components.burnable!.Extinguish();
  inst._owner = undefined;
}

/** IgniteTossed: burning on the inst itself, its torchfire on swap_torch and the light attached to the inst. */
export function IgniteTossed(inst: TorchInst): void {
  if (inst.isRemoved) return;
  WatchRain(inst);
  inst.components.burnable!.Ignite();
  if (inst.fires) return;
  const fire = inst.sprite.followSymbol('swap_torch', 0, TORCH_FIRE_OFFSET_Y, TORCH_FIRE_VFX);
  inst.light.set(TORCH_LIGHT);
  inst.fires = [{ remove() { fire.remove(); inst.light.set(null); } }];
}

/** OnPutInInventory: back to idle, the fire goes and fuel stops without emptying it. */
function OnPutInInventory(inst: TorchInst, owner: InventoryActor): void {
  if (inst.isRemoved) return;
  inst.sprite.playOnce('idle');
  if (inst.fires) {
    RemoveFires(inst);
    PlayExtinguishSound(inst, owner.GetPosition() as ReadonlyVector3, false, false);
  }
  inst.components.burnable!.Extinguish();
}

/** burnable's onextinguish: handles being extinguished from outside while stuck in the ground (flingo, waterballoon, icestaff). */
function OnExtinguish(inst: TorchInst): void {
  if (inst.isRemoved || !inst.fires || inst.components.inventoryitem.owner !== null || (inst.components.fueled?.IsEmpty() ?? true)) return;
  RemoveFires(inst);
  PlayExtinguishSound(inst, inst.position, true, false);
  inst.sprite.playOnce('idle');
  // Physics:Teleport(x, max(.1, y), z) and SetVel(speed * cos, 8 + random, -speed * sin) with speed = random.
  inst.components.inventoryphysics?.Launch({ angle: Math.random() * Math.PI * 2, height: .1,
    speed: { min: 0, range: 1 }, ySpeed: { min: 8, range: 1 } } satisfies LootLaunch);
}

/** onfuelchange: burning out. */
function onfuelchange(newsection: number, inst: TorchInst): void {
  if (newsection > 0 || inst.isRemoved) return;
  inst.components.burnable?.Extinguish();
  if (inst.components.inventoryitem.owner !== null) {
    const owner = inst._owner;
    if (owner && inst.components.equippable?.IsEquipped()) {
      PlayExtinguishSound(inst, ownerSound(owner), true, false);
      inst.remove(); // need to remove before "itemranout" for auto-reequip to work
      owner.PushEvent('itemranout', { prefab: TORCH_ID, equipslot: 'hand', announce: 'ANNOUNCE_TORCH_OUT' });
    } else inst.remove();
  } else if (inst.fires) {
    RemoveFires(inst);
    PlayExtinguishSound(inst, inst.position, true, false);
    inst.persists = false;
    inst.addTag('NOCLICK');
    // As in Lua, fueled:DoDelta then runs SetDepletedFn(inst.Remove) in this same call, which ends the erosion at once.
    const scheduler = inst.components.perishable.scheduler;
    if (scheduler) {
      const erode = new ErodeAway(scheduler, amount => inst.sprite.setErosion(amount), () => inst.remove());
      inst.onRemove(() => erode.dispose());
      erode.start();
    }
  } else inst.remove(); // Shouldn't reach here.
}

/** equippable:SetOnEquip(onequip) / SetOnUnequip(onunequip), with the owner's light parent and FollowSymbol. */
export function createTorchHandLifecycle(entity: ItemEntity, holder: TorchHolder): HeldEquipFunctions {
  const inst = entity as TorchInst;
  return {
    onequip: owner => onequip(inst, owner, holder),
    onunequip: () => onunequip(inst),
    flush: () => inst.components.fueled?.Settle(),
  };
}

/** torch.lua fn: the ground half of the torch's lifecycle on its own inst, and OnSave / OnLoad of a tossed, burning torch. */
export function torchPrefabs(world: ItemPrefabWorld): Record<string, ItemPrefabDefinition> {
  return {
    [TORCH_ID]: groundItemPrefab(TORCH_ID, world, {
      configure: entity => {
        const inst = entity as TorchInst;
        inst.OnSave = (_inst, data) => { if (inst.components.burnable?.IsBurning() && !inst.inlimbo) data.torch = { lit: true }; };
        // OnLoad: a torch saved burning on the ground lands and burns again.
        if (inst.saveRecord?.components.torch?.lit && !inst.inlimbo) {
          inst.sprite.playOnce('land');
          IgniteTossed(inst);
        }
      },
    }),
  };
}

export const torchVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('torch', GROUND_ITEM_DEFINITIONS.torch.skinArchives, item.skinId);
  return handEquipmentVisual(item, [...skin ? [skin] : [], 'swap_torch'], 'swap_torch');
};
