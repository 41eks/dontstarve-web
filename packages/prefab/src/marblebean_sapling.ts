import { Transform } from './transform';
import * as THREE from 'three';
import { SpriteResources, SpriteState, type PrefabDisplayGroup } from '@dontstarve-web/display';
import type { TileStateQuery } from '@dontstarve-web/signals';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Deployable } from '../../componets/src/deployable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Timer, type NamedTimerSave } from '../../componets/src/timer';
import { Workable } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import { configureBurnableItemEntity } from './burnableItems';
import type { SpawnGroundItem } from './groundPrefab';
import type { MarbleShrubManager } from './marbleshrub';
import { bindInstance, PrefabInstance } from './prefabInstance';
import { newEntityId } from './saveRecord';
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import { watchTileActivity } from './tileActivity';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import catalog from './groundItems.json' with { type: 'json' };

export const MARBLEBEAN_SAPLING_ID = 'marblebean_sapling' as const;
const DAY_TIME = 300; // tuning.lua day_time.
// planted_tree.lua startgrowing without growtimes: TUNING.PINECONE_GROWTIME = {base = .75 * day_time, random = .25 * day_time}.
export const MARBLEBEAN_GROW_TIME = { base: .75 * DAY_TIME, random: .25 * DAY_TIME } as const;
const GROW = 'grow';

export interface MarbleBeanSaplingRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { saplingTimer?: NamedTimerSave };
}
export interface MarbleBeanSaplingWorld extends ToolMouseTargetWorld {
  scheduler: GameTimeScheduler;
  tickingarea?: TileStateQuery;
  shrubs: Pick<MarbleShrubManager, 'growFromSeed'>;
  /** digup's marblebean; its display loads the art. */
  spawnGroundItem: SpawnGroundItem;
}

/** marblebean.lua: deployable(PLANT) with default spacing and its ondeploy; the sapling starts growing as it spawns. */
export function configureMarbleBeanEntity(entity: ItemEntity): void {
  if (entity.prefab !== 'marblebean' || entity.components.deployable) return;
  configureBurnableItemEntity(entity);
  entity.components.deployable = entity.component('deployable', () => new Deployable(entity, (point, _deployer, map) => {
    if (!map.SpawnPrefab(MARBLEBEAN_SAPLING_ID, point)) return false;
    PlaySound('dontstarve/wilson/plant_tree', point);
    entity.remove();
    return true;
    // MakePlacer("marblebean_placer", "marblebean", "marblebean", "idle_planted").
  }, { mode: 'PLANT', spacing: 2 * (TILE_SIZE / 4), placer: { bank: 'marblebean', build: 'marblebean', animationArchive: 'marblebean.zip', animation: 'idle_planted' } }));
}

/** planted_tree.lua sapling_fn("marblebean", ...): a fireproof sapling with a `grow` timer and a DIG workable. */
export class MarbleBeanSaplingInstance extends PrefabInstance {
  private readonly world: MarbleBeanSaplingWorld;

  constructor(position: THREE.Vector3, world: MarbleBeanSaplingWorld) {
    super(MARBLEBEAN_SAPLING_ID, new SpriteState({ name: 'idle_planted', billboard: true }),
      Transform.stationary());
    this.setPosition(position.x, 0, position.z);
    this.world = world;
    this.deploySmartRadius = 1;
    this.sprite.playOnce('idle_planted');
    this.addTag('marbleshrub');

    const timer = new Timer(world.scheduler, name => this.PushEvent('timerdone', { name }), [GROW]);
    this.ListenForEvent('timerdone', data => { if ((data as { name: string }).name === GROW) this.growtree(); });
    const workable = new Workable(this);
    workable.SetWorkAction('DIG'); workable.SetWorkLeft(1);
    workable.SetOnFinishCallback(() => this.digup());
    Object.assign(this.components, { timer, workable });

    // startgrowing runs on construction and from marblebean's StartGrowing; a saved timer then replaces it.
    timer.StartTimer(GROW, MARBLEBEAN_GROW_TIME.base + (Math.random() * 2 - 1) * MARBLEBEAN_GROW_TIME.random);

    this.onRemove(() => { timer.dispose(); workable.dispose(); });
  }

  /** The shrub replaces the sapling at its position and grows from seed. */
  private growtree(): void {
    this.world.shrubs.growFromSeed(this.position.clone());
    this.remove();
  }

  /** lootdropper loot is `marblebean`, then the sapling is removed. */
  private digup(): void {
    this.world.spawnGroundItem({ ...catalog.items.marblebean, itemId: 'marblebean', count: 1 }, this.position.clone(), { fling: true });
    this.remove();
  }
}

/** The saplings of a world: their collection, injected world and shared marblebean art. */
export class MarbleBeanSaplingManager {
  private readonly displays: PrefabDisplayGroup;
  private readonly world: MarbleBeanSaplingWorld;
  private readonly resources = new SpriteResources();
  private readonly saplings = new Set<MarbleBeanSaplingInstance>();
  private disposed = false;

  /** `displays` is the display-layer owner of the saplings' scene membership, injected and disposed by the application. */
  constructor(displays: PrefabDisplayGroup, world: MarbleBeanSaplingWorld) {
    this.displays = displays; this.world = world;
  }

  /** SpawnPrefab: the sapling exists now and its display loads the art. */
  spawn(position: THREE.Vector3, saved?: MarbleBeanSaplingRecord): MarbleBeanSaplingInstance {
    if (this.disposed) throw new Error('Marble bean saplings disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid sapling position');
    const instance = new MarbleBeanSaplingInstance(position, this.world);
    instance.entityId = saved?.id ?? newEntityId();
    instance.components.timer!.OnLoad(saved?.components.saplingTimer);
    const display = this.displays.add({ root: instance.transform.model, name: MARBLEBEAN_SAPLING_ID, status: instance.status, sprite: instance.sprite, light: instance.light,
      archive: this.resources.archive({ animationArchive: 'marblebean.zip', buildArchives: ['marblebean.zip'], bank: 'marblebean' }, { instancedAnimations: 'all', staticBillboard: true }) });
    bindInstance(display.model, instance);
    new ToolMouseTarget(actionEntity(display.model, MARBLEBEAN_SAPLING_ID), instance, instance.components.workable, this.world.handEquipment);
    this.saplings.add(instance);
    const stopActivity = watchTileActivity(display.model, this.world.tickingarea, active => instance.setActive(active));
    instance.onRemove(() => { stopActivity(); this.saplings.delete(instance); });
    return instance;
  }

  /** The display group advances the awake saplings' clips; the grow timer runs on the world's scheduler. */
  update(dt: number): void {
    if (!this.disposed) this.displays.update(dt);
  }

  get renderEntities() { return this.displays.renderEntities; }

  exportRecords(): MarbleBeanSaplingRecord[] {
    return [...this.saplings].map(sapling => ({ id: String(sapling.entityId),
      transform: { position: [sapling.position.x, 0, sapling.position.z], rotationY: 0 },
      components: { saplingTimer: sapling.components.timer!.OnSave() ?? { timers: {} } },
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const sapling of [...this.saplings]) sapling.remove();
    // Every sapling's display is released above, before the shared resources.
    this.resources.dispose();
  }
}
