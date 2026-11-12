import type { LuaFn } from './luaFn';
import type { Vector3 } from 'three';
import type { Burnable } from './burnable';
import type { Workable, WorkInst, Worker } from './workable';

/** tuning.lua EXPLOSIVE_MAX_WORKABLE_INVENTORYITEMS: workable inventory items one explosion may work. */
export const EXPLOSIVE_MAX_WORKABLE_INVENTORYITEMS = 20;

export interface ExplosiveTarget extends WorkInst {
  getPosition(): Vector3;
  readonly components: {
    workable?: Workable;
    burnable?: Burnable;
    inventoryitem?: unknown;
    stackable?: { readonly count: number };
    fueled?: unknown;
  };
}

/** The explosive inst, which is also the worker of what it works. */
export type ExplosiveInst = ExplosiveTarget & Worker & {
  readonly components: NonNullable<Worker['components']>;
  remove(): boolean;
};
export type ExplosiveOnExplodeFn = LuaFn<[inst: ExplosiveInst]>;

/**
 * The work, ignition and `explosion` event branches of components/explosive.lua. Damage to
 * combat targets, dock damage and the camera flash need systems this project does not have yet.
 */
export class Explosive {
  /** Lua units; `unitsPerMeter` converts them to world units. */
  explosiverange = 3;
  buildingdamage = 10;
  lightonexplode = true;
  private onexplodefn?: ExplosiveOnExplodeFn;
  readonly inst: ExplosiveInst;
  private readonly find: (center: Vector3, radius: number) => readonly ExplosiveTarget[];
  private readonly unitsPerMeter: number;
  private exploded = false;

  constructor(inst: ExplosiveInst, find: (center: Vector3, radius: number) => readonly ExplosiveTarget[], unitsPerMeter = 1) {
    this.inst = inst; this.find = find; this.unitsPerMeter = unitsPerMeter;
  }

  SetOnExplodeFn(fn: ExplosiveOnExplodeFn | undefined): void { this.onexplodefn = fn; }

  /** The whole stack explodes at once and the inst removes itself, as in Lua. */
  OnBurnt(): void {
    if (this.exploded || this.inst.isRemoved) return;
    this.exploded = true;
    this.onexplodefn?.(this.inst);
    const stacksize = this.inst.components.stackable?.count ?? 1;
    // The explosive inst is the worker of every target it works; `working` and `explosion` events name it.
    let workablecount = EXPLOSIVE_MAX_WORKABLE_INVENTORYITEMS;
    for (const target of this.find(this.inst.getPosition(), this.explosiverange * this.unitsPerMeter)) {
      if (target === this.inst || target.isRemoved || target.hasTag('INLIMBO')) continue;
      const workable = target.components.workable;
      if (workable?.CanBeWorked()) {
        let workdamage = this.buildingdamage * stacksize;
        let dowork = true;
        if (target.components.inventoryitem !== undefined) {
          if (workablecount > 0) {
            workablecount--;
            workdamage *= target.components.stackable?.count ?? 1;
          } else dowork = false;
        }
        if (dowork) workable.WorkedBy(this.inst, workdamage);
      }
      // Recheck validity after work.
      if (target.isRemoved || target.hasTag('INLIMBO')) continue;
      const burnable = target.components.burnable;
      if (this.lightonexplode && target.components.fueled === undefined
        && burnable && !burnable.IsBurning() && !target.hasTag('burnt')) burnable.Ignite();
      target.PushEvent?.('explosion', { explosive: this.inst });
    }
    this.inst.remove();
  }

  dispose(): void { this.onexplodefn = undefined; }
}
