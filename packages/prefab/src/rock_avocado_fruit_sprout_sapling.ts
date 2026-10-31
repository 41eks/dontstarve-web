import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { modelEntries } from './modelRecords';
import * as THREE from 'three';
import { createEffect, createMemo, readonlySignal, getBoundWatchWorldContent, type TileStateQuery } from '@dontstarve-web/signals';
import { SpriteResources, type ArchiveSpriteCommands, type PrefabDisplay } from '@dontstarve-web/display';
import { createArchiveEntity, type PrefabInstance, prefabInstance } from './prefabInstance';
import { watchTileActivity } from './tileActivity';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Timer, ComponentTimer, type NamedTimerSave } from '../../componets/src/timer';
import { Workable } from '../../componets/src/workable';
import { Burnable } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import { actionEntity, FindEntities } from './actionEntity';
import { newEntityId } from './saveRecord';
import type { SpawnGroundItem } from './groundPrefab';
import type { RockAvocadoBushManager } from './rock_avocado_bush';
import type { ShovelTarget } from '../../stategraphs/src/dig';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { PlaySound, type SoundHandle } from './sound';
import catalog from './groundItems.json' with { type: 'json' };

export const ROCK_AVOCADO_SAPLING_ID = 'rock_avocado_fruit_sprout_sapling' as const;
export const ROCK_AVOCADO_SPROUT_GROW_TIME = 1500;
/** seed_growth in rock_avocado_fruit.zip, 23 frames at 30 fps: its animover (grow_anim_over) spawns the bush. */
const SEED_GROWTH_SECONDS = 23 / 30;
export interface RockAvocadoSaplingRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { saplingTimer?: NamedTimerSave };
}
interface DrawnEntity { instance: PrefabInstance<ArchiveSpriteCommands>; display: PrefabDisplay }
interface Sapling {
  entity: DrawnEntity;
  stopActivity?: () => void;
  timer: Timer;
  completion: ComponentTimer;
  transitionAt: number;
  phase: ReturnType<typeof createMemo<string>>;
  workable: Workable;
  burnable: Burnable;
  propagator: Propagator;
  fire: DrawnEntity;
  sound?: SoundHandle;
  stopBurning(): void;
}
export interface RockAvocadoSaplingWorld extends ToolMouseTargetWorld {
  scheduler?: GameTimeScheduler;
  tickingarea?: TileStateQuery;
  /** growtree's natural bush. */
  bushes: Pick<RockAvocadoBushManager, 'spawnNatural'>;
  /** DIG's sprout and DefaultBurntFn's ash; their displays load the art. */
  spawnGroundItem: SpawnGroundItem;
}

/** rock_avocado_fruit.lua's buried sprout: named growth timer, DIG, ignition and seed_growth completion. */
export class RockAvocadoSaplingManager {
  private readonly displays: PrefabDisplayGroup;
  private readonly world: RockAvocadoSaplingWorld;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly resources = new SpriteResources();
  private readonly saplings = new Map<THREE.Group, Sapling>();
  private readonly sounds = new Set<SoundHandle>();
  private disposed = false;
  constructor(scene: THREE.Scene, world: RockAvocadoSaplingWorld) {
    this.displays = new PrefabDisplayGroup(scene); this.world = world; this.scheduler = world.scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !world.scheduler;
  }
  /** rock_avocado_fruit_sprout ondeploy: SpawnPrefab of the buried sprout; the display loads the art. */
  transplant(position: THREE.Vector3): boolean {
    this.spawn(position);
    return true;
  }
  spawn(position: THREE.Vector3, saved?: RockAvocadoSaplingRecord): THREE.Group {
    if (this.disposed) throw new Error('Saplings disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid sprout position');
    const drawn: DrawnEntity = createArchiveEntity(ROCK_AVOCADO_SAPLING_ID, this.resources.archive({
      animationArchive: 'rock_avocado_fruit.zip', buildArchives: ['rock_avocado_fruit_build.zip'],
      // seed_growth includes the engine's snow placeholder; this prefab has no MakeSnowCovered.
      bank: 'rock_avo_fruit_master', hiddenSymbols: ['snow'],
    }, { instancedAnimations: 'all', staticBillboard: true }),
      { name: 'idle_buried_seed', billboard: true }, ROCK_AVOCADO_SAPLING_ID);
    const sprite = drawn.instance.sprite;
    sprite.playOnce('idle_buried_seed'); sprite.setSymbolHidden('snow', true);
    // The burning fx entity is drawn only while the sprout burns.
    const fire: DrawnEntity = createArchiveEntity('fire', this.resources.archive({
      animationArchive: 'fire.zip', buildArchives: ['fire.zip'], bank: 'fire' }),
      { name: 'level2', billboard: true }, 'fire', instance => instance.setActive(false));
    for (const tag of ['FX', 'HASHEATER']) fire.instance.addTag(tag);
    fire.instance.persists = false;
    const model = drawn.display.model, fireModel = fire.display.model;
    drawn.instance.position.set(position.x, 0, position.z);
    drawn.instance.entityId = saved?.id ?? newEntityId();
    Object.assign(model.userData, { deploySmartRadius: 3 });
    const entity = actionEntity(model, ROCK_AVOCADO_SAPLING_ID);
    const completion = new ComponentTimer(this.scheduler, () => {
      if (this.saplings.get(model) !== sapling) return;
      const point = model.position.clone();
      this.sounds.add(PlaySound('dontstarve/forest/treeGrow', point));
      this.remove(model); this.world.bushes.spawnNatural(point);
    });
    const timer = new Timer(this.scheduler, name => {
      if (name !== 'grow') return;
      sprite.playOnce('seed_growth'); sapling.transitionAt = this.scheduler.now;
      completion.start(SEED_GROWTH_SECONDS);
    }, ['grow']);
    const workable = new Workable(entity);
    workable.SetWorkAction('DIG'); workable.SetWorkLeft(1);
    workable.SetOnFinishCallback(() => {
      this.world.spawnGroundItem({ ...catalog.items.rock_avocado_fruit_sprout, itemId: 'rock_avocado_fruit_sprout', count: 1 }, model.position.clone());
      this.remove(model);
    });
    const burnable = new Burnable(entity, this.scheduler); burnable.SetBurnTime(7.5);
    const propagator = new Propagator(entity, 'small', radius => {
      return FindEntities(entity.getPosition(), radius).filter(inst => inst.components.propagator && !inst.hasTag('INLIMBO'));
    }, 3, this.scheduler, getBoundWatchWorldContent());
    Object.assign(entity.components, { workable, timer, burnable, propagator });
    new ToolMouseTarget(entity, drawn.instance, workable, this.world.handEquipment);
    const startGrowing = () => { if (!timer.TimerExists('grow')) timer.StartTimer('grow', ROCK_AVOCADO_SPROUT_GROW_TIME); };
    burnable.SetOnIgniteFn(() => timer.StopTimer('grow'));
    burnable.SetOnExtinguishFn(() => {
      startGrowing();
      this.sounds.add(PlaySound('dontstarve/common/fireOut', model.position));
    });
    burnable.SetOnBurntFn(() => { this.world.spawnGroundItem({ ...catalog.items.ash, itemId: 'ash', count: 1 }, model.position.clone()); this.remove(model); });
    const phase = createMemo(() => burnable.burning.get() ? 'burning'
      : completion.snapshot.get().status === 'scheduled' ? 'emerging' : 'growing');
    const sapling: Sapling = { entity: drawn, fire, timer, completion, workable, burnable, propagator,
      transitionAt: this.scheduler.now, phase, stopBurning: () => {} };
    this.saplings.set(model, sapling);
    model.userData.saplingState = { phase: readonlySignal(phase), growTimer: timer.snapshot('grow'), completionTimer: completion.snapshot };
    sapling.stopBurning = createEffect(() => {
      sprite.art.get();
      const visible = burnable.burning.get() && sprite.loaded;
      fire.instance.setActive(visible);
      if (visible) {
        fire.instance.position.copy(model.position);
        if (!fireModel.parent) this.displays.mount(prefabDisplay(fireModel)!);
        sapling.sound ??= PlaySound('dontstarve/common/campfire', model.position);
        prefabInstance(model)!.light.set({ colour: [1, 1, 192 / 255], radius: 9, intensity: .8, falloff: .33 });
      } else {
        sapling.sound?.stop(); sapling.sound = undefined;
        prefabInstance(model)!.light.set(null);
      }
    });
    startGrowing(); timer.OnLoad(saved?.components.saplingTimer);
    this.displays.mount(prefabDisplay(model)!);
    sapling.stopActivity = watchTileActivity(model, this.world.tickingarea, active => drawn.instance.setActive(active));
    return model;
  }
  update(dt: number, _quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
    for (const { entity, fire, transitionAt } of this.saplings.values()) {
      // A clip that started this frame advances only by the game time since its transition.
      entity.display.update(Math.min(dt, this.scheduler.now - transitionAt));
      fire.instance.position.copy(entity.instance.position);
      fire.display.update(dt);
    }
  }
  get renderEntities() {
    return [...this.saplings.values()].flatMap(({ entity, fire }) => [...entity.instance.sprite.loaded ? [entity.display.model] : [],
      ...fire.instance.sprite.loaded ? [fire.display.model] : []]
      .map(object => ({ object, footPosition: entity.display.model.position, cameraDepth: 0 })));
  }
  get digTargets(): ShovelTarget[] { return this.getDigTargets(); }

  getDigTargets(model?: THREE.Object3D): ShovelTarget[] {
    return modelEntries(this.saplings, model).map(([model, sapling]) => ({ id: String(sapling.entity.instance.entityId), model, position: model.position,
      entity: actionEntity(model, ROCK_AVOCADO_SAPLING_ID), isValid: () => this.saplings.get(model) === sapling && sapling.workable.CanBeWorked(),
      dig: () => performToolWork('DIG', actionEntity(model, ROCK_AVOCADO_SAPLING_ID), {}),
    }));
  }
  exportRecords(): RockAvocadoSaplingRecord[] {
    this.scheduler.advanceTo(this.scheduler.now);
    return [...this.saplings].map(([model, { timer, entity }]) => ({ id: String(entity.instance.entityId),
      transform: { position: model.position.toArray() as [number, number, number], rotationY: 0 },
      components: { saplingTimer: timer.OnSave() ?? { timers: {} } },
    }));
  }
  remove(model: THREE.Group): void {
    const sapling = this.saplings.get(model); if (!sapling) return;
    this.saplings.delete(model); model.userData.removed = true;
    sapling.stopActivity?.(); sapling.stopBurning();
    sapling.burnable.SetOnExtinguishFn(undefined); sapling.burnable.dispose(); sapling.propagator.dispose();
    sapling.timer.dispose(); sapling.completion.stop(); sapling.workable.dispose(); sapling.phase.dispose();
    sapling.sound?.stop(); prefabInstance(model)!.light.set(null);
    for (const { instance, display } of [sapling.entity, sapling.fire]) { instance.remove(); display.dispose(); }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of this.saplings.keys()) this.remove(model);
    for (const sound of this.sounds) sound.stop(); this.sounds.clear(); this.displays.dispose(); this.resources.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();

  }
}
