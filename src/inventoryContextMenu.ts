import {
  cursorSlotAddress,
  equipmentSlotAddress,
  inventorySlotAddress,
  type InventoryStore,
} from '@dontstarve-web/inventory';
import { AMULET_ID } from '@dontstarve-web/prefab/amulet';
import { ARMORSNURTLESHELL_ID } from '@dontstarve-web/prefab/armorsnurtleshell';
import { playDrop, type PlayerInstance } from '@dontstarve-web/prefab/player_common';
import { createRenderEffect, untrack, type EventEmitter } from '@dontstarve-web/signals';
import type { PlayerActionEvents } from '@dontstarve-web/stategraphs';
import type { mountGameUi, SlotAddress } from '@dontstarve-web/ui';

export function bindInventoryContextMenu(
  contextMenu: ReturnType<typeof mountGameUi>['inventoryBar']['contextMenu'],
  inventory: InventoryStore,
  playerEntity: PlayerInstance,
  actionEvents: EventEmitter<PlayerActionEvents>,
): () => void {
  const handSlotAddress = equipmentSlotAddress('hand');
  const bodySlotAddress = equipmentSlotAddress('body');
  const isHandSlot = (slot: SlotAddress) =>
    slot.containerId === handSlotAddress.containerId && slot.slotKey === handSlotAddress.slotKey;
  // Each request is a new object, so every context-menu click is handled once, synchronously.
  let handled = contextMenu.value;
  return createRenderEffect(() => {
    const request = contextMenu.get();
    if (request === handled) {
      return;
    }
    handled = request;
    if (request) {
      untrack(() => handle(request));
    }
  });

  function handle(request: NonNullable<typeof handled>): void {
    const { slot, action, item } = request;
    actionEvents.emit('action:interrupt', { reason: 'slot-context-menu' });
    if (isHandSlot(slot)) {
      inventory.getEntity(slot)?.flush();
    }
    const stack = inventory.get(slot);
    if (
      !stack ||
      !item ||
      stack.itemId !== item.id ||
      stack.skinId !== item.skinId ||
      (item.entityId !== undefined && inventory.getEntity(slot)?.id !== item.entityId)
    ) {
      return;
    }
    if (action === 'drop') {
      actionEvents.emit('action:interrupt', { reason: 'drop' });
      const entity = inventory.getEntity(slot);
      if (!entity) {
        return;
      }
      // DROP's perform frame: inventory:DropItem of the whole stack, if this inst is still the slot's.
      playDrop(playerEntity, () => {
        if (isHandSlot(slot)) {
          inventory.getEntity(slot)?.flush();
        }
        if (inventory.getEntity(slot) !== entity) {
          return false;
        }
        inventory.DropItem(entity, playerEntity.position.clone());
        return true;
      });
      return;
    }
    // inventory.lua UseItemFromInvTile: with an active item, use it on the original inventory target.
    const activeItem = inventory.GetActiveItem();
    if (activeItem) {
      const target = inventory.getEntity(slot),
        controller = playerEntity.components.playercontroller;
      const use = target && controller?.GetItemUseAction(activeItem, target);
      if (use) {
        controller?.DoAction(use);
      }
      return;
    }
    if (inventory.getEntity(slot)?.components.deployable?.mode === 'PLANT') {
      if (!inventory.get(cursorSlotAddress())) {
        inventory.transfer(slot, cursorSlotAddress(), stack.count);
      }
      return;
    }
    const entity = inventory.getEntity(slot);
    // inventory.lua UseItemFromInvTile: GetInventoryActions(item)[1], pushed to the locomotor.
    const controller = playerEntity.components.playercontroller;
    const use = entity && controller?.GetInventoryItemAction(entity);
    if (use) {
      controller!.DoAction(use);
      return;
    }
    if (stack.itemId === 'backpack' || stack.itemId === ARMORSNURTLESHELL_ID || stack.itemId === AMULET_ID) {
      const equipped = slot.containerId === bodySlotAddress.containerId && slot.slotKey === bodySlotAddress.slotKey;
      const target = equipped
        ? Array.from({ length: 15 }, (_, index) => inventorySlotAddress(index)).find(address => !inventory.get(address))
        : inventory.get(bodySlotAddress) === null
          ? bodySlotAddress
          : undefined;
      // componentactions.lua INVENTORY.useableitem: USEITEM outranks UNEQUIP for a worn item.
      if (equipped && entity?.components.useableitem?.CanInteract()) {
        entity.components.useableitem.StartUsingItem();
        return;
      }
      if (target) {
        inventory.transfer(slot, target, 1);
      }
    }
  }
}
