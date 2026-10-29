import * as THREE from 'three';
import type { World } from 'cannon-es';
import { ArchiveSpriteAssets, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import type { TileStateQuery } from '@dontstarve-web/signals';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import { Workable } from '../../componets/src/workable';
import { ComponentTimer, Timer, type NamedTimerSave } from '../../componets/src/timer';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { MiniMapState } from '../../map/src/minimapState';
import { createArchiveEntity, type PrefabInstance } from './prefabInstance';
import { actionEntity } from './actionEntity';
import { MakeObstaclePhysics } from './standardcomponents';
import { watchTileActivity } from './tileActivity';
import { modelEntries } from './modelRecords';
import { newEntityId } from './saveRecord';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { performToolWork } from '../../stategraphs/src/componentactions';

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
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  workable: Workable;
  timer: Timer;
  honeyTimer: ComponentTimer;
  pendingHoney?: number;
  minimap: MiniMapState;
  stopActivity?: () => void;
}

/** beequeenhive.lua `fn`: the grown hive's saved work and regeneration state. */
export class BeeQueenHiveManager {
  private readonly assets = new ArchiveSpriteAssets('beequeenhivegrown');
  private readonly hives = new Map<THREE.Group, Hive>();
  private disposed = false;

  private readonly scene: THREE.Scene;
  private readonly world: BeeQueenHiveWorld;
  constructor(scene: THREE.Scene, world: BeeQueenHiveWorld) { this.scene = scene; this.world = world; }

  spawn(position: THREE.Vector3, saved?: BeeQueenHiveRecord): THREE.Group {
    if (this.disposed) throw new Error('Bee queen hives have been disposed');
    // PrefabDisplay invokes this shared loader when the tile is active; logical spawn performs no asset IO.
    const build = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(this.assets, {
      animationArchive: 'bee_queen_hive.zip', buildArchives: ['bee_queen_hive.zip'], bank: 'bee_queen_hive',
      animation: clip.name, loop: clip.loop,
    }, { instancedAnimations: 'all', name: BEEQUEENHIVEGROWN_ID });
    const entity = createArchiveEntity(BEEQUEENHIVEGROWN_ID, { create: build },
      { name: 'large', held: true, billboard: true }, BEEQUEENHIVEGROWN_ID);
    const { instance, display } = entity, model = display.model;
    instance.entityId = saved?.id ?? newEntityId();
    instance.position.set(position.x, 0, position.z);
    instance.scale.setScalar(1.4);
    for (const tag of ['event_trigger', 'antlion_sinkhole_blocker']) instance.addTag(tag);
    MakeObstaclePhysics(instance, 1.9);
    if (this.world.physics) instance.bindPhysics(this.world.physics);
    // `fn` plays large without a loop argument, then hides honey0..2. The held pose is its last frame.
    instance.sprite.playOnce('large');
    for (let level = 0; level < 3; level++) instance.sprite.setSymbolHidden(`honey${level}`, true);
    const inst = actionEntity(model, BEEQUEENHIVEGROWN_ID);
    const workable = new Workable(inst);
    workable.SetWorkAction('HAMMER');
    workable.SetMaxWork(BEEQUEEN_HIVE_MAX_WORK);
    workable.SetWorkLeft(BEEQUEEN_HIVE_MAX_WORK);
    workable.savestate = true;
    const hive: Hive = { instance, display, workable, timer: new Timer(this.world.scheduler, name => this.onTimer(hive, name), ['hiveregen']),
      honeyTimer: new ComponentTimer(this.world.scheduler, () => {
        if (hive.pendingHoney !== undefined) this.showHoneyLevel(hive, hive.pendingHoney);
        hive.pendingHoney = undefined;
      }), minimap: instance.minimap };
    hive.minimap.SetIcon('beequeenhivegrown.png');
    if (saved?.components.workable) workable.OnLoad(saved.components.workable);
    this.setHoneyLevel(hive, this.honeyLevel(workable.GetWorkLeft()));
    hive.timer.OnLoad(saved?.components.beeQueenHiveTimer);
    workable.SetOnWorkCallback(() => this.onWorked(hive));
    Object.assign(model.userData.components, { workable, timer: hive.timer });
    new ToolMouseTarget(inst, instance, workable, this.world.handEquipment);
    this.hives.set(model, hive);
    inst.hammerTarget = {
      get id() { return String(instance.entityId); }, instance, display, entity: inst, position: instance.position,
      isValid: () => this.hives.get(model) === hive && workable.CanBeWorked(),
      playHit: () => { performToolWork('HAMMER', inst, {}); },
    };
    this.scene.add(model);
    hive.stopActivity = watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active));
    return model;
  }

  private honeyLevel(workleft: number): number {
    return Math.max(0, Math.min(3, 3 + Math.ceil((workleft - BEEQUEEN_HIVE_MAX_WORK) * .5)));
  }

  private showHoneyLevel(hive: Hive, level: number): void {
    for (let i = 0; i <= 3; i++) hive.instance.sprite.setSymbolHidden(`honey${i}`, i !== level);
  }

  private setHoneyLevel(hive: Hive, level: number, delay?: number): void {
    hive.honeyTimer.stop(); hive.pendingHoney = undefined;
    if (delay === undefined) this.showHoneyLevel(hive, level);
    else {
      this.showHoneyLevel(hive, level - 1);
      hive.pendingHoney = level;
      hive.honeyTimer.start(delay);
    }
  }

  private onWorked(hive: Hive): void {
    const { workable, timer, instance } = hive;
    if (!workable.enabled.peek()) return;
    timer.StopTimer('hiveregen');
    if (workable.GetWorkLeft() < 1) workable.SetWorkLeft(1);
    // OnWorked: large_hit, then a nonlooping large pose. No animover callback is attached here in Lua.
    instance.sprite.playOnce('large_hit');
    instance.sprite.pushAnimation('large', false);
    this.setHoneyLevel(hive, this.honeyLevel(workable.GetWorkLeft()));
    timer.StartTimer('hiveregen', 4 * SEG_TIME);
  }

  private onTimer(hive: Hive, name: string): void {
    if (name !== 'hiveregen' || !hive.workable.CanBeWorked() || hive.workable.GetWorkLeft() >= BEEQUEEN_HIVE_MAX_WORK) return;
    const old = this.honeyLevel(hive.workable.GetWorkLeft());
    hive.workable.SetWorkLeft(hive.workable.GetWorkLeft() + 1);
    const next = this.honeyLevel(hive.workable.GetWorkLeft());
    if (hive.workable.GetWorkLeft() < BEEQUEEN_HIVE_MAX_WORK) hive.timer.StartTimer('hiveregen', SEG_TIME);
    if (old !== next && hive.instance.status.peek() === 'active') {
      hive.instance.sprite.playOnce('transition');
      hive.instance.sprite.pushAnimation('large', false);
      this.setHoneyLevel(hive, next, 10 / 30);
    } else {
      this.setHoneyLevel(hive, next);
    }
  }

  get hammerTargets(): HammerTarget[] { return this.getHammerTargets(); }
  getHammerTargets(model?: THREE.Object3D): HammerTarget[] {
    return modelEntries(this.hives, model).filter(([, hive]) => hive.workable.CanBeWorked())
      .map(([model]) => actionEntity(model, BEEQUEENHIVEGROWN_ID).hammerTarget)
      .filter((target): target is HammerTarget => target !== undefined);
  }

  update(dt: number): void { for (const { instance } of this.hives.values()) instance.sprite.update(dt); }
  get renderEntities() { return [...this.hives].filter(([, hive]) => hive.instance.sprite.loaded)
    .map(([object]) => ({ object, footPosition: object.position, cameraDepth: 0 })); }
  exportRecords(): { prefabId: typeof BEEQUEENHIVEGROWN_ID; record: BeeQueenHiveRecord }[] {
    return [...this.hives].map(([model, hive]) => ({ prefabId: BEEQUEENHIVEGROWN_ID, record: {
      id: String(hive.instance.entityId), transform: { position: [model.position.x, 0, model.position.z], rotationY: model.rotation.y },
      components: { workable: { maxwork: BEEQUEEN_HIVE_MAX_WORK, workleft: hive.workable.GetWorkLeft() },
        ...(hive.timer.OnSave() ? { beeQueenHiveTimer: hive.timer.OnSave() } : {}) },
    } }));
  }
  private remove(model: THREE.Group): void {
    const hive = this.hives.get(model); if (!hive) return;
    this.hives.delete(model);
    model.userData.removed = true;
    hive.stopActivity?.(); hive.timer.dispose(); hive.honeyTimer.stop(); hive.workable.dispose(); hive.instance.remove();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of [...this.hives.keys()]) this.remove(model);
    this.assets.dispose();
  }
}
