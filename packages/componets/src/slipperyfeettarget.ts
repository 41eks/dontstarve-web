/** What components/slipperyfeettarget.lua reads from its entity. */
export interface SlipperyFeetTargetInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
  getPosition(): { x: number; z: number };
  /** Physics:GetRadius, or undefined for an entity without physics. */
  getPhysicsRadius(): number | undefined;
}

/** components/slipperyfeettarget.lua: marks a surface that slipperyfeet users can slide on. */
export class SlipperyFeetTarget {
  private isslipperyatfeetfn?: (inst: SlipperyFeetTargetInst, x: number, z: number) => boolean;
  private ratefn?: (inst: SlipperyFeetTargetInst, target: unknown) => number;
  private readonly inst: SlipperyFeetTargetInst;

  constructor(inst: SlipperyFeetTargetInst) {
    this.inst = inst;
    inst.addTag('slipperyfeettarget');
  }

  OnRemoveFromEntity(): void { this.inst.removeTag('slipperyfeettarget'); }

  SetIsSlipperyAtPoint(fn: SlipperyFeetTarget['isslipperyatfeetfn']): void { this.isslipperyatfeetfn = fn; }

  IsSlipperyAtPosition(x: number, z: number): boolean {
    if (this.isslipperyatfeetfn) return this.isslipperyatfeetfn(this.inst, x, z);
    const radius = this.inst.getPhysicsRadius();
    if (radius === undefined) return false;
    const position = this.inst.getPosition();
    const dx = position.x - x, dz = position.z - z;
    return dx * dx + dz * dz < radius * radius;
  }

  SetSlipperyRate(fn: SlipperyFeetTarget['ratefn']): void { this.ratefn = fn; }

  GetSlipperyRate(target: unknown): number { return this.ratefn ? this.ratefn(this.inst, target) : 1; }
}
