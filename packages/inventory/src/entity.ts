import type { InventoryItemSignals, InventoryItemSpec, InventoryStack, SlotAddress } from './types';
import { batch, createMemo, createSignal, readonlySignal } from '@dontstarve-web/signals';
import { StorageSlot } from './slots';
import { Container } from '../../componets/src/container';
import { BACKPACK_SLOT_COUNT } from './addresses';
import { InventoryItem } from '../../componets/src/inventoryitem';
import { MiniMapEntity } from '../../componets/src/minimapentity';
import { Equippable } from '../../componets/src/equippable';
import { Perishable, type PerishWorld } from '../../componets/src/perishable';
import { EventEmitter } from '@dontstarve-web/signals';
import { Vector3 } from 'three';
import type { Fuel } from '../../componets/src/fuel';
import { Fueled } from '../../componets/src/fueled';
import { Temperature, type TemperatureWorld, type TemperatureSaveData } from '../../componets/src/temperature';
import type { Heater } from '../../componets/src/heater';
import { SpriteState } from '@dontstarve-web/display/spriteState';

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
  hasTag?(tag: string): boolean;
  getPosition?(): Vector3;
  changed(): void;
  remove(): boolean;
  /** perishable.lua's onperishreplacement: the same slot receives the replacement stack. */
  replace(prefab: string): boolean;
  /** Livestock onperish removes the original stack, then gives its generated loot to the holder. */
  GiveItem?(item: ItemEntity): boolean;
  /** Lua owner:PushEvent: the player's inventory forwards to the player; other containers ignore it. */
  PushEvent(name: string, data: unknown): void;
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
    // finiteuses.lua SetUses pushes percentusedchange before onfinished removes the inst.
    this.entity.PushEvent('percentusedchange', { percent: next / this.maximum });
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
  /** finiteuses.lua SetPercent: SetUses(total * percent), keeping the saved step exact. */
  setPercent(percent: number, step: number): boolean {
    if (this.entity.isRemoved || this.maximum === undefined || !Number.isFinite(percent) || percent <= 0) return false;
    const next = Math.round(Math.min(1, percent) * this.maximum / step) * step;
    this.entity.PushEvent('percentusedchange', { percent: next / this.maximum });
    this.remaining = next;
    this.entity.components.inventoryitem.owner?.changed();
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
    eater?: import('../../componets/src/eater').Eater;
    edible?: import('../../componets/src/edible').Edible;
    health?: import('../../componets/src/health').Health;
    combat?: import('../../componets/src/combat').Combat;
    bait?: import('../../componets/src/bait').Bait;
    sleeper?: import('../../componets/src/sleeper').Sleeper;
    freezable?: import('../../componets/src/freezable').Freezable;
    stackable: StackableComponent;
    fueled?: Fueled<ItemEntity>;
    finiteuses: FiniteUsesComponent;
    inventoryitem: InventoryItem<ItemEntity, ItemOwner>;
    perishable: Perishable;
    equippable?: Equippable;
    container?: Container<InventoryStack, ItemEntity, StorageSlot>;
    tool?: import('../../componets/src/tool').Tool;
    fertilizer?: import('../../componets/src/fertilizer').Fertilizer;
    bathbomb?: import('../../componets/src/bathbomb').BathBomb;
    shaver?: import('../../componets/src/shaver').Shaver;
    deployable?: import('../../componets/src/deployable').Deployable<any>;
    instrument?: ItemRuntimeComponent & { Play(musician: unknown, listeners: (range: number) => Iterable<never>): boolean };
    workable?: import('../../componets/src/workable').Workable;
    spellcaster?: import('../../componets/src/spellcaster').SpellCasterComponent;
    lighter?: import('../../componets/src/lighter').Lighter;
    burnable?: import('../../componets/src/burnable').Burnable;
    propagator?: import('../../componets/src/propagator').Propagator;
    explosive?: import('../../componets/src/explosive').Explosive;
    book?: import('../../componets/src/book').BookComponent;
    weapon?: import('../../componets/src/weapon').Weapon;
    projectile?: import('../../componets/src/projectile').Projectile;
    repairer?: import('../../componets/src/repairer').Repairer;
    fuel?: Fuel;
    tradable?: import('../../componets/src/tradable').Tradable;
    temperature?: Temperature;
    heater?: Heater;
    armor?: import('../../componets/src/armor').Armor;
    setbonus?: import('../../componets/src/setbonus').SetBonus;
    hauntable?: import('../../componets/src/hauntable').Hauntable;
    useableitem?: import('../../componets/src/useableitem').UseableItem;
    machine?: import('../../componets/src/machine').Machine;
  };
  readonly signals: InventoryItemSignals;
  /** Display-only itemtile freshness for items without a perishable timer. */
  private readonly freshnessState = createSignal<number | undefined>(undefined);
  private readonly freshness;
  private readonly wetState = createSignal(false);
  private readonly persistsState = createSignal(true);
  readonly persistence = readonlySignal(this.persistsState);
  private readonly durability;
  /** components.armor is attached by prefab configuration, after the durability memo exists. */
  private readonly armorState = createSignal<import('../../componets/src/armor').Armor | undefined>(undefined);
  private savedArmor?: InventoryStack['armor'];
  /** components.fueled is added by prefab configuration, after the durability memo exists. */
  private readonly fueledState = createSignal<Fueled<ItemEntity> | undefined>(undefined);
  /** The saved fuel, loaded once the prefab has added and initialized its fueled. */
  private savedFuel?: number;
  readonly transform: { readonly position: Vector3; rotationY: number } = { position: new Vector3(), rotationY: 0 };
  private miniMapEntity?: MiniMapEntity;
  get MiniMapEntity(): MiniMapEntity | undefined { return this.miniMapEntity; }
  /** AddMiniMapEntity is owned by the logical inst, independently of its art. */
  AddMiniMapEntity(): MiniMapEntity {
    if (!this.miniMapEntity) {
      this.miniMapEntity = new MiniMapEntity(this.transform.position);
      this.miniMapEntity.SetEnabled(!this.isRemoved && this.components.inventoryitem.owner === null);
      this.PushEvent('minimapentityadded', this.miniMapEntity);
    }
    return this.miniMapEntity;
  }
  mole?: InventoryStack['mole'];
  lightflier?: InventoryStack['lightflier'];
  /**
   * inst.AnimState: the item's sprite json for its whole life, on the ground, in a container or equipped. A ground
   * visual draws this declaration; off the ground it plays no clip.
   */
  readonly sprite: SpriteState;
  /** The item's skin is the sprite json's `skinId`; inventory, equipment and saves read it from there. */
  get skinId(): string | undefined { return this.sprite.skinId.peek(); }
  set skinId(skinId: string | undefined) { this.sprite.setSkinId(skinId); }
  variant?: string;
  highTemp?: number;
  lowTemp?: number;
  private temperatureWorld?: TemperatureWorld;
  private savedTemperature?: TemperatureSaveData;
  AddTemperature(): Temperature {
    return this.components.temperature ??= this.component('temperature', () => new Temperature(this, this.temperatureWorld, this.savedTemperature));
  }
  /** inst:AddComponent("fueled"), consuming on the game time of the item's world. */
  AddFueled(): Fueled<ItemEntity> {
    let fueled = this.components.fueled;
    if (fueled) return fueled;
    fueled = this.components.fueled = new Fueled<ItemEntity>(this, this.components.perishable.scheduler);
    // inventoryitem.lua OnPercentUsedChanged: the item tile follows the fuel.
    this.ListenForEvent('percentusedchange', () => this.components.inventoryitem.owner?.changed());
    this.fueledState.set(fueled);
    return fueled;
  }
  /** perishable.lua's world, whose game-time scheduler also runs this item's fueled task. */
  BindPerishWorld(world: PerishWorld): void {
    this.components.perishable.BindWorld(world);
    this.components.fueled?.BindScheduler(this.components.perishable.scheduler);
  }
  BindTemperatureWorld(world: TemperatureWorld): void {
    this.temperatureWorld = world;
    this.components.temperature?.BindWorld(world);
  }
  spelltype?: string;
  _cached_reskinname?: Map<string, string | undefined>;
  castsound?: string;
  projectiledelay?: number;
  fxcolour?: readonly [number, number, number];
  phonographRecord?: string;
  private readonly runtime = new Map<string, ItemRuntimeComponent>();
  private readonly removedState = createSignal(false);
  readonly removal = readonlySignal(this.removedState);
  private readonly tags = new Set<string>();
  private events = new EventEmitter<Record<string, unknown>>();

  constructor(state: InventoryStack, perishWorld?: PerishWorld) {
    this.id = state.entityId ?? newItemEntityId();
    this.prefab = state.itemId;
    this.sprite = new SpriteState({ name: state.itemId, none: true });
    this.wetState.set(state.wet ?? false);
    this.components = {
      stackable: new StackableComponent(state.count),
      finiteuses: new FiniteUsesComponent(this, state.remainingUses),
      inventoryitem: new InventoryItem<ItemEntity, ItemOwner>(this),
      perishable: new Perishable(this, readonlySignal(this.wetState), perishWorld),
    };
    this.durability = createMemo(() => this.components.finiteuses.percent.get() ?? this.fueledState.get()?.percent.get()
      ?? this.armorState.get()?.percent.get());
    this.freshness = createMemo(() => this.components.perishable.perishtime.get() === undefined
      ? this.freshnessState.get() : this.components.perishable.percent.get());
    this.signals = Object.freeze({
      count: this.components.stackable.size,
      durabilityPercent: readonlySignal(this.durability),
      freshnessPercent: readonlySignal(this.freshness),
      wet: readonlySignal(this.wetState),
    });
    if (this.prefab === 'backpack') {
      const container = new Container(this, () => new StorageSlot(), (item: InventoryStack) => new ItemEntity(item, perishWorld));
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
  /** The live transform position; callers must not mutate it. */
  getPosition(): Vector3 { return this.transform.position; }
  hasTag(tag: string): boolean { return this.components.workable?.HasTag(tag) ?? this.tags.has(tag); }
  GetIsWet(): boolean { return this.wetState.peek(); }
  addTag(tag: string): void {
    if (this.tags.has(tag)) return;
    this.tags.add(tag);
    this.PushEvent('tagchanged', tag);
  }
  removeTag(tag: string): void {
    if (this.tags.delete(tag)) this.PushEvent('tagchanged', tag);
  }
  PushEvent(name: string, data: unknown): void { this.events.emit(name, data); }
  ListenForEvent(name: string, listener: (data: unknown) => void): () => void { return this.events.on(name, listener); }
  getComponent<T extends ItemRuntimeComponent>(name: string): T | undefined {
    return this.runtime.get(name) as T | undefined;
  }
  snapshot(includeIdentity = true): InventoryStack {
    const temperature = this.components.temperature?.OnSave() ?? this.savedTemperature;
    const armor = this.components.armor ? this.components.armor.OnSave() : this.savedArmor;
    const freshness = this.components.perishable.perishtime.peek() === undefined
      ? this.freshnessState.peek() : this.components.perishable.GetPercent();
    const mole = this.getComponent<ItemRuntimeComponent & { OnSave(): NonNullable<InventoryStack['mole']> }>('mole')?.OnSave() ?? this.mole;
    const lightflier = this.getComponent<ItemRuntimeComponent & { OnSave(): NonNullable<InventoryStack['lightflier']> }>('lightflier')?.OnSave() ?? this.lightflier;
    const remainingFuel = this.components.fueled ? this.components.fueled.OnSave()?.fuel : this.savedFuel;
    return {
      ...(lightflier === undefined ? {} : { lightflier }),
      ...(mole === undefined ? {} : { mole }),
      ...(temperature === undefined ? {} : { temperature }),
      ...(armor === undefined ? {} : { armor }),
      ...(this.highTemp === undefined ? {} : { highTemp: Math.ceil(this.highTemp) }),
      ...(this.lowTemp === undefined ? {} : { lowTemp: Math.floor(this.lowTemp) }),
      ...(includeIdentity ? { entityId: this.id } : {}), itemId: this.prefab, count: this.components.stackable.count,
      ...(this.skinId === undefined ? {} : { skinId: this.skinId }),
      ...(this.variant === undefined ? {} : { variant: this.variant }),
      ...(remainingFuel === undefined ? {} : { remainingFuel }),
      ...(this.components.finiteuses.remaining === undefined ? {} : { remainingUses: this.components.finiteuses.remaining }),
      ...(freshness === undefined ? {} : { freshnessPercent: freshness }),
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
    this.mole = state.mole;
    this.lightflier = state.lightflier;
    this.skinId = state.skinId;
    this.variant = state.variant;
    this.highTemp = state.highTemp;
    this.lowTemp = state.lowTemp;
    this.savedTemperature = state.temperature;
    if (state.temperature && this.components.temperature?.GetCurrent() !== state.temperature.current) {
      this.components.temperature?.OnLoad(state.temperature);
    }
    this.phonographRecord = state.phonographRecord;
    this.savedArmor = state.armor;
    const armor = this.components.armor;
    if (armor && state.armor && state.armor.condition !== armor.condition.peek()) armor.OnLoad(state.armor);
    batch(() => {
      this.components.stackable.count = state.count;
      const fueled = this.components.fueled;
      // fueled.lua OnSave omits a full inst.
      if (!fueled) this.savedFuel = state.remainingFuel;
      else if ((state.remainingFuel ?? fueled.maxfuel) !== fueled.currentfuel) fueled.OnLoad({ fuel: state.remainingFuel ?? fueled.maxfuel });
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
    // fueled.lua OnLoad runs after the prefab's InitializeFuelLevel.
    if (this.components.fueled && this.savedFuel !== undefined) {
      this.components.fueled.OnLoad({ fuel: this.savedFuel });
      this.savedFuel = undefined;
    }
    // armor.lua OnLoad runs after the prefab's InitCondition.
    const armor = this.components.armor;
    if (armor && this.armorState.peek() !== armor) {
      this.armorState.set(armor);
      if (this.savedArmor) armor.OnLoad(this.savedArmor);
    }
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

  /** fueled.lua DoDelta to `seconds`, after settling elapsed consumption; depletion belongs to the prefab's callbacks. */
  setRemainingFuel(seconds: number): boolean {
    const fueled = this.components.fueled;
    if (this.isRemoved || !fueled || !Number.isFinite(seconds) || seconds < 0) return false;
    fueled.Settle();
    if (!this.isRemoved) fueled.DoDelta(seconds - fueled.currentfuel);
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
    this.components.fueled?.Settle();
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
    this.miniMapEntity?.dispose();
    for (const component of this.runtime.values()) component.dispose();
    this.runtime.clear();
    this.components.workable?.dispose();
    this.components.armor?.dispose();
    this.components.useableitem?.dispose();
    this.components.container?.dispose();
    this.durability.dispose();
    this.freshness.dispose();
    this.components.perishable.dispose();
    this.components.fueled?.dispose();
    this.components.finiteuses.dispose();
  }
}

/** Shared by the inventory store and world item manager; contains each live item exactly once. */
export class ItemEntityRegistry {
  private readonly entities = new Map<string, ItemEntity>();
  /** Container-bearing entities (backpacks), so container sync never scans the whole item population. */
  private readonly containerEntities = new Map<string, ItemEntity>();
  private readonly miniMapIcons = new Set<MiniMapEntity>();
  private readonly entityCleanups = new Map<ItemEntity, () => void>();
  /** Only actual icon primitives are visited, independently of the item population and loaded art. */
  get miniMapEntities(): readonly MiniMapEntity[] {
    const icons: MiniMapEntity[] = [];
    for (const icon of this.miniMapIcons) if (icon.enabled) icons.push(icon);
    return icons;
  }
  private register(entity: ItemEntity): void {
    this.entities.set(entity.id, entity);
    if (entity.components.container) this.containerEntities.set(entity.id, entity);
    if (this.entityCleanups.has(entity)) return;
    const addIcon = () => { if (entity.MiniMapEntity) this.miniMapIcons.add(entity.MiniMapEntity); };
    addIcon();
    const stopAdded = entity.ListenForEvent('minimapentityadded', addIcon);
    const stopRemoved = entity.ListenForEvent('onremove', () => this.unregister(entity));
    this.entityCleanups.set(entity, () => {
      stopAdded(); stopRemoved();
      if (entity.MiniMapEntity) this.miniMapIcons.delete(entity.MiniMapEntity);
    });
  }
  private unregister(entity: ItemEntity): void {
    this.entityCleanups.get(entity)?.();
    this.entityCleanups.delete(entity);
    if (this.entities.get(entity.id) === entity) this.entities.delete(entity.id);
    if (this.containerEntities.get(entity.id) === entity) this.containerEntities.delete(entity.id);
  }
  private perishWorld?: PerishWorld;
  private temperatureWorld?: TemperatureWorld;
  bindTemperatureWorld(world: TemperatureWorld): void {
    this.temperatureWorld = world;
    for (const entity of this.values()) entity.BindTemperatureWorld(world);
  }
  /** Existing, newly created, adopted and nested entities share the current world's integral. */
  bindPerishWorld(world: PerishWorld): void {
    this.perishWorld = world;
    for (const entity of this.values()) {
      entity.BindPerishWorld(world);
      for (const slot of entity.components.container?.slots ?? []) {
        const child = slot.getEntity();
        if (child) this.adopt(child);
      }
    }
  }
  create(state: InventoryStack): ItemEntity {
    if (state.entityId && this.get(state.entityId)) throw new Error(`Duplicate item entity: ${state.entityId}`);
    const entity = new ItemEntity(state, this.perishWorld);
    if (this.temperatureWorld) entity.BindTemperatureWorld(this.temperatureWorld);
    this.register(entity);
    return entity;
  }
  get(id: string): ItemEntity | undefined {
    const entity = this.entities.get(id);
    if (entity?.isRemoved) { this.unregister(entity); return undefined; }
    return entity;
  }
  values(): readonly ItemEntity[] {
    return [...this.entities.values()].filter(entity => !entity.isRemoved);
  }
  containers(): ItemEntity[] {
    return [...this.containerEntities.values()].filter(entity => !entity.isRemoved);
  }
  adopt(entity: ItemEntity): void {
    const existing = this.get(entity.id);
    if (entity.isRemoved || (existing && existing !== entity)) throw new Error(`Invalid item entity: ${entity.id}`);
    if (this.perishWorld) entity.BindPerishWorld(this.perishWorld);
    if (this.temperatureWorld) entity.BindTemperatureWorld(this.temperatureWorld);
    this.register(entity);
    for (const slot of entity.components.container?.slots ?? []) {
      const child = slot.getEntity();
      if (child) this.adopt(child);
    }
  }
  destroy(entity: ItemEntity): void {
    entity.destroy();
    this.unregister(entity);
  }
  dispose(): void {
    for (const entity of this.entities.values()) {
      entity.flush();
      entity.components.inventoryitem.owner = null;
      entity.destroy();
    }
    this.entities.clear();
    this.containerEntities.clear();
    for (const cleanup of this.entityCleanups.values()) cleanup();
    this.entityCleanups.clear();
    this.miniMapIcons.clear();
    this.perishWorld = undefined;
    this.temperatureWorld = undefined;
  }
}
