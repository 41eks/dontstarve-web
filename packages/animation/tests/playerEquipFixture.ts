import { ItemEntityRegistry, type InventoryStore, type ItemEntity } from '../../inventory/src';
import type { EquipmentOwner } from '../../signals/src';
import { INVENTORY_ITEM_SPECS } from '../../../src/inventoryItems';
import { createEquipmentViews } from '../../prefab/src/equipmentVisual';
import type { WilsonAnimationController } from '../../prefab/src/player';

type Kind = 'hand' | 'head' | 'body';
const ESLOTS: Readonly<Record<Kind, string>> = { hand: 'HANDS', head: 'HEAD', body: 'BODY' };

/**
 * The player as equipment owner, as main.ts's actor is: equip/unequip reach SGwilson, and OpenEquipmentView gives each
 * equipped inst its slot of the player's sprite. `base` adds the owner's other capabilities.
 */
export function playerEquipmentOwner(animation: Pick<WilsonAnimationController, 'equipmentPresentation' | 'stategraph'>,
  base: Partial<EquipmentOwner> & Record<string, unknown> = {}): EquipmentOwner {
  const owner: EquipmentOwner = {
    ...base,
    PushEvent: (name, data) => {
      if (name === 'equip' || name === 'unequip') animation.stategraph.pushEvent(name, data);
      base.PushEvent?.(name, data);
    },
  };
  owner.OpenEquipmentView = createEquipmentViews(owner, animation.equipmentPresentation);
  return owner;
}

/** Binds an inventory's actor to the player owner, so its committed equips draw on the player. */
export function bindPlayerEquipment(inventory: InventoryStore, animation: Pick<WilsonAnimationController, 'equipmentPresentation' | 'stategraph'>,
  base: Record<string, unknown> = {}): EquipmentOwner {
  const owner = playerEquipmentOwner(animation, { hasTag: () => false, GetPosition: () => ({ x: 0, y: 0, z: 0 }), ...base });
  inventory.bindActor(owner as unknown as Parameters<InventoryStore['bindActor']>[0]);
  return owner;
}

/**
 * Equips a fresh, configured inst of a prefab on the player without an inventory, the way inventory:Equip calls
 * equippable:Equip(owner) and pushes "equip"; the slot's previous inst is unequipped first.
 */
export function createPlayerEquipper(animation: Pick<WilsonAnimationController, 'equipmentPresentation' | 'stategraph'>) {
  const registry = new ItemEntityRegistry();
  const owner = playerEquipmentOwner(animation);
  const worn = new Map<Kind, ItemEntity>();
  const unequip = (kind: Kind) => {
    const item = worn.get(kind);
    if (!item) return;
    worn.delete(kind);
    item.components.equippable?.Unequip(owner);
    owner.PushEvent('unequip', { item, eslot: ESLOTS[kind] });
  };
  return {
    owner, registry,
    equip(prefab: string | null, skinId?: string, kind?: Kind): ItemEntity | undefined {
      const spec = prefab === null ? undefined : INVENTORY_ITEM_SPECS[prefab];
      const slot = kind ?? spec?.equippable ?? 'hand';
      unequip(slot);
      if (prefab === null) return undefined;
      if (!spec) throw new Error(`Unknown item: ${prefab}`);
      const item = registry.create({ itemId: prefab, count: 1, ...(skinId === undefined ? {} : { skinId }) });
      item.configure(spec);
      worn.set(slot, item);
      item.components.equippable!.Equip(owner);
      owner.PushEvent('equip', { item, eslot: ESLOTS[slot] });
      return item;
    },
    dispose() { for (const kind of [...worn.keys()]) unequip(kind); registry.dispose(); },
  };
}
