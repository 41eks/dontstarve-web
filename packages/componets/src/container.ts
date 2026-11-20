import { batch, createEffect, createSignal, readonlySignal, watchSignal, WorldContentKey, type GetWatchWorldContent, type ReadonlySignal } from '../../signals/src';
import type { Vector3 } from 'three';
import type { HeldEntityRecord, SlotItemsSave } from '../../prefab/src/saveRecord';

/** Logical scene-container hosts/openers. Bare transform holders remain supported by detached inventories. */
interface ContainerEntity {
  getPosition?(): Pick<Vector3, 'distanceToSquared'>;
  readonly position?: Pick<Vector3, 'distanceToSquared'>;
  isValid?(): boolean;
  readonly isRemoved?: boolean;
  readonly removal?: ReadonlySignal<boolean>;
  PushEvent?(name: string, data?: unknown): void;
}

/** The entity that has the container — a chest, an icebox, a backpack — and the owner of the items it holds. */
export interface ContainerInst {
  readonly prefab: string;
  readonly isRemoved: boolean;
  readonly components: { readonly container?: { readonly type?: string; Close(doer?: object): void } };
  hasTag(tag: string): boolean;
  getPosition(): Vector3;
  PushEvent(name: string, data?: unknown): void;
}

/** inventory.lua's opencontainers on the doer: the inst of each container it has open. */
interface ContainerDoer {
  readonly components?: { readonly inventory?: { readonly opencontainers?: Set<ContainerInst> } };
}
/** An entity that opens the container: what container.lua reads from the doer and from each opener. */
type ContainerOpener = ContainerEntity & ContainerDoer;

/** The occupied slots' runtime records under zero-based keys, as a held item's snapshot carries its contents. */
export interface ContainerSaveData<TRecord> {
  slotCount: number;
  slots: { slotKey: string; item: TRecord }[];
}

export interface ContainerItem<TRecord> {
  readonly isRemoved: boolean;
  snapshot(): TRecord;
  /** EntityScript:GetSaveRecord, as container.lua OnSave writes each item. */
  GetSaveRecord(): HeldEntityRecord;
  flush(): void;
  destroy(): void;
  /** inst:Remove() through the item's inventory owner, when the item has one. */
  remove?(): boolean;
}

export interface ContainerSlot<TItem> {
  /** The inst in the slot; UI and the holder's components subscribe to it. */
  readonly entity: ReadonlySignal<TItem | null>;
  getEntity(): TItem | null;
  setEntity(item: TItem | null): void;
}

/** container.lua state and lifecycle; inventory transactions own slot mutations. */
export class Container<TRecord, TItem extends ContainerItem<TRecord>, TSlot extends ContainerSlot<TItem>> {
  readonly inst: ContainerInst;
  /** Tags belong to the holder, not to its stored items. */
  hasTag(tag: string): boolean { return this.inst.hasTag(tag); }
  /** containers.lua params[prefab].type: a doer keeps one open container of each type. */
  type?: string;
  canbeopened = true;
  openlimit?: number;
  onopenfn?(inst: object, doer?: object): void;
  onclosefn?(inst: object, doer?: object): void;
  /** InventoryStore supplies authoritative removal; detached containers supply world dropping. */
  dropItem?: (item: TItem, slot: number, position: { x: number; y: number; z: number }) => void;
  /** Set by the prefab's SetNumSlots; each slot's `entity` signal holds its inst. */
  private readonly slotList: TSlot[] = [];
  private readonly openlist = new Set<ContainerOpener>();
  private readonly openCountState = createSignal(0);
  /** container.lua's opencount, for components that follow opening and closing. */
  readonly openCount = readonlySignal(this.openCountState);
  private readonly createSlot: () => TSlot;
  private readonly loadItem: (record: TRecord) => TItem;
  private readonly restoreItem: (record: HeldEntityRecord) => TItem;
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
    if (this.IsOpen()) { this.watchOpeners(); }
  }

  private watchOpeners(): void {
    if (!this.autoCloseWorld || this.stopPositions) { return; }
    const positions = this.autoCloseWorld(WorldContentKey.PlayerPositions, stop => { this.stopPositions = stop; });
    createEffect(() => {
      positions.get();
      this.CheckOpeners();
    });
  }

  CheckOpeners(): void {
    const holder = this.inst, position = holder.getPosition();
    for (const opener of this.openlist) {
      const origin = opener.getPosition?.() ?? opener.position;
      if (holder.isRemoved || opener.isRemoved || opener.isValid?.() === false || !origin
        || origin.distanceToSquared(position) > this.autoCloseDistance ** 2) { this.Close(opener); }
    }
  }

  /** `loadItem` SpawnPrefabs an item from its runtime record; `restoreItem` is SpawnSaveRecord of a saved one. */
  constructor(inst: ContainerInst, createSlot: () => TSlot, loadItem: (record: TRecord) => TItem,
    restoreItem: (record: HeldEntityRecord) => TItem) {
    this.inst = inst;
    this.createSlot = createSlot;
    this.loadItem = loadItem;
    this.restoreItem = restoreItem;
  }

  /** Existing inventory slots back the component; no second copy of item state. */
  get slots(): readonly TSlot[] { return this.slotList; }
  get numslots(): number { return this.slots.length; }
  get opencount(): number { return this.openlist.size; }

  /** Reads every slot's inst inside the caller's effect or memo, as container.lua's itemget/itemlose listeners. */
  TrackContents(): void { for (const slot of this.slotList) { slot.entity.get(); } }

  SetNumSlots(numslots: number): void {
    if (!Number.isSafeInteger(numslots) || numslots < this.numslots) {
      throw new RangeError('Container slot count must be an integer and cannot shrink');
    }
    const added = Array.from({ length: numslots - this.numslots }, () => this.createSlot());
    this.slotList.push(...added);
  }

  /**
   * container.lua removes items through their inventory owner before destroying them; onpredestroyitemcallbackfn sees
   * each item first. Lua's RemoveItemBySlot and item:Remove() are one removal here, so the callback runs while the item
   * is still in its slot.
   */
  DestroyContents(onpredestroyitemcallbackfn?: (inst: ContainerInst, item: TItem) => void): void {
    for (const slot of this.slots) {
      const item = slot.getEntity();
      if (item) { this.destroySlotItem(slot, item, onpredestroyitemcallbackfn); }
    }
  }

  /** container.lua DestroyContentsConditionally: only the items filterfn accepts; without one, every item. */
  DestroyContentsConditionally(filterfn: ((inst: ContainerInst, item: TItem) => boolean) | undefined,
    onpredestroyitemcallbackfn?: (inst: ContainerInst, item: TItem) => void): void {
    if (!filterfn) { this.DestroyContents(onpredestroyitemcallbackfn); return; }
    for (const slot of this.slots) {
      const item = slot.getEntity();
      if (item && filterfn(this.inst, item)) { this.destroySlotItem(slot, item, onpredestroyitemcallbackfn); }
    }
  }

  private destroySlotItem(slot: TSlot, item: TItem, onpredestroyitemcallbackfn?: (inst: ContainerInst, item: TItem) => void): void {
    onpredestroyitemcallbackfn?.(this.inst, item);
    if (item.remove) {
      if (item.remove() && slot.getEntity() === item) { slot.setEntity(null); }
    }
    else { slot.setEntity(null); item.destroy(); }
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
  Open(doer?: ContainerOpener): void {
    if (!doer || this.openlist.has(doer)) { return; }
    const opencontainers = doer.components?.inventory?.opencontainers;
    if (opencontainers) {
      const inst = this.inst;
      for (const k of opencontainers) {
        if (k.prefab === inst.prefab || k.components.container?.type === this.type) { k.components.container?.Close(doer); }
      }
      opencontainers.add(inst);
    }
    const wasOpen = this.IsOpen();
    this.openlist.add(doer);
    this.openCountState.set(this.openlist.size);
    const removal = doer.removal;
    if (removal) {
      const removed = watchSignal(removal, stop => this.openerCleanups.set(doer, stop));
      createEffect(() => { if (removed.get()) { this.Close(doer); } });
    }
    this.inst.PushEvent('onopen', { doer });
    if (!wasOpen) { this.onopenfn?.(this.inst, doer); }
    if (this.IsOpen()) { this.watchOpeners(); }
  }

  Close(doer?: ContainerOpener): void {
    const wasOpen = this.IsOpen();
    let closed = false;
    for (const opener of doer ? [doer] : this.openlist) {
      closed = this.openlist.delete(opener) || closed;
      this.openerCleanups.get(opener)?.();
      this.openerCleanups.delete(opener);
      opener.components?.inventory?.opencontainers?.delete(this.inst);
    }
    if (!closed) { return; }
    this.openCountState.set(this.openlist.size);
    if (!this.IsOpen()) { this.stopPositions?.(); this.stopPositions = undefined; }
    if (wasOpen && !this.IsOpen()) { this.onclosefn?.(this.inst, doer); }
    if (wasOpen) { this.inst.PushEvent('onclose', { doer }); }
  }

  IsOpen(): boolean { return this.opencount > 0; }
  DropEverything(position: { x: number; y: number; z: number }): void {
    this.slots.forEach((slot, index) => {
      const item = slot.getEntity();
      if (item) { this.dropItem?.(item, index + 1, position); }
    });
  }
  IsOpenedBy(doer: object): boolean { return this.openlist.has(doer); }
  IsOpenedByOthers(doer: object): boolean { return this.opencount > (this.IsOpenedBy(doer) ? 1 : 0); }
  CanOpen(): boolean { return this.openlimit === undefined || this.opencount < this.openlimit; }
  GetOpeners(): object[] { return [...this.openlist]; }

  /** The occupied slots' runtime records as they stand, for a holder snapshotted outside a save. */
  GetSnapshot(): ContainerSaveData<TRecord> {
    const slots: ContainerSaveData<TRecord>['slots'] = [];
    this.slots.forEach((slot, index) => {
      const item = slot.getEntity();
      if (item && !item.isRemoved) { slots.push({ slotKey: String(index), item: item.snapshot() }); }
    });
    return { slotCount: this.numslots, slots };
  }

  /** container.lua OnSave: each valid, persisting item's GetSaveRecord under its one-based slot. */
  OnSave(): SlotItemsSave {
    // Each item's GetPersistData settles its components first.
    const items: SlotItemsSave['items'] = {};
    this.slots.forEach((slot, index) => {
      const item = slot.getEntity();
      if (item && !item.isRemoved && (item as { persists?: boolean }).persists !== false) { items[String(index + 1)] = item.GetSaveRecord(); }
    });
    return { items };
  }

  /** container.lua OnLoad: SpawnSaveRecord of each item, then GiveItem(inst, slot). */
  OnLoad(data: Partial<SlotItemsSave>): void {
    this.place(Object.entries(data.items ?? {}).map(([slot, record]) => [Number(slot), () => this.restoreItem(record)]));
  }

  /** A held item's runtime snapshot of its contents, as it travels as a stack. */
  LoadSnapshot(data: { slots?: readonly { slotKey: string; item: TRecord }[] }): void {
    this.place((data.slots ?? []).map(({ slotKey, item }) =>
      [String(Number(slotKey)) === slotKey ? Number(slotKey) + 1 : Number.NaN, () => this.loadItem(item)]));
  }

  /** Spawns every item before any slot changes, so a failed load leaves the container as it was. */
  private place(entries: readonly (readonly [number, () => TItem])[]): void {
    for (const [slot] of entries) {
      if (!Number.isSafeInteger(slot) || slot < 1 || slot > this.numslots || this.GetItemInSlot(slot)) {
        throw new RangeError(`Invalid or occupied container slot: ${slot}`);
      }
    }
    const pending: { slot: TSlot; item: TItem }[] = [];
    const seen = new Set(this.GetAllItems());
    try {
      for (const [slotNumber, load] of entries) {
        const item = load();
        if (item.isRemoved || seen.has(item)) { throw new Error('Invalid or duplicate loaded container item'); }
        seen.add(item);
        pending.push({ slot: this.slots[slotNumber - 1], item });
      }
    } catch (error) {
      for (const { item } of pending) { item.destroy(); }
      throw error;
    }
    batch(() => { for (const { slot, item } of pending) { slot.setEntity(item); } });
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
