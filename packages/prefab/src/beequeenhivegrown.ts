import { PrefabDisplayGroup, PrefabDisplay, SpriteState } from '@dontstarve-web/display';
import * as THREE from 'three';
import type { World } from 'cannon-es';
import { ArchiveSpriteAssets, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { Workable } from '../../componets/src/workable';
import { ComponentTimer, Timer, type NamedTimerSave } from '../../componets/src/timer';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabInstance, bindInstance } from './prefabInstance';
import { actionEntity } from './actionEntity';
import { MakeObstaclePhysics } from './standardcomponents';
import { watchTileActivity } from './tileActivity';
import { newEntityId } from './saveRecord';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';

export const BEEQUEENHIVEGROWN_ID = 'beequeenhivegrown' as const;
export const BEEQUEEN_HIVE_MAX_WORK = 16;
const SEG_TIME = 30;

export interface BeeQueenHiveRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { workable?: { maxwork: number; workleft: number }; beeQueenHiveTimer?: NamedTimerSave };
}

export interface BeeQueenHiveWorld extends ToolMouseTargetWorld {
  tickingarea?: TileStateQuery;
  physics?: World;
  scheduler: GameTimeScheduler;
}

interface Hive {
  instance: BeeQueenHiveInstance;
  display: PrefabDisplay;
  stopActivity?: () => void;
}

/** The hive owns saved work, regeneration and its delayed honey appearance. */
class BeeQueenHiveInstance extends PrefabInstance {
  readonly honeyTimer: ComponentTimer;
  pendingHoney?: number;
  declare readonly components: PrefabInstance['components'] & { workable: Workable<BeeQueenHiveInstance>; timer: Timer };

  constructor(world: BeeQueenHiveWorld, saved?: BeeQueenHiveRecord) {
    super(BEEQUEENHIVEGROWN_ID, new SpriteState({ name: 'large', held: true, billboard: true }));
    this.entityId = saved?.id ?? newEntityId();
    for (const tag of ['event_trigger', 'antlion_sinkhole_blocker']) this.addTag(tag);
    MakeObstaclePhysics(this, 1.9);
    this.sprite.playOnce('large');
    for (let level = 0; level < 3; level++) this.sprite.setSymbolHidden(`honey${level}`, true);
    this.minimap.SetIcon('beequeenhivegrown.png');
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
    if (saved?.components.workable) workable.OnLoad(saved.components.workable);
    setHoneyLevel(this, honeyLevel(workable.GetWorkLeft()));
    timer.OnLoad(saved?.components.beeQueenHiveTimer);
    workable.SetOnWorkCallback(onWorked);
    this.onRemove(() => { timer.dispose(); this.honeyTimer.stop(); workable.dispose(); });
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

/** beequeenhive.lua `fn`: the grown hive's saved work and regeneration state. */
export class BeeQueenHiveManager {
  private readonly assets = new ArchiveSpriteAssets('beequeenhivegrown');
  private readonly hives = new Map<THREE.Group, Hive>();
  private disposed = false;

  private readonly displays: PrefabDisplayGroup;
  private readonly world: BeeQueenHiveWorld;
  constructor(scene: THREE.Scene, world: BeeQueenHiveWorld) { this.displays = new PrefabDisplayGroup(scene); this.world = world; }

  spawn(position: THREE.Vector3, saved?: BeeQueenHiveRecord): THREE.Group {
    if (this.disposed) throw new Error('Bee queen hives have been disposed');
    // PrefabDisplay invokes this shared loader when the tile is active; logical spawn performs no asset IO.
    const build = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(this.assets, {
      animationArchive: 'bee_queen_hive.zip', buildArchives: ['bee_queen_hive.zip'], bank: 'bee_queen_hive',
      animation: clip.name, loop: clip.loop,
    }, { instancedAnimations: 'all', name: BEEQUEENHIVEGROWN_ID });
    const instance = new BeeQueenHiveInstance(this.world, saved);
    const display = new PrefabDisplay({ root: instance.transform.model, name: BEEQUEENHIVEGROWN_ID, status: instance.status, sprite: instance.sprite, archive: { create: build } });
    const model = display.model;
    bindInstance(model, instance);
    instance.position.set(position.x, 0, position.z);
    instance.scale.setScalar(1.4);
    if (this.world.physics) instance.bindPhysics(this.world.physics);
    const inst = actionEntity(model, BEEQUEENHIVEGROWN_ID);
    const hive: Hive = { instance, display };
    new ToolMouseTarget(inst, instance, instance.components.workable, this.world.handEquipment);
    instance.onRemove(() => { this.hives.delete(model); hive.stopActivity?.(); });
    this.hives.set(model, hive);
    this.displays.mount(display);
    hive.stopActivity = watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active));
    return model;
  }

  // The display group advances each entity's declared clip; sleeping and removed entities are skipped.
  update(dt: number): void { this.displays.update(dt); }
  get renderEntities() { return [...this.hives].filter(([, hive]) => hive.instance.sprite.loaded)
    .map(([object]) => ({ object, footPosition: object.position, cameraDepth: 0 })); }
  exportRecords(): { prefabId: typeof BEEQUEENHIVEGROWN_ID; record: BeeQueenHiveRecord }[] {
    return [...this.hives].map(([model, hive]) => ({ prefabId: BEEQUEENHIVEGROWN_ID, record: {
      id: String(hive.instance.entityId), transform: { position: [model.position.x, 0, model.position.z], rotationY: model.rotation.y },
      components: { workable: { maxwork: BEEQUEEN_HIVE_MAX_WORK, workleft: hive.instance.components.workable.GetWorkLeft() },
        ...(hive.instance.components.timer.OnSave() ? { beeQueenHiveTimer: hive.instance.components.timer.OnSave() } : {}) },
    } }));
  }
  private remove(model: THREE.Group): void {
    const hive = this.hives.get(model); if (!hive) return;
    hive.instance.remove();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of [...this.hives.keys()]) this.remove(model);
    this.displays.dispose();
    this.assets.dispose();
  }
}
