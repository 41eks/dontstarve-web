import { addComponent } from './components';
import { ItemEntity, registerItemEntityClass } from '@dontstarve-web/inventory';
import type { EntityTask } from './prefabInstance';
import type { EquipmentOwner } from '@dontstarve-web/signals';
import { Armor } from '../../componets/src/armor';
import { Equippable, type EquippableOwner } from '../../componets/src/equippable';
import { EQUIPMENTSETNAMES, SetBonus } from '../../componets/src/setbonus';

export const DREADSTONEHAT_ID = 'dreadstonehat';
// tuning.lua: wilson_health * 8 * multiplayer_armor_durability_modifier (.7); absorption .9 * 1.
export const ARMOR_DREADSTONEHAT = 150 * 8 * 0.7;
export const ARMOR_DREADSTONEHAT_ABSORPTION = 0.9;
// tuning.lua ARMOR_DREADSTONE_REGEN_*: share of maxcondition repaired per period, by sanity.
export const ARMOR_DREADSTONE_REGEN_PERIOD = 1;
export const ARMOR_DREADSTONE_REGEN_MINRATE = (0.01 / 10) / 1.5;
export const ARMOR_DREADSTONE_REGEN_MAXRATE = (0.01 / 6) / 1.5;
const ARMOR_DREADSTONE_REGEN_SETBONUS = 1.5;
/** tuning.lua CRAZINESS_MED = -100 / day_time. */
export const CRAZINESS_MED = -100 / 300;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** hats.lua's inst.regentask: not saved; onequip after a load starts it again while the armor is damaged. */
/** hats.lua's dreadstonehat inst: the regeneration task its callbacks set on it. */
export class DreadstoneHatEntity extends ItemEntity {
  regentask?: EntityTask;
}
registerItemEntityClass(DREADSTONEHAT_ID, (...item) => new DreadstoneHatEntity(...item));

/** The hat's own inst, which the inventory constructs for every dreadstonehat. */
function dreadstoneEntity(entity: ItemEntity): DreadstoneHatEntity {
  if (!(entity instanceof DreadstoneHatEntity)) { throw new Error(`${entity.prefab} is not a dreadstonehat entity`); }
  return entity;
}

/** dreadstone_doregen: repair faster at lower sanity, only while the wearer is in insanity mode. */
function dreadstone_doregen(inst: DreadstoneHatEntity, owner: EquipmentOwner): void {
  const armor = inst.components.armor!, sanity = owner.components?.sanity;
  if (sanity?.IsInsanityMode()) {
    const setbonus = inst.components.setbonus?.IsEnabled(EQUIPMENTSETNAMES.DREADSTONE) ? ARMOR_DREADSTONE_REGEN_SETBONUS : 1;
    const rate = 1 / lerp(1 / ARMOR_DREADSTONE_REGEN_MAXRATE, 1 / ARMOR_DREADSTONE_REGEN_MINRATE, sanity.GetPercent());
    armor.Repair(armor.maxcondition * rate * setbonus);
  }
  if (!armor.IsDamaged()) { dreadstone_stopregen(inst); }
}

function dreadstone_startregen(inst: DreadstoneHatEntity, owner: EquipmentOwner): void {
  // An item outside a world has no game time to regenerate on; it starts again on equip once adopted.
  if (inst.regentask || !inst.worldServices?.scheduler) { return; }
  inst.regentask = inst.DoPeriodicTask(ARMOR_DREADSTONE_REGEN_PERIOD, inst => dreadstone_doregen(inst, owner));
}

function dreadstone_stopregen(inst: DreadstoneHatEntity): void {
  inst.regentask?.Cancel();
  inst.regentask = undefined;
}

/** inventoryitem.owner while equipped: the injected wearer, released on unequip. */
const equippedOwners = new WeakMap<ItemEntity, EquipmentOwner>();

/** dreadstone_calcdapperness: the regenerating hat drains an insane wearer's sanity. armordreadstone is not ported. */
function calcdapperness(inst: DreadstoneHatEntity, owner: EquippableOwner | undefined): number {
  const insanity = owner?.components?.sanity?.IsInsanityMode() ?? false;
  return insanity && inst.regentask ? CRAZINESS_MED : 0;
}

/** hats.lua simple() + dreadstone_custom_init + fns.dreadstone: tags, armor, magic dapperness and the set name. */
export function configureDreadstoneHatEntity(entity: ItemEntity): void {
  const inst = dreadstoneEntity(entity);
  for (const tag of ['hat', 'dreadstone', 'hardarmor', 'shadow_item', 'waterproofer', 'shadowlevel']) { entity.addTag(tag); }
  // Inventory re-configures entities on equip and commits; InitCondition belongs to construction only.
  if (!entity.components.armor) {
    const armor = addComponent(entity, 'armor', Armor);
    armor.InitCondition(ARMOR_DREADSTONEHAT, ARMOR_DREADSTONEHAT_ABSORPTION);
    // dreadstone_ontakedamage
    armor.ontakedamage = () => {
      const owner = equippedOwners.get(entity);
      if (!inst.regentask && owner?.components?.sanity) { dreadstone_startregen(inst, owner); }
    };
  }
  const equippable = addComponent(entity, 'equippable', Equippable<ItemEntity>, 'head');
  equippable.is_magic_dapperness = true;
  equippable.SetDappernessFn((_inst, owner) => calcdapperness(inst, owner));
  if (!entity.components.setbonus) { addComponent(entity, 'setbonus', SetBonus).SetSetName(EQUIPMENTSETNAMES.DREADSTONE); }
}

/** dreadstone_onequip after the hat's own onequip: regeneration runs only while worn and damaged. */
export function dreadstone_onequip(entity: ItemEntity, owner: EquipmentOwner): void {
  const inst = dreadstoneEntity(entity);
  equippedOwners.set(inst, owner);
  if (owner.components?.sanity && inst.components.armor?.IsDamaged()) { dreadstone_startregen(inst, owner); }
  else { dreadstone_stopregen(inst); }
}

/** dreadstone_onunequip before the hat's own onunequip. */
export function dreadstone_onunequip(entity: ItemEntity): void {
  const inst = dreadstoneEntity(entity);
  equippedOwners.delete(inst);
  dreadstone_stopregen(inst);
}
