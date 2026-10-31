import { createEffect, createSignal, readonlySignal, watchSignal, WorldContentKey, type GetWatchWorldContent, type ReadonlySignal, type Signal } from '../../signals/src';
import { modelHasTag } from '../../prefab/src/prefabInstance';
import type { Object3D, Vector3 } from 'three';

/** Logical scene-container hosts/openers. Bare transform holders remain supported by detached inventories. */
interface ContainerEntity {
  getPosition?(): Vector3;
  readonly position?: Vector3;
  isValid?(): boolean;
  readonly isRemoved?: boolean;
  readonly removal?: ReadonlySignal<boolean>;
}

/** Detached presentation data; empty slots remain explicit so UI can clear them. */
export interface ContainerDTO<TRecord> {
  readonly slotCount: number;
  readonly slots: readonly (Readonly<TRecord> | null)[];
}

export interface ContainerSaveData<TRecord> {
  /** Lua container.lua saves occupied slots using one-based keys. */
  items: Record<string, TRecord>;
}

export interface ContainerItem<TRecord> {
  readonly isRemoved: boolean;
  snapshot(): TRecord;
  flush(): void;
  destroy(): void;
}

export interface ContainerSlot<TItem> {
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
  onopenfn?: (inst: object, doer?: object) => void;
  onclosefn?: (inst: object, doer?: object) => void;
  /** InventoryStore supplies authoritative removal; detached containers supply world dropping. */
  dropItem?: (item: TItem, slot: number, position: { x: number; y: number; z: number }) => void;
  private readonly slotList: TSlot[] = [];
  private readonly openlist = new Set<object>();
  private readonly createSlot: () => TSlot;
  private readonly loadItem: (record: TRecord) => TItem;
  private dtoState?: Signal<ContainerDTO<TRecord>>;
  private dtoView?: ReadonlySignal<ContainerDTO<TRecord>>;
  private readonly lifecycleListeners = new Set<() => void>();
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

  subscribeLifecycle(listener: () => void): () => void {
    this.lifecycleListeners.add(listener);
    return () => { this.lifecycleListeners.delete(listener); };
  }

  private publishLifecycle(): void { for (const listener of this.lifecycleListeners) listener(); }

  constructor(inst: object, createSlot: () => TSlot, loadItem: (record: TRecord) => TItem) {
    this.inst = inst;
    this.createSlot = createSlot;
    this.loadItem = loadItem;
  }

  /** Existing inventory slots back the component; no second copy of item state. */
  get slots(): readonly TSlot[] { return this.slotList; }
  get numslots(): number { return this.slotList.length; }
  get opencount(): number { return this.openlist.size; }

  toDTO(): ContainerDTO<TRecord> {
    const slots = this.slotList.map(slot => {
      const item = slot.getEntity();
      return item && !item.isRemoved ? Object.freeze(structuredClone(item.snapshot())) : null;
    });
    return Object.freeze({ slotCount: this.numslots, slots: Object.freeze(slots) });
  }

  /** A stable read-only signal for UI; live entities and the save format stay authoritative. */
  toSignal(): ReadonlySignal<ContainerDTO<TRecord>> {
    if (!this.dtoState) {
      this.dtoState = createSignal(this.toDTO());
      this.dtoView = readonlySignal(this.dtoState);
    }
    return this.dtoView!;
  }

  /** Call once after committing all slots/components in an inventory transaction. */
  publishDTO(): void {
    this.dtoState?.set(this.toDTO());
    this.publishLifecycle();
  }

  SetNumSlots(numslots: number): void {
    if (!Number.isSafeInteger(numslots) || numslots < this.numslots) {
      throw new RangeError('Container slot count must be an integer and cannot shrink');
    }
    const added = Array.from({ length: numslots - this.numslots }, () => this.createSlot());
    this.slotList.push(...added);
    if (added.length) this.publishDTO();
  }

  /** Adopt already registered authoritative slots when attaching a loaded world entity. */
  BindSlots(slots: readonly TSlot[]): void {
    if (!this.IsEmpty() || slots.length !== this.numslots) throw new Error('Cannot replace populated container slots');
    this.slotList.splice(0, this.slotList.length, ...slots);
    this.publishDTO();
  }

  /** container.lua removes items through their inventory owner before destroying them. */
  DestroyContents(): void {
    for (const slot of this.slotList) {
      const item = slot.getEntity();
      if (!item) continue;
      const removable = item as TItem & { remove?: () => boolean };
      if (removable.remove) {
        if (removable.remove() && slot.getEntity() === item) slot.setEntity(null);
      }
      else { slot.setEntity(null); item.destroy(); }
    }
    this.publishDTO();
  }

  GetNumSlots(): number { return this.numslots; }

  GetItemInSlot(slot: number): TItem | null {
    return Number.isInteger(slot) ? this.slotList[slot - 1]?.getEntity() ?? null : null;
  }

  GetItemSlot(item: TItem): number | undefined {
    const index = this.slotList.findIndex(slot => slot.getEntity() === item);
    return index < 0 ? undefined : index + 1;
  }

  GetAllItems(): TItem[] {
    return this.slotList.flatMap(slot => {
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
    const removal = (doer as ContainerEntity).removal;
    if (removal) {
      const removed = watchSignal(removal, stop => this.openerCleanups.set(doer, stop));
      createEffect(() => { if (removed.get()) this.Close(doer); });
    }
    if (!wasOpen) this.onopenfn?.(this.inst, doer);
    this.publishLifecycle();
    if (this.IsOpen()) this.watchOpeners();
  }

  Close(doer?: object): void {
    const wasOpen = this.IsOpen();
    for (const opener of doer ? [doer] : this.openlist) {
      this.openlist.delete(opener);
      this.openerCleanups.get(opener)?.();
      this.openerCleanups.delete(opener);
    }
    if (!this.IsOpen()) { this.stopPositions?.(); this.stopPositions = undefined; }
    if (wasOpen && !this.IsOpen()) this.onclosefn?.(this.inst, doer);
    if (wasOpen) this.publishLifecycle();
  }

  IsOpen(): boolean { return this.opencount > 0; }
  DropEverything(position: { x: number; y: number; z: number }): void {
    this.slotList.forEach((slot, index) => {
      const item = slot.getEntity();
      if (item) this.dropItem?.(item, index + 1, position);
    });
  }
  IsOpenedBy(doer: object): boolean { return this.openlist.has(doer); }
  IsOpenedByOthers(doer: object): boolean { return this.opencount > (this.IsOpenedBy(doer) ? 1 : 0); }
  CanOpen(): boolean { return this.openlimit === undefined || this.opencount < this.openlimit; }
  GetOpeners(): object[] { return [...this.openlist]; }

  OnSave(): ContainerSaveData<TRecord> {
    const items: Record<string, TRecord> = {};
    this.slotList.forEach((slot, index) => {
      const item = slot.getEntity();
      if (item && !item.isRemoved) items[String(index + 1)] = item.snapshot();
    });
    return { items };
  }

  /** SpawnSaveRecord is injected; loading never stores the serialized records as live items. */
  OnLoad(data: { items?: Readonly<Record<string, TRecord>> }): void {
    const entries = Object.entries(data.items ?? {});
    for (const [key] of entries) {
      const slot = Number(key);
      if (!Number.isSafeInteger(slot) || slot < 1 || slot > this.numslots || String(slot) !== key
        || this.GetItemInSlot(slot)) throw new RangeError(`Invalid or occupied container slot: ${key}`);
    }
    const pending: { slot: TSlot; item: TItem }[] = [];
    const seen = new Set(this.GetAllItems());
    try {
      for (const [key, record] of entries) {
        const item = this.loadItem(record);
        if (item.isRemoved || seen.has(item)) throw new Error('Invalid or duplicate loaded container item');
        seen.add(item);
        pending.push({ slot: this.slotList[Number(key) - 1], item });
      }
    } catch (error) {
      for (const { item } of pending) item.destroy();
      throw error;
    }
    for (const { slot, item } of pending) slot.setEntity(item);
    if (pending.length) this.publishDTO();
  }

  flush(): void { this.ForEachItem(item => item.flush()); }

  dispose(): void {
    this.Close();
    for (const slot of this.slotList) {
      slot.getEntity()?.destroy();
      slot.setEntity(null);
    }
    this.publishDTO();
  }
}

export default Container;
