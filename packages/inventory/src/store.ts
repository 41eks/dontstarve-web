import { ItemEntity, ItemEntityRegistry } from './entity';
import { planCraft } from './craft';
import {
  batch, createEquipmentExistenceState, readonlySignal,
  type Equipment, type EquipmentSlot, type HandEquipment, type HeadEquipment, type BodyEquipment, type ReadonlySignal, type Signal,
} from '@dontstarve-web/signals';
import { EQUIPMENT_KINDS, equipmentSlotAddress, cursorSlotAddress, PLAYER_CURSOR_CONTAINER_ID, backpackContainerId, backpackSlotAddress, isBackpackContainerId, PLAYER_EQUIPMENT_CONTAINER_ID, BACKPACK_SLOT_COUNT } from './addresses';
import { InventorySlot, StorageSlot, type ItemSlot } from './slots';
import { PreparedFoodSlot } from './preparedFoodSlot';
import type { Container } from '../../componets/src/container';
import type {
  EquipmentKind,
  InventoryItemSpec,
  InventoryItemSignals,
  InventoryListener,
  InventoryReceiveListener,
  InventoryMaterialSummary,
  InventoryRecipeDefinition,
  InventorySkinSpec,
  InventorySlotDelta,
  InventoryStack,
  SlotRegistration,
  SlotAddress,
  InventoryState,
} from './types';

export interface EquipmentExistenceStates {
  handEquipmentExistenceState?: Signal<HandEquipment | null>;
  headEquipmentExistenceState?: Signal<HeadEquipment | null>;
  bodyEquipmentExistenceState?: Signal<BodyEquipment | null>;
}

function changedEquipmentKinds(addresses: readonly SlotAddress[]): EquipmentKind[] {
  return EQUIPMENT_KINDS.filter(kind => addresses.some(address =>
    addressKey(address) === addressKey(equipmentSlotAddress(kind))));
}

type RegisteredItemSlot = SlotRegistration<ItemSlot>;
type RegisteredInventorySlot = SlotRegistration<InventorySlot>;

function addressKey(address: SlotAddress): string {
  return `${address.containerId}\n${address.slotKey}`;
}

function cloneAddress(address: SlotAddress): SlotAddress {
  return { ...address };
}

function isSameStack(stack: InventoryStack, itemId: string, skinId?: string): boolean {
  return stack.itemId === itemId && stack.skinId === skinId;
}

function stacksEqual(left: InventoryStack | null, right: InventoryStack | null): boolean {
  return left === null
    ? right === null
    : right !== null
      && left.itemId === right.itemId
      && left.skinId === right.skinId
      && left.remainingUses === right.remainingUses
      && left.remainingFuel === right.remainingFuel
      && left.freshnessPercent === right.freshnessPercent
      && left.wet === right.wet
      && left.phonographRecord === right.phonographRecord
      && left.count === right.count;
}

export class InventoryStore {
  private actor: import('../../componets/src/inventoryitem').InventoryActor = {
    hasTag: tag => tag === 'player', GetPosition: () => ({ x: 0, y: 0, z: 0 }), PushEvent() {},
  };
  private readonly receipts = new Set<(received: readonly InventorySlotDelta[], source?: import('../../componets/src/inventoryitem').ItemPosition) => void>();
  private readonly drops = new Set<(entity: ItemEntity) => void>();

  bindActor(actor: import('../../componets/src/inventoryitem').InventoryActor): void { this.actor = actor; }
  configureItem(entity: ItemEntity): void { entity.configure(this.requireItemSpec(entity.prefab)); }
  subscribeReceived(listener: (received: readonly InventorySlotDelta[], source?: import('../../componets/src/inventoryitem').ItemPosition) => void): () => void {
    this.receipts.add(listener); return () => { this.receipts.delete(listener); };
  }
  subscribeDropped(listener: (entity: ItemEntity) => void): () => void {
    this.drops.add(listener); return () => { this.drops.delete(listener); };
  }
  GetNumSlots(): number { return this.inventorySlots().length; }
  GetActiveItem(): ItemEntity | null { return this.getEntity(cursorSlotAddress()); }
  GetEquippedItem(kind: EquipmentKind): ItemEntity | null { return this.getEntity(equipmentSlotAddress(kind)); }
  Unequip(kind: EquipmentKind): ItemEntity | null {
    const entity = this.GetEquippedItem(kind);
    return entity ? this.extract(equipmentSlotAddress(kind), entity.components.stackable.count, entity) : null;
  }
  /** inventory.lua FindItem: item slots and the equipped backpack, never equipment or the cursor. */
  FindItem(test: (item: ItemEntity) => boolean): ItemEntity | null {
    for (const { address, slot } of this.registrations) {
      if (address.containerId === PLAYER_EQUIPMENT_CONTAINER_ID || address.containerId === PLAYER_CURSOR_CONTAINER_ID) continue;
      const entity = slot.getEntity();
      if (entity && !entity.isRemoved && test(entity)) return entity;
    }
    return null;
  }
  /** inventory.lua Equip of an item that currently sits in an inventory slot. */
  EquipFromInventory(entity: ItemEntity): boolean {
    const owner = entity.components.inventoryitem.owner;
    if (!owner || !entity.components.equippable || this.GetEquippedItem(entity.components.equippable.equipslot)) return false;
    const taken = this.extract(owner.address, 1, entity);
    if (!taken) return false;
    if (this.Equip(taken)) return true;
    this.receive(taken);
    return false;
  }
  Equip(entity: ItemEntity): boolean {
    this.configureItem(entity);
    const kind = entity.components.equippable?.equipslot;
    if (!kind || entity.isRemoved || entity.components.inventoryitem.owner || this.GetEquippedItem(kind)) return false;
    this.entities.adopt(entity);
    const state = entity.snapshot(), slot = equipmentSlotAddress(kind);
    const spec = this.requireItemSpec(entity.prefab), registration = this.registrationByAddress.get(addressKey(slot));
    if (!registration || state.count !== 1 || !registration.slot.accepts(spec, entity.prefab)
      || !this.validUses(state, spec) || !this.validRecord(state)) return false;
    const next = this.snapshot(); next.set(addressKey(slot), state);
    this.commit(next);
    entity.components.inventoryitem.OnPutInInventory(this.actor);
    this.notify([slot], [kind]);
    for (const listener of this.receipts) listener([{ ...state, slot, delta: state.count }]);
    return true;
  }
  DropItem(entity: ItemEntity, dropPosition?: import('../../componets/src/inventoryitem').ItemPosition): void {
    const owner = entity.components.inventoryitem.owner;
    if (owner && this.extract(owner.address, entity.components.stackable.count, entity) !== entity) return;
    const position = dropPosition ?? this.actor.GetPosition();
    entity.transform.position.set(position.x, 0, position.z);
    entity.PushEvent('ondropped', undefined);
    for (const listener of this.drops) listener(entity);
  }
  /** Calls the pickup hook, allocates slots and drops leftovers; a full inventory still handles the item. */
  GiveItem(entity: ItemEntity, source?: import('../../componets/src/inventoryitem').ItemPosition): boolean {
    if (entity.isRemoved || entity.components.inventoryitem.owner) return false;
    entity.flush();
    if (entity.isRemoved) return false;
    this.configureItem(entity);
    if (entity.components.inventoryitem.OnPickup(this.actor, source)) return true;
    if (entity.isRemoved) return true;
    const state = entity.snapshot(), spec = this.requireItemSpec(entity.prefab);
    const slots = this.receptionSlots();
    const capacity = slots.reduce((total, { slot }) => {
      const stack = slot.get();
      return total + (!stack || isSameStack(stack, state.itemId, state.skinId)
        ? Math.max(0, Math.min(spec.maxStack, slot.maxStack?.(state.itemId) ?? spec.maxStack) - (stack?.count ?? 0)) : 0);
    }, 0);
    const count = Math.min(state.count, capacity);
    if (count === 0) { this.DropItem(entity); return true; }
    const incoming = count === state.count ? entity : this.entities.create({ ...state, entityId: undefined, count });
    const received = this.receiveToSlots(incoming, slots, allocations => {
      for (const listener of this.receipts) listener(allocations, source);
    });
    if (!received) { if (incoming !== entity) this.entities.destroy(incoming); return false; }
    if (count < state.count) {
      entity.apply({ ...state, count: state.count - count });
      this.DropItem(entity);
    }
    return true;
  }
  readonly handEquipmentExistenceState: Signal<HandEquipment | null>;
  readonly handEquipment: ReadonlySignal<HandEquipment | null>;
  readonly headEquipmentExistenceState: Signal<HeadEquipment | null>;
  readonly headEquipment: ReadonlySignal<HeadEquipment | null>;
  readonly bodyEquipmentExistenceState: Signal<BodyEquipment | null>;
  readonly bodyEquipment: ReadonlySignal<BodyEquipment | null>;
  readonly entities: ItemEntityRegistry;
  private readonly bufferedBuilds = new Map<string, string | undefined>();
  private readonly itemSpecs = new Map<string, InventoryItemSpec>();
  private readonly listeners = new Set<InventoryListener>();
  private readonly accessibleStorageContainerIds = new Set<string>();
  private readonly worldContainers = new Map<string, Container<InventoryStack, ItemEntity, ItemSlot>>();
  private readonly skinSpecs: Readonly<Record<string, InventorySkinSpec>>;
  private readonly registrationByAddress = new Map<string, RegisteredItemSlot>();
  private readonly registrations: RegisteredItemSlot[] = [];

  constructor(
    registrations: readonly RegisteredItemSlot[],
    itemSpecs: Readonly<Record<string, InventoryItemSpec>>,
    skinSpecs: Readonly<Record<string, InventorySkinSpec>> = {},
    entities = new ItemEntityRegistry(),
    equipmentExistenceStates: EquipmentExistenceStates = {},
  ) {
    this.handEquipmentExistenceState = equipmentExistenceStates.handEquipmentExistenceState ?? createEquipmentExistenceState('HANDS');
    this.headEquipmentExistenceState = equipmentExistenceStates.headEquipmentExistenceState ?? createEquipmentExistenceState('HEAD');
    this.bodyEquipmentExistenceState = equipmentExistenceStates.bodyEquipmentExistenceState ?? createEquipmentExistenceState('BODY');
    this.handEquipment = readonlySignal(this.handEquipmentExistenceState);
    this.headEquipment = readonlySignal(this.headEquipmentExistenceState);
    this.bodyEquipment = readonlySignal(this.bodyEquipmentExistenceState);
    this.entities = entities;
    this.skinSpecs = skinSpecs;
    Object.entries(itemSpecs).forEach(([itemId, spec]) => this.itemSpecs.set(itemId, spec));
    this.registerSlots(registrations);
  }

  registerSlots(registrations: readonly RegisteredItemSlot[]): void {
    const pendingKeys = new Set<string>();
    const entityIds = new Set(this.registrations.flatMap(({ slot }) => slot.getEntity() ? [slot.getEntity()!.id] : []));
    const pending = registrations.map(({ address, slot }) => ({
      address: cloneAddress(address),
      slot,
    }));
    for (const registration of pending) {
      const { address, slot } = registration;
      const key = addressKey(address);
      if (this.registrationByAddress.has(key) || pendingKeys.has(key)) {
        throw new RangeError(`Duplicate slot address: ${key}`);
      }
      pendingKeys.add(key);
      const stack = slot.get();
      if (!stack) continue;
      const entity = slot.getEntity()!;
      if (entity.isRemoved || entity.components.inventoryitem.owner || entityIds.has(entity.id)
        || (this.entities.get(entity.id) && this.entities.get(entity.id) !== entity)) {
        throw new Error(`Invalid or duplicate initial item entity: ${entity.id}`);
      }
      entityIds.add(entity.id);
      const spec = this.requireItemSpec(stack.itemId);
      if (!Number.isSafeInteger(stack.count)
        || stack.count <= 0
        || stack.count > Math.min(spec.maxStack, slot.maxStack?.(stack.itemId) ?? spec.maxStack)
        || !slot.accepts(spec, stack.itemId) || !this.validUses(stack, spec) || !this.validRecord(stack)) {
        throw new RangeError(`Invalid initial stack for ${stack.itemId} in ${key}`);
      }
    }
    for (const registration of pending) {
      const entity = registration.slot.getEntity();
      if (entity) {
        const spec = this.requireItemSpec(entity.prefab);
        entity.configure(spec);
        this.entities.adopt(entity);
      }
      this.registrations.push(registration);
      this.registrationByAddress.set(addressKey(registration.address), registration);
    }
    this.syncBackpackContainers();
    this.bindOwners();
    for (const kind of changedEquipmentKinds(pending.map(({ address }) => address))) {
      this.publishEquipmentExistenceState(kind);
    }
  }

  registerContainer(containerId: string, container: Container<InventoryStack, ItemEntity, ItemSlot>,
    saved?: { slots: readonly { slotKey: string; item: InventoryStack }[] }): void {
    const existing = container.slots.map((_, index) => this.registrationByAddress.get(addressKey({ containerId, slotKey: String(index) })));
    if (existing.some(Boolean)) {
      if (existing.some(slot => !slot)) throw new Error('Partially registered world container');
      container.BindSlots(existing.map(slot => slot!.slot));
    } else {
      if (saved) container.OnLoad({ items: Object.fromEntries(saved.slots.map(({ slotKey, item }) => [String(Number(slotKey) + 1), item])) });
      this.registerSlots(container.slots.map((slot, index) => ({ address: { containerId, slotKey: String(index) }, slot })));
    }
    this.worldContainers.set(containerId, container);
    container.dropItem = (entity, slot, position) => {
      const address = { containerId, slotKey: String(slot - 1) };
      const item = this.extract(address, entity.components.stackable.count, entity);
      if (!item) return;
      item.transform.position.set(position.x, position.y, position.z);
      this.DropItem(item, position);
    };
  }

  getContainer(containerId: string): Container<InventoryStack, ItemEntity, ItemSlot> | undefined {
    return this.worldContainers.get(containerId);
  }

  unregisterContainer(containerId: string, container: Container<InventoryStack, ItemEntity, ItemSlot>): void {
    if (this.worldContainers.get(containerId) !== container) return;
    container.DestroyContents();
    container.dropItem = undefined;
    const removed = this.registrations.filter(registration => registration.address.containerId === containerId);
    for (const registration of removed) this.registrationByAddress.delete(addressKey(registration.address));
    for (let index = this.registrations.length - 1; index >= 0; index--) {
      if (this.registrations[index].address.containerId === containerId) this.registrations.splice(index, 1);
    }
    this.worldContainers.delete(containerId);
    this.accessibleStorageContainerIds.delete(containerId);
    this.notify(removed.map(registration => registration.address));
  }

  subscribe(listener: InventoryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.listeners.clear();
    this.entities.dispose();
  }

  /** Exports detached domain data, including inaccessible storage and buffered builds. */
  exportState(): InventoryState {
    for (const { slot } of this.registrations) slot.getEntity()?.flush();
    return {
      slots: this.registrations.filter(({ address }) => !isBackpackContainerId(address.containerId)).map(({ address, slot }) => {
        return { address: cloneAddress(address), item: slot.getEntity()?.snapshot() ?? null };
      }),
      bufferedBuilds: [...this.bufferedBuilds].map(([recipeId, skinId]) => ({
        recipeId, ...(skinId === undefined ? {} : { skinId }),
      })),
    };
  }

  /** Validates the whole replacement before updating any slots or notifying UI. */
  replaceState(
    state: InventoryState,
    recipes: Readonly<Record<string, InventoryRecipeDefinition>>,
  ): void {
    const next = new Map<string, InventoryStack | null>(
      this.registrations.map(({ address }) => [addressKey(address), null]),
    );
    const seen = new Set<string>();
    const entityIds = new Set<string>();
    const validateSkin = (itemId: string, skinId?: string) => {
      if (skinId === undefined) return;
      const skin = Object.hasOwn(this.skinSpecs, skinId) ? this.skinSpecs[skinId] : undefined;
      if (!skin || (skin.itemId !== undefined && skin.itemId !== itemId)) {
        throw new Error(`Invalid skin ${skinId} for ${itemId}`);
      }
    };
    const validateItem = (item: InventoryStack): void => {
      const spec = this.requireItemSpec(item.itemId);
      if (!Number.isSafeInteger(item.count) || item.count < 1 || item.count > spec.maxStack
        || !this.validUses(item, spec) || !this.validRecord(item)) throw new Error('Invalid saved item');
      validateSkin(item.itemId, item.skinId);
      if (item.entityId) {
        if (entityIds.has(item.entityId)) throw new Error(`Duplicate saved item entity: ${item.entityId}`);
        entityIds.add(item.entityId);
      }
      if (item.container !== undefined) {
        if (item.itemId !== 'backpack' || item.container.slotCount !== BACKPACK_SLOT_COUNT
          || item.container.slots.length > BACKPACK_SLOT_COUNT) throw new Error('Invalid item container');
        const keys = new Set<string>();
        for (const { slotKey, item: child } of item.container.slots) {
          if (!/^[0-7]$/.test(slotKey) || keys.has(slotKey) || child.itemId === 'backpack'
            || this.requireItemSpec(child.itemId).canGoInContainer === false) throw new Error('Invalid container slot');
          keys.add(slotKey);
          const existing = child.entityId ? this.entities.get(child.entityId) : undefined;
          if (existing && !this.registrations.some(({ slot }) => slot.getEntity() === existing)) {
            throw new Error(`Item entity already belongs to the world: ${child.entityId}`);
          }
          validateItem(child);
        }
      }
    };
    for (const { address, item } of state.slots) {
      const key = addressKey(address);
      const registration = this.registrationByAddress.get(key);
      if (!registration || seen.has(key)) throw new Error(`Invalid or duplicate saved slot: ${key}`);
      seen.add(key);
      if (item) {
        const spec = this.requireItemSpec(item.itemId);
        if (!Number.isSafeInteger(item.count) || item.count <= 0
          || item.count > Math.min(spec.maxStack, registration.slot.maxStack?.(item.itemId) ?? spec.maxStack)
          || !registration.slot.accepts(spec, item.itemId) || !this.validUses(item, spec) || !this.validRecord(item)) {
          throw new Error(`Invalid saved item in ${key}`);
        }
        validateItem(item);
        const existing = item.entityId ? this.entities.get(item.entityId) : undefined;
        if (existing && !this.registrations.some(({ slot }) => slot.getEntity() === existing)) {
          throw new Error(`Saved item entity already belongs to the world: ${item.entityId}`);
        }
      }
      next.set(key, item ? { ...item } : null);
    }
    const buffered = new Map<string, string | undefined>();
    for (const build of state.bufferedBuilds) {
      const recipe = recipes[build.recipeId];
      if (!recipe?.buffered || buffered.has(build.recipeId)) {
        throw new Error(`Invalid buffered recipe: ${build.recipeId}`);
      }
      validateSkin(recipe.productId, build.skinId);
      buffered.set(build.recipeId, build.skinId);
    }
    this.commit(next, false, true);
    this.bufferedBuilds.clear();
    for (const [id, skin] of buffered) this.bufferedBuilds.set(id, skin);
    this.notify(this.addresses(), EQUIPMENT_KINDS);
  }

  get(address: SlotAddress): InventoryStack | null {
    return this.registrationByAddress.get(addressKey(address))?.slot.get() ?? null;
  }

  getEntity(address: SlotAddress): ItemEntity | null {
    return this.registrationByAddress.get(addressKey(address))?.slot.getEntity() ?? null;
  }

  /** The same read-only component signals follow an item through transfers and drops. */
  getItemSignals(address: SlotAddress): InventoryItemSignals | null {
    return this.getEntity(address)?.signals ?? null;
  }

  /** Return the whole held stack; a rejected destination never consumes the cursor item. */
  returnCursor(preferred?: SlotAddress): boolean {
    const cursor = cursorSlotAddress();
    const entity = this.getEntity(cursor);
    if (!entity) return true;
    entity.flush();
    const count = entity.components.stackable.count;
    const candidates = [...(preferred ? [preferred] : []), ...this.inventorySlots().map(({ address }) => address)];
    return candidates.some(address => this.getEntity(cursor) === entity
      && this.transfer(cursor, address, count, entity.snapshot()));
  }

  /** GiveItem(inst): ownership changes, not the identity/components of the incoming item. */
  receive(entity: ItemEntity, onReceived?: InventoryReceiveListener): boolean {
    return this.receiveToSlots(entity, this.inventorySlots(), onReceived);
  }

  /** Return a rejected detached item to its source slot, including the active cursor. */
  receiveAt(address: SlotAddress, entity: ItemEntity): boolean {
    const registration = this.registrationByAddress.get(addressKey(address));
    return !!registration && this.accessibleBackpackAddress(address) && this.receiveToSlots(entity, [registration]);
  }

  private receiveToSlots(entity: ItemEntity, slots: readonly RegisteredItemSlot[], onReceived?: InventoryReceiveListener): boolean {
    if (entity.isRemoved || entity.components.inventoryitem.owner) return false;
    entity.flush();
    if (entity.isRemoved) return false;
    this.entities.adopt(entity);
    const state = entity.snapshot();
    const spec = this.requireItemSpec(state.itemId), changes: InventorySlotDelta[] = [];
    let remaining = state.count;
    for (const { address, slot } of [...slots.filter(({ slot }) => slot.get()), ...slots.filter(({ slot }) => !slot.get())]) {
      const current = slot.get();
      if (remaining <= 0 || !slot.accepts(spec, state.itemId) || (current && !isSameStack(current, state.itemId, state.skinId))) continue;
      const count = Math.min(remaining, Math.min(spec.maxStack, slot.maxStack?.(state.itemId) ?? spec.maxStack) - (current?.count ?? 0));
      if (count <= 0) continue;
      changes.push({ ...state, slot: address, delta: count });
      remaining -= count;
    }
    if (remaining > 0 || !this.applySlotChanges(changes)) return false;
    entity.components.inventoryitem.OnPutInInventory(this.actor);
    if (!this.registrations.some(({ slot }) => slot.getEntity() === entity)) this.entities.destroy(entity);
    onReceived?.(changes);
    return true;
  }

  /** Equip/container moves use the source inst and its complete component snapshot. */
  transfer(from: SlotAddress, to: SlotAddress, count: number, expected?: Pick<InventoryStack, 'itemId' | 'skinId' | 'entityId'>): boolean {
    if (!Number.isSafeInteger(count) || count <= 0 || addressKey(from) === addressKey(to)
      || !this.accessibleBackpackAddress(from) || !this.accessibleBackpackAddress(to)) return false;
    const entity = this.getEntity(from);
    entity?.flush();
    if (!entity || entity.isRemoved || (expected && (!isSameStack(entity.snapshot(), expected.itemId, expected.skinId)
      || (expected.entityId !== undefined && expected.entityId !== entity.id)))) return false;
    const state = entity.snapshot();
    return this.applySlotChanges([
      { slot: from, entityId: entity.id, itemId: state.itemId, skinId: state.skinId, delta: -count },
      { slot: to, ...state, entityId: count === state.count ? entity.id : undefined, delta: count },
    ]);
  }

  /** Exchange whole entities in one transaction, validating both receiving slots. */
  swap(from: SlotAddress, to: SlotAddress, expected?: {
    from: Pick<InventoryStack, 'entityId' | 'itemId' | 'skinId' | 'count'>;
    to: Pick<InventoryStack, 'entityId' | 'itemId' | 'skinId' | 'count'>;
  }): boolean {
    if (addressKey(from) === addressKey(to)
      || !this.accessibleBackpackAddress(from) || !this.accessibleBackpackAddress(to)) return false;
    const source = this.getEntity(from), target = this.getEntity(to);
    if (!source || !target) return false;
    source.flush(); target.flush();
    if (source.isRemoved || target.isRemoved || this.getEntity(from) !== source || this.getEntity(to) !== target) return false;
    const sourceState = source.snapshot(), targetState = target.snapshot();
    const matches = (state: InventoryStack, wanted: typeof sourceState): boolean =>
      isSameStack(state, wanted.itemId, wanted.skinId) && state.count === wanted.count
      && (wanted.entityId === undefined || state.entityId === wanted.entityId);
    if (expected && (!matches(sourceState, expected.from) || !matches(targetState, expected.to))) return false;
    return this.applySlotChanges([
      { slot: from, ...sourceState, delta: -sourceState.count },
      { slot: to, ...targetState, delta: -targetState.count },
      { slot: from, ...targetState, delta: targetState.count },
      { slot: to, ...sourceState, delta: sourceState.count },
    ]);
  }

  /** Stackable:Get: a whole stack keeps inst; a partial stack gets a new entity. */
  extract(address: SlotAddress, count: number, expected?: ItemEntity): ItemEntity | null {
    if (!this.accessibleBackpackAddress(address)) return null;
    const entity = this.getEntity(address);
    entity?.flush();
    if (!entity || entity.isRemoved || (expected && entity !== expected)
      || !Number.isSafeInteger(count) || count < 1 || count > entity.components.stackable.count) return null;
    const next = this.snapshot();
    const state = entity.snapshot();
    if (count === state.count) {
      next.set(addressKey(address), null);
      this.commit(next, true);
      this.notify([cloneAddress(address)], changedEquipmentKinds([address]));
      return entity;
    }
    const split = this.entities.create({ ...state, entityId: undefined, count });
    next.set(addressKey(address), { ...state, count: state.count - count });
    this.commit(next);
    this.notify([cloneAddress(address)]);
    return split;
  }

  getItemSpec(itemId: string): InventoryItemSpec {
    return this.requireItemSpec(itemId);
  }

  getStackSpec(stack: InventoryStack): InventoryItemSpec {
    const item = this.requireItemSpec(stack.itemId);
    if (!stack.skinId) return item;
    const skin = this.skinSpecs[stack.skinId];
    return skin ? { ...item, name: skin.name, icon: skin.icon, atlas: skin.atlas } : item;
  }

  count(itemId: string): number {
    return this.registrations.reduce((total, { slot }) => {
      if (slot instanceof StorageSlot || slot instanceof PreparedFoodSlot) return total;
      const stack = slot.get();
      return total + (stack?.itemId === itemId ? stack.count : 0);
    }, 0);
  }

  materialSummary(): InventoryMaterialSummary {
    const summary: Record<string, number> = Object.fromEntries(
      [...this.itemSpecs.keys()].map((itemId) => [itemId, 0]),
    );
    for (const { slot } of this.accessibleMaterialSlots()) {
      const stack = slot.get();
      if (stack) summary[stack.itemId] = (summary[stack.itemId] ?? 0) + stack.count;
    }
    return summary;
  }

  setStorageAccessible(containerId: string, accessible: boolean): void {
    if (!containerId) throw new TypeError('Storage container id must not be empty');
    const changed = accessible
      ? !this.accessibleStorageContainerIds.has(containerId)
      : this.accessibleStorageContainerIds.has(containerId);
    if (!changed) return;
    if (accessible) this.accessibleStorageContainerIds.add(containerId);
    else this.accessibleStorageContainerIds.delete(containerId);
    this.notify([]);
  }

  buffered(): readonly string[] {
    return [...this.bufferedBuilds.keys()];
  }

  isBuffered(recipeId: string): boolean {
    return this.bufferedBuilds.has(recipeId);
  }

  bufferedSkin(recipeId: string): string | undefined {
    return this.bufferedBuilds.get(recipeId);
  }

  takeBuffered(recipeId: string): boolean {
    if (!this.bufferedBuilds.delete(recipeId)) return false;
    this.notify([]);
    return true;
  }

  takeItem(itemId: string, skinId?: string): boolean {
    const registration = this.accessibleMaterialSlots().find(({ slot }) => {
      const item = slot.get();
      return item?.itemId === itemId && item.skinId === skinId;
    });
    const stack = registration?.slot.get();
    if (!registration || !stack) return false;
    return this.applySlotChanges([{
      slot: registration.address,
      itemId,
      ...(stack.skinId === undefined ? {} : { skinId: stack.skinId }),
      delta: -1,
    }]);
  }

  addresses(): readonly SlotAddress[] {
    return this.registrations.map(({ address }) => cloneAddress(address));
  }

  add(itemId: string, count: number, skinId?: string, onReceived?: InventoryReceiveListener, remainingUses?: number, phonographRecord?: string, remainingFuel?: number, entityId?: string): boolean {
    const spec = this.itemSpecs.get(itemId);
    if (!spec || !Number.isSafeInteger(count) || count <= 0 || !this.validUses({ remainingUses, remainingFuel }, spec)) return false;

    if (!this.validRecord({ itemId, phonographRecord })) return false;
    const working = this.snapshot();
    const changes: InventorySlotDelta[] = [];
    let remaining = count;

    for (const { address } of this.inventorySlots()) {
      if (remaining <= 0) break;
      const key = addressKey(address);
      const stack = working.get(key);
      if (!stack || !isSameStack(stack, itemId, skinId) || stack.count >= spec.maxStack) continue;
      const added = Math.min(remaining, spec.maxStack - stack.count);
      changes.push({
        slot: address,
        itemId,
        ...(skinId === undefined ? {} : { skinId }),
        delta: added,
        ...(remainingUses === undefined ? {} : { remainingUses }),
        ...(remainingFuel === undefined ? {} : { remainingFuel }),
        ...(phonographRecord === undefined ? {} : { phonographRecord }),
      });
      stack.count += added;
      remaining -= added;
    }

    for (const { address } of this.inventorySlots()) {
      if (remaining <= 0) break;
      const key = addressKey(address);
      if (working.get(key)) continue;
      const added = Math.min(remaining, spec.maxStack);
      changes.push({
        slot: address,
        itemId,
        ...(skinId === undefined ? {} : { skinId }),
        delta: added,
        ...(entityId === undefined ? {} : { entityId }),
        ...(remainingUses === undefined ? {} : { remainingUses }),
        ...(remainingFuel === undefined ? {} : { remainingFuel }),
        ...(phonographRecord === undefined ? {} : { phonographRecord }),
      });
      working.set(key, { itemId, ...(skinId === undefined ? {} : { skinId }), count: added,
        ...(remainingUses === undefined ? {} : { remainingUses }),
        ...(remainingFuel === undefined ? {} : { remainingFuel }),
        ...(phonographRecord === undefined ? {} : { phonographRecord }) });
      remaining -= added;
      entityId = undefined;
    }

    if (remaining !== 0 || !this.applySlotChanges(changes)) return false;
    onReceived?.(changes.map((change) => ({ ...change, slot: cloneAddress(change.slot) })));
    return true;
  }

  /** inventory.lua GiveItem: fill available slots/stacks, leaving excess for the caller to drop. */
  addAvailable(itemId: string, count: number, skinId?: string, onReceived?: InventoryReceiveListener): number {
    const spec = this.itemSpecs.get(itemId);
    if (!spec || !Number.isSafeInteger(count) || count <= 0) return 0;
    const capacity = this.inventorySlots().reduce((total, { slot }) => {
      const stack = slot.get();
      if (stack && !isSameStack(stack, itemId, skinId)) return total;
      return total + Math.max(0, spec.maxStack - (stack?.count ?? 0));
    }, 0);
    const accepted = Math.min(count, capacity);
    return accepted > 0 && this.add(itemId, accepted, skinId, onReceived) ? accepted : 0;
  }

  craft(recipe: InventoryRecipeDefinition, skinId?: string, onReceived?: InventoryReceiveListener): boolean {
    for (const { slot } of this.registrations) slot.getEntity()?.flush();
    if (recipe.buffered && this.isBuffered(recipe.recipeId)) return false;
    const inventorySlots = this.inventorySlots();
    const ingredientSlots = this.accessibleMaterialSlots().filter(({ slot }) => !(slot instanceof InventorySlot));
    const slots = [...inventorySlots, ...ingredientSlots];
    const current = slots.map(({ slot }) => slot.get());
    const result = planCraft(
      skinId === undefined ? recipe : { ...recipe, productSkinId: skinId },
      inventorySlots.map(({ slot }) => slot),
      ingredientSlots.map(({ slot }) => slot),
    );
    if (!result) return false;
    const next = result.items;

    const changed: SlotAddress[] = [];
    slots.forEach(({ address }, index) => {
      const stack = next[index] ?? null;
      if (stacksEqual(current[index] ?? null, stack)) return;
      changed.push(cloneAddress(address));
    });
    const committed = this.snapshot();
    slots.forEach(({ address }, index) => committed.set(addressKey(address), next[index] ?? null));
    this.commit(committed);
    if (recipe.buffered) {
      this.bufferedBuilds.set(recipe.recipeId, skinId ?? recipe.productSkinId);
    }
    this.notify(changed, changedEquipmentKinds(changed));
    if (result.products.length) {
      const productSkinId = skinId ?? recipe.productSkinId;
      onReceived?.(result.products.map(({ slotIndex, count }) => ({
        slot: cloneAddress(inventorySlots[slotIndex].address),
        itemId: recipe.productId,
        ...(productSkinId === undefined ? {} : { skinId: productSkinId }),
        delta: count,
      })));
    }
    return true;
  }

  applySlotChanges(changes: readonly InventorySlotDelta[]): boolean {
    if (changes.length === 0) return true;
    const next = this.snapshot();
    const moved: { source: string; state: InventoryStack }[] = [];

    for (const change of changes) {
      if (!Number.isSafeInteger(change.delta) || change.delta === 0) return false;
      const spec = this.itemSpecs.get(change.itemId);
      const registration = this.registrationByAddress.get(addressKey(change.slot));
      if (change.delta > 0 && change.itemId === 'backpack'
        && (registration?.slot instanceof StorageSlot || registration?.slot instanceof PreparedFoodSlot)) return false;
      if (!spec || !registration || !this.validUses(change, spec) || !this.validRecord(change)) return false;
      if (change.entityId && !this.entities.get(change.entityId)) return false;

      const { address, slot } = registration;
      const key = addressKey(address);
      const current = next.get(key) ?? null;
      if (change.delta < 0) {
        if (!current
          || (change.entityId !== undefined && change.entityId !== current.entityId)
          || !isSameStack(current, change.itemId, change.skinId)
          || current.count < -change.delta) return false;
        const nextCount = current.count + change.delta;
        moved.push({ source: key, state: { ...current, count: -change.delta,
          ...(nextCount === 0 ? {} : { entityId: undefined }) } });
        next.set(key, nextCount === 0 ? null : { ...current, count: nextCount });
        continue;
      }

      if (!slot.accepts(spec, change.itemId)) return false;
      if (current && !isSameStack(current, change.itemId, change.skinId)) return false;
      const nextCount = (current?.count ?? 0) + change.delta;
      if (nextCount > Math.min(spec.maxStack, slot.maxStack?.(change.itemId) ?? spec.maxStack)) return false;
      const sourceIndex = moved.findIndex(({ source, state }) => source !== key
        && state.itemId === change.itemId && state.skinId === change.skinId && state.count === change.delta);
      const source = sourceIndex < 0 ? undefined : moved.splice(sourceIndex, 1)[0].state;
      const entityId = current?.entityId ?? change.entityId ?? source?.entityId;
      const incoming = change.entityId ? this.entities.get(change.entityId)?.snapshot() : undefined;
      const freshnessPercent = spec.perishTime === undefined
        ? change.freshnessPercent ?? current?.freshnessPercent ?? source?.freshnessPercent ?? incoming?.freshnessPercent
        : this.dilutedFreshness(current, change.delta, change.freshnessPercent ?? source?.freshnessPercent ?? incoming?.freshnessPercent);
      next.set(key, {
        ...(entityId === undefined ? {} : { entityId }),
        itemId: change.itemId,
        ...(change.skinId === undefined ? {} : { skinId: change.skinId }),
        count: nextCount,
        ...(freshnessPercent === undefined ? {} : { freshnessPercent }),
        ...((change.wet ?? current?.wet ?? source?.wet ?? incoming?.wet) === undefined ? {}
          : { wet: change.wet ?? current?.wet ?? source?.wet ?? incoming?.wet }),
        ...((current?.container ?? source?.container) === undefined ? {} : { container: current?.container ?? source?.container }),
        ...((change.phonographRecord ?? current?.phonographRecord ?? source?.phonographRecord) === undefined ? {}
          : { phonographRecord: change.phonographRecord ?? current?.phonographRecord ?? source?.phonographRecord }),
        ...((change.remainingUses ?? current?.remainingUses ?? source?.remainingUses) === undefined ? {}
          : { remainingUses: change.remainingUses ?? current?.remainingUses ?? source?.remainingUses }),
        ...((change.remainingFuel ?? current?.remainingFuel ?? source?.remainingFuel) === undefined ? {}
          : { remainingFuel: change.remainingFuel ?? current?.remainingFuel ?? source?.remainingFuel }),
      });
    }

    const changed = new Map<string, SlotAddress>();
    for (const change of changes) {
      const registration = this.registrationByAddress.get(addressKey(change.slot))!;
      const key = addressKey(registration.address);
      changed.set(key, cloneAddress(registration.address));
    }
    if (!this.validEntityAssignments(next)) return false;
    this.commit(next);
    this.notify([...changed.values()], changedEquipmentKinds([...changed.values()]));
    return true;
  }

  /** stackable:Put → perishable:Dilute; items without a saved percent arrive fresh. */
  private dilutedFreshness(current: InventoryStack | null, delta: number, incoming?: number): number {
    const added = incoming ?? 1;
    if (!current) return added;
    const existing = current.freshnessPercent ?? 1;
    return (current.count * existing + delta * added) / (current.count + delta);
  }

  private validRecord(item: { itemId: string; phonographRecord?: string }): boolean {
    if (item.phonographRecord === undefined) return true;
    return item.itemId === 'phonograph' && (item.phonographRecord === 'record'
      || this.skinSpecs[item.phonographRecord]?.itemId === 'record');
  }

  /** Persists prefab fuel state. Burning and depletion are managed by the prefab. */
  setRemainingFuel(address: SlotAddress, remainingFuel: number): boolean {
    const registration = this.registrationByAddress.get(addressKey(address));
    const stack = registration?.slot.get();
    if (!registration || !stack) return false;
    const spec = this.requireItemSpec(stack.itemId);
    if (spec.maxFuel === undefined || !this.validUses({ remainingFuel }, spec)) return false;
    if (stack.remainingFuel === remainingFuel) return true;
    return registration.slot.getEntity()!.setRemainingFuel(remainingFuel);
  }

  private validUses(item: { remainingUses?: number; remainingFuel?: number; freshnessPercent?: number; wet?: boolean }, spec: InventoryItemSpec): boolean {
    return (item.remainingUses === undefined || (spec.maxUses !== undefined
      && Number.isSafeInteger(item.remainingUses / (spec.useStep ?? 1))
      && item.remainingUses > 0 && item.remainingUses <= spec.maxUses))
      && (item.remainingFuel === undefined || (spec.maxFuel !== undefined
        && Number.isFinite(item.remainingFuel) && item.remainingFuel >= 0 && item.remainingFuel <= spec.maxFuel))
      && (item.freshnessPercent === undefined || (Number.isFinite(item.freshnessPercent)
        && item.freshnessPercent >= 0 && item.freshnessPercent <= 1))
      && (item.wet === undefined || typeof item.wet === 'boolean');
  }

  private accessibleBackpackAddress(address: SlotAddress): boolean {
    if (!isBackpackContainerId(address.containerId)) return true;
    const equipped = this.getEntity(equipmentSlotAddress('body'));
    return equipped?.prefab === 'backpack' && equipped.components.container?.canbeopened === true
      && address.containerId === backpackContainerId(equipped.id);
  }

  private accessibleMaterialSlots(): readonly RegisteredItemSlot[] {
    return this.registrations.filter(({ address, slot }) => address.containerId !== PLAYER_CURSOR_CONTAINER_ID && (
      !(slot instanceof StorageSlot || slot instanceof PreparedFoodSlot)
      || (isBackpackContainerId(address.containerId) ? this.accessibleBackpackAddress(address)
        : this.accessibleStorageContainerIds.has(address.containerId))
    ));
  }

  private inventorySlots(): readonly RegisteredInventorySlot[] {
    return this.registrations.filter(
      (registration): registration is RegisteredInventorySlot => (
        registration.slot instanceof InventorySlot && registration.address.containerId !== PLAYER_CURSOR_CONTAINER_ID
      ),
    );
  }

  private receptionSlots(): readonly RegisteredItemSlot[] {
    return this.registrations.filter(({ address, slot }) => address.containerId !== PLAYER_CURSOR_CONTAINER_ID
      && (slot instanceof InventorySlot || (isBackpackContainerId(address.containerId) && this.accessibleBackpackAddress(address))));
  }

  private snapshot(): Map<string, InventoryStack | null> {
    for (const { slot } of this.registrations) slot.getEntity()?.flush();
    return new Map(this.registrations.map(({ address, slot }) => [addressKey(address), slot.getEntity()?.snapshot() ?? null]));
  }

  private validEntityAssignments(next: Map<string, InventoryStack | null>): boolean {
    const seen = new Set<string>();
    for (const state of next.values()) {
      if (!state?.entityId) continue;
      if (seen.has(state.entityId)) return false;
      seen.add(state.entityId);
      const entity = this.entities.get(state.entityId);
      if (entity && (entity.prefab !== state.itemId || (entity.components.inventoryitem.owner
        && !this.registrations.some(({ slot }) => slot.getEntity() === entity)))) return false;
    }
    return true;
  }

  private syncBackpackContainers(): void {
    const backpacks = this.entities.values().filter(entity => entity.components.container);
    const live = new Set(backpacks.map(entity => backpackContainerId(entity.id)));
    for (let index = this.registrations.length - 1; index >= 0; index--) {
      const registration = this.registrations[index];
      if (!isBackpackContainerId(registration.address.containerId)) continue;
      const entityId = registration.address.containerId.slice('item:backpack:'.length);
      const parent = this.entities.get(entityId);
      if (!live.has(registration.address.containerId)
        || parent?.components.container?.slots[Number(registration.address.slotKey)] !== registration.slot) {
        this.registrationByAddress.delete(addressKey(registration.address));
        this.registrations.splice(index, 1);
      }
    }
    for (const backpack of backpacks) {
      this.entities.adopt(backpack);
      backpack.components.container!.slots.forEach((slot, index) => {
        const address = backpackSlotAddress(backpack.id, index);
        if (this.registrationByAddress.has(addressKey(address))) return;
        const registration = { address, slot };
        this.registrations.push(registration);
        this.registrationByAddress.set(addressKey(address), registration);
        const child = slot.getEntity();
        if (child) {
          const spec = this.requireItemSpec(child.prefab);
          child.configure(spec);
        }
      });
    }
    const equipped = this.getEntity(equipmentSlotAddress('body'));
    for (const backpack of backpacks) {
      const container = backpack.components.container!;
      if (backpack === equipped && container.canbeopened && (container.IsOpenedBy(this) || container.CanOpen())) {
        container.Open(this);
      } else container.Close(this);
    }
  }

  private bindOwners(): void {
    for (const { address, slot } of this.registrations) {
      const entity = slot.getEntity();
      if (!entity) continue;
      entity.components.inventoryitem.owner = {
        address: cloneAddress(address),
        changed: () => { if (slot.getEntity() === entity) this.notify([cloneAddress(address)]); },
        // Items in a backpack have the backpack as owner in DST, which has no player handlers.
        PushEvent: (name, data) => { if (!isBackpackContainerId(address.containerId)) this.actor.PushEvent(name, data); },
        remove: () => slot.getEntity() === entity && this.applySlotChanges([{
          slot: address, itemId: entity.prefab, skinId: entity.skinId, delta: -entity.components.stackable.count,
        }]),
        replace: prefab => {
          if (slot.getEntity() !== entity) return false;
          const count = entity.components.stackable.count;
          if (this.applySlotChanges([
            { slot: address, entityId: entity.id, itemId: entity.prefab, skinId: entity.skinId, delta: -count },
            { slot: address, itemId: prefab, delta: count },
          ])) return true;
          // GiveItem falls back to dropping the replacement beside the holder.
          if (!this.applySlotChanges([{ slot: address, entityId: entity.id, itemId: entity.prefab, skinId: entity.skinId, delta: -count }])) return false;
          const replacement = this.entities.create({ itemId: prefab, count });
          this.configureItem(replacement);
          this.DropItem(replacement);
          return true;
        },
      };
    }
  }

  private commit(next: Map<string, InventoryStack | null>, keepDeparted = false, restore = false): void {
    batch(() => {
      const old = new Set(this.registrations.flatMap(({ slot }) => slot.getEntity() ? [slot.getEntity()!] : []));
      if (restore) for (const entity of old) {
        entity.components.inventoryitem.owner = null;
        this.entities.destroy(entity);
      }
      const retained = new Set<ItemEntity>();
      const prepared = this.registrations.map(({ address, slot }) => {
        if (restore && isBackpackContainerId(address.containerId)) return { slot, entity: null };
        const state = next.get(addressKey(address));
        if (!state) return { slot, entity: null };
        let entity = state.entityId ? this.entities.get(state.entityId) : undefined;
        entity ??= this.entities.create(state);
        entity.apply(state);
        const spec = this.requireItemSpec(entity.prefab);
        entity.configure(spec);
        retained.add(entity);
        return { slot, entity };
      });
      for (const entity of old) entity.components.inventoryitem.owner = null;
      for (const { slot, entity } of prepared) slot.setEntity(entity);
      for (const entity of old) if (!retained.has(entity) && !keepDeparted) this.entities.destroy(entity);
      this.syncBackpackContainers();
      this.bindOwners();
    });
  }

  private publishEquipmentExistenceState(kind: EquipmentKind): void {
    const address = equipmentSlotAddress(kind);
    if (!this.registrationByAddress.has(addressKey(address))) return;
    const entity = this.getEntity(address);
    const publish = <S extends EquipmentSlot>(state: Signal<Equipment<S> | null>, EQUIPSLOTS: S) => {
      state.set(entity ? Object.freeze({
        itemId: entity.prefab, EQUIPSLOTS, entity,
        ...(entity.skinId === undefined ? {} : { skinId: entity.skinId }),
      }) : null);
    };
    if (kind === 'hand') publish(this.handEquipmentExistenceState, 'HANDS');
    else if (kind === 'head') publish(this.headEquipmentExistenceState, 'HEAD');
    else publish(this.bodyEquipmentExistenceState, 'BODY');
  }

  private notify(changedSlots: readonly SlotAddress[], replacedEquipment: readonly EquipmentKind[] = []): void {
    for (const id of new Set(changedSlots.map(address => address.containerId))) this.worldContainers.get(id)?.publishDTO();
    // One complete DTO per changed container, including in-place quantity/fuel updates.
    const containerIds = new Set(changedSlots.map(address => address.containerId).filter(isBackpackContainerId));
    for (const id of containerIds) {
      this.entities.get(id.slice('item:backpack:'.length))?.components.container?.publishDTO();
    }
    // Component or unrelated inventory updates must not restart equipment lifecycles.
    for (const kind of replacedEquipment) this.publishEquipmentExistenceState(kind);
    this.listeners.forEach((listener) => listener(changedSlots));
  }

  private requireItemSpec(itemId: string): InventoryItemSpec {
    const spec = this.itemSpecs.get(itemId);
    if (!spec) throw new Error(`Unknown inventory item: ${itemId}`);
    return spec;
  }
}
