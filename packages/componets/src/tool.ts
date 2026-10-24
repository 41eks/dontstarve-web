import type { WorkAction, WorkInst } from './workable';

/** components/tool.lua: capability belongs to the item, independent of its prefab ID. */
export class Tool {
  private readonly actions = new Map<WorkAction, number>();
  private readonly inst: WorkInst;
  constructor(inst: WorkInst) { this.inst = inst; inst.addTag('tool'); }
  SetAction(action: WorkAction, effectiveness = 1): void {
    this.actions.set(action, effectiveness);
    this.inst.addTag(`${action}_tool`);
  }
  CanDoAction(action: WorkAction): boolean { return this.actions.has(action); }
  GetEffectiveness(action: WorkAction): number { return this.actions.get(action) ?? 0; }
  dispose(): void {
    this.inst.removeTag('tool');
    for (const action of this.actions.keys()) this.inst.removeTag(`${action}_tool`);
    this.actions.clear();
  }
}
