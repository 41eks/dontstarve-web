import type * as THREE from 'three';
export interface SpellCastDoer {
  readonly position: THREE.Vector3;
  hasTag(tag: string): boolean;
  readonly components: {
    sanity?: { doDelta(delta: number): void };
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
  prepareCast(): Promise<void>;
  castSpell(target: object | undefined, position: THREE.Vector3, doer: SpellCastDoer): boolean;
  dispose(): void;
}
interface SpellCasterInst {
  readonly isRemoved: boolean;
  addTag(tag: string): void;
  removeTag(tag: string): void;
}

type SpellFn = (item: SpellCasterInst, target: object | undefined, position: THREE.Vector3, doer: SpellCastDoer) => boolean;

/** Supported point branch of components/spellcaster.lua; capability flags own tags. */
export class SpellCaster implements SpellCasterComponent {
  private readonly item: SpellCasterInst;
  private readonly map: SpellCastMap;
  private spell?: SpellFn;
  private prepare: () => Promise<void> = async () => {};
  private onPoint = false;
  private onWater = false;
  private disposed = false;
  constructor(item: SpellCasterInst, map: SpellCastMap) { this.item = item; this.map = map; }
  get canUseOnPoint(): boolean { return this.onPoint; }
  set canUseOnPoint(value: boolean) { this.onPoint = value; this.refreshTags(); }
  get canUseOnPointWater(): boolean { return this.onWater; }
  set canUseOnPointWater(value: boolean) { this.onWater = value; this.refreshTags(); }
  setSpellFn(spell: SpellFn, prepare: () => Promise<void>): void {
    this.spell = spell; this.prepare = prepare; this.refreshTags();
  }
  canCast(_doer: SpellCastDoer, target: object | undefined, position: THREE.Vector3): boolean {
    if (this.disposed || this.item.isRemoved || !this.spell || target
      || ![position.x, position.y, position.z].every(Number.isFinite)) return false;
    return (this.onPoint ? this.map.isAboveGroundAtPoint(position, this.onWater)
      : this.onWater && this.map.isOceanAtPoint(position)) && !this.map.isGroundTargetBlocked(position);
  }
  prepareCast(): Promise<void> { return this.prepare(); }
  castSpell(target: object | undefined, position: THREE.Vector3, doer: SpellCastDoer): boolean {
    return this.canCast(doer, target, position) && (this.spell?.(this.item, target, position, doer) ?? false);
  }
  dispose(): void { this.disposed = true; this.refreshTags(); }
  private refreshTags(): void {
    for (const [tag, enabled] of [['castonpoint', this.onPoint], ['castonpointwater', this.onWater]] as const) {
      if (!this.disposed && this.spell && enabled) this.item.addTag(tag);
      else this.item.removeTag(tag);
    }
  }
}
