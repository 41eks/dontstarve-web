import type { LuaFn } from './luaFn';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type * as THREE from 'three';
import { getDeconstructionRecipe } from './recipes.ts';
export interface SpellCastDoer {
  readonly position: ReadonlyVector3;
  hasTag(tag: string): boolean;
  readonly components: {
    sanity?: { DoDelta(delta: number): void };
    staffsanity?: { doCastingDelta(delta: number): void };
  };
}
export interface SpellCastMap {
  isAboveGroundAtPoint(position: THREE.Vector3, allowWater: boolean): boolean;
  isOceanAtPoint(position: THREE.Vector3): boolean;
  isGroundTargetBlocked(position: THREE.Vector3): boolean;
}
/** `position` is BufferedAction:GetActionPoint(): undefined for a cast from the inventory, which has no target either. */
export interface SpellCasterComponent {
  canCast(doer: SpellCastDoer, target: SpellTarget | undefined, position: THREE.Vector3 | undefined): boolean;
  castSpell(target: SpellTarget | undefined, position: THREE.Vector3 | undefined, doer: SpellCastDoer): boolean;
  dispose(): void;
}
export interface SpellCasterInst {
  readonly isRemoved: boolean;
  addTag(tag: string): void;
  removeTag(tag: string): void;
}

export interface SpellTarget {
  readonly isRemoved?: boolean;
  hasTag(tag: string): boolean;
  /** inst.entity:IsVisible() */
  IsVisible?(): boolean;
  readonly components?: { readonly health?: { IsDead(): boolean }; readonly locomotor?: object };
  readonly sg?: { hasStateTag(tag: string): boolean };
}

/** spellcaster.lua spell(inst, target, pos, doer). */
export type SpellFn = LuaFn<[inst: SpellCasterInst, target: object | undefined, position: THREE.Vector3 | undefined, doer: SpellCastDoer], boolean>;
/** spellcaster.lua can_cast_fn(doer, target, pos, inst): the doer comes first in the source. */
export type SpellCanCastFn = LuaFn<[doer: SpellCastDoer, target: object | undefined, position: THREE.Vector3 | undefined, inst: SpellCasterInst], boolean>;

/** Supported point, target and inventory branches of components/spellcaster.lua. */
export class SpellCaster implements SpellCasterComponent {
  private readonly item: SpellCasterInst;
  /** TheWorld.Map, read when a point is checked. */
  private readonly map: () => SpellCastMap | undefined;
  private spell?: SpellFn;
  private onPoint = false;
  private onWater = false;
  private fromInventory = false;
  private onTargets = false;
  private onRecipes = false;
  private onLocomotorsPvP = false;
  private onDead = false;
  private veryQuick = false;
  private canCastFn?: SpellCanCastFn;
  private disposed = false;
  constructor(item: SpellCasterInst, map: () => SpellCastMap | undefined = () => undefined) { this.item = item; this.map = map; }
  get canUseFromInventory(): boolean { return this.fromInventory; }
  set canUseFromInventory(value: boolean) { this.fromInventory = value; this.refreshTags(); }
  get canUseOnTargets(): boolean { return this.onTargets; }
  set canUseOnTargets(value: boolean) { this.onTargets = value; this.refreshTags(); }
  get canOnlyUseOnRecipes(): boolean { return this.onRecipes; }
  set canOnlyUseOnRecipes(value: boolean) { this.onRecipes = value; this.refreshTags(); }
  get canOnlyUseOnLocomotorsPvP(): boolean { return this.onLocomotorsPvP; }
  set canOnlyUseOnLocomotorsPvP(value: boolean) { this.onLocomotorsPvP = value; this.refreshTags(); }
  get canUseOnDead(): boolean { return this.onDead; }
  set canUseOnDead(value: boolean) { this.onDead = value; }
  get veryQuickCast(): boolean { return this.veryQuick; }
  set veryQuickCast(value: boolean) { this.veryQuick = value; this.refreshTags(); }
  SetCanCastFn(fn: SpellCanCastFn | undefined): void { this.canCastFn = fn; }
  get canUseOnPoint(): boolean { return this.onPoint; }
  set canUseOnPoint(value: boolean) { this.onPoint = value; this.refreshTags(); }
  get canUseOnPointWater(): boolean { return this.onWater; }
  set canUseOnPointWater(value: boolean) { this.onWater = value; this.refreshTags(); }
  SetSpellFn(spell: SpellFn | undefined): void {
    this.spell = spell; this.refreshTags();
  }
  canCast(doer: SpellCastDoer, target: SpellTarget | undefined, position: THREE.Vector3 | undefined): boolean {
    if (this.disposed || this.item.isRemoved || !this.spell
      || (position && ![position.x, position.y, position.z].every(Number.isFinite))) { return false; }
    if (target) {
      const inst = target;
      // TheNet:GetPVPEnabled() is false: a player casts on another player only with PvP.
      return this.onTargets && !inst.isRemoved && !inst.hasTag('INLIMBO') && inst.IsVisible?.() !== false
        && (this.onDead || !inst.components?.health?.IsDead())
        && !['death', 'flight', 'invisible', 'nospellcasting'].some(tag => inst.sg?.hasStateTag(tag))
        && ((this.onRecipes && 'prefab' in inst && typeof inst.prefab === 'string'
          && !!getDeconstructionRecipe(inst.prefab))
          || (!!inst.components?.locomotor && this.onLocomotorsPvP
            && (Object.is(target, doer) || !(inst.hasTag('player') && doer.hasTag('player'))))
          || (this.canCastFn?.(doer, target, position, this.item) ?? false));
    }
    if (!position) { return this.fromInventory; }
    const map = this.map();
    return (this.canCastFn?.(doer, target, position, this.item) ?? true) && !!map
      && (this.onPoint ? map.isAboveGroundAtPoint(position, this.onWater)
        : this.onWater && map.isOceanAtPoint(position)) && !map.isGroundTargetBlocked(position);
  }
  castSpell(target: SpellTarget | undefined, position: THREE.Vector3 | undefined, doer: SpellCastDoer): boolean {
    return this.canCast(doer, target, position) && (this.spell?.(this.item, target, position, doer) ?? false);
  }
  dispose(): void { this.disposed = true; this.refreshTags(); }
  private refreshTags(): void {
    for (const [tag, enabled] of [['castfrominventory', this.fromInventory], ['castonpoint', this.onPoint], ['castonpointwater', this.onWater],
      ['castontargets', this.onTargets && !this.onRecipes && !this.onLocomotorsPvP], ['castonrecipes', this.onTargets && this.onRecipes],
      ['castonlocomotorspvp', this.onTargets && this.onLocomotorsPvP], ['veryquickcast', this.veryQuick]] as const) {
      if (!this.disposed && this.spell && enabled) { this.item.addTag(tag); }
      else { this.item.removeTag(tag); }
    }
  }
}
