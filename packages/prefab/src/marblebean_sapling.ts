import { Transform } from './transform';
import * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Deployable } from '../../componets/src/deployable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Timer } from '../../componets/src/timer';
import { Workable } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import { configureBurnableItemEntity } from './burnableItems';
import type { SpawnGroundItem } from './groundPrefab';
import type { MarbleShrubInstance } from './marbleshrub';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import catalog from './groundItems.json' with { type: 'json' };

export const MARBLEBEAN_SAPLING_ID = 'marblebean_sapling' as const;
const DAY_TIME = 300; // tuning.lua day_time.
// planted_tree.lua startgrowing without growtimes: TUNING.PINECONE_GROWTIME = {base = .75 * day_time, random = .25 * day_time}.
export const MARBLEBEAN_GROW_TIME = { base: .75 * DAY_TIME, random: .25 * DAY_TIME } as const;
const GROW = 'grow';

export interface MarbleBeanSaplingWorld extends ToolMouseTargetWorld {
  scheduler: GameTimeScheduler;
  /** growtree's SpawnPrefab(inst.growprefab); the shrub's display loads its art. */
  spawnPrefab(prefab: 'marbleshrub_short', position: THREE.Vector3): MarbleShrubInstance;
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

  constructor(position: ReadonlyVector3, world: MarbleBeanSaplingWorld) {
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

    // The record keeps the timer component's save under saplingTimer, as the rock avocado sprout's does.
    this.OnSave = (_inst, data) => { data.saplingTimer = data.timer ?? { timers: {} }; delete data.timer; };
    this.OnLoad = (_inst, data) => { timer.OnLoad(data.saplingTimer); };
  }

  /** growtree: SpawnPrefab("marbleshrub_short") at the sapling, tree:growfromseed(), then the sapling is removed. */
  private growtree(): void {
    this.world.spawnPrefab('marbleshrub_short', this.position.clone()).growfromseed();
    this.remove();
  }

  /** lootdropper loot is `marblebean`, then the sapling is removed. */
  private digup(): void {
    this.world.spawnGroundItem({ ...catalog.items.marblebean, itemId: 'marblebean', count: 1 }, this.position.clone(), { fling: true });
    this.remove();
  }
}

/** planted_tree.lua's marblebean_sapling Prefab. */
export function marbleBeanSaplingPrefabs(world: MarbleBeanSaplingWorld): Readonly<Record<typeof MARBLEBEAN_SAPLING_ID, PrefabEntityDefinition<MarbleBeanSaplingInstance>>> {
  return {
    [MARBLEBEAN_SAPLING_ID]: {
      fn: position => new MarbleBeanSaplingInstance(position, world),
      assets: { animationArchive: 'marblebean.zip', buildArchives: ['marblebean.zip'], bank: 'marblebean' },
      assetOptions: { instancedAnimations: 'all', staticBillboard: true },
      onSpawned: inst => { new ToolMouseTarget(actionEntity(inst.transform.model, MARBLEBEAN_SAPLING_ID), inst, inst.components.workable, world.handEquipment); },
    },
  };
}
