import { SpriteState } from '@dontstarve-web/display';
import { Workable, type Worker } from '../../componets/src/workable';
import { Repairable } from '../../componets/src/repairable';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';
import { spawnStructureLoot } from './structureLoot';
import { Transform } from './transform';
import type { WorldContext } from './worldContext';

export const CHESSJUNK_IDS = ['chessjunk1', 'chessjunk2', 'chessjunk3'] as const;
export type ChessJunkId = typeof CHESSJUNK_IDS[number];
/** chessjunk.lua OnSave: repaired, repairerid and repairerchar. */
export interface ChessJunkSaveState { repaired: true; repairerid?: string; repairerchar?: string }
export interface ChessJunkWorld {
  scheduler: GameTimeScheduler;
  fx?: WorldContext['fx'];
  dropLoot?: WorldContext['dropLoot'];
}
interface Repairer { readonly prefab?: string; readonly userid?: string }

const MAXHITS = 6;

SetSharedLootTable('chess_junk', [
  ['trinket_6', 1], ['trinket_6', .55], ['trinket_1', .25], ['gears', .25], ['redgem', .25],
  ['greengem', .05], ['yellowgem', .05], ['purplegem', .05], ['orangegem', .05], ['thulecite', .01],
]);

/** BasePile's inst.style, inst.repaired, inst.repairerid and inst.repairerchar. */
export class ChessJunkInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { workable: Workable; lootdropper: LootDropper; repairable: Repairable };
  readonly style: 1 | 2 | 3;
  repaired = false;
  repairerid?: string;
  repairerchar?: string;
  constructor(prefab: ChessJunkId) {
    const style = Number(prefab.at(-1)) as 1 | 2 | 3;
    super(prefab, new SpriteState({ name: `idle${style}`, billboard: true }), Transform.stationary());
    this.style = style;
  }
}

/**
 * OnPlayerRepaired: the gears chance loot, DropLoot and Remove. SpawnScionAtXZ's maxwell_smoke and
 * bishop/rook/knight_nightmare are not ported, so no scion follows.
 */
function OnPlayerRepaired(inst: ChessJunkInstance): void {
  inst.components.lootdropper.AddChanceLoot('gears', .1);
  inst.components.lootdropper.DropLoot();
  inst.remove();
}

function OnRepaired(inst: ChessJunkInstance, doer?: Repairer): void {
  if (inst.components.workable.GetWorkLeft() < MAXHITS) {
    inst.SoundEmitter!.PlaySound('dontstarve/common/chesspile_repair');
    inst.sprite.playOnce(`hit${inst.style}`);
    inst.sprite.pushAnimation(`idle${inst.style}`, false);
  } else {
    inst.sprite.start(`hit${inst.style}`);
    inst.SoundEmitter!.PlaySound('dontstarve/common/chesspile_ressurect');
    inst.DoTaskInTime(.7, OnPlayerRepaired);
    inst.repaired = true;
    if (doer?.userid) {
      inst.repairerid = doer.userid;
      inst.repairerchar = doer.prefab;
    }
  }
}

/**
 * OnHammered: DropLoot, Remove, then collapse_small with the metal material. TryLuckRoll's scion branch
 * (ms_sendlightningstrike and SpawnScionAtXZ) is not ported, so the collapse branch always runs.
 */
function OnHammered(inst: ChessJunkInstance, _worker: Worker): void {
  inst.components.lootdropper.DropLoot();
  const position = inst.getPosition();
  inst.remove();
  inst.worldServices?.fx?.collapse?.('small', position, 'metal');
}

function OnHit(inst: ChessJunkInstance): void {
  inst.sprite.playOnce(`hit${inst.style}`);
  inst.sprite.pushAnimation(`idle${inst.style}`, false);
  inst.SoundEmitter!.PlaySound('dontstarve/common/lightningrod');
}

function OnSave(pile: ChessJunkInstance, data: PlacementSaveRecord['components']): void {
  if (!pile.repaired) return;
  data.chessJunk = { repaired: true,
    ...pile.repairerid === undefined ? {} : { repairerid: pile.repairerid },
    ...pile.repairerchar === undefined ? {} : { repairerchar: pile.repairerchar } };
}

function OnLoad(pile: ChessJunkInstance, data: PlacementSaveRecord['components']): void {
  const saved = data.chessJunk;
  if (!saved?.repaired) return;
  pile.components.workable.SetWorkLeft(MAXHITS);
  OnRepaired(pile);
  pile.repairerid = saved.repairerid;
  pile.repairerchar = saved.repairerchar;
}

/** BasePile(style). The YOTH special-event loot is not ported. */
function BasePile(world: ChessJunkWorld, prefab: ChessJunkId): ChessJunkInstance {
  const inst = new ChessJunkInstance(prefab);
  inst.AddSoundEmitter();
  inst.worldServices = { scheduler: world.scheduler, fx: world.fx, dropLoot: world.dropLoot };
  inst.addTag('chess');
  inst.addTag('mech');
  // PlayAnimation("idle"..style) has no loop argument.
  inst.sprite.playOnce(`idle${inst.style}`);

  addComponent(inst, 'inspectable', Inspectable);
  const lootdropper = addComponent(inst, 'lootdropper', LootDropper, spawnStructureLoot(inst));
  lootdropper.SetChanceLootTable('chess_junk');

  const workable = addComponent(inst, 'workable', Workable);
  workable.SetWorkAction('HAMMER');
  workable.SetWorkLeft(MAXHITS / 2);
  workable.SetMaxWork(MAXHITS);
  workable.SetOnFinishCallback(OnHammered);
  workable.SetOnWorkCallback(OnHit);

  const repairable = addComponent(inst, 'repairable', Repairable, workable, 'gears');
  repairable.onrepaired = doer => OnRepaired(inst, doer as Repairer | undefined);

  // MakeHauntableWork: its work attempt is commented out, so the haunt returns false.
  addComponent(inst, 'hauntable', Hauntable, world.scheduler).SetOnHauntFn(() => false);

  inst.OnSave = OnSave;
  inst.OnLoad = OnLoad;
  return inst;
}

/** chessjunk1–3. The random `chessjunk` and the ruins respawners are not ported. */
export function chessJunkPrefabs(world: ChessJunkWorld): Readonly<Record<ChessJunkId, PrefabEntityDefinition<ChessJunkInstance>>> {
  const pile = (prefab: ChessJunkId): PrefabEntityDefinition<ChessJunkInstance> => ({
    fn: () => BasePile(world, prefab),
    assets: { animationArchive: 'chessmonster_ruins.zip', buildArchives: ['chessmonster_ruins.zip'], bank: 'chessmonster_ruins' },
    assetOptions: { instancedAnimations: 'all' },
    physics: { make: MakeObstaclePhysics, radius: 1.2 },
    minimapIcon: 'chessjunk.png',
  });
  return Object.fromEntries(CHESSJUNK_IDS.map(id => [id, pile(id)])) as Record<ChessJunkId, PrefabEntityDefinition<ChessJunkInstance>>;
}
