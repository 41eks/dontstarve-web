import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory } from '@dontstarve-web/animation/sprite';
import type { PrefabDisplay, SpriteState } from '@dontstarve-web/display';
import { createEffect, watchSignal, type ReadonlySignal, type Signal, type TileStateQuery } from '@dontstarve-web/signals';
import { BathBombable } from '../../componets/src/bathbombable';
import { Heater } from '../../componets/src/heater';
import { ComponentTimer } from '../../componets/src/timer';
import { TileTracker } from '../../componets/src/tileManager';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { actionEntity } from './actionEntity';
import { setPrefabLocalLight } from './localLight';
import { newEntityId } from './saveRecord';
import { MakePondPhysics, WORLD_SCALE } from './standardcomponents';
import { createPrefabEntity, type PrefabInstance } from './prefabInstance';

export const HOTSPRING_ID = 'hotspring' as const;
/** tuning.lua HOTSPRING_HEAT. */
export const HOTSPRING_HEAT = { ACTIVE: 90, PASSIVE: 45 } as const;
/** tuning.lua HOTSPRING_GLOW with prefabs/hotspring.lua's colour, radius in scene units. */
export const HOTSPRING_LIGHT = { radius: 2 * WORLD_SCALE, intensity: .75, falloff: .75,
  colour: [.1, 1.6, 2] as const };
/** hotspring.lua MakePondPhysics(inst, 1), in scene units. */
export const HOTSPRING_RADIUS = WORLD_SCALE;

/** tuning.lua HOTSPRING_IDLE: steam period and the random range of the first delay. */
export const HOTSPRING_IDLE = { BASE: 3, DELAY: 4 } as const;
export type HotspringSteamPrefab = `crater_steam_fx${1 | 2 | 3 | 4}` | `slow_steam_fx${1 | 2 | 3 | 4 | 5}`;
/** fx.lua crater_steam_fx1..4 / slow_steam_fx1..5: bank = build = archive name, anim = steam<N>. */
const STEAM_ARCHIVES = { crater: 'crater_steam.zip', slow: 'slow_steam.zip' } as const;

export interface HotspringSaveState { isbathbombed?: true; }
export interface HotspringRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { hotspring?: HotspringSaveState };
}

/** hotspring.lua's heat, light, bathbombable and steam branches; glass and bathing are separate Lua branches. */
class Hotspring {
  readonly heater: Heater;
  readonly bathbombable: BathBombable;
  private readonly model: THREE.Group;
  private tileActivity?: Signal<boolean>;
  private stopTileActivity?: () => void;
  /** hotspring.lua _fx_task: DoPeriodicTask(HOTSPRING_IDLE.BASE, push_special_idle, delay). */
  private readonly fxTask: ComponentTimer;
  readonly fx;
  private readonly random: () => number;
  private readonly emitSteam: (prefab: HotspringSteamPrefab) => void;
  constructor(model: THREE.Group, scheduler: GameTimeScheduler, random: () => number,
    emitSteam: (prefab: HotspringSteamPrefab) => void, saved?: HotspringSaveState) {
    this.model = model; this.random = random; this.emitSteam = emitSteam;
    this.fxTask = new ComponentTimer(scheduler, () => this.pushSpecialIdle());
    this.fx = this.fxTask.snapshot;
    const inst = actionEntity(model, HOTSPRING_ID);
    for (const tag of ['watersource', 'antlion_sinkhole_blocker', 'birdblocker']) inst.addTag(tag);
    this.heater = new Heater(inst);
    this.heater.SetHeatFn(() => this.getHeat());
    this.bathbombable = new BathBombable(inst);
    this.bathbombable.SetOnBathBombedFn(() => this.onBathBombed(false));
    inst.components.heater = this.heater; inst.components.bathbombable = this.bathbombable;
    setPrefabLocalLight(model, null); // Light:Enable(false)
    // OnLoad: `bathbombable:OnBathBombed()` with POPULATING set.
    if (saved?.isbathbombed) { this.bathbombable.OnBathBombed(); this.onBathBombed(true); }
    this.startFx();
  }
  /** push_special_idle, non-glass branches. */
  private pushSpecialIdle(): void {
    this.fxTask.start(HOTSPRING_IDLE.BASE);
    if (this.bathbombable.is_bathbombed) this.emitSteam(`crater_steam_fx${1 + Math.floor(this.random() * 4)}` as HotspringSteamPrefab);
    else this.emitSteam(`slow_steam_fx${1 + Math.floor(this.random() * 5)}` as HotspringSteamPrefab);
  }
  private startFx(delay = this.random() * HOTSPRING_IDLE.DELAY): void { this.fxTask.start(delay); }
  /** OnEntitySleep: StopFx. */
  sleep(): void { this.fxTask.stop(); }
  /** OnEntityWake. */
  wake(): void {
    const { is_bathbombed, can_be_bathbombed } = this.bathbombable;
    if (this.fxTask.snapshot.peek().status !== 'scheduled' && (is_bathbombed || can_be_bathbombed)) this.startFx();
  }
  bindTileActivity(source: ReadonlySignal<boolean>, onChange: (active: boolean) => void): void {
    this.stopTileActivity?.();
    this.tileActivity = watchSignal(source, stop => { this.stopTileActivity = stop; });
    createEffect(() => onChange(this.tileActivity!.get()));
  }
  private getHeat(): number {
    if (this.bathbombable.is_bathbombed) { this.heater.SetThermics(true, false); return HOTSPRING_HEAT.ACTIVE; }
    if (this.bathbombable.can_be_bathbombed) { this.heater.SetThermics(true, false); return HOTSPRING_HEAT.PASSIVE; }
    this.heater.SetThermics(false, false);
    return 0;
  }
  private onBathBombed(populating: boolean): void {
    setPrefabLocalLight(this.model, HOTSPRING_LIGHT);
    const controller = this.model.userData.animationController as SpriteState;
    if (populating) { controller.start('glow_loop'); return; }
    controller.playOnce('bath_bomb', () => controller.playOnce('glow_pre', () => controller.start('glow_loop')));
  }
  exportSave(): HotspringSaveState { return this.bathbombable.is_bathbombed ? { isbathbombed: true } : {}; }
  dispose(): void {
    this.stopTileActivity?.(); this.fxTask.stop();
    this.heater.dispose(); this.bathbombable.dispose();
    const components = this.model.userData.components;
    delete components.heater; delete components.bathbombable;
    setPrefabLocalLight(this.model, null);
  }
}

interface SteamFx { object: THREE.Group; footPosition: THREE.Vector3; instance: PrefabInstance; display: PrefabDisplay; }

/** Source heat, light, bath bomb and steam interaction: the glass and bathing pool branches are not ported. */
export class HotspringManager {
  private factoryRequest?: Promise<AnimatedSpriteFactory>;
  private steamRequests: Partial<Record<keyof typeof STEAM_ARCHIVES, Promise<AnimatedSpriteFactory>>> = {};
  private readonly steam = new Set<SteamFx>();
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly random: () => number;
  private readonly springs = new Map<THREE.Group, Hotspring>();
  private readonly entities = new Map<THREE.Group, ReturnType<typeof createPrefabEntity>>();
  private readonly activeSprings = new Set<THREE.Group>();
  private readonly scene: THREE.Scene;
  private readonly physics: CANNON.World;
  private readonly baseUrl: string;
  private readonly tickingarea?: TileStateQuery;
  private disposed = false;
  constructor(scene: THREE.Scene, physics: CANNON.World, baseUrl: string, tickingarea?: TileStateQuery,
    options: { scheduler?: GameTimeScheduler; random?: () => number } = {}) {
    this.scene = scene; this.physics = physics; this.baseUrl = baseUrl;
    this.tickingarea = tickingarea;
    this.ownsScheduler = !options.scheduler; this.scheduler = options.scheduler ?? new GameTimeScheduler();
    this.random = options.random ?? Math.random;
  }
  private steamFactory(kind: keyof typeof STEAM_ARCHIVES): Promise<AnimatedSpriteFactory> {
    if (this.disposed) return Promise.reject(new Error('Hotspring manager has been disposed'));
    const existing = this.steamRequests[kind];
    if (existing) return existing;
    const request = this.steamRequests[kind] = createAnimatedSpriteFactory(this.baseUrl, STEAM_ARCHIVES[kind]);
    void request.catch(() => { delete this.steamRequests[kind]; });
    return request;
  }
  /** fx.lua nonpersistent FX with SetFinalOffset(1): played once at the spring, removed on animover. */
  private spawnSteam(prefab: HotspringSteamPrefab, foot: THREE.Vector3): void {
    const kind = prefab.startsWith('crater') ? 'crater' : 'slow';
    const request = this.steamRequests[kind];
    if (this.disposed || !request) return;
    void request.then(factory => {
      if (this.disposed) return;
      const anim = `steam${prefab.slice(-1)}`;
      const { instance, display } = createPrefabEntity(prefab, { create: animation => factory.create({ initialAnimation: animation, name: prefab }),
        release: sprite => factory.disposeSprite(sprite) }, { name: anim, billboard: true }, prefab);
      const object = display.model;
      object.position.copy(foot);
      instance.persists = false;
      const fx: SteamFx = { object, footPosition: object.position, instance, display };
      instance.sprite.playOnce(anim, () => this.removeSteam(fx));
      this.steam.add(fx); this.scene.add(object);
    });
  }
  private removeSteam(fx: SteamFx): void {
    if (!this.steam.delete(fx)) return;
    fx.instance.remove(); fx.display.dispose();
  }
  private factory(): Promise<AnimatedSpriteFactory> {
    if (this.disposed) return Promise.reject(new Error('Hotspring manager has been disposed'));
    if (this.factoryRequest) return this.factoryRequest;
    const request = this.factoryRequest = createAnimatedSpriteFactory(this.baseUrl, 'crater_pool.zip');
    void request.catch(() => { this.factoryRequest = undefined; });
    return request;
  }
  async spawn(position: THREE.Vector3, saved?: HotspringRecord): Promise<THREE.Group> {
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid hotspring position');
    const [factory] = await Promise.all([this.factory(), this.steamFactory('crater'), this.steamFactory('slow')]);
    if (this.disposed) throw new Error('Hotspring manager has been disposed');
    const entity = createPrefabEntity(HOTSPRING_ID, { create: animation => factory.create({ initialAnimation: animation, name: HOTSPRING_ID }),
      release: sprite => factory.disposeSprite(sprite) }, { name: 'idle', billboard: true }, HOTSPRING_ID);
    const model = entity.display.model;
    model.position.copy(position);
    // LAYER_BACKGROUND controls drawing order, not OnGround orientation; keep the source art origin.
    entity.instance.entityId = saved?.id ?? newEntityId();
    Object.assign(model.userData, { noWetPrefix: true, deploySmartRadius: 1.5 * WORLD_SCALE });
    MakePondPhysics(entity.instance, HOTSPRING_RADIUS / WORLD_SCALE);
    const spring = new Hotspring(model, this.scheduler, this.random,
      prefab => this.spawnSteam(prefab, model.position), saved?.components.hotspring);
    model.userData.hotspring = spring;
    model.userData.remove = () => this.remove(model);
    this.springs.set(model, spring); this.entities.set(model, entity);
    entity.instance.bindPhysics(this.physics);
    this.scene.add(model);
    const tileActivity = this.tickingarea?.(new TileTracker(() => model.position).tile);
    if (tileActivity) spring.bindTileActivity(tileActivity, active => this.setActive(model, spring, active));
    else this.setActive(model, spring, true);
    return model;
  }
  private setActive(model: THREE.Group, spring: Hotspring, active: boolean): void {
    if (this.disposed || !this.springs.has(model)) return;
    // A spring first found asleep still leaves the scene: its display was added at spawn.
    this.entities.get(model)!.instance.setActive(active);
    if (this.activeSprings.has(model) === active) return;
    if (active) {
      this.activeSprings.add(model);
      spring.wake();
    } else {
      this.activeSprings.delete(model);
      spring.sleep();
    }
  }
  update(dt: number, _cameraQuaternion: THREE.Quaternion): void {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
    for (const model of this.activeSprings) (model.userData.animationController as SpriteState).update(dt);
    for (const fx of [...this.steam]) fx.instance.sprite.update(dt);
  }
  get renderEntities() {
    return [
      ...[...this.activeSprings].map(object => ({ object, footPosition: object.position, cameraDepth: 0, renderLayer: -1 })),
      // Default LAYER_WORLD with FinalOffset 1: sorted among world entities, above the spring's own entry.
      ...[...this.steam].map(({ object, footPosition }) => ({ object, footPosition, cameraDepth: 0, sortLayer: 2 })),
    ];
  }
  exportRecords(): { prefabId: typeof HOTSPRING_ID; record: HotspringRecord }[] {
    return [...this.springs].map(([model, spring]) => ({ prefabId: HOTSPRING_ID, record: {
      id: this.entities.get(model)!.instance.entityId as string,
      transform: { position: model.position.toArray(), rotationY: 0 }, components: { hotspring: spring.exportSave() },
    } }));
  }
  remove(model: THREE.Group): void {
    const spring = this.springs.get(model);
    if (!spring) return;
    this.springs.delete(model); this.activeSprings.delete(model); model.userData.removed = true;
    spring.dispose();
    const { instance, display } = this.entities.get(model)!;
    this.entities.delete(model); instance.remove(); display.dispose();
  }
  dispose(): void {
    if (this.disposed) return;
    for (const model of [...this.springs.keys()]) this.remove(model);
    for (const fx of [...this.steam]) this.removeSteam(fx);
    this.disposed = true;
    void this.factoryRequest?.then(factory => factory.dispose(), () => undefined);
    for (const request of Object.values(this.steamRequests)) void request.then(factory => factory.dispose(), () => undefined);
  }
}
