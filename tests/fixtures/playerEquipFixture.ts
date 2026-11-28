import { type InventoryStore, type ItemEntity } from '../../packages/inventory/src';
import { INVENTORY_ITEM_SPECS } from '../../src/inventoryItems';
import { createEquipmentViews } from '../../packages/prefab/src/equipmentVisual';
import { testPlayer } from './testPlayer';
import type { PlayerInstance } from '../../packages/prefab/src/player_common';
import { testItemRegistry } from './testInventory';

type Kind = 'hand' | 'head' | 'body';
const ESLOTS: Readonly<Record<Kind, import('../../packages/componets/src/entityEvents').EquipSlot>> = {
  hand: 'HANDS',
  head: 'HEAD',
  body: 'BODY',
};

/**
 * The player inst as equipment owner, as main.ts binds it: its own events reach SGwilson, and its OpenEquipmentView
 * gives each equipped inst a slot of its sprite.
 */
export function playerEquipmentOwner(player: PlayerInstance): PlayerInstance {
  player.OpenEquipmentView ??= createEquipmentViews(player, player.equipmentPresentation);
  return player;
}

/** The player inst owns the inventory, so its committed equips draw on the player. */
export function bindPlayerEquipment(inventory: InventoryStore, player: PlayerInstance): PlayerInstance {
  testPlayer({ model: player.transform.model, inventory });
  return playerEquipmentOwner(player);
}

/**
 * Equips a fresh, configured inst of a prefab on the player without an inventory, the way inventory:Equip calls
 * equippable:Equip(owner) and pushes "equip"; the slot's previous inst is unequipped first.
 */
export function createPlayerEquipper(animation: PlayerInstance) {
  const registry = testItemRegistry();
  const owner = playerEquipmentOwner(animation);
  const worn = new Map<Kind, ItemEntity>();
  const unequip = (kind: Kind) => {
    const item = worn.get(kind);
    if (!item) {
      return;
    }
    worn.delete(kind);
    item.components.equippable?.Unequip(owner);
    owner.PushEvent('unequip', { item, eslot: ESLOTS[kind] });
  };
  return {
    owner,
    registry,
    equip(prefab: string | null, skinId?: string, kind?: Kind): ItemEntity | undefined {
      const spec = prefab === null ? undefined : INVENTORY_ITEM_SPECS[prefab];
      const slot = kind ?? spec?.equippable ?? 'hand';
      unequip(slot);
      if (prefab === null) {
        return undefined;
      }
      if (!spec) {
        throw new Error(`Unknown item: ${prefab}`);
      }
      const item = registry.create({ itemId: prefab, count: 1, ...(skinId === undefined ? {} : { skinId }) });
      item.configure(spec);
      worn.set(slot, item);
      item.components.equippable!.Equip(owner);
      owner.PushEvent('equip', { item, eslot: ESLOTS[slot] });
      return item;
    },
    dispose() {
      for (const kind of [...worn.keys()]) {
        unequip(kind);
      }
      registry.dispose();
    },
  };
}
