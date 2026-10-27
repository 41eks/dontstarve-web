import type { Vector3 } from 'three';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { EquipmentLifecycle, EquipmentOwner } from '@dontstarve-web/signals';
import { Equippable } from '../../componets/src/equippable';
import { Hauntable, HAUNT_INSTANT_REZ, type HauntableInst } from '../../componets/src/hauntable';
import { ComponentTimer } from '../../componets/src/timer';
import { skinArchive, type EquipmentVisualFactory, type EquipmentVisualOwner } from './equipmentVisual';
import catalog from './groundItems.json' with { type: 'json' };

/** amulet.lua registers the red amulet as prefab `amulet`; the other colours are separate prefabs. */
export const AMULET_ID = 'amulet';
// tuning.lua REDAMULET_USES / REDAMULET_CONVERSION / REDAMULET_CONVERSION_TIME, DAPPERNESS_SMALL = 100 / (day_time * 10).
export const REDAMULET_USES = 20;
export const REDAMULET_CONVERSION = 5;
export const REDAMULET_CONVERSION_TIME = 30;
export const AMULET_DAPPERNESS = 100 / (300 * 10);
/** healowner: the hunger the conversion needs to leave behind. */
const REDAMULET_MIN_HUNGER = 5;

/** What the ghost's OnRespawnFromGhost needs from a resurrector, and the hauntable's own inst. */
export interface AmuletRezSource extends HauntableInst {
  readonly prefab: typeof AMULET_ID;
  readonly entity: ItemEntity;
  isValid(): boolean;
  readonly position: Vector3;
  hasTag(tag: string): boolean;
}

/** `source:IsValid() and not source:IsInLimbo()`: a held or removed amulet is not on the ground any more. */
function createRezSource(entity: ItemEntity): AmuletRezSource {
  return {
    prefab: AMULET_ID, entity,
    isValid: () => !entity.isRemoved && entity.components.inventoryitem.owner === null && !entity.hasTag('INLIMBO'),
    get position() { return entity.transform.position; },
    hasTag: tag => entity.hasTag(tag),
    addTag: tag => entity.addTag(tag),
    removeTag: tag => entity.removeTag(tag),
    PushEvent: (name, data) => entity.PushEvent(name, data),
  };
}

/** amulet.lua commonfn + red: tags, body equippable with magic dapperness, finiteuses and a hauntable that resurrects. */
export function configureAmuletEntity(entity: ItemEntity): void {
  entity.addTag('shadowlevel');
  entity.addTag('resurrector');
  const equippable = entity.components.equippable ??= new Equippable(entity, 'body');
  equippable.dapperness = AMULET_DAPPERNESS;
  equippable.is_magic_dapperness = true;
  // The timer belongs to the world the item is bound to; a world-less entity is configured again once adopted.
  const scheduler = entity.components.perishable.scheduler;
  if (!scheduler || entity.components.hauntable) return;
  entity.components.hauntable = entity.component('hauntable', () => {
    const hauntable = new Hauntable(createRezSource(entity), scheduler);
    hauntable.SetHauntValue(HAUNT_INSTANT_REZ);
    return hauntable;
  });
}

/** amulet.lua healowner: convert hunger into health while hurt, one use per conversion. */
function healowner(entity: ItemEntity, owner: EquipmentOwner): void {
  const { health, hunger } = owner.components ?? {};
  if (!health || !hunger || health.peek() >= health.GetMaxWithPenalty() || hunger.peek() <= REDAMULET_MIN_HUNGER) return;
  health.set(health.peek() + REDAMULET_CONVERSION);
  hunger.set(hunger.peek() - REDAMULET_CONVERSION);
  entity.components.finiteuses.use(1);
}

/**
 * amulet.lua onequip_red / onunequip_red / onequiptomodel_red: while worn, a periodic task heals the owner. The task is a
 * game-time timer re-armed after each run; it is not saved, and equipping on load starts it again. The worn art keeps
 * `swap_body` while the owner is in amulet_rebirth, whose state clears it on exit.
 */
export function createAmuletEquipmentLifecycle(entity: ItemEntity, art: Pick<EquipmentLifecycle, 'onequip' | 'onunequip'>): EquipmentLifecycle {
  let task: ComponentTimer | undefined;
  let owner: EquipmentOwner | undefined;
  return {
    onequip(equipper) {
      owner = equipper;
      art.onequip(equipper);
      const scheduler = entity.components.perishable.scheduler;
      if (!equipper || !scheduler) return;
      const current: ComponentTimer = task = new ComponentTimer(scheduler, () => {
        healowner(entity, equipper);
        if (task === current && !entity.isRemoved) current.start(REDAMULET_CONVERSION_TIME);
      });
      current.start(REDAMULET_CONVERSION_TIME);
    },
    onunequip() {
      task?.stop();
      task = undefined;
      if (!owner?.IsCurrentState?.('amulet_rebirth')) art.onunequip();
      owner = undefined;
    },
  };
}

/** amulet.lua onequip_red: swap_body from torso_amulets' redamulet, or the skin's swap_body. */
export const amuletVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('amulet', catalog.items.amulet.skinArchives as Readonly<Record<string, string>>, item.skinId);
  let owner: EquipmentVisualOwner | undefined;
  return {
    onequip(equipper) {
      owner = equipper;
      if (skin) {
        owner.PushEvent('equipskinneditem', item.skinId);
        owner.AnimState.OverrideItemSkinSymbol('swap_body', skin, 'swap_body', item.id, 'torso_amulets');
      } else owner.AnimState.OverrideSymbol('swap_body', 'torso_amulets', 'redamulet');
    },
    onunequip() {
      if (!owner) return;
      owner.AnimState.ClearOverrideSymbol('swap_body');
      if (skin) owner.PushEvent('unequipskinneditem', item.skinId);
      owner = undefined;
    },
  };
};
