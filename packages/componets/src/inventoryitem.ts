import type { LuaFn } from './luaFn';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { MiniMapEntity } from './minimapentity';
import { createMemo, createSignal, type Memo, type ReadonlySignal } from '../../signals/src';

export interface ItemPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export interface InventoryActor {
  hasTag(tag: string): boolean;
  addTag?(tag: string): void;
  removeTag?(tag: string): void;
  getPosition(): import('three').Vector3;
  PushEvent(name: string, data: unknown): void;
}
/**
 * inventoryitem.owner: the entity holding the inst, whose child it is (owner:AddChild) — the player, a container's inst
 * such as a chest or a worn backpack, or a creature.
 */
export interface ItemHolder {
  hasTag(tag: string): boolean;
  getPosition(): import('three').Vector3;
  PushEvent(name: string, data?: unknown): void;
  /** The holder's own components; a holder that is itself an item (a backpack) has an inventoryitem. */
  readonly components?: object;
}

/** The holder that is itself held: its inventoryitem, when it has one. */
function heldHolder(owner: ItemHolder): InventoryItem<InventoryItemInstance, ItemHolder, unknown> | undefined {
  const item = owner.components && 'inventoryitem' in owner.components ? owner.components.inventoryitem : undefined;
  return item instanceof InventoryItem ? item : undefined;
}

export interface InventoryItemInstance {
  hasTag(tag: string): boolean;
  PushEvent(name: string, data: unknown): void;
  readonly transform: { readonly position: ReadonlyVector3; setPosition(x: number, y: number, z: number): void };
  readonly MiniMapEntity?: MiniMapEntity;
  readonly isRemoved?: boolean;
  /** The inst's components; DoDropPhysics throws its `inventoryphysics` body. */
  readonly components?: object;
  /** EntityScript:RemoveFromScene / ReturnToScene, for an inst that has a scene. */
  RemoveFromScene?(): void;
  ReturnToScene?(): void;
  /** The inst's sprite json: its skin, and the clip a prefab may derive its inventory image from. */
  readonly sprite: { readonly sprite: ReadonlySignal<InventoryItemSprite> };
}

export type InventoryItemOnPickupFn<Inst> = LuaFn<
  [inst: Inst, pickupguy: InventoryActor, src_pos?: ItemPosition],
  boolean | void
>;
export type InventoryItemOnPutInInventoryFn<Inst> = LuaFn<[inst: Inst, owner: ItemHolder]>;
/** inventoryitem.lua ondropfn(inst). */
export type InventoryItemOnDroppedFn<Inst> = LuaFn<[inst: Inst]>;

export interface InventoryImage {
  readonly icon: string;
  readonly atlas: string;
}
/** The prefab's or its skin's name and default inventory image. */
export interface InventoryAppearance extends InventoryImage {
  readonly name: string;
}
export interface InventoryItemSprite {
  readonly skinId?: string;
  readonly clip: { readonly name: string };
}

/**
 * inventoryitem.lua's supported pickup/ownership hooks. `owner` is the holder entity; `slot` is the holder's slot of the
 * inst (inventory/container:GetItemSlot), which the store holding it binds together with the owner.
 */
export class InventoryItem<Instance extends InventoryItemInstance, Owner extends ItemHolder, Slot = never> {
  readonly inst: Instance;
  /** inventoryitem.imagename/atlasname, set by ChangeImageName. */
  private readonly imagename = createSignal<InventoryImage | undefined>(undefined);
  private readonly imageFromSprite = createSignal<
    ((sprite: InventoryItemSprite) => InventoryImage | undefined) | undefined
  >(undefined);
  private readonly defaultAppearance = createSignal<((skinId: string | undefined) => InventoryAppearance) | undefined>(
    undefined,
  );
  private memos?: {
    readonly skinId: Memo<string | undefined>;
    readonly appearance: Memo<InventoryAppearance | undefined>;
    readonly image: Memo<InventoryImage | undefined>;
  };
  ChangeImageName(icon: string, atlas: string): void {
    const previous = this.imagename.peek();
    if (previous?.icon !== icon || previous?.atlas !== atlas) {
      this.imagename.set(Object.freeze({ icon, atlas }));
    }
  }
  /**
   * A prefab whose image is a function of its sprite json (heatrock: skin and temperature-range clip). It must
   * return constant objects, so sprite writes that keep the image do not propagate.
   */
  SetImageFromSprite(fn: ((sprite: InventoryItemSprite) => InventoryImage | undefined) | undefined): void {
    this.imageFromSprite.set(fn);
  }
  /** Injected by the inventory: the prefab's or skin's name and default image. Pass a stable function. */
  SetDefaultAppearance(fn: (skinId: string | undefined) => InventoryAppearance): void {
    this.defaultAppearance.set(fn);
  }
  private get derived() {
    if (this.memos) {
      return this.memos;
    }
    const skinId = createMemo(() => this.inst.sprite.sprite.get().skinId);
    const appearance = createMemo(() => this.defaultAppearance.get()?.(skinId.get()));
    const image = createMemo((): InventoryImage | undefined => {
      const fromSprite = this.imageFromSprite.get();
      return (fromSprite && fromSprite(this.inst.sprite.sprite.get())) ?? this.imagename.get() ?? appearance.get();
    });
    return (this.memos = { skinId, appearance, image });
  }
  /** The name for the inst's current skin; undefined until the inventory injects its appearance. */
  get appearance(): ReadonlySignal<InventoryAppearance | undefined> {
    return this.derived.appearance;
  }
  /** replica.inventoryitem:GetImage()/GetAtlas(): the sprite-derived, changed or default image. */
  get image(): ReadonlySignal<InventoryImage | undefined> {
    return this.derived.image;
  }
  dispose(): void {
    // Disposed memos keep their final value; a removed inst does not derive them again.
    this.memos?.image.dispose();
    this.memos?.appearance.dispose();
    this.memos?.skinId.dispose();
  }
  private ownerValue: Owner | null = null;
  private slotValue: Slot | null = null;
  get owner(): Owner | null {
    return this.ownerValue;
  }
  /** The holder's slot of the inst while it is held; it goes with the owner. */
  get slot(): Slot | null {
    return this.slotValue;
  }
  /** inventoryitem:OnPutInInventory's SetOwner, with the slot its holder put it in. */
  SetOwner(owner: Owner, slot: Slot): void {
    this.owner = owner;
    this.slotValue = slot;
  }
  /** inventoryitem:GetGrandOwner(): through a held holder (a worn backpack) to the one that holds it. */
  GetGrandOwner(): ItemHolder | null {
    const owner = this.ownerValue;
    if (!owner) {
      return null;
    }
    const held = heldHolder(owner);
    return held ? held.GetGrandOwner() : owner;
  }
  /**
   * Transform:GetWorldPosition of a held inst: owner:AddChild puts it at its holder, and a held holder at its own
   * holder. Undefined while the inst is not held.
   */
  GetHeldPosition(): import('three').Vector3 | undefined {
    const owner = this.ownerValue;
    if (!owner) {
      return undefined;
    }
    return heldHolder(owner)?.GetHeldPosition() ?? owner.getPosition();
  }
  set owner(owner: Owner | null) {
    const previous = this.ownerValue;
    this.ownerValue = owner;
    if (owner === null) {
      this.slotValue = null;
    }
    // OnPutInInventory's RemoveFromScene and OnRemoved's ReturnToScene: a held inst is in limbo, as is its minimap icon.
    this.inst.MiniMapEntity?.SetEnabled(owner === null && !this.inst.isRemoved);
    if (this.inst.isRemoved || (previous === null) === (owner === null)) {
      return;
    }
    if (owner === null) {
      this.inst.ReturnToScene?.();
    } else {
      this.inst.RemoveFromScene?.();
    }
  }
  canbepickedup = true;
  canbepickedupalive = false;
  cangoincontainer = true;
  grabbableoverridetag?: string;
  onpickupfn?: InventoryItemOnPickupFn<Instance>;
  onputininventoryfn?: InventoryItemOnPutInInventoryFn<Instance>;
  ondropfn?: InventoryItemOnDroppedFn<Instance>;

  constructor(inst: Instance) {
    this.inst = inst;
  }
  CanBePickedUp(doer: InventoryActor): boolean {
    if (this.grabbableoverridetag && doer.hasTag(this.grabbableoverridetag)) {
      return true;
    }
    return this.canbepickedup && (!this.inst.hasTag('spider') || doer.hasTag('spiderwhisperer'));
  }
  SetOnPickupFn(fn: InventoryItemOnPickupFn<Instance> | undefined): void {
    this.onpickupfn = fn;
  }
  SetOnPutInInventoryFn(fn: InventoryItemOnPutInInventoryFn<Instance> | undefined): void {
    this.onputininventoryfn = fn;
  }
  SetOnDroppedFn(fn: InventoryItemOnDroppedFn<Instance> | undefined): void {
    this.ondropfn = fn;
  }
  OnPickup(doer: InventoryActor, source?: ItemPosition): boolean {
    this.inst.PushEvent('onpickup', { owner: doer });
    return this.onpickupfn?.(this.inst, doer, source) === true;
  }
  /**
   * inventoryitem.lua OnDropped: OnRemoved returns the inst to the scene where it was put down, DoDropPhysics throws a
   * body in `launch`'s direction, then ondropfn and `ondropped`. An inst without a body lands where it is.
   */
  OnDropped(launch?: import('./inventoryphysics').LootLaunch): void {
    if (this.inst.isRemoved) {
      this.ownerValue = null;
      this.slotValue = null;
      return;
    }
    this.owner = null;
    // OnRemoved's ReturnToScene, also for an inst a holder took out of the scene without a store owner.
    this.inst.ReturnToScene?.();
    if (launch) {
      (
        this.inst.components as
          | { inventoryphysics?: { Launch(launch?: import('./inventoryphysics').LootLaunch): void } }
          | undefined
      )?.inventoryphysics?.Launch(launch);
    }
    this.ondropfn?.(this.inst);
    this.inst.PushEvent('ondropped', undefined);
  }
  OnPutInInventory(doer: ItemHolder): void {
    this.inst.transform.setPosition(0, 0, 0);
    this.onputininventoryfn?.(this.inst, doer);
    this.inst.PushEvent('onputininventory', doer);
  }
}
