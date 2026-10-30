import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { modelEntries } from './modelRecords';
import * as THREE from 'three';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { SpriteResources, type ArchiveSpriteCommands, type PrefabDisplay } from '@dontstarve-web/display';
import { createArchiveEntity, type PrefabInstance } from './prefabInstance';
import { watchTileActivity } from './tileActivity';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Timer, type NamedTimerSave } from '../../componets/src/timer';
import { Workable } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import type { SpawnGroundItem } from './groundPrefab';
import type { MarbleShrubManager } from './marbleshrub';
import type { ShovelTarget } from '../../stategraphs/src/shovel';
import { performToolWork } from '../../stategraphs/src/componentactions';
import catalog from './groundItems.json' with { type: 'json' };

export const MARBLEBEAN_SAPLING_ID = 'marblebean_sapling' as const;
const DAY_TIME = 300; // tuning.lua day_time.
// planted_tree.lua startgrowing without growtimes: TUNING.PINECONE_GROWTIME = {base = .75 * day_time, random = .25 * day_time}.
export const MARBLEBEAN_GROW_TIME = { base: .75 * DAY_TIME, random: .25 * DAY_TIME } as const;

export interface MarbleBeanSaplingRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { saplingTimer?: NamedTimerSave };
}
interface Sapling {
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  stopActivity?: () => void;
  timer: Timer;
  workable: Workable;
}
export interface MarbleBeanSaplingWorld extends ToolMouseTargetWorld {
  scheduler?: GameTimeScheduler;
  tickingarea?: TileStateQuery;
  shrubs: Pick<MarbleShrubManager, 'growFromSeed'>;
  /** digup's marblebean; its display loads the art. */
  spawnGroundItem: SpawnGroundItem;
}

/** planted_tree.lua sapling_fn("marblebean", ...): a fireproof sapling with a `grow` timer and a DIG workable. */
export class MarbleBeanSaplingManager {
  private readonly displays: PrefabDisplayGroup;
  private readonly world: MarbleBeanSaplingWorld;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly resources = new SpriteResources();
  private readonly saplings = new Map<THREE.Group, Sapling>();
  private disposed = false;

  constructor(scene: THREE.Scene, world: MarbleBeanSaplingWorld) {
    this.displays = new PrefabDisplayGroup(scene); this.world = world;
    this.scheduler = world.scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !world.scheduler;
  }

  /** marblebean.lua ondeploy: spawn the sapling and StartGrowing at the planted point; the display loads the art. */
  transplant(position: THREE.Vector3): boolean {
    this.spawn(position);
    return true;
  }

  spawn(position: THREE.Vector3, saved?: MarbleBeanSaplingRecord): THREE.Group {
    if (this.disposed) throw new Error('Marble bean saplings disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid sapling position');
    const { instance, display } = createArchiveEntity(MARBLEBEAN_SAPLING_ID, this.resources.archive({ animationArchive: 'marblebean.zip',
      buildArchives: ['marblebean.zip'], bank: 'marblebean' }, { instancedAnimations: 'all', staticBillboard: true }),
      { name: 'idle_planted', billboard: true }, MARBLEBEAN_SAPLING_ID);
    instance.sprite.playOnce('idle_planted');
    const model = display.model;
    instance.position.set(position.x, 0, position.z);
    instance.entityId = saved?.id ?? newEntityId();
    Object.assign(model.userData, { deploySmartRadius: 1 });
    instance.addTag('marbleshrub');
    const entity = actionEntity(model, MARBLEBEAN_SAPLING_ID);
    const timer = new Timer(this.scheduler, name => {
      // growtree: the shrub replaces the sapling at its position and grows from seed.
      if (name === 'grow') { this.world.shrubs.growFromSeed(model.position.clone()); this.remove(model); }
    }, ['grow']);
    const workable = new Workable(entity);
    workable.SetWorkAction('DIG'); workable.SetWorkLeft(1);
    // digup: lootdropper loot is `marblebean`, then the sapling is removed.
    workable.SetOnFinishCallback(() => {
      this.world.spawnGroundItem({ ...catalog.items.marblebean, itemId: 'marblebean', count: 1 }, model.position.clone(), { fling: true });
      this.remove(model);
    });
    Object.assign(entity.components, { workable, timer });
    new ToolMouseTarget(entity, instance, workable, this.world.handEquipment);
    const sapling: Sapling = { instance, display, timer, workable };
    this.saplings.set(model, sapling);
    // startgrowing runs on construction and from marblebean's StartGrowing; a saved timer then replaces it.
    if (!timer.TimerExists('grow')) {
      timer.StartTimer('grow', MARBLEBEAN_GROW_TIME.base + (Math.random() * 2 - 1) * MARBLEBEAN_GROW_TIME.random);
    }
    timer.OnLoad(saved?.components.saplingTimer);
    this.displays.mount(prefabDisplay(model)!);
    sapling.stopActivity = watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active));
    return model;
  }

  update(dt: number, _quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
    this.displays.update(dt);
  }

  get renderEntities() {
    return [...this.saplings.values()].filter(({ instance }) => instance.sprite.loaded).map(({ display }) => ({ object: display.model, footPosition: display.model.position, cameraDepth: 0 }));
  }
  get digTargets(): ShovelTarget[] { return this.getDigTargets(); }

  getDigTargets(model?: THREE.Object3D): ShovelTarget[] {
    return modelEntries(this.saplings, model).map(([model, sapling]) => ({ id: String(sapling.instance.entityId), model, position: model.position,
      entity: actionEntity(model, MARBLEBEAN_SAPLING_ID),
      isValid: () => this.saplings.get(model) === sapling && sapling.workable.CanBeWorked(),
      dig: () => performToolWork('DIG', actionEntity(model, MARBLEBEAN_SAPLING_ID), {}),
    }));
  }

  exportRecords(): MarbleBeanSaplingRecord[] {
    this.scheduler.advanceTo(this.scheduler.now);
    return [...this.saplings].map(([model, { timer, instance }]) => ({ id: String(instance.entityId),
      transform: { position: model.position.toArray() as [number, number, number], rotationY: 0 },
      components: { saplingTimer: timer.OnSave() ?? { timers: {} } },
    }));
  }

  private remove(model: THREE.Group): void {
    const sapling = this.saplings.get(model); if (!sapling) return;
    this.saplings.delete(model); model.userData.removed = true;
    sapling.stopActivity?.();
    sapling.timer.dispose(); sapling.workable.dispose();
    sapling.instance.remove(); sapling.display.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of [...this.saplings.keys()]) this.remove(model);
    this.displays.dispose(); this.resources.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();

  }
}
