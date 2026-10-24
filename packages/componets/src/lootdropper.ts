export interface LootRecipe { ingredients: readonly { type: string; amount: number; deconstruct?: boolean }[] }

export interface LootInst {
  getPosition(): { x: number; y: number; z: number };
  PushEvent?(name: string, data: unknown): void;
}
export interface LootEntity { PushEvent(name: string, data: unknown): void; }
export type ChanceLootTable = readonly (readonly [prefab: string, chance: number])[];
const sharedLootTables = new Map<string, ChanceLootTable>();
export function SetSharedLootTable(name: string, entries: ChanceLootTable): void { sharedLootTables.set(name, entries); }

/** lootdropper.lua SpawnLootPrefab: the host prepares/creates and flings the actual loot inst. */
export class LootDropper {
  private chanceLootTable?: string;
  private loot: readonly string[] = [];
  private readonly inst: LootInst;
  private readonly spawn: (prefab: string, position: ReturnType<LootInst['getPosition']>, skinId?: string) => LootEntity | undefined;
  constructor(inst: LootInst, spawn: LootDropper['spawn']) { this.inst = inst; this.spawn = spawn; }
  SetChanceLootTable(name: string): void { this.chanceLootTable = name; }
  SetLoot(loot: readonly string[]): void { this.loot = [...loot]; }
  GenerateLoot(random = Math.random): string[] {
    return [...(sharedLootTables.get(this.chanceLootTable ?? '') ?? [])
      .filter(([, chance]) => chance >= 1 || random() <= chance).map(([prefab]) => prefab), ...this.loot];
  }
  DropLoot(): void { for (const prefab of this.GenerateLoot()) this.SpawnLootPrefab(prefab); }
  SpawnLootPrefab(prefab: string, position = this.inst.getPosition(), skinId?: string): LootEntity | undefined {
    const loot = this.spawn(prefab, position, skinId);
    if (loot) {
      loot.PushEvent('on_loot_dropped', { dropper: this.inst });
      this.inst.PushEvent?.('loot_prefab_spawned', { loot });
    }
    return loot;
  }
}

/** lootdropper.lua:GetRecipeLoot, unburnt/burnt structures without finiteuses. */
export function GetRecipeLoot(recipe: LootRecipe | undefined, recipes: ReadonlyMap<string, LootRecipe>, burnt = false): { itemId: string; count: number }[] {
  const loot: { itemId: string; count: number }[] = [];
  for (const ingredient of recipe?.ingredients ?? []) {
    const amount = Math.ceil(ingredient.amount * (burnt ? .25 : .5)); // TUNING.(BURNT_)HAMMER_LOOT_PERCENT
    if (ingredient.deconstruct) {
      for (let i = 0; i < amount; i++) loot.push(...GetRecipeLoot(recipes.get(ingredient.type), recipes, burnt));
    } else loot.push({ itemId: ingredient.type, count: amount });
  }
  return loot;
}
