import { SpriteState } from '@dontstarve-web/display';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { Workable } from '../../componets/src/workable';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import { Transform } from './transform';

export const RUINS_STATUE_MAGE_ID = 'ruins_statue_mage' as const;
export const RUINS_STATUE_MAGE_NOGEM_ID = 'ruins_statue_mage_nogem' as const;
export const RUINS_STATUE_HEAD_ID = 'ruins_statue_head' as const;
export const RUINS_STATUE_HEAD_NOGEM_ID = 'ruins_statue_head_nogem' as const;
export const RUINS_STATUE_GEMS = ['greengem', 'redgem', 'bluegem', 'yellowgem', 'orangegem', 'purplegem'] as const;
export type RuinsStatueGem = typeof RUINS_STATUE_GEMS[number];
/** onsave: data.gem = inst.gemmed. gem() statues save their gem; the save field keeps the mage's original name.
 * nogem() never calls SetGemmed, so its onsave writes `gem = nil`. */
export interface RuinsStatueSaveState { gem: RuinsStatueGem }
export type RuinsStatueId = typeof RUINS_STATUE_MAGE_ID | typeof RUINS_STATUE_MAGE_NOGEM_ID | typeof RUINS_STATUE_HEAD_ID | typeof RUINS_STATUE_HEAD_NOGEM_ID;

export interface RuinsStatueWorld { scheduler: GameTimeScheduler }

// statueruins.lua SetSharedLootTable('statue_ruins_no_gem', ...).
SetSharedLootTable('statue_ruins_no_gem', [['thulecite', 1], ['nightmarefuel', 1], ['thulecite', .05]]);

/**
 * The Prefab(...) list of statueruins.lua: commonfn(small) picks SetBank / SetBuild, gem() adds SetGemmed from the
 * matching gem build (`inst.small and "statue_ruins_small_gem" or "statue_ruins_gem"`), nogem() a chance loot table.
 */
interface RuinsStatueVariant { archive: string; bank: string; gemArchive?: string; chanceLootTable?: string }
const VARIANTS: Readonly<Record<RuinsStatueId, RuinsStatueVariant>> = {
  [RUINS_STATUE_MAGE_ID]: { archive: 'statue_ruins.zip', bank: 'statue_ruins', gemArchive: 'statue_ruins_gem.zip' },
  [RUINS_STATUE_MAGE_NOGEM_ID]: { archive: 'statue_ruins.zip', bank: 'statue_ruins', chanceLootTable: 'statue_ruins_no_gem' },
  [RUINS_STATUE_HEAD_ID]: { archive: 'statue_ruins_small.zip', bank: 'statue_ruins_small', gemArchive: 'statue_ruins_small_gem.zip' },
  [RUINS_STATUE_HEAD_NOGEM_ID]: { archive: 'statue_ruins_small.zip', bank: 'statue_ruins_small', chanceLootTable: 'statue_ruins_no_gem' },
};
export const RUINS_STATUE_IDS = Object.keys(VARIANTS) as RuinsStatueId[];

/** statueruins.lua commonfn() with gem() or nogem(). Mining, the nightmare cycle and their FX are not ported. */
export class RuinsStatueInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { workable: Workable; lootdropper: LootDropper; inspectable: Inspectable; hauntable: Hauntable };
  /** inst.gemmed. */
  gemmed?: RuinsStatueGem;
  private readonly gemArchive?: string;

  constructor(prefab: RuinsStatueId, world: RuinsStatueWorld, position: ReadonlyVector3) {
    super(prefab, new SpriteState({ name: 'idle_full', billboard: true }), Transform.stationary());
    const variant = VARIANTS[prefab];
    this.gemArchive = variant.gemArchive;
    this.setPosition(position.x, 0, position.z);
    for (const tag of ['cavedweller', 'structure', 'statue']) this.addTag(tag);
    this.minimap.SetIcon('statue_ruins.png');
    const workable = new Workable(this);
    workable.SetWorkAction('MINE'); workable.SetWorkLeft(10);
    const lootdropper = new LootDropper(this, () => undefined);
    if (variant.chanceLootTable) lootdropper.SetChanceLootTable(variant.chanceLootTable);
    const hauntable = new Hauntable(this, world.scheduler);
    hauntable.SetOnHauntFn(() => false);
    Object.assign(this.components, { workable, lootdropper, inspectable: new Inspectable(this), hauntable });
    // commonfn immediately invokes OnNightmarePhaseChanged(..., true): ShowWorkState plays idle_full looping, with no
    // `_night` suffix because this world has the calm phase.
    this.sprite.start('idle_full');
    // gem() calls SetGemmed with a random gem; OnLoad calls it again when data.gem exists.
    if (this.gemArchive) this.SetGemmed(RUINS_STATUE_GEMS[Math.floor(Math.random() * RUINS_STATUE_GEMS.length)]);

    this.OnSave = (_inst, data) => { if (this.gemmed !== undefined) data.ruinsStatueMage = { gem: this.gemmed }; };
    this.OnLoad = (_inst, data) => { if (data.ruinsStatueMage?.gem !== undefined) this.SetGemmed(data.ruinsStatueMage.gem); };
    this.onRemove(() => { workable.dispose(); hauntable.dispose(); });
  }

  /** SetGemmed: the swap_gem override from the gem build, SetLoot({ "thulecite", gem }) and AddChanceLoot("thulecite", .05). */
  SetGemmed(gem: RuinsStatueGem): void {
    if (!this.gemArchive) return;
    this.gemmed = gem;
    this.sprite.setSymbolOverride('swap_gem', this.gemArchive, gem);
    this.components.lootdropper.SetLoot(['thulecite', gem]);
    this.components.lootdropper.AddChanceLoot('thulecite', .05);
  }
}

/** The four Prefabs statueruins.lua returns. */
export function ruinsStatuePrefabs(world: RuinsStatueWorld): Readonly<Record<RuinsStatueId, PrefabEntityDefinition<RuinsStatueInstance>>> {
  const prefabs = {} as Record<RuinsStatueId, PrefabEntityDefinition<RuinsStatueInstance>>;
  for (const prefab of RUINS_STATUE_IDS) {
    const { archive, bank, gemArchive } = VARIANTS[prefab];
    prefabs[prefab] = {
      fn: position => new RuinsStatueInstance(prefab, world, position),
      assets: { animationArchive: archive, buildArchives: [archive, ...gemArchive ? [gemArchive] : []], bank },
      assetOptions: { instancedAnimations: 'all' },
      physics: { make: MakeObstaclePhysics, radius: .66 },
    };
  }
  return prefabs;
}
