import type { ItemEntity, ItemRuntimeComponent } from '@dontstarve-web/inventory';
import type { EquipmentLifecycle, EquipmentOwner } from '@dontstarve-web/signals';
import { Armor } from '../../componets/src/armor';
import { Equippable, type EquippableOwner } from '../../componets/src/equippable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { EQUIPMENTSETNAMES, SetBonus } from '../../componets/src/setbonus';
import { ComponentTimer } from '../../componets/src/timer';

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

const REGEN = 'dreadstoneregen';
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * hats.lua's inst.regentask: a DoPeriodicTask bound to the wearer, owned by the item so ontakedamage and dapperfn see it.
 * It is not saved; onequip after a load starts it again while the armor is damaged.
 */
class DreadstoneRegen implements ItemRuntimeComponent {
  private readonly timer: ComponentTimer;
  /** Read-only task state: scheduled while regenerating, stopped once cancelled. */
  readonly snapshot;
  private owner?: EquipmentOwner;
  private readonly entity: ItemEntity;

  constructor(entity: ItemEntity, scheduler: GameTimeScheduler) {
    this.entity = entity;
    this.timer = new ComponentTimer(scheduler, () => this.doregen());
    this.snapshot = this.timer.snapshot;
  }

  get running(): boolean { return this.owner !== undefined; }

  start(owner: EquipmentOwner): void {
    if (this.running) return;
    this.owner = owner;
    this.timer.start(ARMOR_DREADSTONE_REGEN_PERIOD);
  }

  stop(): void {
    this.owner = undefined;
    this.timer.stop();
  }

  /** dreadstone_doregen: repair faster at lower sanity, only while the wearer is in insanity mode. */
  private doregen(): void {
    const owner = this.owner!, armor = this.entity.components.armor!;
    const sanity = owner.components?.sanity;
    if (sanity?.IsInsanityMode()) {
      const setbonus = this.entity.components.setbonus?.IsEnabled(EQUIPMENTSETNAMES.DREADSTONE) ? ARMOR_DREADSTONE_REGEN_SETBONUS : 1;
      const rate = 1 / lerp(1 / ARMOR_DREADSTONE_REGEN_MAXRATE, 1 / ARMOR_DREADSTONE_REGEN_MINRATE, sanity.GetPercent());
      armor.Repair(armor.maxcondition * rate * setbonus);
    }
    if (this.owner !== owner) return;
    if (armor.IsDamaged() && !this.entity.isRemoved) this.timer.start(ARMOR_DREADSTONE_REGEN_PERIOD);
    else this.stop();
  }

  dispose(): void { this.stop(); }
}

/** inventoryitem.owner while equipped: the injected wearer, released on unequip. */
const equippedOwners = new WeakMap<ItemEntity, EquipmentOwner>();

const regenOf = (entity: ItemEntity) => entity.getComponent<DreadstoneRegen>(REGEN);
function startRegen(entity: ItemEntity, owner: EquipmentOwner): void {
  const scheduler = entity.components.perishable.scheduler;
  if (!scheduler || entity.isRemoved) return;
  entity.component(REGEN, () => new DreadstoneRegen(entity, scheduler)).start(owner);
}

/** dreadstone_calcdapperness: the regenerating hat drains an insane wearer's sanity. armordreadstone is not ported. */
function calcdapperness(entity: ItemEntity, owner: EquippableOwner | undefined): number {
  const insanity = owner?.components?.sanity?.IsInsanityMode() ?? false;
  return insanity && regenOf(entity)?.running ? CRAZINESS_MED : 0;
}

/** hats.lua simple() + dreadstone_custom_init + fns.dreadstone: tags, armor, magic dapperness and the set name. */
export function configureDreadstoneHatEntity(entity: ItemEntity): void {
  for (const tag of ['hat', 'dreadstone', 'hardarmor', 'shadow_item', 'waterproofer', 'shadowlevel']) entity.addTag(tag);
  // Inventory re-configures entities on equip and commits; InitCondition belongs to construction only.
  if (!entity.components.armor) {
    const armor = entity.components.armor = new Armor(entity);
    armor.InitCondition(ARMOR_DREADSTONEHAT, ARMOR_DREADSTONEHAT_ABSORPTION);
    // dreadstone_ontakedamage
    armor.ontakedamage = () => {
      const owner = equippedOwners.get(entity);
      if (!regenOf(entity)?.running && owner?.components?.sanity) startRegen(entity, owner);
    };
  }
  const equippable = entity.components.equippable ??= new Equippable(entity, 'head');
  equippable.is_magic_dapperness = true;
  equippable.SetDappernessFn((_inst, owner) => calcdapperness(entity, owner));
  if (!entity.components.setbonus) {
    entity.components.setbonus = new SetBonus();
    entity.components.setbonus.SetSetName(EQUIPMENTSETNAMES.DREADSTONE);
  }
}

/** dreadstone_onequip / dreadstone_onunequip: regeneration runs only while worn and damaged. */
export function createDreadstoneHatLifecycle(entity: ItemEntity): EquipmentLifecycle {
  return {
    onequip(owner) {
      if (!owner) return;
      equippedOwners.set(entity, owner);
      if (owner.components?.sanity && entity.components.armor?.IsDamaged()) startRegen(entity, owner);
      else regenOf(entity)?.stop();
    },
    onunequip() {
      equippedOwners.delete(entity);
      regenOf(entity)?.stop();
    },
  };
}
