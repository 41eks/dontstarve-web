import { ItemEntity, ItemEntityRegistry } from './entity';
import { planCraft } from './craft';
import {
  createHandEquipmentExistenceState, createHeadEquipmentExistenceState, createBodyEquipmentExistenceState, readonlySignal,
  type Equipment, type EquipmentSlot, type HandEquipment, type HeadEquipment, type BodyEquipment, type ReadonlySignal, type Signal,
} from '@dontstarve-web/signals';
import { EQUIPMENT_KINDS, equipmentSlotAddress, cursorSlotAddress, PLAYER_CURSOR_CONTAINER_ID, backpackContainerId, backpackSlotAddress, isBackpackContainerId, BACKPACK_SLOT_COUNT } from './addresses';
import { InventorySlot, StorageSlot, type ItemSlot } from './slots';
import { PreparedFoodSlot } from './preparedFoodSlot';
import type {
  EquipmentKind,
  InventoryItemSpec,
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
      && left.phonographRecord === right.phonographRecord
      && left.count === right.count;
}

export class InventoryStore {
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
  private readonly skinSpecs: Readonly<Record<string, InventorySkinSpec>>;
  private readonly registrationByAddress = new Map<string, RegisteredItemSlot>();
  private readonly registrations: RegisteredItemSlot[] = [];
  private readonly equipmentSubscriptions = new Map<EquipmentKind, () => void>();

  constructor(
    registrations: readonly RegisteredItemSlot[],
    itemSpecs: Readonly<Record<string, InventoryItemSpec>>,
    skinSpecs: Readonly<Record<string, InventorySkinSpec>> = {},
    entities = new ItemEntityRegistry(),
    equipmentExistenceStates: EquipmentExistenceStates = {},
  ) {
    this.handEquipmentExistenceState = equipmentExistenceStates.handEquipmentExistenceState ?? createHandEquipmentExistenceState();
    this.headEquipmentExistenceState = equipmentExistenceStates.headEquipmentExistenceState ?? createHeadEquipmentExistenceState();
    this.bodyEquipmentExistenceState = equipmentExistenceStates.bodyEquipmentExistenceState ?? createBodyEquipmentExistenceState();
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
        || !slot.accepts(spec) || !this.validUses(stack, spec) || !this.validRecord(stack)) {
        throw new RangeError(`Invalid initial stack for ${stack.itemId} in ${key}`);
      }
    }
    for (const registration of pending) {
      const entity = registration.slot.getEntity();
      if (entity) {
        const spec = this.requireItemSpec(entity.prefab);
        if (spec.maxUses !== undefined) entity.components.finiteuses.setMaxUses(spec.maxUses);
        this.entities.adopt(entity);
      }
      this.registrations.push(registration);
      this.registrationByAddress.set(addressKey(registration.address), registration);
    }
    this.syncBackpackContainers();
    this.bindOwners();
    for (const kind of changedEquipmentKinds(pending.map(({ address }) => address))) {
      this.bindEquipmentExistenceState(kind);
      this.publishEquipmentExistenceState(kind);
    }
  }

  subscribe(listener: InventoryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Each equipment slot binds once before publishing; null removes its current item. */
  private bindEquipmentExistenceState(kind: EquipmentKind): void {
    if (this.equipmentSubscriptions.has(kind)) return;
    const address = equipmentSlotAddress(kind);
    const state = kind === 'hand' ? this.handEquipmentExistenceState
      : kind === 'head' ? this.headEquipmentExistenceState : this.bodyEquipmentExistenceState;
    const stop = state.subscribe((equipment: Equipment | null, previous: Equipment | null) => {
      if (equipment !== null || state.peek() !== null) return;
      const entity = this.getEntity(address);
      // Own transfers already emptied the slot; foreign/stale equipment cannot remove its replacement.
      if (!entity || previous?.entity !== entity) return;
      this.applySlotChanges([{
        slot: address, itemId: entity.prefab, skinId: entity.skinId, delta: -entity.components.stackable.count,
      }]);
    });
    this.equipmentSubscriptions.set(kind, stop);
  }

  dispose(): void {
    for (const stop of this.equipmentSubscriptions.values()) stop();
    this.equipmentSubscriptions.clear();
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
          || !registration.slot.accepts(spec) || !this.validUses(item, spec) || !this.validRecord(item)) {
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
    if (entity.isRemoved || entity.components.inventoryitem.owner) return false;
    entity.flush();
    if (entity.isRemoved) return false;
    this.entities.adopt(entity);
    const state = entity.snapshot();
    const received = this.add(state.itemId, state.count, state.skinId, onReceived,
      state.remainingUses, state.phonographRecord, state.remainingFuel, entity.id);
    if (received) entity.transform.position = [0, 0, 0];
    if (received && !this.registrations.some(({ slot }) => slot.getEntity() === entity)) this.entities.destroy(entity);
    return received;
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

      if (!slot.accepts(spec)) return false;
      if (current && !isSameStack(current, change.itemId, change.skinId)) return false;
      const nextCount = (current?.count ?? 0) + change.delta;
      if (nextCount > Math.min(spec.maxStack, slot.maxStack?.(change.itemId) ?? spec.maxStack)) return false;
      const sourceIndex = moved.findIndex(({ source, state }) => source !== key
        && state.itemId === change.itemId && state.skinId === change.skinId && state.count === change.delta);
      const source = sourceIndex < 0 ? undefined : moved.splice(sourceIndex, 1)[0].state;
      const entityId = current?.entityId ?? change.entityId ?? source?.entityId;
      next.set(key, {
        ...(entityId === undefined ? {} : { entityId }),
        itemId: change.itemId,
        ...(change.skinId === undefined ? {} : { skinId: change.skinId }),
        count: nextCount,
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

  private validUses(item: { remainingUses?: number; remainingFuel?: number }, spec: InventoryItemSpec): boolean {
    return (item.remainingUses === undefined || (spec.maxUses !== undefined
      && Number.isSafeInteger(item.remainingUses) && item.remainingUses >= 1 && item.remainingUses <= spec.maxUses))
      && (item.remainingFuel === undefined || (spec.maxFuel !== undefined
        && Number.isFinite(item.remainingFuel) && item.remainingFuel > 0 && item.remainingFuel <= spec.maxFuel));
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
          if (spec.maxUses !== undefined) child.components.finiteuses.setMaxUses(spec.maxUses);
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
        remove: () => slot.getEntity() === entity && this.applySlotChanges([{
          slot: address, itemId: entity.prefab, skinId: entity.skinId, delta: -entity.components.stackable.count,
        }]),
      };
    }
  }

  private commit(next: Map<string, InventoryStack | null>, keepDeparted = false, restore = false): void {
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
      if (spec.maxUses !== undefined) entity.components.finiteuses.setMaxUses(spec.maxUses);
      retained.add(entity);
      return { slot, entity };
    });
    for (const entity of old) entity.components.inventoryitem.owner = null;
    for (const { slot, entity } of prepared) slot.setEntity(entity);
    for (const entity of old) if (!retained.has(entity) && !keepDeparted) this.entities.destroy(entity);
    this.syncBackpackContainers();
    this.bindOwners();
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
