import type { InventoryItemSignals, InventoryItemSpec, InventoryStack, SlotAddress } from './types';
import { batch, createMemo, createSignal, readonlySignal } from '@dontstarve-web/signals';
import { StorageSlot } from './slots';
import { Container } from '../../componets/src/container';
import { BACKPACK_SLOT_COUNT } from './addresses';
import { InventoryItem } from '../../componets/src/inventoryitem';
import { Equippable } from '../../componets/src/equippable';
import { Perishable } from '../../componets/src/perishable';
import { EventEmitter } from '@dontstarve-web/signals';

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
  /** perishable.lua's onperishreplacement: the same slot receives the replacement stack. */
  replace(prefab: string): boolean;
}

/** stackable.lua: stack size belongs to the item, independent of its current slot. */
export class StackableComponent {
  private readonly state;
  readonly size;
  constructor(count: number) {
    this.state = createSignal(count);
    this.size = readonlySignal(this.state);
  }
  get count(): number { return this.state.peek(); }
  set count(value: number) { this.state.set(value); }
}

/** fueled.lua: remaining fuel is the source; percent derives from the configured maximum. */
export class FueledComponent {
  private readonly state;
  private readonly maximum = createSignal<number | undefined>(undefined);
  readonly fuel;
  readonly percent = createMemo(() => {
    const maximum = this.maximum.get();
    return maximum === undefined ? undefined : Math.max(0, Math.min(1, (this.state.get() ?? maximum) / maximum));
  });
  constructor(remaining?: number) {
    this.state = createSignal(remaining);
    this.fuel = readonlySignal(this.state);
  }
  get remaining(): number | undefined { return this.state.peek(); }
  set remaining(value: number | undefined) { this.state.set(value); }
  setMaxFuel(maximum: number): void {
    if (!Number.isFinite(maximum) || maximum <= 0) throw new RangeError('Invalid fuel maximum');
    this.maximum.set(maximum);
  }
  dispose(): void { this.percent.dispose(); }
}

/** finiteuses.lua: Use changes the component and invokes inst removal on depletion. */
export class FiniteUsesComponent {
  private onFinished?: () => boolean;
  private readonly consumption = new Map<string, number>();
  private readonly state;
  private readonly maximumState = createSignal<number | undefined>(undefined);
  readonly uses;
  readonly percent = createMemo(() => {
    const maximum = this.maximumState.get();
    return maximum === undefined ? undefined : (this.state.get() ?? maximum) / maximum;
  });
  private readonly entity: ItemEntity;

  constructor(entity: ItemEntity, remaining?: number) {
    this.entity = entity;
    this.state = createSignal(remaining);
    this.uses = readonlySignal(this.state);
  }
  get remaining(): number | undefined { return this.state.peek(); }
  set remaining(value: number | undefined) { this.state.set(value); }
  private get maximum(): number | undefined { return this.maximumState.peek(); }
  setMaxUses(maximum: number): void {
    if (!Number.isSafeInteger(maximum) || maximum <= 0
      || (this.remaining !== undefined && this.remaining > maximum)) throw new RangeError('Invalid finiteuses maximum');
    this.maximumState.set(maximum);
  }
  use(amount = 1): boolean {
    if (this.entity.isRemoved || !Number.isFinite(amount) || amount <= 0 || this.maximum === undefined) return false;
    const remaining = this.remaining ?? this.maximum;
    const next = Math.max(0, remaining - amount);
    if (next === 0) {
      // Inventory removal must commit through the bound owner before publishing zero uses.
      if (!(this.onFinished ? this.onFinished() : this.entity.remove())) return false;
      this.remaining = 0;
    } else {
      this.remaining = next;
      this.entity.components.inventoryitem.owner?.changed();
    }
    return true;
  }
  setConsumption(action: string, amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) throw new RangeError('Invalid use consumption');
    this.consumption.set(action, amount);
  }
  setOnFinished(fn: () => boolean): void { this.onFinished = fn; }
  useForAction(action: string): boolean { return this.use(this.consumption.get(action) ?? 1); }
  dispose(): void { this.percent.dispose(); this.consumption.clear(); this.onFinished = undefined; }
}

/** Like DST's inst: identity and components survive changes of inventory owner and scene art. */
export class ItemEntity {
  readonly id: string;
  readonly prefab: string;
  readonly components: {
    stackable: StackableComponent;
    fueled: FueledComponent;
    finiteuses: FiniteUsesComponent;
    inventoryitem: InventoryItem<ItemEntity, ItemOwner>;
    perishable: Perishable;
    equippable?: Equippable;
    container?: Container<InventoryStack, ItemEntity, StorageSlot>;
    tool?: import('../../componets/src/tool').Tool;
    workable?: import('../../componets/src/workable').Workable;
    spellcaster?: import('../../componets/src/spellcaster').SpellCasterComponent;
    lighter?: import('../../componets/src/lighter').Lighter;
    burnable?: import('../../componets/src/burnable').Burnable;
    propagator?: import('../../componets/src/propagator').Propagator;
    book?: import('../../componets/src/book').BookComponent;
    weapon?: import('../../componets/src/weapon').Weapon;
    repairer?: import('../../componets/src/repairer').Repairer;
  };
  readonly signals: InventoryItemSignals;
  /** Display-only itemtile freshness for items without a perishable timer. */
  private readonly freshnessState = createSignal<number | undefined>(undefined);
  private readonly freshness;
  private readonly wetState = createSignal(false);
  private readonly persistsState = createSignal(true);
  readonly persistence = readonlySignal(this.persistsState);
  private readonly durability;
  readonly transform: { position: [number, number, number]; rotationY: number } = { position: [0, 0, 0], rotationY: 0 };
  skinId?: string;
  spelltype?: string;
  _cached_reskinname?: Map<string, string | undefined>;
  castsound?: string;
  fxcolour?: readonly [number, number, number];
  phonographRecord?: string;
  private readonly runtime = new Map<string, ItemRuntimeComponent>();
  private readonly removedState = createSignal(false);
  readonly removal = readonlySignal(this.removedState);
  private readonly tags = new Set<string>();
  private events = new EventEmitter<Record<string, unknown>>();

  constructor(state: InventoryStack) {
    this.id = state.entityId ?? newItemEntityId();
    this.prefab = state.itemId;
    this.components = {
      stackable: new StackableComponent(state.count),
      fueled: new FueledComponent(state.remainingFuel),
      finiteuses: new FiniteUsesComponent(this, state.remainingUses),
      inventoryitem: new InventoryItem<ItemEntity, ItemOwner>(this),
      perishable: new Perishable(this),
    };
    this.durability = createMemo(() => this.components.finiteuses.percent.get() ?? this.components.fueled.percent.get());
    this.freshness = createMemo(() => this.components.perishable.perishtime.get() === undefined
      ? this.freshnessState.get() : this.components.perishable.percent.get());
    this.signals = Object.freeze({
      count: this.components.stackable.size,
      durabilityPercent: readonlySignal(this.durability),
      freshnessPercent: readonlySignal(this.freshness),
      wet: readonlySignal(this.wetState),
    });
    if (this.prefab === 'backpack') {
      const container = new Container(this, () => new StorageSlot(), (item: InventoryStack) => new ItemEntity(item));
      container.SetNumSlots(BACKPACK_SLOT_COUNT);
      container.OnLoad({ items: Object.fromEntries((state.container?.slots ?? [])
        .map(({ slotKey, item }) => [String(Number(slotKey) + 1), item])) });
      this.components.container = container;
    }
    this.apply(state);
  }

  get isRemoved(): boolean { return this.removedState.peek(); }
  get persists(): boolean { return this.persistence.peek(); }
  set persists(value: boolean) { this.persistsState.set(value); }
  getPosition(): { x: number; y: number; z: number } {
    const [x, y, z] = this.transform.position;
    return { x, y, z };
  }
  hasTag(tag: string): boolean { return this.components.workable?.HasTag(tag) ?? this.tags.has(tag); }
  GetIsWet(): boolean { return this.wetState.peek(); }
  addTag(tag: string): void { this.tags.add(tag); }
  removeTag(tag: string): void { this.tags.delete(tag); }
  PushEvent(name: string, data: unknown): void { this.events.emit(name, data); }
  ListenForEvent(name: string, listener: (data: unknown) => void): () => void { return this.events.on(name, listener); }
  getComponent<T extends ItemRuntimeComponent>(name: string): T | undefined {
    return this.runtime.get(name) as T | undefined;
  }
  snapshot(includeIdentity = true): InventoryStack {
    return {
      ...(includeIdentity ? { entityId: this.id } : {}), itemId: this.prefab, count: this.components.stackable.count,
      ...(this.skinId === undefined ? {} : { skinId: this.skinId }),
      ...(this.components.fueled.remaining === undefined ? {} : { remainingFuel: this.components.fueled.remaining }),
      ...(this.components.finiteuses.remaining === undefined ? {} : { remainingUses: this.components.finiteuses.remaining }),
      ...(this.freshness.peek() === undefined ? {} : { freshnessPercent: this.freshness.peek() }),
      ...(this.wetState.peek() ? { wet: true } : {}),
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
    if (state.itemId !== this.prefab || this.isRemoved) throw new Error('Cannot change a removed entity or its prefab');
    this.skinId = state.skinId;
    this.phonographRecord = state.phonographRecord;
    batch(() => {
      this.components.stackable.count = state.count;
      this.components.fueled.remaining = state.remainingFuel;
      this.components.finiteuses.remaining = state.remainingUses;
      if (this.components.perishable.perishtime.peek() === undefined) this.freshnessState.set(state.freshnessPercent);
      else if (state.freshnessPercent !== undefined) this.components.perishable.SetPercent(state.freshnessPercent);
      this.wetState.set(state.wet ?? false);
    });
  }

  configure(spec: Pick<InventoryItemSpec, 'maxUses' | 'maxFuel' | 'perishTime' | 'perishReplacement' | 'equippable' | 'canGoInContainer' | 'configureEntity'>): void {
    if (spec.equippable) {
      this.components.equippable ??= new Equippable(this, spec.equippable);
      this.components.equippable.equipslot = spec.equippable;
    }
    this.components.inventoryitem.cangoincontainer = spec.canGoInContainer !== false;
    batch(() => {
      if (spec.maxUses !== undefined) this.components.finiteuses.setMaxUses(spec.maxUses);
      if (spec.maxFuel !== undefined) this.components.fueled.setMaxFuel(spec.maxFuel);
      const perishable = this.components.perishable;
      if (spec.perishTime !== undefined && perishable.perishtime.peek() === undefined) {
        // SetPerishTime starts full; a stack's saved/transferred percent then restores perishremainingtime.
        const saved = this.freshnessState.peek();
        perishable.SetPerishTime(spec.perishTime);
        if (saved !== undefined) perishable.SetPercent(saved);
        this.freshnessState.set(undefined);
        perishable.onperishreplacement = spec.perishReplacement;
        perishable.StartPerishing();
      }
    });
    spec.configureEntity?.(this);
  }

  /** Component adapters publish itemtile's perishchange / wetnesschange state. */
  setFreshnessPercent(percent: number): boolean {
    if (this.isRemoved || !Number.isFinite(percent)) return false;
    if (this.components.perishable.perishtime.peek() === undefined) this.freshnessState.set(Math.max(0, Math.min(1, percent)));
    else this.components.perishable.SetPercent(percent);
    this.components.inventoryitem.owner?.changed();
    return true;
  }
  setWet(wet: boolean): boolean {
    if (this.isRemoved || typeof wet !== 'boolean') return false;
    this.wetState.set(wet);
    this.components.inventoryitem.owner?.changed();
    return true;
  }

  /** fueled.lua clamps at zero; whether an empty inst is removed belongs to its depleted callback. */
  setRemainingFuel(seconds: number): boolean {
    if (this.isRemoved || !Number.isFinite(seconds) || seconds < 0) return false;
    this.components.fueled.remaining = seconds;
    this.components.inventoryitem.owner?.changed();
    return true;
  }

  component<T extends ItemRuntimeComponent>(name: string, create: () => T): T {
    if (this.isRemoved) throw new Error('Cannot attach a component to a removed entity');
    let component = this.runtime.get(name);
    if (!component) { component = create(); this.runtime.set(name, component); }
    return component as T;
  }

  flush(): void {
    this.components.perishable.flush();
    this.components.container?.flush();
    for (const component of this.runtime.values()) component.flush?.();
  }
  remove(): boolean {
    if (this.isRemoved) return false;
    const owner = this.components.inventoryitem.owner;
    if (owner) return owner.remove();
    this.destroy();
    return true;
  }
  destroy(): void {
    if (this.isRemoved) return;
    this.flush();
    if (this.isRemoved) return;
    this.removedState.set(true);
    this.PushEvent('onremove', undefined);
    this.events = new EventEmitter();
    this.components.inventoryitem.owner = null;
    for (const component of this.runtime.values()) component.dispose();
    this.runtime.clear();
    this.components.workable?.dispose();
    this.components.container?.dispose();
    this.durability.dispose();
    this.freshness.dispose();
    this.components.perishable.dispose();
    this.components.fueled.dispose();
    this.components.finiteuses.dispose();
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
