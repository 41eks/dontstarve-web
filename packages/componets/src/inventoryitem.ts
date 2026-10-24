import type { Vector3 } from 'three';
import type { MiniMapEntity } from './minimapentity';
import { createSignal, readonlySignal } from '../../signals/src';

export interface ItemPosition { readonly x: number; readonly y: number; readonly z: number; }
export interface InventoryActor {
  hasTag(tag: string): boolean;
  GetPosition(): ItemPosition;
  PushEvent(name: string, data: unknown): void;
}
export interface InventoryItemInstance {
  hasTag(tag: string): boolean;
  PushEvent(name: string, data: unknown): void;
  readonly transform: { readonly position: Vector3 };
  readonly MiniMapEntity?: MiniMapEntity;
  readonly isRemoved?: boolean;
}

/** inventoryitem.lua's supported pickup/ownership hooks; slot addresses remain store-owned. */
export class InventoryItem<Instance extends InventoryItemInstance, Owner> {
  readonly inst: Instance;
  private readonly imageState = createSignal<{ readonly icon: string; readonly atlas: string } | undefined>(undefined);
  readonly image = readonlySignal(this.imageState);
  ChangeImageName(icon: string, atlas: string): void {
    const previous = this.imageState.peek();
    if (previous?.icon !== icon || previous?.atlas !== atlas) this.imageState.set(Object.freeze({ icon, atlas }));
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
    this.inst.transform.position.set(0, 0, 0);
    this.onputininventoryfn?.(this.inst, doer);
    this.inst.PushEvent('onputininventory', doer);
  }
}
