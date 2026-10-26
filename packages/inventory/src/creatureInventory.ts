import { InventorySlot } from './slots';
import type { ItemEntity, ItemOwner } from './entity';
import { batch } from '../../signals/src';
import type { InventoryItemSpec, InventoryStack } from './types';
import type { Vector3 } from 'three';

/** inventory.lua's creature inventory, backed by authoritative inventory slots. */
export class CreatureInventory {
  private readonly slots: InventorySlot[];
  private readonly inst: { id: string; getPosition(): Vector3 };
  private readonly drop: (item: ItemEntity, position: Vector3) => void;
  constructor(inst: { id: string; getPosition(): Vector3 }, maxslots: number, drop: (item: ItemEntity, position: Vector3) => void, itemSpecs: Readonly<Record<string, Pick<InventoryItemSpec, 'maxStack'>>> = {}) {
    this.inst = inst; this.drop = drop;
    this.slots = Array.from({ length: maxslots }, () => new InventorySlot(null, itemSpecs));
  }
  /** inventory.lua ApplyDamage: a creature inventory has no equip slots, so nothing absorbs. */
  ApplyDamage(damage: number): number { return damage; }
  IsFull(): boolean { return this.slots.every(slot => slot.getEntity() !== null); }
  GetItems(): ItemEntity[] { return this.slots.flatMap(slot => slot.getEntity() ?? []); }
  GiveItem(item: ItemEntity): boolean {
    if (item.isRemoved || item.components.inventoryitem.owner) return false;
    item.flush();
    const stackLimit = this.slots[0]?.maxStack(item.prefab) ?? 1;
    if (stackLimit > 1) for (const slot of this.slots) {
      const current = slot.getEntity();
      if (!current || current.prefab !== item.prefab || current.skinId !== item.skinId || current.components.stackable.count >= stackLimit) continue;
      current.flush();
      const previous = current.components.stackable.count, received = Math.min(stackLimit - previous, item.components.stackable.count);
      const a = current.snapshot().freshnessPercent, b = item.snapshot().freshnessPercent;
      const consumed = received === item.components.stackable.count;
      batch(() => {
        if (a !== undefined && b !== undefined) current.setFreshnessPercent((a * previous + b * received) / (previous + received));
        if (item.GetIsWet()) current.setWet(true);
        current.components.stackable.count += received;
        if (consumed) item.destroy(); else item.components.stackable.count -= received;
      });
      if (consumed) return true;
    }
    const index = this.slots.findIndex(slot => slot.getEntity() === null);
    if (index < 0) { this.drop(item, this.inst.getPosition().clone()); return true; }
    item.flush();
    const slot = this.slots[index];
    const owner: ItemOwner = {
      address: { containerId: `creature:${this.inst.id}`, slotKey: String(index) },
      getPosition: () => this.inst.getPosition(), changed: () => undefined,
      remove: () => { if (slot.getEntity() !== item) return false; slot.setEntity(null); item.components.inventoryitem.owner = null; item.destroy(); return true; },
      replace: () => false, PushEvent: () => undefined,
    };
    slot.setEntity(item); item.components.inventoryitem.owner = owner;
    item.PushEvent('onputininventory', owner);
    return true;
  }
  private TakeItem(item: ItemEntity): void {
    const slot = this.slots.find(slot => slot.getEntity() === item); if (!slot) return;
    slot.setEntity(null); item.components.inventoryitem.owner = null;
  }
  TransferInventory(receiver: { components: { inventory?: CreatureInventory } }): void {
    const target = receiver.components.inventory;
    if (!target) return;
    for (const item of this.GetItems()) {
      item.flush(); this.TakeItem(item); if (!target.GiveItem(item)) this.drop(item, this.inst.getPosition().clone());
    }
  }
  DropEverything(): void {
    const position = this.inst.getPosition().clone();
    for (const item of this.GetItems()) {
      item.flush(); this.TakeItem(item); this.drop(item, position);
    }
  }
  OnSave(): InventoryStack[] { return this.GetItems().map(item => { item.flush(); return item.snapshot(); }); }
  OnLoad(items: readonly InventoryStack[], spawn: (state: InventoryStack) => ItemEntity): void {
    for (const state of items) this.GiveItem(spawn(state));
  }
  dispose(): void {
    for (const slot of this.slots) { const item = slot.getEntity(); slot.setEntity(null); if (item) { item.components.inventoryitem.owner = null; item.destroy(); } }
  }
}
