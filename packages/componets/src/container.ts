import { batch, createEffect, createSignal, readonlySignal, watchSignal, WorldContentKey, type GetWatchWorldContent, type ReadonlySignal } from '../../signals/src';
import { modelHasTag } from '../../prefab/src/prefabInstance';
import type { Object3D, Vector3 } from 'three';

/** Logical scene-container hosts/openers. Bare transform holders remain supported by detached inventories. */
interface ContainerEntity {
  getPosition?(): Vector3;
  readonly position?: Vector3;
  isValid?(): boolean;
  readonly isRemoved?: boolean;
  readonly removal?: ReadonlySignal<boolean>;
  PushEvent?(name: string, data?: unknown): void;
}

/** container.lua's data.items in the save document's shape: occupied slots under zero-based keys. */
export interface ContainerSaveData<TRecord> {
  slotCount: number;
  slots: { slotKey: string; item: TRecord }[];
}

export interface ContainerItem<TRecord> {
  readonly isRemoved: boolean;
  snapshot(): TRecord;
  flush(): void;
  destroy(): void;
}

export interface ContainerSlot<TItem> {
  /** The inst in the slot; UI and the holder's components subscribe to it. */
  readonly entity: ReadonlySignal<TItem | null>;
  getEntity(): TItem | null;
  setEntity(item: TItem | null): void;
}

/** container.lua state and lifecycle; inventory transactions own slot mutations. */
export class Container<TRecord, TItem extends ContainerItem<TRecord>, TSlot extends ContainerSlot<TItem>> {
  readonly inst: object;
  /** Tags belong to the holder, not to its stored items. */
  hasTag(tag: string): boolean {
    const inst = this.inst as { hasTag?(tag: string): boolean; tags?: Set<string>; userData?: object };
    return inst.hasTag?.(tag) ?? inst.tags?.has(tag) ?? (inst.userData ? modelHasTag(inst as Object3D, tag) : false);
  }
  canbeopened = true;
  openlimit?: number;
  onopenfn?(inst: object, doer?: object): void;
  onclosefn?(inst: object, doer?: object): void;
  /** InventoryStore supplies authoritative removal; detached containers supply world dropping. */
  dropItem?: (item: TItem, slot: number, position: { x: number; y: number; z: number }) => void;
  private readonly slotListState = createSignal<readonly TSlot[]>(Object.freeze([]));
  /** The slots, replaced when SetNumSlots adds some; each slot's `entity` signal holds its inst. */
  readonly slotList = readonlySignal(this.slotListState);
  private readonly openlist = new Set<object>();
  private readonly openCountState = createSignal(0);
  /** container.lua's opencount, for components that follow opening and closing. */
  readonly openCount = readonlySignal(this.openCountState);
  private readonly createSlot: () => TSlot;
  private readonly loadItem: (record: TRecord) => TItem;
  private autoCloseWorld?: GetWatchWorldContent;
  private autoCloseDistance = 3;
  private stopPositions?: () => void;
  private readonly openerCleanups = new Map<object, () => void>();

  /** container.lua's scene-container autoclose branch, driven by world position snapshots. */
  SetAutoClose(getWatchWorldContent: GetWatchWorldContent | undefined, distance = 3): void {
    this.stopPositions?.();
    this.stopPositions = undefined;
    this.autoCloseWorld = getWatchWorldContent;
    this.autoCloseDistance = distance;
    if (this.IsOpen()) this.watchOpeners();
  }

  private watchOpeners(): void {
    if (!this.autoCloseWorld || this.stopPositions) return;
    const positions = this.autoCloseWorld(WorldContentKey.PlayerPositions, stop => { this.stopPositions = stop; });
    createEffect(() => {
      positions.get();
      this.CheckOpeners();
    });
  }

  CheckOpeners(): void {
    const holder = this.inst as ContainerEntity;
    const position = holder.getPosition?.() ?? holder.position;
    if (!position) return;
    for (const opener of this.openlist) {
      const entity = opener as ContainerEntity;
      const origin = entity.getPosition?.() ?? entity.position;
      if (holder.isRemoved || entity.isRemoved || entity.isValid?.() === false || !origin
        || origin.distanceToSquared(position) > this.autoCloseDistance ** 2) this.Close(opener);
    }
  }

  constructor(inst: object, createSlot: () => TSlot, loadItem: (record: TRecord) => TItem) {
    this.inst = inst;
    this.createSlot = createSlot;
    this.loadItem = loadItem;
  }

  /** Existing inventory slots back the component; no second copy of item state. */
  get slots(): readonly TSlot[] { return this.slotListState.peek(); }
  get numslots(): number { return this.slots.length; }
  get opencount(): number { return this.openlist.size; }

  /** Reads every slot's inst inside the caller's effect or memo, as container.lua's itemget/itemlose listeners. */
  TrackContents(): void { for (const slot of this.slotList.get()) slot.entity.get(); }

  SetNumSlots(numslots: number): void {
    if (!Number.isSafeInteger(numslots) || numslots < this.numslots) {
      throw new RangeError('Container slot count must be an integer and cannot shrink');
    }
    const added = Array.from({ length: numslots - this.numslots }, () => this.createSlot());
    if (added.length) this.slotListState.set(Object.freeze([...this.slots, ...added]));
  }

  /** container.lua removes items through their inventory owner before destroying them. */
  DestroyContents(): void {
    for (const slot of this.slots) {
      const item = slot.getEntity();
      if (!item) continue;
      const removable = item as TItem & { remove?: () => boolean };
      if (removable.remove) {
        if (removable.remove() && slot.getEntity() === item) slot.setEntity(null);
      }
      else { slot.setEntity(null); item.destroy(); }
    }
  }

  GetNumSlots(): number { return this.numslots; }

  GetItemInSlot(slot: number): TItem | null {
    return Number.isInteger(slot) ? this.slots[slot - 1]?.getEntity() ?? null : null;
  }

  GetItemSlot(item: TItem): number | undefined {
    const index = this.slots.findIndex(slot => slot.getEntity() === item);
    return index < 0 ? undefined : index + 1;
  }

  GetAllItems(): TItem[] {
    return this.slots.flatMap(slot => {
      const item = slot.getEntity();
      return item ? [item] : [];
    });
  }

  ForEachItem(fn: (item: TItem) => void): void { this.GetAllItems().forEach(fn); }
  NumItems(): number { return this.GetAllItems().length; }
  IsEmpty(): boolean { return this.NumItems() === 0; }
  IsFull(): boolean { return this.NumItems() >= this.numslots; }

  /** As in Lua, callers check canbeopened/CanOpen before requesting Open. */
  Open(doer?: object): void {
    if (!doer || this.openlist.has(doer)) return;
    const wasOpen = this.IsOpen();
    this.openlist.add(doer);
    this.openCountState.set(this.openlist.size);
    const removal = (doer as ContainerEntity).removal;
    if (removal) {
      const removed = watchSignal(removal, stop => this.openerCleanups.set(doer, stop));
      createEffect(() => { if (removed.get()) this.Close(doer); });
    }
    (this.inst as ContainerEntity).PushEvent?.('onopen', { doer });
    if (!wasOpen) this.onopenfn?.(this.inst, doer);
    if (this.IsOpen()) this.watchOpeners();
  }

  Close(doer?: object): void {
    const wasOpen = this.IsOpen();
    for (const opener of doer ? [doer] : this.openlist) {
      this.openlist.delete(opener);
      this.openerCleanups.get(opener)?.();
      this.openerCleanups.delete(opener);
    }
    this.openCountState.set(this.openlist.size);
    if (!this.IsOpen()) { this.stopPositions?.(); this.stopPositions = undefined; }
    if (wasOpen && !this.IsOpen()) this.onclosefn?.(this.inst, doer);
    if (wasOpen) (this.inst as ContainerEntity).PushEvent?.('onclose', { doer });
  }

  IsOpen(): boolean { return this.opencount > 0; }
  DropEverything(position: { x: number; y: number; z: number }): void {
    this.slots.forEach((slot, index) => {
      const item = slot.getEntity();
      if (item) this.dropItem?.(item, index + 1, position);
    });
  }
  IsOpenedBy(doer: object): boolean { return this.openlist.has(doer); }
  IsOpenedByOthers(doer: object): boolean { return this.opencount > (this.IsOpenedBy(doer) ? 1 : 0); }
  CanOpen(): boolean { return this.openlimit === undefined || this.opencount < this.openlimit; }
  GetOpeners(): object[] { return [...this.openlist]; }

  /** The occupied slots' records as they stand, for a holder snapshotted outside a save. */
  GetSaveData(): ContainerSaveData<TRecord> {
    const slots: ContainerSaveData<TRecord>['slots'] = [];
    this.slots.forEach((slot, index) => {
      const item = slot.getEntity();
      if (item && !item.isRemoved) slots.push({ slotKey: String(index), item: item.snapshot() });
    });
    return { slotCount: this.numslots, slots };
  }

  /** Items settle their components before a save reads them. */
  OnSave(): ContainerSaveData<TRecord> {
    this.flush();
    return this.GetSaveData();
  }

  /** SpawnSaveRecord is injected; loading never stores the serialized records as live items. */
  OnLoad(data: { slots?: readonly { slotKey: string; item: TRecord }[] }): void {
    const entries = data.slots ?? [];
    for (const { slotKey } of entries) {
      const slot = Number(slotKey) + 1;
      if (!Number.isSafeInteger(slot) || slot < 1 || slot > this.numslots || String(slot - 1) !== slotKey
        || this.GetItemInSlot(slot)) throw new RangeError(`Invalid or occupied container slot: ${slotKey}`);
    }
    const pending: { slot: TSlot; item: TItem }[] = [];
    const seen = new Set(this.GetAllItems());
    try {
      for (const { slotKey, item: record } of entries) {
        const item = this.loadItem(record);
        if (item.isRemoved || seen.has(item)) throw new Error('Invalid or duplicate loaded container item');
        seen.add(item);
        pending.push({ slot: this.slots[Number(slotKey)], item });
      }
    } catch (error) {
      for (const { item } of pending) item.destroy();
      throw error;
    }
    batch(() => { for (const { slot, item } of pending) slot.setEntity(item); });
  }

  flush(): void { this.ForEachItem(item => item.flush()); }

  dispose(): void {
    this.Close();
    for (const slot of this.slots) {
      slot.getEntity()?.destroy();
      slot.setEntity(null);
    }
  }
}

export default Container;
