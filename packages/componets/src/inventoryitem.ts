import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { MiniMapEntity } from './minimapentity';
import { createMemo, createSignal, type Memo, type ReadonlySignal } from '../../signals/src';

export interface ItemPosition { readonly x: number; readonly y: number; readonly z: number; }
export interface InventoryActor {
  hasTag(tag: string): boolean;
  addTag?(tag: string): void;
  removeTag?(tag: string): void;
  GetPosition(): ItemPosition;
  PushEvent(name: string, data: unknown): void;
}
export interface InventoryItemInstance {
  hasTag(tag: string): boolean;
  PushEvent(name: string, data: unknown): void;
  readonly transform: { readonly position: ReadonlyVector3; setPosition(x: number, y: number, z: number): void };
  readonly MiniMapEntity?: MiniMapEntity;
  readonly isRemoved?: boolean;
  /** The inst's sprite json: its skin, and the clip a prefab may derive its inventory image from. */
  readonly sprite: { readonly sprite: ReadonlySignal<InventoryItemSprite> };
}

export interface InventoryImage { readonly icon: string; readonly atlas: string }
/** The prefab's or its skin's name and default inventory image. */
export interface InventoryAppearance extends InventoryImage { readonly name: string }
export interface InventoryItemSprite { readonly skinId?: string; readonly clip: { readonly name: string } }

/** inventoryitem.lua's supported pickup/ownership hooks; slot addresses remain store-owned. */
export class InventoryItem<Instance extends InventoryItemInstance, Owner> {
  readonly inst: Instance;
  /** inventoryitem.imagename/atlasname, set by ChangeImageName. */
  private readonly imagename = createSignal<InventoryImage | undefined>(undefined);
  private readonly imageFromSprite = createSignal<((sprite: InventoryItemSprite) => InventoryImage | undefined) | undefined>(undefined);
  private readonly defaultAppearance = createSignal<((skinId: string | undefined) => InventoryAppearance) | undefined>(undefined);
  private memos?: { readonly skinId: Memo<string | undefined>; readonly appearance: Memo<InventoryAppearance | undefined>; readonly image: Memo<InventoryImage | undefined> };
  ChangeImageName(icon: string, atlas: string): void {
    const previous = this.imagename.peek();
    if (previous?.icon !== icon || previous?.atlas !== atlas) this.imagename.set(Object.freeze({ icon, atlas }));
  }
  /**
   * A prefab whose image is a function of its sprite json (heatrock: skin and temperature-range clip). It must
   * return constant objects, so sprite writes that keep the image do not propagate.
   */
  SetImageFromSprite(fn: ((sprite: InventoryItemSprite) => InventoryImage | undefined) | undefined): void { this.imageFromSprite.set(fn); }
  /** Injected by the inventory: the prefab's or skin's name and default image. Pass a stable function. */
  SetDefaultAppearance(fn: (skinId: string | undefined) => InventoryAppearance): void { this.defaultAppearance.set(fn); }
  private get derived() {
    if (this.memos) return this.memos;
    const skinId = createMemo(() => this.inst.sprite.sprite.get().skinId);
    const appearance = createMemo(() => this.defaultAppearance.get()?.(skinId.get()));
    const image = createMemo((): InventoryImage | undefined => {
      const fromSprite = this.imageFromSprite.get();
      return (fromSprite && fromSprite(this.inst.sprite.sprite.get())) ?? this.imagename.get() ?? appearance.get();
    });
    return this.memos = { skinId, appearance, image };
  }
  /** The name for the inst's current skin; undefined until the inventory injects its appearance. */
  get appearance(): ReadonlySignal<InventoryAppearance | undefined> { return this.derived.appearance; }
  /** replica.inventoryitem:GetImage()/GetAtlas(): the sprite-derived, changed or default image. */
  get image(): ReadonlySignal<InventoryImage | undefined> { return this.derived.image; }
  dispose(): void {
    // Disposed memos keep their final value; a removed inst does not derive them again.
    this.memos?.image.dispose(); this.memos?.appearance.dispose(); this.memos?.skinId.dispose();
  }
  private ownerValue: Owner | null = null;
  get owner(): Owner | null { return this.ownerValue; }
  set owner(owner: Owner | null) {
    this.ownerValue = owner;
    // inventoryitem.lua removes owned items from the scene and returns them
    // when ownership is cleared; this applies to every inventory minimap icon.
    this.inst.MiniMapEntity?.SetEnabled(owner === null && !this.inst.isRemoved);
  }
  canbepickedup = true;
  canbepickedupalive = false;
  cangoincontainer = true;
  grabbableoverridetag?: string;
  onpickupfn?: (inst: Instance, owner: InventoryActor, source?: ItemPosition) => boolean | void;
  onputininventoryfn?: (inst: Instance, owner: InventoryActor) => void;

  constructor(inst: Instance) { this.inst = inst; }
  CanBePickedUp(doer: InventoryActor): boolean {
    if (this.grabbableoverridetag && doer.hasTag(this.grabbableoverridetag)) return true;
    return this.canbepickedup && (!this.inst.hasTag('spider') || doer.hasTag('spiderwhisperer'));
  }
  SetOnPickupFn(fn: InventoryItem<Instance, Owner>['onpickupfn']): void { this.onpickupfn = fn; }
  SetOnPutInInventoryFn(fn: InventoryItem<Instance, Owner>['onputininventoryfn']): void { this.onputininventoryfn = fn; }
  OnPickup(doer: InventoryActor, source?: ItemPosition): boolean {
    this.inst.PushEvent('onpickup', { owner: doer });
    return this.onpickupfn?.(this.inst, doer, source) === true;
  }
  OnPutInInventory(doer: InventoryActor): void {
    this.inst.transform.setPosition(0, 0, 0);
    this.onputininventoryfn?.(this.inst, doer);
    this.inst.PushEvent('onputininventory', doer);
  }
}
