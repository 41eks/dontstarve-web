import type * as THREE from 'three';
import { getDeconstructionRecipe } from './recipes.ts';
export interface SpellCastDoer {
  readonly position: THREE.Vector3;
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
export interface SpellCasterComponent {
  canCast(doer: SpellCastDoer, target: object | undefined, position: THREE.Vector3): boolean;
  castSpell(target: object | undefined, position: THREE.Vector3, doer: SpellCastDoer): boolean;
  dispose(): void;
}
interface SpellCasterInst {
  readonly isRemoved: boolean;
  addTag(tag: string): void;
  removeTag(tag: string): void;
}

export interface SpellTarget {
  readonly isRemoved: boolean;
  hasTag(tag: string): boolean;
  isVisible?(): boolean;
  isDead?(): boolean;
  hasStateTag?(tag: string): boolean;
}

type SpellFn = (item: SpellCasterInst, target: object | undefined, position: THREE.Vector3, doer: SpellCastDoer) => boolean;

/** Supported point and target branches of components/spellcaster.lua. */
export class SpellCaster implements SpellCasterComponent {
  private readonly item: SpellCasterInst;
  private readonly map: SpellCastMap | undefined;
  private spell?: SpellFn;
  private onPoint = false;
  private onWater = false;
  private onTargets = false;
  private onRecipes = false;
  private onDead = false;
  private veryQuick = false;
  private canCastFn?: (doer: SpellCastDoer, target: object | undefined, position: THREE.Vector3) => boolean;
  private disposed = false;
  constructor(item: SpellCasterInst, map?: SpellCastMap) { this.item = item; this.map = map; }
  get canUseOnTargets(): boolean { return this.onTargets; }
  set canUseOnTargets(value: boolean) { this.onTargets = value; this.refreshTags(); }
  get canOnlyUseOnRecipes(): boolean { return this.onRecipes; }
  set canOnlyUseOnRecipes(value: boolean) { this.onRecipes = value; this.refreshTags(); }
  get canUseOnDead(): boolean { return this.onDead; }
  set canUseOnDead(value: boolean) { this.onDead = value; }
  get veryQuickCast(): boolean { return this.veryQuick; }
  set veryQuickCast(value: boolean) { this.veryQuick = value; this.refreshTags(); }
  setCanCastFn(fn: (doer: SpellCastDoer, target: object | undefined, position: THREE.Vector3) => boolean): void { this.canCastFn = fn; }
  get canUseOnPoint(): boolean { return this.onPoint; }
  set canUseOnPoint(value: boolean) { this.onPoint = value; this.refreshTags(); }
  get canUseOnPointWater(): boolean { return this.onWater; }
  set canUseOnPointWater(value: boolean) { this.onWater = value; this.refreshTags(); }
  setSpellFn(spell: SpellFn): void {
    this.spell = spell; this.refreshTags();
  }
  canCast(doer: SpellCastDoer, target: object | undefined, position: THREE.Vector3): boolean {
    if (this.disposed || this.item.isRemoved || !this.spell
      || ![position.x, position.y, position.z].every(Number.isFinite)) return false;
    if (target) {
      const inst = target as SpellTarget;
      return this.onTargets && !inst.isRemoved && !inst.hasTag('INLIMBO') && inst.isVisible?.() !== false
        && (this.onDead || !inst.isDead?.())
        && !['death', 'flight', 'invisible', 'nospellcasting'].some(tag => inst.hasStateTag?.(tag))
        && ((this.onRecipes && 'prefab' in inst && typeof inst.prefab === 'string'
          && !!getDeconstructionRecipe(inst.prefab)) || (this.canCastFn?.(doer, target, position) ?? false));
    }
    return (this.canCastFn?.(doer, target, position) ?? true) && !!this.map
      && (this.onPoint ? this.map.isAboveGroundAtPoint(position, this.onWater)
        : this.onWater && this.map.isOceanAtPoint(position)) && !this.map.isGroundTargetBlocked(position);
  }
  castSpell(target: object | undefined, position: THREE.Vector3, doer: SpellCastDoer): boolean {
    return this.canCast(doer, target, position) && (this.spell?.(this.item, target, position, doer) ?? false);
  }
  dispose(): void { this.disposed = true; this.refreshTags(); }
  private refreshTags(): void {
    for (const [tag, enabled] of [['castonpoint', this.onPoint], ['castonpointwater', this.onWater],
      ['castontargets', this.onTargets && !this.onRecipes], ['castonrecipes', this.onTargets && this.onRecipes], ['veryquickcast', this.veryQuick]] as const) {
      if (!this.disposed && this.spell && enabled) this.item.addTag(tag);
      else this.item.removeTag(tag);
    }
  }
}
