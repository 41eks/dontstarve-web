import { Inspectable } from '../../componets/src/inspectable';
import { addComponent } from '../../prefab/src/components';
import type { ItemTileJson, InventoryItemSpec, InventoryStack, SlotAddress } from './types';
import {
  batch,
  createMemo,
  createSignal,
  readonlySignal,
  type Memo,
  type ReadonlySignal,
} from '@dontstarve-web/signals';
import { newItemEntityId } from './entityId';
import { StorageSlot } from './slots';
import { Container } from '../../componets/src/container';
import { BACKPACK_SLOT_COUNT } from './addresses';
import { InventoryItem } from '../../componets/src/inventoryitem';
import { MiniMapEntity } from '../../componets/src/minimapentity';
import { Equippable } from '../../componets/src/equippable';
import { Perishable, type PerishWorld } from '../../componets/src/perishable';
import { PrefabInstance } from '../../prefab/src/prefabInstance';
import { Vector3 } from 'three';
import type { Fuel } from '../../componets/src/fuel';
import { Fueled } from '../../componets/src/fueled';
import { Temperature, type TemperatureWorld, type TemperatureSaveData } from '../../componets/src/temperature';
import type { Heater } from '../../componets/src/heater';
import { SpriteState } from '@dontstarve-web/display/spriteState';
import type { EntityPersistData, HeldEntityRecord } from '../../prefab/src/saveRecord';

export { newItemEntityId };

export interface ItemRuntimeComponent {
  flush?(): void;
  BindScheduler?(scheduler: import('../../componets/src/gameTimeScheduler').GameTimeScheduler): void;
  dispose(): void;
}
/** TUNING.MOISTURE_DRY_THRESHOLD. */
const MOISTURE_DRY_THRESHOLD = 15;

/** inventoryitem.owner: the entity holding an item — the player, a chest's or a worn backpack's inst, or a creature. */
export type ItemOwner = import('../../componets/src/inventoryitem').ItemHolder;

/** The holder's slot an item is in (inventory/container:GetItemSlot), bound by the inventory that holds it. */
export interface HeldSlot {
  readonly address: SlotAddress;
  /** The item's stack or state changed in place; the holder republishes the slot. */
  changed(): void;
  /** inst:Remove() of a held item: its slot gives it up. */
  remove(): boolean;
  /** perishable.lua's onperishreplacement: the same slot receives the replacement stack (holder:GiveItem(goop, slot)). */
  replace(prefab: string): boolean;
  /** holder:GiveItem(item): livestock onperish gives its loot to the holder of the perished stack. */
  GiveItem?(item: ItemEntity): boolean;
  /** holder:DropItem(item). */
  DropItem?(item: ItemEntity, position?: Vector3): void;
}

/** stackable.lua: stack size belongs to the item, independent of its current slot. */
export class StackableComponent {
  private readonly entity: ItemEntity;
  private readonly state;
  readonly size;
  constructor(entity: ItemEntity, count: number) {
    this.entity = entity;
    this.state = createSignal(count);
    this.size = readonlySignal(this.state);
  }
  get count(): number {
    return this.state.value;
  }
  set count(value: number) {
    this.state.set(value);
  }
  /** stackable.lua OnSave: only a stack of more than one is written. */
  OnSave(): { stack: number } | undefined {
    return this.count !== 1 ? { stack: this.count } : undefined;
  }
  OnLoad(data: { stack?: number }): void {
    if (data.stack !== undefined) {
      this.count = data.stack;
    }
  }
  /** stackable:Get():Remove(), without creating a temporary entity just to destroy it. The owner recounts materials. */
  Consume(): boolean {
    this.entity.flush();
    if (this.entity.isRemoved || this.count < 1) {
      return false;
    }
    if (this.count === 1) {
      return this.entity.remove();
    }
    this.count--;
    this.entity.components.inventoryitem.slot?.changed();
    return true;
  }
}

/** finiteuses.lua: Use changes the component and invokes inst removal on depletion. */
export class FiniteUsesComponent {
  private onFinished?: (inst: ItemEntity) => boolean;
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
  GetPercent(): number {
    return this.percent.value ?? 1;
  }
  /** finiteuses.lua OnSave: the uses left, unless the item is unused. */
  OnSave(): { uses: number } | undefined {
    return this.remaining === undefined ? undefined : { uses: this.remaining };
  }
  OnLoad(data: { uses?: number }): void {
    if (data.uses !== undefined) {
      this.remaining = data.uses;
    }
  }
  get remaining(): number | undefined {
    return this.state.value;
  }
  set remaining(value: number | undefined) {
    this.state.set(value);
  }
  private get maximum(): number | undefined {
    return this.maximumState.value;
  }
  setMaxUses(maximum: number): void {
    if (!Number.isSafeInteger(maximum) || maximum <= 0 || (this.remaining !== undefined && this.remaining > maximum)) {
      throw new RangeError('Invalid finiteuses maximum');
    }
    this.maximumState.set(maximum);
  }
  use(amount = 1): boolean {
    if (this.entity.isRemoved || !Number.isFinite(amount) || amount <= 0 || this.maximum === undefined) {
      return false;
    }
    const remaining = this.remaining ?? this.maximum;
    const next = Math.max(0, remaining - amount);
    // finiteuses.lua SetUses pushes percentusedchange before onfinished removes the inst.
    this.entity.PushEvent('percentusedchange', { percent: next / this.maximum });
    if (next === 0) {
      // Inventory removal must commit through the bound owner before publishing zero uses.
      if (!(this.onFinished ? this.onFinished(this.entity) : this.entity.remove())) {
        return false;
      }
      this.remaining = 0;
    } else {
      this.remaining = next;
    }
    return true;
  }
  /** finiteuses.lua SetPercent: SetUses(total * percent), keeping the saved step exact. */
  setPercent(percent: number, step: number): boolean {
    if (this.entity.isRemoved || this.maximum === undefined || !Number.isFinite(percent) || percent <= 0) {
      return false;
    }
    const next = Math.round((Math.min(1, percent) * this.maximum) / step) * step;
    this.entity.PushEvent('percentusedchange', { percent: next / this.maximum });
    this.remaining = next;
    return true;
  }
  setConsumption(action: string, amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new RangeError('Invalid use consumption');
    }
    this.consumption.set(action, amount);
  }
  setOnFinished(fn: (inst: ItemEntity) => boolean): void {
    this.onFinished = fn;
  }
  useForAction(action: string): boolean {
    return this.use(this.consumption.get(action) ?? 1);
  }
  dispose(): void {
    this.percent.dispose();
    this.consumption.clear();
    this.onFinished = undefined;
  }
}

/** Like DST's inst: identity and components survive changes of inventory owner and scene art. */
export interface ItemComponents {
  locomotor?: import('../../componets/src/locomotor').LocoMotor;
  knownlocations?: import('../../componets/src/knownlocations').KnownLocations;
  pollinator?: import('../../componets/src/pollinator').Pollinator<import('../../brains/src/types').BrainEntity>;
  farmplantable?: import('../../componets/src/farmplantable').FarmPlantable;
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
  inventoryitem: InventoryItem<ItemEntity, ItemOwner, HeldSlot>;
  /** MakeInventoryPhysics, added by an item prefab in a world that advances its flights. */
  inventoryphysics?: import('../../componets/src/inventoryphysics').InventoryPhysics;
  perishable: Perishable;
  equippable?: Equippable<ItemEntity>;
  container?: Container<InventoryStack, ItemEntity, StorageSlot>;
  tool?: import('../../componets/src/tool').Tool;
  fertilizer?: import('../../componets/src/fertilizer').Fertilizer;
  bathbomb?: import('../../componets/src/bathbomb').BathBomb;
  shaver?: import('../../componets/src/shaver').Shaver;
  deployable?: import('../../componets/src/deployable').Deployable;
  instrument?: ItemRuntimeComponent & { Play(musician: unknown): boolean };
  workable?: import('../../componets/src/workable').Workable;
  spellcaster?: import('../../componets/src/spellcaster').SpellCasterComponent;
  blinkstaff?: import('../../componets/src/blinkstaff').BlinkStaff<ItemEntity>;
  fishingrod?: import('../../componets/src/fishingrod').FishingRod;
  terraformer?: import('../../componets/src/terraformer').Terraformer;
  farmtiller?: import('../../componets/src/farmtiller').FarmTiller;
  lighter?: import('../../componets/src/lighter').Lighter;
  burnable?: import('../../componets/src/burnable').Burnable;
  propagator?: import('../../componets/src/propagator').Propagator;
  explosive?: import('../../componets/src/explosive').Explosive;
  book?: import('../../componets/src/book').BookComponent;
  weapon?: import('../../componets/src/weapon').Weapon;
  projectile?: import('../../componets/src/projectile').Projectile;
  repairer?: import('../../componets/src/repairer').Repairer;
  /** Its owner is the cage (occupiable) that holds it. */
  occupier?: import('../../componets/src/occupiable').Occupier<import('../../componets/src/occupiable').OccupiableInst>;
  fuel?: Fuel;
  tradable?: import('../../componets/src/tradable').Tradable;
  temperature?: Temperature;
  heater?: Heater;
  armor?: import('../../componets/src/armor').Armor;
  setbonus?: import('../../componets/src/setbonus').SetBonus;
  hauntable?: import('../../componets/src/hauntable').Hauntable;
  useableitem?: import('../../componets/src/useableitem').UseableItem;
  lootdropper?: import('../../componets/src/lootdropper').LootDropper;
  phonograph?: import('../../prefab/src/phonograph').PhonographController;
  inventory?: import('./creatureInventory').CreatureInventory;
  trader?: import('../../componets/src/trader').Trader;
  machine?: import('../../componets/src/machine').Machine;
  inspectable?: import('../../componets/src/inspectable').Inspectable;
  floater?: import('../../componets/src/floater').Floater;
  furnituredecor?: import('../../componets/src/ruinsrelicSignatures').FurnitureDecor;
  inventoryitemmoisture?: import('../../componets/src/ruinsrelicSignatures').InventoryItemMoisture;
}

export class ItemEntity extends PrefabInstance<SpriteState, ItemComponents> {
  get id(): string {
    return this.entityId!;
  }

  private tileMemo?: Memo<ItemTileJson>;
  /** The item tile's declaration, derived on first use; UI subscribes to it as display does to the sprite json. */
  get tile(): ReadonlySignal<ItemTileJson> {
    return (this.tileMemo ??= createMemo((): ItemTileJson => {
      const { inventoryitem, stackable } = this.components;
      const appearance = inventoryitem.appearance.get(),
        image = inventoryitem.image.get();
      const durabilityPercent = this.durability.get(),
        freshnessPercent = this.freshness.get();
      return Object.freeze({
        ...(appearance ? { name: appearance.name } : {}),
        ...(image ? { image } : {}),
        count: stackable.size.get(),
        ...(durabilityPercent === undefined ? {} : { durabilityPercent }),
        ...(freshnessPercent === undefined ? {} : { freshnessPercent }),
        wet: this.wetState.get(),
      });
    }));
  }
  /** Display-only itemtile freshness for items without a perishable timer. */
  private readonly freshnessState = createSignal<number | undefined>(undefined);
  private readonly freshness;
  private readonly wetState = createSignal(false);
  private readonly durability;
  /** components.armor is attached by prefab configuration, after the durability memo exists. */
  private readonly armorState = createSignal<import('../../componets/src/armor').Armor | undefined>(undefined);
  private savedArmor?: InventoryStack['armor'];
  /** components.fueled is added by prefab configuration, after the durability memo exists. */
  private readonly fueledState = createSignal<Fueled<ItemEntity> | undefined>(undefined);
  /** The saved fuel, loaded once the prefab has added and initialized its fueled. */
  private savedFuel?: number;
  private miniMapEntity?: MiniMapEntity;
  get MiniMapEntity(): MiniMapEntity | undefined {
    return this.miniMapEntity;
  }
  /** AddMiniMapEntity is owned by the logical inst, independently of its art. */
  AddMiniMapEntity(): MiniMapEntity {
    if (!this.miniMapEntity) {
      this.miniMapEntity = new MiniMapEntity(() => this.transform.position);
      this.miniMapEntity.SetEnabled(!this.isRemoved && this.components.inventoryitem.owner === null);
      this.PushEvent('minimapentityadded', this.miniMapEntity);
    }
    return this.miniMapEntity;
  }
  mole?: InventoryStack['mole'];
  lightflier?: InventoryStack['lightflier'];
  variant?: string;
  highTemp?: number;
  lowTemp?: number;
  private temperatureWorld?: TemperatureWorld;
  private savedTemperature?: TemperatureSaveData;
  AddTemperature(): Temperature {
    return addComponent(this, 'temperature', Temperature, this.temperatureWorld, this.savedTemperature);
  }
  /** inst:AddComponent("fueled"), consuming on the game time of the item's world. */
  AddFueled(): Fueled<ItemEntity> {
    let fueled = this.components.fueled;
    if (fueled) {
      return fueled;
    }
    fueled = addComponent(this, 'fueled', Fueled<ItemEntity>, this.components.perishable.scheduler);
    this.fueledState.set(fueled);
    return fueled;
  }
  /** perishable.lua's world, whose game-time scheduler also runs this item's fueled task. */
  BindPerishWorld(world: PerishWorld): void {
    this.components.perishable.BindWorld(world);
    this.BindScheduler(world.scheduler);
    // The item's components and runtimes keep their game-time tasks on the world it joins.
    for (const component of [...Object.values(this.components), ...this.runtime.values()]) {
      (component as Partial<ItemRuntimeComponent> | undefined)?.BindScheduler?.(world.scheduler);
    }
  }
  BindTemperatureWorld(world: TemperatureWorld): void {
    this.temperatureWorld = world;
    this.components.temperature?.BindWorld(world);
  }
  spelltype?: string;
  _cached_reskinname?: Map<string, string | undefined>;
  castsound?: import('../../prefab/src/sound').SoundEventPath;
  projectiledelay?: number;
  /** staff.lua blue_common: inst.icestaff_coldness, the coldness each hit adds. */
  icestaff_coldness?: number;
  fxcolour?: readonly [number, number, number];
  /** books.lua inst.def, inst.swap_build and inst.swap_prefix, read by SGwilson's book state. */
  def?: import('../../stategraphs/src/bufferedaction').BookDef;
  swap_build?: string;
  swap_prefix?: string;
  /** AnimState:GetSkinBuild, set by the prefab whose skins a stategraph overrides on the doer. */
  GetSkinBuild?(): string | undefined;
  private savedPhonographRecord?: string;
  private savedInventory?: InventoryStack[];
  /** Compatibility projection; the prefab's inventory owns the live record. */
  get phonographRecord(): string | undefined {
    return this.components.phonograph ? this.components.phonograph.record : this.savedPhonographRecord;
  }
  private readonly runtime = new Map<string, ItemRuntimeComponent>();
  /** `createItem` makes the insts a backpack loads, through the same SpawnPrefab as this one. */
  constructor(state: InventoryStack, perishWorld: PerishWorld | undefined, createItem: ItemSpawner) {
    super(state.itemId, new SpriteState({ name: state.itemId, none: true }));
    this.entityId = state.entityId ?? newItemEntityId();
    this.wetState.set(state.wet ?? false);
    addComponent(this, 'stackable', StackableComponent, state.count);
    addComponent(this, 'finiteuses', FiniteUsesComponent, state.remainingUses);
    addComponent(this, 'inventoryitem', InventoryItem<ItemEntity, ItemOwner, HeldSlot>);
    addComponent(this, 'inspectable', Inspectable);
    addComponent(this, 'perishable', Perishable, readonlySignal(this.wetState), perishWorld);
    this.durability = createMemo(
      () =>
        this.components.finiteuses.percent.get() ??
        this.fueledState.get()?.percent.get() ??
        this.armorState.get()?.percent.get(),
    );
    this.freshness = createMemo(() =>
      this.components.perishable.perishtime.get() === undefined
        ? this.freshnessState.get()
        : this.components.perishable.percent.get(),
    );
    if (this.prefab === 'backpack') {
      // container:OnLoad's GiveItem: each loaded inst is SpawnPrefab'd, then OnPutInInventory takes it out of the scene.
      const held = (child: ItemEntity) => {
        child.RemoveFromScene();
        return child;
      };
      const container = addComponent(
        this,
        'container',
        Container<InventoryStack, ItemEntity, StorageSlot>,
        () => new StorageSlot(),
        (item: InventoryStack) => held(createItem(item.itemId, stackRecord(item))),
        (record: HeldEntityRecord) => held(createItem(record.prefab, record)),
      );
      container.SetNumSlots(BACKPACK_SLOT_COUNT);
      container.LoadSnapshot(state.container ?? {});
    }
    this.apply(state);
  }

  /**
   * EntityScript:GetPersistData: each component's OnSave under its name (stackable, finiteuses, perishable, fueled, armor,
   * temperature, container, inventory, …), the item's moisture and heatrock.lua's extremes, then the prefab's OnSave.
   */
  override GetPersistData(): EntityPersistData {
    this.flush();
    const data = super.GetPersistData();
    if (this.wetState.value && !data.inventoryitemmoisture) {
      data.inventoryitemmoisture = { wet: true };
    }
    if (this.highTemp !== undefined) {
      data.highTemp = Math.ceil(this.highTemp);
    } else if (this.lowTemp !== undefined) {
      data.lowTemp = Math.floor(this.lowTemp);
    }
    if (this.variant !== undefined) {
      data.groundVariant = this.variant;
    }
    // Components the prefab has not attached yet keep the state they were loaded with.
    if (!this.components.fueled && this.savedFuel !== undefined) {
      data.fueled = { fuel: this.savedFuel };
    }
    if (!this.components.armor && this.savedArmor) {
      data.armor = this.savedArmor;
    }
    if (!this.components.temperature && this.savedTemperature) {
      data.temperature = this.savedTemperature;
    }
    for (const loaded of [this.pendingPersist, this.unattached]) {
      if (loaded) {
        for (const [name, saved] of Object.entries(loaded)) {
          if (!(name in data)) {
            Reflect.set(data, name, saved);
          }
        }
      }
    }
    return data;
  }

  /**
   * After the common OnPreLoad, a runtime `stack` restores the inventory's stack. A saved record loads its stack, uses, moisture and
   * ground variant at once; the components and OnLoad of the item's prefab, which `configure` attaches after SpawnPrefab,
   * load once it has run, as SetPersistData follows the prefab's fn in Lua.
   */
  protected override LoadPersistedData(data: EntityPersistData): void {
    if (data.stack) {
      this.apply({ ...data.stack, itemId: this.prefab, entityId: this.id });
      if (data.stack.container) {
        this.components.container?.LoadSnapshot(data.stack.container);
      }
      this.OnLoad?.(this, data);
      return;
    }
    if (data.stackable) {
      this.components.stackable.OnLoad(data.stackable);
    }
    if (data.finiteuses) {
      this.components.finiteuses.OnLoad(data.finiteuses);
    }
    if (data.inventoryitemmoisture?.wet) {
      this.wetState.set(true);
    }
    if (data.groundVariant !== undefined) {
      this.variant = data.groundVariant;
    }
    if (data.highTemp !== undefined) {
      this.highTemp = data.highTemp;
      this.lowTemp = undefined;
    } else if (data.lowTemp !== undefined) {
      this.lowTemp = data.lowTemp;
      this.highTemp = undefined;
    }
    const { stackable: _stackable, finiteuses: _finiteuses, ...rest } = data;
    this.pendingPersist = rest;
    if (this.configured) {
      this.loadPending();
    }
  }
  private pendingPersist?: EntityPersistData;
  /** Saved records of components the prefab attaches after configuring, as the mole its world's inventory. */
  private unattached?: Record<string, unknown>;
  private configured = false;
  /** The saved components' OnLoad once the prefab has attached them, then the prefab's OnLoad. */
  private loadPending(): void {
    const data = this.pendingPersist;
    if (!data) {
      return;
    }
    this.pendingPersist = undefined;
    super.LoadPersistedData(data);
  }

  protected override LoadPersistedComponent(name: string, saved: unknown): void {
    if (Reflect.get(this.components, name)) {
      super.LoadPersistedComponent(name, saved);
    } else if (isComponentRecord(name)) {
      (this.unattached ??= {})[name] = saved;
    }
  }

  /** A component the prefab attaches late loads the record it was saved with. */
  onComponentAdded(name: string): void {
    if (!this.unattached || !(name in this.unattached)) {
      return;
    }
    const saved = this.unattached[name];
    delete this.unattached[name];
    super.LoadPersistedComponent(name, saved);
  }

  GetIsWet(): boolean {
    return this.wetState.value;
  }
  getComponent<T extends ItemRuntimeComponent>(name: string): T | undefined {
    return this.runtime.get(name) as T | undefined;
  }
  snapshot(includeIdentity = true): InventoryStack {
    const inventory = this.components.inventory?.GetSnapshot() ?? this.savedInventory;
    const temperature = this.components.temperature?.OnSave() ?? this.savedTemperature;
    const armor = this.components.armor ? this.components.armor.OnSave() : this.savedArmor;
    const freshness =
      this.components.perishable.perishtime.value === undefined
        ? this.freshnessState.value
        : this.components.perishable.GetPercent();
    const mole =
      this.getComponent<ItemRuntimeComponent & { OnSave(): NonNullable<InventoryStack['mole']> }>('mole')?.OnSave() ??
      this.mole;
    const lightflier =
      this.getComponent<ItemRuntimeComponent & { OnSave(): NonNullable<InventoryStack['lightflier']> }>(
        'lightflier',
      )?.OnSave() ?? this.lightflier;
    const remainingFuel = this.components.fueled ? this.components.fueled.OnSave()?.fuel : this.savedFuel;
    return {
      ...(lightflier === undefined ? {} : { lightflier }),
      ...(mole === undefined ? {} : { mole }),
      ...(temperature === undefined ? {} : { temperature }),
      ...(armor === undefined ? {} : { armor }),
      ...(this.highTemp === undefined ? {} : { highTemp: Math.ceil(this.highTemp) }),
      ...(this.lowTemp === undefined ? {} : { lowTemp: Math.floor(this.lowTemp) }),
      ...(includeIdentity ? { entityId: this.id } : {}),
      itemId: this.prefab,
      count: this.components.stackable.count,
      ...(this.skinId === undefined ? {} : { skinId: this.skinId }),
      ...(this.variant === undefined ? {} : { variant: this.variant }),
      ...(remainingFuel === undefined ? {} : { remainingFuel }),
      ...(this.components.finiteuses.remaining === undefined
        ? {}
        : { remainingUses: this.components.finiteuses.remaining }),
      ...(freshness === undefined ? {} : { freshnessPercent: freshness }),
      ...(this.wetState.value ? { wet: true } : {}),
      ...(this.phonographRecord === undefined ? {} : { phonographRecord: this.phonographRecord }),
      ...(inventory?.length ? { inventory } : {}),
      ...(this.components.container === undefined ? {} : { container: this.components.container.GetSnapshot() }),
    };
  }

  /** Store commits call this only after the complete transaction has been validated. */
  apply(state: InventoryStack): void {
    if (state.itemId !== this.prefab || this.isRemoved) {
      throw new Error('Cannot change a removed entity or its prefab');
    }
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
    this.savedPhonographRecord = state.phonographRecord;
    this.savedInventory = state.inventory;
    this.savedArmor = state.armor;
    const armor = this.components.armor;
    if (armor && state.armor && state.armor.condition !== armor.condition.value) {
      armor.OnLoad(state.armor);
    }
    batch(() => {
      this.components.stackable.count = state.count;
      const fueled = this.components.fueled;
      // fueled.lua OnSave omits a full inst.
      if (!fueled) {
        this.savedFuel = state.remainingFuel;
      } else if ((state.remainingFuel ?? fueled.maxfuel) !== fueled.currentfuel) {
        fueled.OnLoad({ fuel: state.remainingFuel ?? fueled.maxfuel });
      }
      this.components.finiteuses.remaining = state.remainingUses;
      if (this.components.perishable.perishtime.value === undefined) {
        this.freshnessState.set(state.freshnessPercent);
      } else if (state.freshnessPercent !== undefined) {
        this.components.perishable.SetPercent(state.freshnessPercent);
      }
      this.wetState.set(state.wet ?? false);
    });
  }

  configure(
    spec: Pick<
      InventoryItemSpec,
      'maxUses' | 'maxFuel' | 'perishTime' | 'perishReplacement' | 'equippable' | 'canGoInContainer' | 'configureEntity'
    >,
  ): void {
    if (spec.equippable) {
      addComponent(this, 'equippable', Equippable<ItemEntity>, spec.equippable).equipslot = spec.equippable;
    }
    this.components.inventoryitem.cangoincontainer = spec.canGoInContainer !== false;
    batch(() => {
      if (spec.maxUses !== undefined) {
        this.components.finiteuses.setMaxUses(spec.maxUses);
      }
      const perishable = this.components.perishable;
      if (spec.perishTime !== undefined && perishable.perishtime.value === undefined) {
        // SetPerishTime starts full; a stack's saved/transferred percent then restores perishremainingtime.
        const saved = this.freshnessState.value;
        perishable.SetPerishTime(spec.perishTime);
        if (saved !== undefined) {
          perishable.SetPercent(saved);
        }
        this.freshnessState.set(undefined);
        perishable.onperishreplacement = spec.perishReplacement;
        perishable.StartPerishing();
      }
    });
    spec.configureEntity?.(this);
    this.configured = true;
    // fueled.lua OnLoad runs after the prefab's InitializeFuelLevel.
    if (this.components.fueled && this.savedFuel !== undefined) {
      this.components.fueled.OnLoad({ fuel: this.savedFuel });
      this.savedFuel = undefined;
    }
    // armor.lua OnLoad runs after the prefab's InitCondition.
    const armor = this.components.armor;
    if (armor && this.armorState.value !== armor) {
      this.armorState.set(armor);
      if (this.savedArmor) {
        armor.OnLoad(this.savedArmor);
      }
    }
    this.loadPending();
  }

  /** Component adapters publish itemtile's perishchange / wetnesschange state. */
  setFreshnessPercent(percent: number): boolean {
    if (this.isRemoved || !Number.isFinite(percent)) {
      return false;
    }
    if (this.components.perishable.perishtime.value === undefined) {
      this.freshnessState.set(Math.max(0, Math.min(1, percent)));
    } else {
      this.components.perishable.SetPercent(percent);
    }
    return true;
  }
  /**
   * inventoryitemmoisture:MakeMoistureAtLeast(min): the item is wet once `min` is above TUNING.MOISTURE_DRY_THRESHOLD;
   * the moisture value itself is not kept, only whether the item is wet.
   */
  MakeMoistureAtLeast(min: number): void {
    if (min > MOISTURE_DRY_THRESHOLD) {
      this.setWet(true);
    }
  }
  setWet(wet: boolean): boolean {
    if (this.isRemoved || typeof wet !== 'boolean') {
      return false;
    }
    this.wetState.set(wet);
    return true;
  }

  /** fueled.lua DoDelta to `seconds`, after settling elapsed consumption; depletion belongs to the prefab's callbacks. */
  setRemainingFuel(seconds: number): boolean {
    const fueled = this.components.fueled;
    if (this.isRemoved || !fueled || !Number.isFinite(seconds) || seconds < 0) {
      return false;
    }
    fueled.Settle();
    if (!this.isRemoved) {
      fueled.DoDelta(seconds - fueled.currentfuel);
    }
    return true;
  }

  component<T extends ItemRuntimeComponent>(name: string, create: () => T): T {
    if (this.isRemoved) {
      throw new Error('Cannot attach a component to a removed entity');
    }
    let component = this.runtime.get(name);
    if (!component) {
      component = create();
      this.runtime.set(name, component);
    }
    return component as T;
  }

  flush(): void {
    this.components.perishable.flush();
    this.components.fueled?.Settle();
    this.components.container?.flush();
    for (const component of this.runtime.values()) {
      component.flush?.();
    }
  }
  override remove(): boolean {
    if (this.isRemoved) {
      return false;
    }
    const slot = this.components.inventoryitem.slot;
    if (slot) {
      return slot.remove();
    }
    this.destroy();
    return true;
  }
  destroy(): void {
    if (this.isRemoved) {
      return;
    }
    this.flush();
    if (this.isRemoved) {
      return;
    }
    // EntityScript:Remove pushes onremove first.
    super.remove();
    this.components.inventoryitem.owner = null;
    this.miniMapEntity?.dispose();
    for (const component of this.runtime.values()) {
      component.dispose();
    }
    this.runtime.clear();
    this.tileMemo?.dispose();
    this.durability.dispose();
    this.freshness.dispose();
  }
}

/** The records an item's components write; the rest of its data is its prefab's own OnSave. */
const ITEM_COMPONENT_RECORDS = new Set([
  'perishable',
  'fueled',
  'armor',
  'temperature',
  'container',
  'inventory',
  'health',
  'knownlocations',
  'workable',
]);
function isComponentRecord(name: string): boolean {
  return ITEM_COMPONENT_RECORDS.has(name);
}

/** What SpawnSaveRecord gives an item's SpawnPrefab: its identity, GetPersistData and skin. */
export interface SpawnedItemRecord {
  id: string;
  components: EntityPersistData;
  skinname?: string;
}

/**
 * SpawnPrefab of an item, then SetPersistData: the prefab's inst, in the world it was spawned into. A runtime stack
 * travels as the record's `stack` (`stackRecord`); a saved item as its own record.
 */
export type ItemSpawner = (prefab: string, saved: SpawnedItemRecord) => ItemEntity;

/** The record of an item made from the inventory's runtime stack. */
export function stackRecord(state: InventoryStack): SpawnedItemRecord {
  return { id: state.entityId ?? newItemEntityId(), components: { stack: state } };
}

/**
 * How an item prefab's fn makes its inst: the prefab's own ItemEntity subclass, built with the registry's world and the
 * SpawnPrefab its containers load through.
 */
export type ItemEntityFactory<Entity extends ItemEntity = ItemEntity> = (
  state: InventoryStack,
  perishWorld: PerishWorld | undefined,
  createItem: ItemSpawner,
) => Entity;

/** Each item prefab's own ItemEntity subclass, by item id; the prefab module registers it where it defines it. */
const itemEntityClasses = new Map<string, ItemEntityFactory>();

/** The item prefab declares that every `itemId` inst is made by `factory`, wherever the inventory constructs one. */
export function registerItemEntityClass(itemId: string, factory: ItemEntityFactory): void {
  if (itemEntityClasses.has(itemId)) {
    throw new Error(`Item entity class already registered: ${itemId}`);
  }
  itemEntityClasses.set(itemId, factory);
}

/** An `itemId` inst as its prefab makes it: its registered subclass, or a plain ItemEntity. */
export function newItemEntity(
  state: InventoryStack,
  perishWorld: PerishWorld | undefined,
  createItem: ItemSpawner,
): ItemEntity {
  const factory = itemEntityClasses.get(state.itemId);
  return factory ? factory(state, perishWorld, createItem) : new ItemEntity(state, perishWorld, createItem);
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
    for (const icon of this.miniMapIcons) {
      if (icon.enabled) {
        icons.push(icon);
      }
    }
    return icons;
  }
  private register(entity: ItemEntity): void {
    this.entities.set(entity.id, entity);
    if (entity.components.container) {
      this.containerEntities.set(entity.id, entity);
    }
    if (this.entityCleanups.has(entity)) {
      return;
    }
    const addIcon = () => {
      if (entity.MiniMapEntity) {
        this.miniMapIcons.add(entity.MiniMapEntity);
      }
    };
    addIcon();
    const stopAdded = entity.ListenForEvent('minimapentityadded', addIcon);
    const stopRemoved = entity.ListenForEvent('onremove', () => this.unregister(entity));
    this.entityCleanups.set(entity, () => {
      stopAdded();
      stopRemoved();
      if (entity.MiniMapEntity) {
        this.miniMapIcons.delete(entity.MiniMapEntity);
      }
    });
  }
  private unregister(entity: ItemEntity): void {
    this.entityCleanups.get(entity)?.();
    this.entityCleanups.delete(entity);
    if (this.entities.get(entity.id) === entity) {
      this.entities.delete(entity.id);
    }
    if (this.containerEntities.get(entity.id) === entity) {
      this.containerEntities.delete(entity.id);
    }
  }
  private perishWorld?: PerishWorld;
  private temperatureWorld?: TemperatureWorld;
  bindTemperatureWorld(world: TemperatureWorld): void {
    this.temperatureWorld = world;
    for (const entity of this.values()) {
      entity.BindTemperatureWorld(world);
    }
  }
  /** Existing, newly created, adopted and nested entities share the current world's integral. */
  bindPerishWorld(world: PerishWorld): void {
    // The perished inst's onperishreplacement is SpawnPrefab'd through this registry, as any other item.
    this.perishWorld = {
      ...world,
      SpawnPrefab: world.SpawnPrefab ?? (prefab => this.create({ itemId: prefab, count: 1 })),
    };
    world = this.perishWorld;
    for (const entity of this.values()) {
      entity.BindPerishWorld(world);
      for (const slot of entity.components.container?.slots ?? []) {
        const child = slot.getEntity();
        if (child) {
          this.adopt(child);
        }
      }
    }
  }
  /**
   * `spawn` is the world's SpawnPrefab for an item: every inst this registry creates is spawned through it, so it is its
   * prefab's inst in that world from its birth and only leaves and re-enters the scene. There is no other way to make one.
   */
  private readonly spawner: ItemSpawner;
  constructor(spawner: ItemSpawner) {
    this.spawner = spawner;
  }
  /** The item prefab's own construction, bound to this registry's worlds but not yet registered. */
  construct(state: InventoryStack): ItemEntity;
  construct<Entity extends ItemEntity>(state: InventoryStack, factory: ItemEntityFactory<Entity>): Entity;
  construct(state: InventoryStack, factory: ItemEntityFactory = newItemEntity): ItemEntity {
    const entity = factory(state, this.perishWorld, (prefab, saved) => this.spawn(prefab, saved));
    if (this.temperatureWorld) {
      entity.BindTemperatureWorld(this.temperatureWorld);
    }
    return entity;
  }
  /** SpawnPrefab of an item from the inventory's runtime stack. */
  create(state: InventoryStack): ItemEntity {
    return this.spawn(state.itemId, stackRecord(state));
  }
  /** SpawnSaveRecord of an item a container or inventory held: container.lua / inventory.lua OnLoad. */
  restore(record: HeldEntityRecord): ItemEntity {
    return this.spawn(record.prefab, record);
  }
  /**
   * An inst constructed outside a world (a held building, a test) and given its record as SpawnSaveRecord does:
   * the skin, then SetPersistData.
   */
  constructSaved(prefab: string, saved: SpawnedItemRecord): ItemEntity {
    const entity = this.construct({ itemId: prefab, count: 1, entityId: saved.id });
    if (saved.skinname !== undefined) {
      entity.skinId = saved.skinname;
    }
    entity.SetPersistData(saved.components);
    return entity;
  }
  private spawn(prefab: string, saved: SpawnedItemRecord): ItemEntity {
    if (this.get(saved.id)) {
      throw new Error(`Duplicate item entity: ${saved.id}`);
    }
    const entity = this.spawner(prefab, saved);
    this.register(entity);
    return entity;
  }
  get(id: string): ItemEntity | undefined {
    const entity = this.entities.get(id);
    if (entity?.isRemoved) {
      this.unregister(entity);
      return undefined;
    }
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
    if (entity.isRemoved || (existing && existing !== entity)) {
      throw new Error(`Invalid item entity: ${entity.id}`);
    }
    if (this.perishWorld) {
      entity.BindPerishWorld(this.perishWorld);
    }
    if (this.temperatureWorld) {
      entity.BindTemperatureWorld(this.temperatureWorld);
    }
    this.register(entity);
    for (const slot of entity.components.container?.slots ?? []) {
      const child = slot.getEntity();
      if (child) {
        this.adopt(child);
      }
    }
    for (const child of entity.components.inventory?.GetItems() ?? []) {
      this.adopt(child);
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
    for (const cleanup of this.entityCleanups.values()) {
      cleanup();
    }
    this.entityCleanups.clear();
    this.miniMapIcons.clear();
    this.perishWorld = undefined;
    this.temperatureWorld = undefined;
  }
}
