import type { WorkAction, WorkInst } from './workable';

export interface ToolInst extends WorkInst {
  /** Returns the unsubscribe function. */
  ListenForEvent?(name: string, listener: (data: unknown) => void): () => void;
  readonly components: {
    inventoryitem?: { readonly owner: { PushEvent(name: string, data: unknown): void } | null };
    rechargeable?: unknown;
  };
}

/** components/tool.lua: capability belongs to the item, independent of its prefab ID. */
export class Tool {
  private readonly actions = new Map<WorkAction, number>();
  private readonly inst: ToolInst;
  private readonly stopPercentListener?: () => void;
  constructor(inst: ToolInst) {
    this.inst = inst;
    inst.addTag('tool');
    // tool.lua PercentChanged: a depleted, non-rechargeable tool tells its owner it broke.
    this.stopPercentListener = inst.ListenForEvent?.('percentusedchange', data => {
      const percent = (data as { percent?: number } | undefined)?.percent;
      if (percent === undefined || percent > 0 || inst.components.rechargeable) return;
      inst.components.inventoryitem?.owner?.PushEvent('toolbroke', { tool: inst });
    });
  }
  SetAction(action: WorkAction, effectiveness = 1): void {
    this.actions.set(action, effectiveness);
    this.inst.addTag(`${action}_tool`);
  }
  CanDoAction(action: WorkAction): boolean { return this.actions.has(action); }
  GetEffectiveness(action: WorkAction): number { return this.actions.get(action) ?? 0; }
  dispose(): void {
    this.stopPercentListener?.();
    this.inst.removeTag('tool');
    for (const action of this.actions.keys()) this.inst.removeTag(`${action}_tool`);
    this.actions.clear();
  }
}
