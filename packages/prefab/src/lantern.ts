import { addComponent } from './components';
import type { AnimState } from '@dontstarve-web/animation/animState';
import { ItemEntity, registerItemEntityClass } from '@dontstarve-web/inventory';
import type { EquipmentOwner } from '@dontstarve-web/signals';
import * as THREE from 'three';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory, type HeldEquipFunctions } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS, groundItemPrefab, type ItemPrefabDefinition } from './groundItems';
import type { ItemPrefabWorld } from './groundPrefab';
import { TILE_SIZE } from './tile';
import { spawnLightEntity, type LightEntity, type LightParent } from './localLight';
import { Machine } from '../../componets/src/machine';
import { TURNON_FULL_FUELED_CONSUMPTION, TURNON_FUELED_CONSUMPTION } from './torch';

export const LANTERN_ID = 'lantern';
export const LANTERN_COLOUR = [180 / 255, 195 / 255, 150 / 255] as const;
/** tuning.lua: LANTERN_LIGHTTIME = (night_time + dusk_time) * 2.6 with 2 night and 4 dusk segments. */
export const LANTERN_FUEL = (30 * 2 + 30 * 4) * 2.6;

/** mininglantern.lua's fields on the inst. */
/** mininglantern.lua's inst: the fields its fn and callbacks set on it. */
export class LanternEntity extends ItemEntity {
  /** inst._light: the lanternlight, parented to (owner or inst) while on. */
  _light?: LightEntity;
  /** inst._owner: after an unequip while on, the owner whose next hand (or heavy body) equip turns it off. */
  _owner?: EquipmentOwner;
  _stoptrackingowner?: () => void;
  /** inventoryitem.owner as onequip reaches it: the owner itself, its entity for SetParent and owner.AnimState (the inst's slot). */
  _equipowner?: EquipmentOwner;
  _ownerentity?: LightParent;
  _ownerAnimState?: Pick<AnimState, 'Show' | 'Hide'>;
}
registerItemEntityClass(LANTERN_ID, (...item) => new LanternEntity(...item));

/** The lantern's own inst, which the inventory constructs for every lantern. */
function lanternEntity(entity: ItemEntity): LanternEntity {
  if (!(entity instanceof LanternEntity)) { throw new Error(`${entity.prefab} is not a lantern entity`); }
  return entity;
}

/** What onequip reaches on the owner: its entity for the light and owner.AnimState, the inst's own slot of its sprite. */
export interface LanternHolder {
  lightParent?: LightParent;
  AnimState?: Pick<AnimState, 'Show' | 'Hide'>;
}

const isEquipped = (inst: LanternEntity) => inst.components.equippable?.IsEquipped() === true;

/** fuelupdate: the light follows the fuel percent, radius 3 -> 5 and intensity .4 -> .6. */
function fuelupdate(inst: LanternEntity): void {
  const fueled = inst.components.fueled;
  if (!inst._light || !fueled) { return; }
  const fuelpercent = THREE.MathUtils.clamp(fueled.GetPercent(), 0, 1);
  inst._light.instance.light.set({
    radius: THREE.MathUtils.lerp(3, 5, fuelpercent) * (TILE_SIZE / 4),
    intensity: THREE.MathUtils.lerp(.4, .6, fuelpercent),
    falloff: .9,
    colour: LANTERN_COLOUR,
  });
}

function stoptrackingowner(inst: LanternEntity): void {
  inst._stoptrackingowner?.();
  inst._stoptrackingowner = undefined;
  inst._owner = undefined;
}

function starttrackingowner(inst: LanternEntity, owner: EquipmentOwner | undefined): void {
  if (owner === inst._owner) { return; }
  stoptrackingowner(inst);
  if (!owner?.ListenForEvent) { return; }
  inst._owner = owner;
  inst._stoptrackingowner = owner.ListenForEvent('equip', (_inst, data) => onownerequip(inst, data));
}

/** inst._onownerequip */
function onownerequip(inst: LanternEntity, data: unknown): void {
  const { item, eslot } = data as { item?: { hasTag?(tag: string): boolean }; eslot?: string };
  if (item !== inst && (eslot === 'HANDS' || (eslot === 'BODY' && item?.hasTag?.('heavy')))) { turnoff(inst); }
}

function turnon(inst: LanternEntity): void {
  const fueled = inst.components.fueled;
  if (inst.isRemoved || !fueled || fueled.IsEmpty()) { return; }
  fueled.StartConsuming();
  const held = inst.components.inventoryitem.owner !== null;
  if (!inst._light) {
    inst._light = spawnLightEntity('lanternlight');
    fuelupdate(inst);
  }
  inst._light.setParent(held ? inst._ownerentity : inst);
  inst.sprite.playOnce('idle_on');
  if (held && isEquipped(inst)) { inst._ownerAnimState?.Show('LANTERN_OVERLAY'); }
  inst.components.machine!.isOn = true;
}

function turnoff(inst: LanternEntity): void {
  stoptrackingowner(inst);
  if (inst.isRemoved) { return; }
  inst.components.fueled?.StopConsuming();
  inst._light?.remove();
  inst._light = undefined;
  inst.sprite.playOnce('idle_off');
  if (isEquipped(inst)) { inst._ownerAnimState?.Hide('LANTERN_OVERLAY'); }
  inst.components.machine!.isOn = false;
}

/** OnRemoveEntity */
function OnRemove(inst: LanternEntity): void {
  stoptrackingowner(inst);
  inst._light?.remove();
  inst._light = undefined;
  inst.components.machine?.dispose();
}

/** inventoryitem:SetOnDroppedFn(ondropped) */
function ondropped(inst: LanternEntity): void {
  turnoff(inst);
  turnon(inst);
}

/** onequip: the swap art is the equippable's visual; LANTERN_OVERLAY shows only while there is fuel. */
function onequip(inst: LanternEntity, owner: EquipmentOwner | undefined, holder: LanternHolder): void {
  if (inst.isRemoved) { return; }
  inst._equipowner = owner;
  inst._ownerentity = holder.lightParent;
  inst._ownerAnimState = holder.AnimState;
  if (inst.components.fueled!.IsEmpty()) { holder.AnimState?.Hide('LANTERN_OVERLAY'); }
  else {
    holder.AnimState?.Show('LANTERN_OVERLAY');
    turnon(inst);
  }
}

/** onunequip only clears the worn art; pocketing, dropping or the owner's next equip decides when it turns off. */
function onunequip(inst: LanternEntity): void {
  const owner = inst._equipowner;
  inst._ownerAnimState?.Hide('LANTERN_OVERLAY');
  inst._ownerAnimState = undefined;
  inst._equipowner = undefined;
  if (inst.components.machine?.IsOn()) { starttrackingowner(inst, owner); }
}

/** fueled:SetDepletedFn(nofuel): an equipped lantern tells its owner it ran out. */
function nofuel(inst: LanternEntity): void {
  const owner = isEquipped(inst) && inst.components.inventoryitem.owner !== null ? inst._equipowner : undefined;
  turnoff(inst);
  owner?.PushEvent('torchranout', { prefab: inst.prefab, equipslot: 'HANDS' });
}

/** fueled:SetTakeFuelFn(ontakefuel) */
function ontakefuel(inst: LanternEntity): void {
  if (isEquipped(inst)) { turnon(inst); }
}

/** mininglantern.lua fn(): inventoryitem, machine and CAVE fueled with the callbacks it registers on them. */
export function configureLanternEntity(entity: ItemEntity): void {
  if (entity.components.machine) { return; }
  const inst = lanternEntity(entity);
  inst.components.inventoryitem.SetOnPutInInventoryFn(() => turnoff(inst));
  inst.ListenForEvent('ondropped', () => ondropped(inst));
  const machine = addComponent(inst, 'machine', Machine, () => inst.components.perishable.scheduler);
  machine.turnonfn = () => turnon(inst);
  machine.turnofffn = () => turnoff(inst);
  machine.cooldowntime = 0;
  if (!inst.components.fueled) {
    const fueled = inst.AddFueled();
    fueled.fueltype = 'CAVE';
    fueled.InitializeFuelLevel(LANTERN_FUEL);
    fueled.SetDepletedFn(() => nofuel(inst));
    fueled.SetUpdateFn(() => fuelupdate(inst));
    fueled.SetTakeFuelFn(() => ontakefuel(inst));
    fueled.SetFirstPeriod(TURNON_FUELED_CONSUMPTION, TURNON_FULL_FUELED_CONSUMPTION);
    fueled.accepting = true;
  }
  inst.onRemove(() => OnRemove(inst));
}

/** equippable:SetOnEquip(onequip) / SetOnUnequip(onunequip), with the owner's entity and AnimState slot. */
export function createLanternHandLifecycle(entity: ItemEntity, holder: LanternHolder): HeldEquipFunctions {
  const inst = lanternEntity(entity);
  return {
    onequip: owner => onequip(inst, owner, holder),
    onunequip: () => onunequip(inst),
    flush: () => inst.components.fueled?.Settle(),
  };
}

/** mininglantern.lua: the ground half of the lantern on its own inst; machine's OnSave / OnLoad keep the switch. */
export function lanternPrefabs(world: ItemPrefabWorld): Record<string, ItemPrefabDefinition> {
  return {
    [LANTERN_ID]: groundItemPrefab(LANTERN_ID, world, {
      configure: inst => {
        inst.addTag('light');
        configureLanternEntity(inst);
        const machine = inst.components.machine!;
        inst.sprite.playOnce(machine.IsOn() ? 'idle_on' : 'idle_off');
        // machine.lua OnSave writes the switch itself; fueled settles first.
        inst.OnSave = () => { inst.components.fueled?.Settle(); };
        // machine:OnLoad, once the machine's turnon / turnoff callbacks exist.
        const saved = inst.saveRecord?.components.machine;
        if (saved) { machine.OnLoad(saved); }
      },
    }),
  };
}

/** Source prefab onequip/onunequip: swap_lantern, or the skin's, named on the owner's AnimState. */
export const lanternVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('lantern', GROUND_ITEM_DEFINITIONS.lantern.skinArchives, item.skinId);
  return handEquipmentVisual(item, [...skin ? [skin] : [], 'swap_lantern'], 'swap_lantern', [{ symbol: 'lantern_overlay', source: 'lantern_overlay' }]);
};
