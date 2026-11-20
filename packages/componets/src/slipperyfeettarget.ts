import type { LuaFn } from './luaFn';
/** What components/slipperyfeettarget.lua reads from its entity. */
export interface SlipperyFeetTargetInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
  getPosition(): { x: number; z: number };
  /** Physics:GetRadius, or undefined for an entity without physics. */
  getPhysicsRadius(): number | undefined;
}

export type SlipperyFeetTargetIsSlipperyAtPointFn = LuaFn<[inst: SlipperyFeetTargetInst, x: number, y: number, z: number], boolean>;
export type SlipperyFeetTargetRateFn = LuaFn<[inst: SlipperyFeetTargetInst, target: unknown], number>;

/** components/slipperyfeettarget.lua: marks a surface that slipperyfeet users can slide on. */
export class SlipperyFeetTarget {
  private isslipperyatfeetfn?: SlipperyFeetTargetIsSlipperyAtPointFn;
  private ratefn?: SlipperyFeetTargetRateFn;
  private readonly inst: SlipperyFeetTargetInst;

  constructor(inst: SlipperyFeetTargetInst) {
    this.inst = inst;
    inst.addTag('slipperyfeettarget');
  }

  OnRemoveFromEntity(): void { this.inst.removeTag('slipperyfeettarget'); }

  SetIsSlipperyAtPoint(fn: SlipperyFeetTargetIsSlipperyAtPointFn | undefined): void { this.isslipperyatfeetfn = fn; }

  IsSlipperyAtPosition(x: number, z: number): boolean {
    if (this.isslipperyatfeetfn) { return this.isslipperyatfeetfn(this.inst, x, 0, z); }
    const radius = this.inst.getPhysicsRadius();
    if (radius === undefined) { return false; }
    const position = this.inst.getPosition();
    const dx = position.x - x, dz = position.z - z;
    return dx * dx + dz * dz < radius * radius;
  }

  SetSlipperyRate(fn: SlipperyFeetTargetRateFn | undefined): void { this.ratefn = fn; }

  GetSlipperyRate(target: unknown): number { return this.ratefn ? this.ratefn(this.inst, target) : 1; }
}
