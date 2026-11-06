import { SpriteState } from '@dontstarve-web/display';
import { Workable } from '../../componets/src/workable';
import { ComponentTimer, Timer } from '../../componets/src/timer';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import { actionEntity } from './actionEntity';
import { MakeObstaclePhysics } from './standardcomponents';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import type { ReadonlyVector3 } from './transform';

export const BEEQUEENHIVEGROWN_ID = 'beequeenhivegrown' as const;
export const BEEQUEEN_HIVE_MAX_WORK = 16;
const SEG_TIME = 30;

export interface BeeQueenHiveWorld extends ToolMouseTargetWorld {
  scheduler: GameTimeScheduler;
}

/** beequeenhive.lua `fn` for the grown hive: saved work, regeneration and its delayed honey appearance. */
export class BeeQueenHiveInstance extends PrefabInstance {
  readonly honeyTimer: ComponentTimer;
  pendingHoney?: number;
  declare readonly components: PrefabInstance['components'] & { workable: Workable<BeeQueenHiveInstance>; timer: Timer };

  constructor(world: BeeQueenHiveWorld, position: ReadonlyVector3) {
    super(BEEQUEENHIVEGROWN_ID, new SpriteState({ name: 'large', held: true, billboard: true }));
    this.setPosition(position.x, 0, position.z);
    this.scale.setScalar(1.4);
    for (const tag of ['event_trigger', 'antlion_sinkhole_blocker']) this.addTag(tag);
    this.sprite.playOnce('large');
    for (let level = 0; level < 3; level++) this.sprite.setSymbolHidden(`honey${level}`, true);
    const workable = this.components.workable = new Workable(this);
    workable.SetWorkAction('HAMMER');
    workable.SetMaxWork(BEEQUEEN_HIVE_MAX_WORK);
    workable.SetWorkLeft(BEEQUEEN_HIVE_MAX_WORK);
    workable.savestate = true;
    const timer = this.components.timer = new Timer(world.scheduler, name => onTimer(this, name), ['hiveregen']);
    this.honeyTimer = new ComponentTimer(world.scheduler, () => {
      if (this.pendingHoney !== undefined) showHoneyLevel(this, this.pendingHoney);
      this.pendingHoney = undefined;
    });
    setHoneyLevel(this, honeyLevel(workable.GetWorkLeft()));
    workable.SetOnWorkCallback(onWorked);
    this.onRemove(() => { timer.dispose(); this.honeyTimer.stop(); workable.dispose(); });
  }

  /** The record keeps the timer component's save under beeQueenHiveTimer. */
  OnSave(_inst: unknown, data: PlacementSaveRecord['components']): void {
    const saved = data.timer; delete data.timer;
    if (saved) data.beeQueenHiveTimer = saved;
  }

  /** inst.OnLoad = RefreshHoneyState, after the saved workable and timer. */
  OnLoad(_inst: unknown, data: PlacementSaveRecord['components']): void {
    this.components.timer.OnLoad(data.beeQueenHiveTimer);
    setHoneyLevel(this, honeyLevel(this.components.workable.GetWorkLeft()));
  }
}

function honeyLevel(workleft: number): number {
  return Math.max(0, Math.min(3, 3 + Math.ceil((workleft - BEEQUEEN_HIVE_MAX_WORK) * .5)));
}

function showHoneyLevel(inst: BeeQueenHiveInstance, level: number): void {
  for (let i = 0; i <= 3; i++) inst.sprite.setSymbolHidden(`honey${i}`, i !== level);
}

function setHoneyLevel(inst: BeeQueenHiveInstance, level: number, delay?: number): void {
  inst.honeyTimer.stop(); inst.pendingHoney = undefined;
  if (delay === undefined) showHoneyLevel(inst, level);
  else {
    showHoneyLevel(inst, level - 1);
    inst.pendingHoney = level;
    inst.honeyTimer.start(delay);
  }
}

function onWorked(inst: BeeQueenHiveInstance): void {
  const { workable, timer } = inst.components;
  if (!workable.enabled.peek()) return;
  timer.StopTimer('hiveregen');
  if (workable.GetWorkLeft() < 1) workable.SetWorkLeft(1);
  // OnWorked: large_hit, then a nonlooping large pose. No animover callback is attached here in Lua.
  inst.sprite.playOnce('large_hit');
  inst.sprite.pushAnimation('large', false);
  setHoneyLevel(inst, honeyLevel(workable.GetWorkLeft()));
  timer.StartTimer('hiveregen', 4 * SEG_TIME);
}

function onTimer(inst: BeeQueenHiveInstance, name: string): void {
  if (name !== 'hiveregen' || !inst.components.workable.CanBeWorked() || inst.components.workable.GetWorkLeft() >= BEEQUEEN_HIVE_MAX_WORK) return;
  const old = honeyLevel(inst.components.workable.GetWorkLeft());
  inst.components.workable.SetWorkLeft(inst.components.workable.GetWorkLeft() + 1);
  const next = honeyLevel(inst.components.workable.GetWorkLeft());
  if (inst.components.workable.GetWorkLeft() < BEEQUEEN_HIVE_MAX_WORK) inst.components.timer.StartTimer('hiveregen', SEG_TIME);
  if (old !== next && inst.status.peek() === 'active') {
    inst.sprite.playOnce('transition');
    inst.sprite.pushAnimation('large', false);
    setHoneyLevel(inst, next, 10 / 30);
  } else {
    setHoneyLevel(inst, next);
  }
}

/** The Prefab("beequeenhivegrown", fn, assets) beequeenhive.lua returns. */
export function beeQueenHivePrefabs(world: BeeQueenHiveWorld): Readonly<Record<typeof BEEQUEENHIVEGROWN_ID, PrefabEntityDefinition<BeeQueenHiveInstance>>> {
  return {
    [BEEQUEENHIVEGROWN_ID]: {
      fn: position => new BeeQueenHiveInstance(world, position),
      assets: { animationArchive: 'bee_queen_hive.zip', buildArchives: ['bee_queen_hive.zip'], bank: 'bee_queen_hive' },
      assetOptions: { instancedAnimations: 'all' },
      // MakeObstaclePhysics(inst, PHYS_RAD_LRG).
      physics: { make: MakeObstaclePhysics, radius: 1.9 },
      minimapIcon: 'beequeenhivegrown.png',
      onSpawned: inst => {
        new ToolMouseTarget(actionEntity(inst.transform.model, BEEQUEENHIVEGROWN_ID), inst, inst.components.workable, world.handEquipment);
      },
    },
  };
}
