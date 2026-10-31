import type { Vector3 } from 'three';

export interface LootRecipe { ingredients: readonly { type: string; amount: number; deconstruct?: boolean }[] }

export interface LootInst {
  readonly prefab?: string;
  hasTag?(tag: string): boolean;
  readonly components?: { finiteuses?: { GetUses?(): number; GetPercent?(): number } };
  getPosition(): Vector3;
  PushEvent?(name: string, data: unknown): void;
}
export interface LootEntity { PushEvent(name: string, data: unknown): void; }
export type ChanceLootTable = readonly (readonly [prefab: string, chance: number])[];
const sharedLootTables = new Map<string, ChanceLootTable>();
export function SetSharedLootTable(name: string, entries: ChanceLootTable): void { sharedLootTables.set(name, entries); }

/** lootdropper.lua SpawnLootPrefab: the host prepares/creates and flings the actual loot inst. */
export class LootDropper {
  droprecipeloot = true;
  private chanceLootTable?: string;
  private loot: readonly string[] = [];
  private chanceLoot: { prefab: string; chance: number }[] = [];
  private readonly inst: LootInst;
  private readonly spawn: (prefab: string, position: ReturnType<LootInst['getPosition']>, skinId?: string) => LootEntity | undefined;
  private readonly recipes?: ReadonlyMap<string, LootRecipe>;
  constructor(inst: LootInst, spawn: LootDropper['spawn'], recipes?: ReadonlyMap<string, LootRecipe>) {
    this.inst = inst; this.spawn = spawn; this.recipes = recipes;
  }
  SetChanceLootTable(name: string): void { this.chanceLootTable = name; }
  AddChanceLoot(prefab: string, chance: number): void { this.chanceLoot.push({ prefab, chance }); }
  ClearChanceLoot(): void { this.chanceLoot = []; }
  SetLoot(loot: readonly string[]): void { this.loot = [...loot]; }
  GenerateLoot(random = Math.random): string[] {
    const loot = [...this.chanceLoot.filter(({ chance }) => chance >= 1 || random() <= chance).map(({ prefab }) => prefab),
      ...(sharedLootTables.get(this.chanceLootTable ?? '') ?? [])
      .filter(([, chance]) => chance >= 1 || random() <= chance).map(([prefab]) => prefab), ...this.loot];
    const burnt = this.inst.hasTag?.('burnt') === true;
    if (this.droprecipeloot && this.recipes && this.inst.prefab) {
      for (const { itemId, count } of GetRecipeLoot(this.recipes.get(this.inst.prefab), this.recipes,
        burnt, this.inst.components?.finiteuses?.GetPercent?.() ?? 1)) {
        for (let i = 0; i < count; i++) loot.push(itemId);
      }
    }
    if (burnt && random() < .4) loot.push('charcoal');
    return loot;
  }
  DropLoot(position = this.inst.getPosition()): void { for (const prefab of this.GenerateLoot()) this.SpawnLootPrefab(prefab, position); }
  SpawnLootPrefab(prefab: string, position = this.inst.getPosition(), skinId?: string): LootEntity | undefined {
    const loot = this.spawn(prefab, position, skinId);
    if (loot) {
      loot.PushEvent('on_loot_dropped', { dropper: this.inst });
      this.inst.PushEvent?.('loot_prefab_spawned', { loot });
    }
    return loot;
  }
}

/** lootdropper.lua:GetRecipeLoot: recipe salvage scaled by burnt state and remaining uses. */
export function GetRecipeLoot(recipe: LootRecipe | undefined, recipes: ReadonlyMap<string, LootRecipe>, burnt = false, percent = 1): { itemId: string; count: number }[] {
  const loot: { itemId: string; count: number }[] = [];
  for (const ingredient of recipe?.ingredients ?? []) {
    const amount = Math.ceil(ingredient.amount * (burnt ? .25 : .5) * percent); // TUNING.(BURNT_)HAMMER_LOOT_PERCENT
    if (ingredient.deconstruct) {
      for (let i = 0; i < amount; i++) loot.push(...GetRecipeLoot(recipes.get(ingredient.type), recipes, burnt, percent));
    } else loot.push({ itemId: ingredient.type, count: amount });
  }
  return loot;
}
