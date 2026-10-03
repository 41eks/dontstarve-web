import {
  inventorySlotAddress, equipmentSlotAddress,
  type EquipmentKind, type InventoryState,
} from '@three-roaming/inventory';
import type { SaveDocument } from './types';
import { STORAGE_BUILDING_IDS, buildingContainerId } from '@three-roaming/prefab/containers';

export function chestContainerId(entityId: string): string {
  return `world:treasurechest:${entityId}`;
}

export function cookPotContainerId(entityId: string): string {
  return `world:cookpot:${entityId}`;
}

export function iceBoxContainerId(entityId: string): string {
  return `world:icebox:${entityId}`;
}

export function inventoryStateFromSave(save: SaveDocument): InventoryState {
  const slots: InventoryState['slots'][number][] = [];
  for (const [id, container] of Object.entries(save.players.local.inventory.containers)) {
    for (const { slotKey, item } of container.slots) {
      const address = id === 'player:inventory'
        ? inventorySlotAddress(Number(slotKey))
        : equipmentSlotAddress(slotKey as EquipmentKind);
      slots.push({ address, item: { ...item } });
    }
  }
  for (const prefab of STORAGE_BUILDING_IDS) {
    for (const record of save.world.entities[prefab] ?? []) {
      for (const { slotKey, item } of record.components.container?.slots ?? []) {
        const containerId = buildingContainerId(prefab, record.id);
        slots.push({ address: { containerId, slotKey }, item: { ...item } });
      }
    }
  }
  return { slots, bufferedBuilds: save.players.local.inventory.bufferedBuilds.map((build) => ({ ...build })) };
}
