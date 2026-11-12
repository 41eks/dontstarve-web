import { InventorySlot } from './slots';
import type { ItemEntity } from './entity';
import { batch } from '../../signals/src';
import type { InventoryItemSpec, InventoryStack } from './types';
import type { Vector3 } from 'three';

/** The creature whose inventory this is: its items' owner. */
export interface CreatureInventoryInst { readonly id: string; hasTag(tag: string): boolean; getPosition(): Vector3; PushEvent(name: string, data?: unknown): void }

/** inventory.lua's creature inventory, backed by authoritative inventory slots. */
export class CreatureInventory {
  private readonly slots: InventorySlot[];
  private readonly inst: CreatureInventoryInst;
  private readonly drop: (item: ItemEntity, position: Vector3) => void;
  /** SpawnPrefab for onperishreplacement; without it a perished item stays in its slot. */
  private readonly spawn?: (state: InventoryStack) => ItemEntity;
  constructor(inst: CreatureInventoryInst, maxslots: number, drop: (item: ItemEntity, position: Vector3) => void, itemSpecs: Readonly<Record<string, Pick<InventoryItemSpec, 'maxStack'>>> = {}, spawn?: (state: InventoryStack) => ItemEntity) {
    this.inst = inst; this.drop = drop; this.spawn = spawn;
    this.slots = Array.from({ length: maxslots }, () => new InventorySlot(null, itemSpecs));
  }
  /** inventory.lua ApplyDamage: a creature inventory has no equip slots, so nothing absorbs. */
  ApplyDamage(damage: number): number { return damage; }
  /** inventory.lua GetEquippedItem: `self.equipslots[eslot]`, which a creature inventory leaves empty. */
  GetEquippedItem(_eslot: string): null { return null; }
  IsFull(): boolean { return this.slots.every(slot => slot.getEntity() !== null); }
  GetItems(): ItemEntity[] { return this.slots.flatMap(slot => slot.getEntity() ?? []); }
  /** inventory.lua GetItemInSlot: slots count from 1. */
  GetItemInSlot(slot: number): ItemEntity | undefined { return this.slots[slot - 1]?.getEntity() ?? undefined; }
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
    this.PutInSlot(index, item);
    return true;
  }
  private PutInSlot(index: number, item: ItemEntity): void {
    const slot = this.slots[index];
    // The creature itself is the item's owner; the slot is its inventory's.
    item.components.inventoryitem.SetOwner(this.inst, {
      address: { containerId: `creature:${this.inst.id}`, slotKey: String(index) },
      changed: () => undefined,
      remove: () => { if (slot.getEntity() !== item) return false; slot.setEntity(null); item.components.inventoryitem.owner = null; item.destroy(); return true; },
      replace: prefab => {
        if (!this.spawn || slot.getEntity() !== item) return false;
        const replacement = this.spawn({ itemId: prefab, count: item.components.stackable.count });
        this.RemoveItem(item);
        item.destroy();
        this.PutInSlot(index, replacement);
        return true;
      },
    });
    slot.setEntity(item);
    item.PushEvent('onputininventory', this.inst);
  }
  /** inventory.lua RemoveItem with wholestack: the item leaves its slot and stays valid. */
  RemoveItem(item: ItemEntity): void {
    const slot = this.slots.find(slot => slot.getEntity() === item); if (!slot) return;
    slot.setEntity(null); item.components.inventoryitem.owner = null;
  }
  /** inventory.lua DropItem; an item already removed from its slot, as a failed shelf take leaves it, still drops. */
  DropItem(item: ItemEntity): void {
    item.flush(); this.RemoveItem(item); this.drop(item, this.inst.getPosition().clone());
  }
  TransferInventory(receiver: { components: { inventory?: CreatureInventory } }): void {
    const target = receiver.components.inventory;
    if (!target) return;
    for (const item of this.GetItems()) {
      item.flush(); this.RemoveItem(item); if (!target.GiveItem(item)) this.drop(item, this.inst.getPosition().clone());
    }
  }
  DropEverything(): void {
    const position = this.inst.getPosition().clone();
    for (const item of this.GetItems()) {
      item.flush(); this.RemoveItem(item); this.drop(item, position);
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
