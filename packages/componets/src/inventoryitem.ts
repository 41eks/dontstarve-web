import type { LuaFn } from './luaFn';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { MiniMapEntity } from './minimapentity';
import { createMemo, createSignal, type Memo, type ReadonlySignal } from '../../signals/src';
import type { ComponentUpdates } from './componentUpdates';

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
  /** inst.inlimbo. */
  readonly inlimbo?: boolean;
  ListenForEvent?(event: string, fn: () => void): () => void;
  DoTaskInTime?(time: number, fn: () => void): unknown;
}

/**
 * The world inventoryitem's landing reaches: StartUpdatingComponent for the landing poll, and ocean_util.lua's
 * ShouldEntitySink and SinkEntity.
 */
export interface InventoryItemLandingWorld<Inst> {
  readonly componentUpdates: ComponentUpdates;
  ShouldEntitySink(inst: Inst, sinks: boolean): boolean;
  SinkEntity(inst: Inst): void;
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
    this.StopPolling();
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

  /** inventoryitem.sinks: the inst sinks in the ocean, not only off the map's passable ground. */
  sinks = false;
  /** inventoryitem.nobounce: a dropped inst is on the ground at once. */
  nobounce = false;
  pushlandedevents = true;
  private is_landed = false;
  /** The constructor's SetLanded(false, true): the inst polls for landing once its world is bound. */
  private pollingForLanding = true;
  private landingWorld?: InventoryItemLandingWorld<Instance>;
  private stopPolling?: () => void;
  private readonly poll = { OnUpdate: () => this.OnUpdate() };

  constructor(inst: Instance) {
    this.inst = inst;
  }

  /**
   * The world's map and component updates, bound once with the inst's world: the constructor's landing poll starts,
   * and its enterlimbo / exitlimbo listeners stop and restart it.
   */
  BindLandingWorld(world: InventoryItemLandingWorld<Instance>): void {
    this.landingWorld = world;
    this.inst.ListenForEvent?.('enterlimbo', () => this.SetLanded(false, false));
    this.inst.ListenForEvent?.('exitlimbo', () => this.SetLanded(false, true));
    this.SetLanded(this.is_landed, this.pollingForLanding);
  }

  get isLanded(): boolean {
    return this.is_landed;
  }

  /** inventoryitem:IsHeld(). */
  IsHeld(): boolean {
    return this.ownerValue !== null;
  }

  /**
   * inventoryitem:SetLanded: a falling inst polls each frame until it rests; landing pushes `on_landed` and tries to
   * sink, taking off pushes `on_no_longer_landed`.
   */
  SetLanded(is_landed: boolean, should_poll_for_landing: boolean): void {
    if (!is_landed) {
      if (should_poll_for_landing) {
        this.StartPolling();
      } else {
        this.StopPolling();
      }
      if (this.pushlandedevents && this.is_landed) {
        this.inst.PushEvent('on_no_longer_landed', undefined);
      }
    } else {
      this.StopPolling();
      if (this.pushlandedevents && !this.is_landed) {
        this.inst.PushEvent('on_landed', undefined);
        this.TryToSink();
      }
    }
    this.is_landed = is_landed;
  }

  /** inventoryitem:SetSinks: an inst that has already landed tries to sink at once. */
  SetSinks(should_sink: boolean): void {
    this.sinks = should_sink;
    if (this.is_landed) {
      this.TryToSink();
    }
  }

  /** inventoryitem:ShouldSink. */
  ShouldSink(): boolean {
    return this.landingWorld?.ShouldEntitySink(this.inst, this.sinks) ?? false;
  }

  /** inventoryitem:TryToSink: DoTaskInTime(0, SinkEntity). */
  TryToSink(): void {
    const world = this.landingWorld;
    if (world?.ShouldEntitySink(this.inst, this.sinks)) {
      this.inst.DoTaskInTime?.(0, () => world.SinkEntity(this.inst));
    }
  }

  /** inventoryitem:OnUpdate: the inst has landed once its body is at rest (MakeInventoryPhysics' flight is over). */
  OnUpdate(): void {
    if (this.inst.isRemoved) {
      this.StopPolling();
      return;
    }
    const physics = (this.inst.components as { inventoryphysics?: { readonly flying: boolean } } | undefined)
      ?.inventoryphysics;
    if (!physics?.flying) {
      this.SetLanded(true, false);
    }
  }

  private StartPolling(): void {
    this.pollingForLanding = true;
    if (this.landingWorld && !this.inst.isRemoved) {
      this.stopPolling ??= this.landingWorld.componentUpdates.register(this.poll);
    }
  }

  private StopPolling(): void {
    this.pollingForLanding = false;
    this.stopPolling?.();
    this.stopPolling = undefined;
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
    this.SetLanded(false, false);
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
    // DoDropPhysics: nobounce items are on the ground at once.
    this.SetLanded(this.nobounce, true);
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
