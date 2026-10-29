import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createSignal, readonlySignal } from '@dontstarve-web/signals';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory } from '@dontstarve-web/animation/sprite';
import { Heater } from '../../componets/src/heater';
import { ComponentTimer } from '../../componets/src/timer';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import type { MiniMapState } from '../../map/src/minimapState';
import { MakePondPhysics } from './standardcomponents';
import { TILE_SIZE } from './tile';
import { createPrefabEntity, prefabInstance } from './prefabInstance';
import type { PrefabDisplay, SpriteState } from '@dontstarve-web/display';

const WORLD_SCALE = TILE_SIZE / 4;
export const LAVA_POND_ID = 'lava_pond' as const;
export const LAVA_POND_ROCK_IDS = ['lava_pond_rock', 'lava_pond_rock2', 'lava_pond_rock3',
  'lava_pond_rock4', 'lava_pond_rock5', 'lava_pond_rock6', 'lava_pond_rock7'] as const;
export type LavaPondRockId = typeof LAVA_POND_ROCK_IDS[number];
export type LavaPondRockType = '' | '2' | '3' | '4' | '5' | '6' | '7';
export const LAVA_POND_ROCK_TYPES = ['', '2', '3', '4', '5', '6', '7'] as const;
export const LAVA_POND_HEAT = 500;
export const LAVA_POND_RADIUS = 1.95 * WORLD_SCALE;
export interface LavaPondRockLayout { rocktype: LavaPondRockType; offset: [number, number, number]; }
export interface LavaPondSaveState { rocks?: LavaPondRockLayout[]; }
export interface LavaPondRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { lavaPond?: LavaPondSaveState };
}
export interface LavaPondRockRecord extends Omit<LavaPondRecord, 'components'> { components: Record<string, never>; }
const copyLayout = (rocks: readonly LavaPondRockLayout[]) => rocks.map(rock => ({ ...rock, offset: [...rock.offset] as [number, number, number] }));

/** lava_pond.lua SpawnRocks/OnLoad/OnRemove; art and physics are owned by the prefab manager. */
class LavaPond {
  private readonly rocksState = createSignal<readonly LavaPondRockLayout[] | undefined>(undefined);
  readonly rocks = readonlySignal(this.rocksState);
  private readonly initializer: ComponentTimer;
  readonly timer;
  readonly children: THREE.Group[] = [];
  readonly heater: Heater;
  /** lava_pond.lua: MiniMapEntity:SetIcon("lava_pond.png"). */
  readonly minimap: MiniMapState;
  readonly model: THREE.Group;
  private readonly rockFactory: AnimatedSpriteFactory;
  private readonly random: () => number;
  constructor(model: THREE.Group, factory: AnimatedSpriteFactory, scheduler: GameTimeScheduler,
    random: () => number, saved?: LavaPondSaveState) {
    this.model = model; this.rockFactory = factory; this.random = random;
    const inst = actionEntity(model, LAVA_POND_ID);
    for (const tag of ['lava', 'antlion_sinkhole_blocker', 'birdblocker', 'blocker']) inst.addTag(tag);
    this.minimap = prefabInstance(model)!.minimap;
    this.minimap.SetIcon('lava_pond.png');
    this.heater = new Heater(inst); this.heater.SetHeat(LAVA_POND_HEAT);
    inst.components.heater = this.heater;
    this.initializer = new ComponentTimer(scheduler, () => this.spawnRocks());
    this.timer = this.initializer.snapshot;
    this.initializer.start(0);
    if (saved?.rocks !== undefined) {
      // Lua OnLoad cancels the pending random initializer and restores children immediately.
      this.initializer.stop(); this.rocksState.set(copyLayout(saved.rocks)); this.spawnRocks();
    }
  }
  private spawnRocks(): void {
    if (this.model.userData.removed) return;
    if (this.rocksState.peek() === undefined) {
      const rocks: LavaPondRockLayout[] = [];
      const count = 2 + Math.floor(this.random() * 3);
      for (let i = 0; i < count; i++) {
        const theta = this.random() * Math.PI * 2;
        const rocktype = LAVA_POND_ROCK_TYPES[Math.floor(this.random() * LAVA_POND_ROCK_TYPES.length)];
        rocks.push({ rocktype, offset: [Math.sin(theta) * 2.1 + this.random() * .3, 0,
          Math.cos(theta) * 2.1 + this.random() * .3] });
      }
      this.rocksState.set(rocks);
    }
    for (const rock of this.rocksState.peek()!) {
      const child = createRock(this.rockFactory, `lava_pond_rock${rock.rocktype}` as LavaPondRockId);
      child.position.fromArray(rock.offset).multiplyScalar(WORLD_SCALE);
      prefabInstance(child)!.persists = false; this.model.add(child); this.children.push(child);
    }
  }
  exportSave(): LavaPondSaveState {
    const rocks = this.rocksState.peek();
    return rocks === undefined ? {} : { rocks: copyLayout(rocks) };
  }
  dispose(): void {
    this.model.userData.removed = true;
    if (this.timer.peek().status === 'scheduled' || this.timer.peek().status === 'paused') this.initializer.stop();

    this.heater.dispose(); delete this.model.userData.components.heater;
    prefabInstance(this.model)!.light.set(null);
    for (const child of this.children) { child.userData.removed = true; removeEntity(child); }
    this.children.length = 0;
  }
}

/** The entity and its drawn sprite leave together; the factory stays with the manager. */
function removeEntity(model: THREE.Group): void {
  prefabInstance(model)!.remove();
  (model.userData.display as PrefabDisplay).dispose();
}

function createRock(factory: AnimatedSpriteFactory, prefab: LavaPondRockId, saved?: LavaPondRockRecord): THREE.Group {
  const type = prefab.slice('lava_pond_rock'.length);
  const { instance, display } = createPrefabEntity(prefab, { create: animation => factory.create({ initialAnimation: animation, name: prefab }),
    release: sprite => factory.disposeSprite(sprite) }, { name: `idle${type}`, billboard: true }, prefab);
  const model = display.model;
  // matrixWorld is read directly: getWorldPosition() calls updateWorldMatrix, which re-enters the spatial index sync.
  const groundPosition = new THREE.Vector3();
  instance.sprite.playOnce(`idle${type}`);
  instance.entityId = saved?.id ?? newEntityId();
  Object.assign(model.userData, { prefabNameOverride: 'lava_pond_rock',
    getGroundPosition: () => groundPosition.setFromMatrixPosition(model.matrixWorld) });
  actionEntity(model, prefab);
  return model;
}

/** Source heat supply only; body-temperature, burning, cooker and dragonfly branches are deferred. */
export class LavaPondManager {
  private poolRequest?: Promise<AnimatedSpriteFactory>;
  private rockRequest?: Promise<AnimatedSpriteFactory>;
  private readonly pools = new Map<THREE.Group, LavaPond>();
  private readonly standaloneRocks = new Set<THREE.Group>();
  private readonly scene: THREE.Scene;
  private readonly physics: CANNON.World;
  private readonly baseUrl: string;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly random: () => number;
  private disposed = false;
  constructor(scene: THREE.Scene, physics: CANNON.World, baseUrl: string,
    options: { scheduler?: GameTimeScheduler; random?: () => number } = {}) {
    this.scene = scene; this.physics = physics; this.baseUrl = baseUrl;
    this.ownsScheduler = !options.scheduler; this.scheduler = options.scheduler ?? new GameTimeScheduler();
    this.random = options.random ?? Math.random;
  }
  private factory(rock: boolean): Promise<AnimatedSpriteFactory> {
    if (this.disposed) return Promise.reject(new Error('Lava pond manager has been disposed'));
    const existing = rock ? this.rockRequest : this.poolRequest;
    if (existing) return existing;
    const request = createAnimatedSpriteFactory(this.baseUrl, rock ? 'scorched_rock.zip' : 'lava_tile.zip');
    if (rock) this.rockRequest = request; else this.poolRequest = request;
    void request.catch(() => { if (rock) this.rockRequest = undefined; else this.poolRequest = undefined; });
    return request;
  }
  async spawn(position: THREE.Vector3, saved?: LavaPondRecord): Promise<THREE.Group> {
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid lava pond position');
    const [factory, rocks] = await Promise.all([this.factory(false), this.factory(true)]);
    if (this.disposed) throw new Error('Lava pond manager has been disposed');
    const { instance, display } = createPrefabEntity(LAVA_POND_ID, { create: animation => factory.create({ initialAnimation: animation, name: LAVA_POND_ID }),
      release: sprite => factory.disposeSprite(sprite) }, { name: 'bubble_lava' }, LAVA_POND_ID);
    const model = display.model;
    model.position.copy(position); model.userData.billboard = false;
    // OnGround rotates only art; the entity root and child offsets stay in world space.
    instance.sprite.setGround(0); instance.sprite.setMeshOrder(-.5); // Same BACKGROUND/sort order 3 as pond.lua.
    instance.entityId = saved?.id ?? newEntityId();
    Object.assign(model.userData, { noWetPrefix: true, deploySmartRadius: 2 * WORLD_SCALE, sourceSortOrder: 3 });
    const pool = new LavaPond(model, rocks, this.scheduler, this.random, saved?.components.lavaPond);
    model.userData.lavaPond = pool;
    // lava_pond.lua MakePondPhysics(inst, 1.95)
    MakePondPhysics(instance, LAVA_POND_RADIUS / WORLD_SCALE);
    instance.bindPhysics(this.physics);
    model.userData.remove = () => this.remove(model);
    prefabInstance(model)!.light.set({ radius: 1.5 * WORLD_SCALE, falloff: .66, intensity: .66,
      colour: [235 / 255, 121 / 255, 12 / 255] });
    this.pools.set(model, pool); this.scene.add(model);
    return model;
  }
  async spawnRock(prefab: LavaPondRockId, position: THREE.Vector3, saved?: LavaPondRockRecord): Promise<THREE.Group> {
    if (!LAVA_POND_ROCK_IDS.includes(prefab) || ![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid lava pond rock');
    const factory = await this.factory(true);
    if (this.disposed) throw new Error('Lava pond manager has been disposed');
    const model = createRock(factory, prefab, saved); model.position.copy(position);
    model.userData.remove = () => this.remove(model);
    this.standaloneRocks.add(model); this.scene.add(model);
    return model;
  }
  update(dt: number, _cameraQuaternion: THREE.Quaternion): void {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
    for (const pool of this.pools.values()) (pool.model.userData.animationController as SpriteState).update(dt);
    for (const rock of this.rockModels) {
      (rock.userData.animationController as SpriteState).update(dt);
    }
  }
  private get rockModels(): THREE.Group[] { return [...this.standaloneRocks, ...[...this.pools.values()].flatMap(pool => pool.children)]; }
  get renderEntities() {
    return this.rockModels.map(object => ({ object, footPosition: object.getWorldPosition(new THREE.Vector3()), cameraDepth: 0 }));
  }
  exportRecords(): { prefabId: string; record: LavaPondRecord | LavaPondRockRecord }[] {
    return [...[...this.pools.values()].map(pool => ({ prefabId: LAVA_POND_ID, record: {
      id: prefabInstance(pool.model)!.entityId as string,
      transform: { position: pool.model.position.toArray(), rotationY: 0 }, components: { lavaPond: pool.exportSave() },
    } })), ...[...this.standaloneRocks].map(model => ({ prefabId: prefabInstance(model)!.prefab as LavaPondRockId, record: {
      id: prefabInstance(model)!.entityId as string, transform: { position: model.position.toArray(), rotationY: 0 }, components: {},
    } }))];
  }
  remove(model: THREE.Group): void {
    const pool = this.pools.get(model);
    if (pool) {
      this.pools.delete(model); pool.dispose();
      removeEntity(model);
    } else if (this.standaloneRocks.delete(model)) {
      model.userData.removed = true;
      removeEntity(model);
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of [...this.pools.keys(), ...this.standaloneRocks]) this.remove(model);
    for (const request of [this.poolRequest, this.rockRequest]) void request?.then(factory => factory.dispose(), () => undefined);
    if (this.ownsScheduler) this.scheduler.dispose();
  }
}
