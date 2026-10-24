import { GroundItemAssets, createGroundItemFactory } from './groundItems';
import { createHatGroundFactory } from './hats';
import { createBernieGroundFactory } from './bernie';
import { createFirefliesGroundFactory } from './fireflies';
import { createButterflyGroundFactory } from './butterfly';
import { createLightbulbGroundFactory } from './lightbulb';
import { createLanternGroundFactory } from './lantern';
import { createPhonographGroundFactory } from './phonograph';
import { createRecordGroundFactory } from './records';
import { createTorchGroundFactory } from './torch';
import { createPoopGroundFactory } from './poop';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { GroundItemFactory, GroundPrefabOptions } from './groundPrefab';
import type * as THREE from 'three';

// Shared catalog factories come first; specialized prefabs override their IDs.
const PREFAB_MODULES = [
  createGroundItemFactory, createHatGroundFactory, createBernieGroundFactory,
  createFirefliesGroundFactory, createButterflyGroundFactory,
  createLightbulbGroundFactory, createLanternGroundFactory, createPhonographGroundFactory,
  createTorchGroundFactory, createRecordGroundFactory,
  createPoopGroundFactory,
];

/** One registry and resource lifetime per ground-item manager. */
export class GroundPrefabRegistry {
  private readonly factories = new Map<string, GroundItemFactory>();
  private readonly modules: GroundItemFactory[];
  private readonly assets: GroundItemAssets;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;

  constructor(options: GroundPrefabOptions) {
    this.assets = new GroundItemAssets(options.animationBaseUrl);
    this.ownsScheduler = options.scheduler === undefined;
    this.scheduler = options.scheduler ?? new GameTimeScheduler();
    const context = { ...options, scheduler: this.scheduler, assets: this.assets };
    this.modules = PREFAB_MODULES.map((createFactory) => createFactory(context));
    for (const factory of this.modules) {
      for (const id of factory.itemIds) this.factories.set(id, factory);
    }
  }

  get(itemId: string): GroundItemFactory | undefined {
    return this.factories.get(itemId);
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    if (this.ownsScheduler && Number.isFinite(dt) && dt > 0) this.scheduler.advance(dt);
    for (const factory of this.modules) factory.update?.(dt, cameraQuaternion);
  }

  get renderEntities() { return this.modules.flatMap(factory => factory.renderEntities?.() ?? []); }

  dispose(): void {
    this.factories.clear();
    for (const factory of [...this.modules].reverse()) factory.dispose?.();
    this.assets.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();
  }
}
