import type { InventoryStack, SlotAddress } from './types';
import { StorageSlot } from './slots';
import { Container } from '../../componets/src/container';
import { BACKPACK_SLOT_COUNT } from './addresses';

let sequence = 0;
export function newItemEntityId(): string {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return `e_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  return `e_${Date.now().toString(36)}_${++sequence}_${Math.random().toString(36).slice(2)}`;
}

export interface ItemRuntimeComponent {
  flush?(): void;
  dispose(): void;
}
export interface ItemOwner {
  readonly address: SlotAddress;
  changed(): void;
  remove(): boolean;
}

/** finiteuses.lua: Use changes the component and invokes inst removal on depletion. */
export class FiniteUsesComponent {
  remaining: number | undefined;
  private maximum: number | undefined;
  private readonly entity: ItemEntity;

  constructor(entity: ItemEntity, remaining?: number) {
    this.entity = entity;
    this.remaining = remaining;
  }
  setMaxUses(maximum: number): void {
    if (!Number.isSafeInteger(maximum) || maximum <= 0
      || (this.remaining !== undefined && this.remaining > maximum)) throw new RangeError('Invalid finiteuses maximum');
    this.maximum = maximum;
  }
  use(amount = 1): boolean {
    if (this.entity.isRemoved || !Number.isSafeInteger(amount) || amount <= 0 || this.maximum === undefined) return false;
    const remaining = this.remaining ?? this.maximum;
    const next = Math.max(0, remaining - amount);
    if (next === 0) {
      // Inventory removal must commit through the bound owner before publishing zero uses.
      if (!this.entity.remove()) return false;
      this.remaining = 0;
    } else {
      this.remaining = next;
      this.entity.components.inventoryitem.owner?.changed();
    }
    return true;
  }
}

/** Like DST's inst: identity and components survive changes of inventory owner and scene art. */
export class ItemEntity {
  readonly id: string;
  readonly prefab: string;
  readonly components: {
    stackable: { count: number };
    fueled: { remaining: number | undefined };
    finiteuses: FiniteUsesComponent;
    inventoryitem: { owner: ItemOwner | null };
    container?: Container<InventoryStack, ItemEntity, StorageSlot>;
  };
  readonly transform: { position: [number, number, number]; rotationY: number } = { position: [0, 0, 0], rotationY: 0 };
  skinId?: string;
  phonographRecord?: string;
  private readonly runtime = new Map<string, ItemRuntimeComponent>();
  private removed = false;

  constructor(state: InventoryStack) {
    this.id = state.entityId ?? newItemEntityId();
    this.prefab = state.itemId;
    this.components = {
      stackable: { count: state.count },
      fueled: { remaining: state.remainingFuel },
      finiteuses: new FiniteUsesComponent(this, state.remainingUses),
      inventoryitem: { owner: null },
    };
    if (this.prefab === 'backpack') {
      const container = new Container(this, () => new StorageSlot(), (item: InventoryStack) => new ItemEntity(item));
      container.SetNumSlots(BACKPACK_SLOT_COUNT);
      container.OnLoad({ items: Object.fromEntries((state.container?.slots ?? [])
        .map(({ slotKey, item }) => [String(Number(slotKey) + 1), item])) });
      this.components.container = container;
    }
    this.apply(state);
  }

  get isRemoved(): boolean { return this.removed; }
  snapshot(includeIdentity = true): InventoryStack {
    return {
      ...(includeIdentity ? { entityId: this.id } : {}), itemId: this.prefab, count: this.components.stackable.count,
      ...(this.skinId === undefined ? {} : { skinId: this.skinId }),
      ...(this.components.fueled.remaining === undefined ? {} : { remainingFuel: this.components.fueled.remaining }),
      ...(this.components.finiteuses.remaining === undefined ? {} : { remainingUses: this.components.finiteuses.remaining }),
      ...(this.phonographRecord === undefined ? {} : { phonographRecord: this.phonographRecord }),
      ...(this.components.container === undefined ? {} : { container: {
        slotCount: this.components.container.GetNumSlots(),
        slots: Object.entries(this.components.container.OnSave().items)
          .map(([key, item]) => ({ slotKey: String(Number(key) - 1), item })),
      } }),
    };
  }

  /** Store commits call this only after the complete transaction has been validated. */
  apply(state: InventoryStack): void {
    if (state.itemId !== this.prefab || this.removed) throw new Error('Cannot change a removed entity or its prefab');
    this.skinId = state.skinId;
    this.phonographRecord = state.phonographRecord;
    this.components.stackable.count = state.count;
    this.components.fueled.remaining = state.remainingFuel;
    this.components.finiteuses.remaining = state.remainingUses;
  }

  setRemainingFuel(seconds: number): boolean {
    if (this.removed || !Number.isFinite(seconds) || seconds <= 0) return false;
    this.components.fueled.remaining = seconds;
    this.components.inventoryitem.owner?.changed();
    return true;
  }

  component<T extends ItemRuntimeComponent>(name: string, create: () => T): T {
    if (this.removed) throw new Error('Cannot attach a component to a removed entity');
    let component = this.runtime.get(name);
    if (!component) { component = create(); this.runtime.set(name, component); }
    return component as T;
  }

  flush(): void {
    this.components.container?.flush();
    for (const component of this.runtime.values()) component.flush?.();
  }
  remove(): boolean {
    if (this.removed) return false;
    const owner = this.components.inventoryitem.owner;
    if (owner) return owner.remove();
    this.destroy();
    return true;
  }
  destroy(): void {
    if (this.removed) return;
    this.flush();
    if (this.removed) return;
    this.removed = true;
    this.components.inventoryitem.owner = null;
    for (const component of this.runtime.values()) component.dispose();
    this.runtime.clear();
    this.components.container?.dispose();
  }
}

/** Shared by the inventory store and world item manager; contains each live item exactly once. */
export class ItemEntityRegistry {
  private readonly entities = new Map<string, ItemEntity>();
  create(state: InventoryStack): ItemEntity {
    if (state.entityId && this.get(state.entityId)) throw new Error(`Duplicate item entity: ${state.entityId}`);
    const entity = new ItemEntity(state);
    this.entities.set(entity.id, entity);
    return entity;
  }
  get(id: string): ItemEntity | undefined {
    const entity = this.entities.get(id);
    if (entity?.isRemoved) { this.entities.delete(id); return undefined; }
    return entity;
  }
  values(): readonly ItemEntity[] {
    return [...this.entities.values()].filter(entity => !entity.isRemoved);
  }
  adopt(entity: ItemEntity): void {
    const existing = this.get(entity.id);
    if (entity.isRemoved || (existing && existing !== entity)) throw new Error(`Invalid item entity: ${entity.id}`);
    this.entities.set(entity.id, entity);
    for (const slot of entity.components.container?.slots ?? []) {
      const child = slot.getEntity();
      if (child) this.adopt(child);
    }
  }
  destroy(entity: ItemEntity): void {
    entity.destroy();
    if (this.entities.get(entity.id) === entity) this.entities.delete(entity.id);
  }
  dispose(): void {
    for (const entity of this.entities.values()) {
      entity.components.inventoryitem.owner = null;
      entity.destroy();
    }
    this.entities.clear();
  }
}
