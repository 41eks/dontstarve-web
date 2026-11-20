import type { EntityTask } from './prefabInstance';
import { addComponent } from './components';
import type { ItemEntity, ItemRuntimeComponent } from '@dontstarve-web/inventory';
import type { EquipmentOwner } from '@dontstarve-web/signals';
import { Equippable } from '../../componets/src/equippable';
import { Hauntable, HAUNT_INSTANT_REZ } from '../../componets/src/hauntable';
import { skinArchive, wornOwner, type EquipmentVisual, type EquipmentVisualFactory, type EquipmentArtOwner } from './equipmentVisual';
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

/** amulet.lua commonfn + red: tags, body equippable with magic dapperness, finiteuses and a hauntable that resurrects. */
export function configureAmuletEntity(entity: ItemEntity): void {
  entity.addTag('shadowlevel');
  entity.addTag('resurrector');
  const equippable = addComponent(entity, 'equippable', Equippable<ItemEntity>, 'body');
  equippable.dapperness = AMULET_DAPPERNESS;
  equippable.is_magic_dapperness = true;
  const red = entity.component('redamulet', () => new RedAmulet(entity));
  equippable.SetOnEquip((_inst, owner) => red.onequip(owner));
  equippable.SetOnUnequip((_inst, owner) => red.onunequip(owner));
  // The timer belongs to the world the item is bound to; a world-less entity is configured again once adopted.
  const scheduler = entity.components.perishable.scheduler;
  if (!scheduler || entity.components.hauntable) { return; }
  addComponent(entity, 'hauntable', Hauntable, scheduler).SetHauntValue(HAUNT_INSTANT_REZ);
}

/** amulet.lua healowner: convert hunger into health while hurt, one use per conversion. */
function healowner(entity: ItemEntity, owner: EquipmentOwner): void {
  const { health, hunger } = owner.components ?? {};
  if (!health || !hunger || !health.IsHurt() || hunger.current <= REDAMULET_MIN_HUNGER) { return; }
  health.DoDelta(REDAMULET_CONVERSION, false, 'redamulet');
  hunger.DoDelta(-REDAMULET_CONVERSION);
  entity.components.finiteuses.use(1);
}

/**
 * amulet.lua onequip_red / onunequip_red: swap_body on the owner's AnimState, and `inst.task`, a periodic task that heals
 * the owner while worn. The task is a game-time timer re-armed after each run; it is not saved, and equipping on load
 * starts it again.
 */
class RedAmulet implements ItemRuntimeComponent {
  private readonly inst: ItemEntity;
  private task?: EntityTask;
  private visual?: EquipmentVisual;
  constructor(inst: ItemEntity) { this.inst = inst; }

  onequip(owner: EquipmentOwner): void {
    this.onunequip(owner);
    const worn = wornOwner(owner);
    if (worn) {
      this.visual = amuletVisual({ id: this.inst.id, prefab: this.inst.prefab, skinId: this.inst.skinId });
      this.visual.onequip(worn);
    }
    if (!this.inst.worldServices?.scheduler) { return; }
    this.task = this.inst.DoPeriodicTask(REDAMULET_CONVERSION_TIME, inst => healowner(inst, owner));
  }

  onunequip(owner?: EquipmentOwner): void {
    const visual = this.visual;
    this.visual = undefined;
    // onunequip_red keeps swap_body while the owner is in amulet_rebirth; that state clears it on exit, so the
    // amulet's slot stays drawn until the owner leaves it.
    const worn = owner && wornOwner(owner);
    if (visual && worn?.sg?.stateName === 'amulet_rebirth') {
      const release = worn.Retain();
      const stop = worn.ListenForEvent?.('newstate', (_inst, data) => {
        if ((data as { statename?: string } | undefined)?.statename === 'amulet_rebirth') { return; }
        stop?.();
        visual.onunequip();
        release();
      });
      if (!stop) { visual.onunequip(); release(); }
    } else { visual?.onunequip(); }
    this.task?.Cancel();
    this.task = undefined;
  }

  dispose(): void { this.onunequip(); }
}

/** amulet.lua onequip_red: swap_body from torso_amulets' redamulet, or the skin's swap_body. */
export const amuletVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('amulet', catalog.items.amulet.skinArchives as Readonly<Record<string, string>>, item.skinId);
  let owner: EquipmentArtOwner | undefined;
  return {
    onequip(equipper) {
      owner = equipper;
      if (skin) {
        owner.PushEvent('equipskinneditem', item.skinId);
        owner.AnimState.OverrideItemSkinSymbol('swap_body', skin, 'swap_body', item.id, 'torso_amulets');
      } else { owner.AnimState.OverrideSymbol('swap_body', 'torso_amulets', 'redamulet'); }
    },
    onunequip() {
      if (!owner) { return; }
      owner.AnimState.ClearOverrideSymbol('swap_body');
      if (skin) { owner.PushEvent('unequipskinneditem', item.skinId); }
      owner = undefined;
    },
  };
};
