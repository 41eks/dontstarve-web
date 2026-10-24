import { modelEntries } from './modelRecords';
import * as THREE from 'three';
import { preloadSharedArchiveSprite, ArchiveSpriteAssets } from '@dontstarve-web/animation/archiveSprite';
import { ResidentSprite } from '@dontstarve-web/animation/residentSprite';
import { createEffect, type TileStateQuery } from '@dontstarve-web/signals';
import { watchTileActivity } from './tileActivity';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Timer, type NamedTimerSave } from '../../componets/src/timer';
import { Workable } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import type { GroundItemDefinition, PreparedGroundSpawn } from './groundPrefab';
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
  sprite: ResidentSprite;
  stopActivity?: () => void;
  stopAppearance: () => void;
  timer: Timer;
  workable: Workable;
  loot: PreparedGroundSpawn;
  shrub: Awaited<ReturnType<MarbleShrubManager['prepareGrowFromSeed']>>;
}
export interface MarbleBeanSaplingWorld {
  scheduler?: GameTimeScheduler;
  tickingarea?: TileStateQuery;
  shrubs: Pick<MarbleShrubManager, 'prepareGrowFromSeed'>;
  prepareSpawn(definition: GroundItemDefinition, fling?: boolean): Promise<PreparedGroundSpawn>;
}

/** planted_tree.lua sapling_fn("marblebean", ...): a fireproof sapling with a `grow` timer and a DIG workable. */
export class MarbleBeanSaplingManager {
  private readonly scene: THREE.Scene;
  private readonly world: MarbleBeanSaplingWorld;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly assets = new ArchiveSpriteAssets();
  private source?: ReturnType<typeof preloadSharedArchiveSprite>;
  private readonly cameraQuaternion = new THREE.Quaternion();
  private readonly saplings = new Map<THREE.Group, Sapling>();
  private disposed = false;

  constructor(scene: THREE.Scene, world: MarbleBeanSaplingWorld) {
    this.scene = scene; this.world = world;
    this.scheduler = world.scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !world.scheduler;
  }

  async spawn(position: THREE.Vector3, saved?: MarbleBeanSaplingRecord): Promise<THREE.Group> {
    return (await this.prepare()).spawn(position, saved);
  }

  /** marblebean.lua ondeploy: spawn the sapling and StartGrowing at the planted point. */
  async prepareTransplant() {
    const prepared = await this.prepare();
    return { dispose: prepared.dispose, spawn: (position: THREE.Vector3) => { prepared.spawn(position); return true; } };
  }

  private async prepare() {
    const resources = await Promise.allSettled([
      this.source ??= preloadSharedArchiveSprite(this.assets, { animationArchive: 'marblebean.zip', buildArchives: ['marblebean.zip'],
        bank: 'marblebean' }, { instancedAnimations: 'all', staticBillboard: true }).catch(error => { this.source = undefined; throw error; }),
      this.world.prepareSpawn({ ...catalog.items.marblebean, itemId: 'marblebean', count: 1 }, true),
      this.world.shrubs.prepareGrowFromSeed(),
    ] as const);
    const disposeResources = () => {
      for (const result of resources) if (result.status === 'fulfilled' && 'dispose' in result.value) result.value.dispose();
    };
    const failed = resources.find(result => result.status === 'rejected');
    if (failed || this.disposed) {
      disposeResources();
      throw failed?.status === 'rejected' ? failed.reason : new Error('Marble bean saplings disposed');
    }
    const source = (resources[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof preloadSharedArchiveSprite>>>).value;
    const loot = (resources[1] as PromiseFulfilledResult<PreparedGroundSpawn>).value;
    const shrub = (resources[2] as PromiseFulfilledResult<Sapling['shrub']>).value;
    let used = false;
    return {
      dispose: () => { if (!used) { used = true; disposeResources(); } },
      spawn: (position: THREE.Vector3, saved?: MarbleBeanSaplingRecord): THREE.Group => {
        if (used || this.disposed) throw new Error('Prepared sapling is unavailable');
        if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid sapling position');
        used = true;
        const create = (clip: { name: string; loop: boolean }) => source(clip.name, clip.loop, MARBLEBEAN_SAPLING_ID);
        const clip = { name: 'idle_planted', loop: false };
        const sprite = new ResidentSprite(create, clip, create(clip), MARBLEBEAN_SAPLING_ID);
        const model = sprite.model;
        model.userData.animationController = sprite;
        const stopAppearance = createEffect(() => { sprite.art.get(); sprite.faceCamera(this.cameraQuaternion); });
        model.position.set(position.x, 0, position.z);
        Object.assign(model.userData, { entityId: saved?.id ?? newEntityId(), prefab: MARBLEBEAN_SAPLING_ID,
          deploySmartRadius: 1, tags: ['marbleshrub'] });
        const entity = actionEntity(model, MARBLEBEAN_SAPLING_ID);
        const timer = new Timer(this.scheduler, name => {
          // growtree: the shrub replaces the sapling at its position and grows from seed.
          if (name === 'grow') { shrub.spawn(model.position); this.remove(model); }
        }, ['grow']);
        const workable = new Workable(entity);
        workable.SetWorkAction('DIG'); workable.SetWorkLeft(1);
        // digup: lootdropper loot is `marblebean`, then the sapling is removed.
        workable.SetOnFinishCallback(() => {
          if (!loot.spawn(model.position)) throw new Error('Missing marblebean DIG loot');
          this.remove(model);
        });
        Object.assign(entity.components, { workable, timer });
        const sapling: Sapling = { sprite, stopAppearance, timer, workable, loot, shrub };
        this.saplings.set(model, sapling);
        // startgrowing runs on construction and from marblebean's StartGrowing; a saved timer then replaces it.
        if (!timer.TimerExists('grow')) {
          timer.StartTimer('grow', MARBLEBEAN_GROW_TIME.base + (Math.random() * 2 - 1) * MARBLEBEAN_GROW_TIME.random);
        }
        timer.OnLoad(saved?.components.saplingTimer);
        this.scene.add(model);
        sapling.stopActivity = watchTileActivity(model, this.world.tickingarea, active => sprite.setActive(active));
        return model;
      },
    };
  }

  update(dt: number, quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    this.cameraQuaternion.copy(quaternion);
    if (this.ownsScheduler) this.scheduler.advance(dt);
    for (const { sprite } of this.saplings.values()) if (sprite.loaded) { sprite.faceCamera(quaternion); sprite.update(dt); }
  }

  get renderEntities() {
    return [...this.saplings.values()].filter(({ sprite }) => sprite.loaded).map(({ sprite }) => ({ object: sprite.model, footPosition: sprite.model.position, cameraDepth: 0 }));
  }
  get digTargets(): ShovelTarget[] { return this.getDigTargets(); }

  getDigTargets(model?: THREE.Object3D): ShovelTarget[] {
    return modelEntries(this.saplings, model).map(([model, sapling]) => ({ id: String(model.userData.entityId), model, position: model.position,
      entity: actionEntity(model, MARBLEBEAN_SAPLING_ID),
      isValid: () => this.saplings.get(model) === sapling && sapling.workable.CanBeWorked(),
      dig: () => performToolWork('DIG', actionEntity(model, MARBLEBEAN_SAPLING_ID), {}),
    }));
  }

  exportRecords(): MarbleBeanSaplingRecord[] {
    this.scheduler.advanceTo(this.scheduler.now);
    return [...this.saplings].map(([model, { timer }]) => ({ id: String(model.userData.entityId),
      transform: { position: model.position.toArray() as [number, number, number], rotationY: 0 },
      components: { saplingTimer: timer.OnSave() ?? { timers: {} } },
    }));
  }

  private remove(model: THREE.Group): void {
    const sapling = this.saplings.get(model); if (!sapling) return;
    this.saplings.delete(model); model.userData.removed = true;
    sapling.stopActivity?.(); sapling.stopAppearance();
    sapling.timer.dispose(); sapling.workable.dispose();
    sapling.sprite.dispose(); sapling.loot.dispose(); sapling.shrub.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of [...this.saplings.keys()]) this.remove(model);
    this.assets.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();
  }
}
