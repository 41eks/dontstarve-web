/** recipes.lua CONSTRUCTION_PLANS: the materials each construction site takes, as { type, amount } slots. */
export const CONSTRUCTION_PLANS: Readonly<Record<string, readonly { type: string; amount: number }[]>> = {
  support_pillar: [{ type: 'rocks', amount: 40 }],
};

/** constructionsite.lua OnSave: each material's amount by prefab. */
export interface ConstructionSiteSave { materials: Record<string, number> }

export interface ConstructionSiteInst {
  readonly prefab: string;
  addTag(tag: string): void;
}

/**
 * components/constructionsite.lua: the materials held, the enabled flag, the construction prefab and OnSave / OnLoad.
 * Not ported: the builder and ForceStopConstruction's constructionbuilder (a nil builder makes it a no-op here),
 * OnStartConstruction / OnStopConstruction / OnConstruct and their callbacks, AddMaterial / RemoveMaterial /
 * DropAllMaterials, IsComplete / ForceCompletion and the replica's slot counts.
 */
export class ConstructionSite {
  private readonly inst: ConstructionSiteInst;
  private readonly materials = new Map<string, { amount: number; slot?: number }>();
  constructionprefab?: string;
  enabled = true;

  constructor(inst: ConstructionSiteInst) {
    this.inst = inst;
    // V2C: Recommended to explicitly add tag to prefab pristine state
    inst.addTag('constructionsite');
  }

  Enable(): void { this.enabled = true; }
  /** Disable: ForceStopConstruction has no builder to stop. */
  Disable(): void { this.enabled = false; }
  IsEnabled(): boolean { return this.enabled; }
  SetConstructionPrefab(prefab: string): void { this.constructionprefab = prefab; }

  GetMaterialCount(prefab: string | undefined): number {
    return (prefab === undefined ? undefined : this.materials.get(prefab))?.amount ?? 0;
  }

  GetSlotCount(slot: number): number {
    return this.GetMaterialCount(CONSTRUCTION_PLANS[this.inst.prefab]?.[slot - 1]?.type);
  }

  OnSave(): ConstructionSiteSave | undefined {
    if (this.materials.size === 0) { return undefined; }
    return { materials: Object.fromEntries([...this.materials].map(([prefab, { amount }]) => [prefab, amount])) };
  }

  /** OnLoad: the plan's materials take their slots, any other saved material is kept without one. */
  OnLoad(data: Partial<ConstructionSiteSave>): void {
    if (data.materials === undefined) { return; }
    (CONSTRUCTION_PLANS[this.inst.prefab] ?? []).forEach(({ type }, index) => {
      const amount = data.materials![type];
      if (amount !== undefined) { this.materials.set(type, { amount, slot: index + 1 }); }
    });
    for (const [prefab, amount] of Object.entries(data.materials)) {
      if (!this.materials.has(prefab)) { this.materials.set(prefab, { amount }); }
    }
  }
}
