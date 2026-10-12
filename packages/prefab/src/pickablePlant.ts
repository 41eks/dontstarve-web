import * as THREE from 'three';
import { createEffect, createMemo, createSignal, readonlySignal, type ReadonlySignal, type SeasonState } from '@dontstarve-web/signals';
import { loadAnim, loadBuild } from '@dontstarve-web/animation/animationAssets';
import {
  createSpriteFactory, type AnimatedSpriteFactory, type FrameSeekableAnimationController, type TransientSpriteAnimationController,
} from '@dontstarve-web/animation/sprite';
import { newEntityId } from './saveRecord';
import { Pickable, type PickableSaveState } from './components/pickable';
import { GameTimeScheduler } from './components/gameTimeScheduler';
import { PlaySound, PreloadSounds, type SoundEventPath, type SoundHandle } from './sound';
import { Burnable, type BurnableInst } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import { Workable } from '../../componets/src/workable';
import { LootDropper } from '../../componets/src/lootdropper';
import { actionEntity } from './actionEntity';
import { performToolWork } from '../../stategraphs/src/componentactions';
import type { ShovelTarget } from '../../stategraphs/src/shovel';
import type { GroundItemDefinition, PreparedGroundSpawn } from './groundPrefab';
import catalog from './groundItems.json' with { type: 'json' };
import { setPrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';

export interface PickablePlantRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { pickable?: PickableSaveState };
}

export interface PickablePlantWorld {
  scheduler?: GameTimeScheduler;
  season?: ReadonlySignal<SeasonState>;
  prepareSpawn(definition: GroundItemDefinition, fling?: boolean): Promise<PreparedGroundSpawn>;
  isOcean?(position: THREE.Vector3): boolean;
}

/** The prefab-specific values of a renewable pickable plant: art, callbacks' clips and sounds, and loot. */
export interface PickablePlantDefinition {
  readonly prefab: string;
  readonly animArchive: string;
  readonly buildArchive: string;
  readonly tags: readonly string[];
  readonly product: string;
  readonly regrowTime: number;
  /** Looping ready clip, optionally started on a random frame (AnimState:SetFrame). */
  readonly idle: { readonly name: string; readonly randomFrame?: boolean };
  /** onpickedfn: an optional sound, then one clip or a clip followed by its rest pose. */
  readonly picked: { readonly sound?: SoundEventPath; readonly clips: readonly [string] | readonly [string, string] };
  /** makeemptyfn as restored by Pickable:OnLoad. */
  readonly empty: { readonly name: string; readonly frame: 'first' | 'last' };
  /** onregenfn: grow, then the looping idle clip. */
  readonly grow: string;
  /** workable dig_up loot after the ready product. */
  readonly dugLoot: string;
}

interface Plant {
  definition: PickablePlantDefinition;
  model: THREE.Group;
  pickable: Pickable;
  factory: AnimatedSpriteFactory;
  animation: TransientSpriteAnimationController;
  version: number;
  transitionAt: number;
  stopEffect: () => void;
  sound?: SoundHandle;
  burnable: Burnable;
  propagator: Propagator;
  workable: Workable;
  persistence: ReturnType<typeof createSignal<boolean>>;
  fire: THREE.Group;
  fireFactory: AnimatedSpriteFactory;
  fireSound?: SoundHandle;
  extinguishSound?: SoundHandle;
  stopBurning: () => void;
  phase: ReturnType<typeof createMemo<string>>;
  outputs: Map<string, PreparedGroundSpawn>;
}

/**
 * Renewable pickable plants (grass.lua, sapling.lua): source component ownership for PICK,
 * DIG and burning (MakeMediumBurnable, MakeSmallPropagator, MakeNoGrowInWinter).
 */
export class PickablePlantManager {
  private readonly factoryRequests = new Map<string, Promise<AnimatedSpriteFactory>>();
  private fireFactoryRequest?: Promise<AnimatedSpriteFactory>;
  private readonly plants = new Map<THREE.Group, Plant>();
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly stopSeason: () => void;
  private disposed = false;

  private readonly scene: THREE.Scene;
  private readonly assetBaseUrl: string;
  private readonly world: PickablePlantWorld;

  constructor(scene: THREE.Scene, assetBaseUrl: string, world: PickablePlantWorld) {
    this.scene = scene; this.assetBaseUrl = assetBaseUrl; this.world = world;
    this.scheduler = world.scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !world.scheduler;
    // MakeNoGrowInWinter belongs to the component/world binding, not the appearance effect.
    this.stopSeason = world.season?.subscribe((current, previous) => {
      if ((current.season === 'winter') === (previous.season === 'winter')) return;
      for (const { pickable } of this.plants.values()) {
        if (current.season === 'winter') pickable.pause();
        else pickable.resume();
      }
    }) ?? (() => {});
  }

  protected async spawnPlant(definition: PickablePlantDefinition, position: THREE.Vector3,
    saved?: PickablePlantRecord): Promise<THREE.Group> {
    const { prefab } = definition;
    if (this.disposed) throw new Error(`${prefab} manager has been disposed`);
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError(`Invalid ${prefab} position`);
    let factoryRequest = this.factoryRequests.get(prefab);
    if (!factoryRequest) {
      factoryRequest = Promise.all([
        loadBuild(definition.buildArchive, this.assetBaseUrl), loadAnim(definition.animArchive, this.assetBaseUrl),
        PreloadSounds(...definition.picked.sound ? [definition.picked.sound] : [],
          'dontstarve/common/campfire', 'dontstarve/common/fireOut'),
      ]).then(([buildPackage, animations]) => createSpriteFactory(buildPackage, animations));
      this.factoryRequests.set(prefab, factoryRequest);
      void factoryRequest.catch(() => { this.factoryRequests.delete(prefab); });
    }
    if (!this.fireFactoryRequest) {
      this.fireFactoryRequest = Promise.all([
        loadBuild('fire.zip', this.assetBaseUrl), loadAnim('fire.zip', this.assetBaseUrl),
      ]).then(([build, anim]) => createSpriteFactory(build, anim));
      void this.fireFactoryRequest.catch(() => { this.fireFactoryRequest = undefined; });
    }
    const outputIds = ['ash', definition.dugLoot, definition.product];
    const resources = await Promise.allSettled([
      factoryRequest, this.fireFactoryRequest,
      ...outputIds.map(itemId => this.world.prepareSpawn({
        ...catalog.items[itemId as keyof typeof catalog.items], itemId, count: 1,
      }, itemId !== 'ash')),
    ]);
    const failed = resources.find(result => result.status === 'rejected');
    if (failed || this.disposed) {
      for (const result of resources.slice(2)) if (result.status === 'fulfilled') result.value.dispose();
      if (failed?.status === 'rejected') throw failed.reason;
      throw new Error(`${prefab} manager has been disposed`);
    }
    const factory = (resources[0] as PromiseFulfilledResult<AnimatedSpriteFactory>).value;
    const fireFactory = (resources[1] as PromiseFulfilledResult<AnimatedSpriteFactory>).value;
    const outputs = new Map(outputIds.map((itemId, i) =>
      [itemId, (resources[i + 2] as PromiseFulfilledResult<PreparedGroundSpawn>).value]));
    const state = saved?.components.pickable;
    const model = factory.create(state?.picked
      ? { initialAnimation: definition.empty.name, initialFrame: definition.empty.frame, name: prefab }
      : { initialAnimation: definition.idle.name, initialFrame: 'first', name: prefab });
    model.position.set(position.x, 0, position.z);
    Object.assign(model.userData, { prefab, entityId: saved?.id ?? newEntityId(), tags: [...definition.tags] });
    const animation = model.userData.animationController as TransientSpriteAnimationController & FrameSeekableAnimationController;
    // sapling.lua: AnimState:SetFrame(math.random(GetCurrentAnimationNumFrames()) - 1).
    if (!state?.picked && definition.idle.randomFrame) animation.setFrame(Math.floor(Math.random() * animation.numFrames));
    const playSequence = (first: string, last?: string, loop = false) => {
      const version = ++plant.version;
      plant.transitionAt = this.scheduler.now;
      animation.playOnce(first, last === undefined ? undefined : () => {
        if (this.disposed || this.plants.get(model) !== plant || plant.version !== version) return;
        if (loop) animation.start(last);
        else animation.playOnce(last);
      });
    };
    const pickable = new Pickable(model, definition.product, definition.regrowTime, 1, () => {
      plant.sound?.stop();
      if (definition.picked.sound) plant.sound = PlaySound(definition.picked.sound, model.position);
      const [first, last] = definition.picked.clips;
      playSequence(first, last);
    }, () => playSequence(definition.grow, definition.idle.name, true), state, {
      scheduler: this.scheduler,
      growthDuration: seconds => this.world.season?.peek().season === 'spring' ? seconds * 0.75 : seconds,
    });
    const entity = actionEntity(model, prefab);
    const burnable = new Burnable(entity, this.scheduler);
    entity.components.burnable = burnable;
    burnable.SetBurnTime(20); // standardcomponents.lua MakeMediumBurnable default.
    const propagator = new Propagator(entity, 'small', radius => {
      const nearby: BurnableInst[] = [];
      this.scene.traverse(object => {
        const other = object.userData.actionEntity as BurnableInst | undefined;
        if (!other?.components.propagator || other.isRemoved || other.hasTag('INLIMBO')) return;
        const point = other.getPosition();
        if ((point.x - model.position.x) ** 2 + (point.z - model.position.z) ** 2 <= radius ** 2) nearby.push(other);
      });
      return nearby;
    }, TILE_SIZE / 4, this.scheduler, this.world.season);
    entity.components.propagator = propagator;
    const persistence = createSignal(true);
    const phase = createMemo(() => pickable.state.removed.get() ? 'removed'
      : burnable.burning.get() ? 'burning' : pickable.state.phase.get());
    const fire = fireFactory.create({ initialAnimation: 'level3', name: 'fire' });
    fire.userData.tags = ['FX', 'NOCLICK'];
    const workable = new Workable(entity);
    entity.components.workable = workable;
    workable.SetWorkAction('DIG'); workable.SetWorkLeft(1);
    const lootdropper = new LootDropper(entity, (lootPrefab, point) => {
      const output = outputs.get(lootPrefab);
      if (!output?.spawn(new THREE.Vector3(point.x, point.y, point.z))) throw new Error(`${prefab} loot not prepared: ${lootPrefab}`);
      return output.spawnedEntity;
    });
    model.userData.components.lootdropper = lootdropper;
    workable.SetOnFinishCallback(() => {
      if (pickable.canBePicked) lootdropper.SpawnLootPrefab(pickable.product);
      lootdropper.SpawnLootPrefab(definition.dugLoot);
      this.remove(model);
    });
    burnable.SetOnIgniteFn(() => persistence.set(false));
    burnable.SetOnExtinguishFn(() => persistence.set(true));
    burnable.SetOnBurntFn(() => {
      if (!this.world.isOcean?.(model.position) && !outputs.get('ash')!.spawn(model.position.clone())) {
        throw new Error(`${prefab} ash not prepared`);
      }
      this.remove(model);
    });
    const plant: Plant = { definition, model, animation, pickable, factory, version: 0,
      transitionAt: this.scheduler.now, stopEffect: () => {}, stopBurning: () => {},
      burnable, propagator, workable, persistence, fire, fireFactory, phase, outputs };
    model.userData.pickablePlantState = Object.freeze({ ...pickable.state, phase: readonlySignal(phase),
      burning: burnable.burning, burnTimer: burnable.timer, persistence: readonlySignal(persistence) });
    plant.stopBurning = burnable.burning.subscribe(burning => {
      if (burning) {
        fire.position.copy(model.position);
        this.scene.add(fire);
        plant.fireSound = PlaySound('dontstarve/common/campfire', model.position);
        setPrefabLocalLight(model, { colour: [1, 1, 192 / 255], radius: 4 * (TILE_SIZE / 4), intensity: .8, falloff: .33 });
      } else {
        fire.removeFromParent(); plant.fireSound?.stop(); plant.fireSound = undefined;
        setPrefabLocalLight(model, null);
        if (this.plants.get(model) === plant && !this.disposed) {
          plant.extinguishSound?.stop(); plant.extinguishSound = PlaySound('dontstarve/common/fireOut', model.position);
        }
      }
    });
    this.plants.set(model, plant);
    if (this.world.season?.peek().season === 'winter') pickable.pause();
    else pickable.resume();
    const readyClips = [definition.idle.name, definition.grow];
    const emptyClips: string[] = [...definition.picked.clips, definition.empty.name];
    plant.stopEffect = createEffect(() => {
      const current = plant.phase.get();
      if (current === 'ready' && !readyClips.includes(animation.currentAnimation)) animation.start(definition.idle.name);
      else if (current === 'picked' && !emptyClips.includes(animation.currentAnimation)) animation.playOnce(definition.empty.name);
    });
    this.scene.add(model);
    return model;
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
    for (const { model, animation, transitionAt, fire } of this.plants.values()) {
      model.quaternion.copy(cameraQuaternion);
      animation.update(Math.min(dt, this.scheduler.now - transitionAt));
      if (fire.parent) {
        fire.position.copy(model.position); fire.quaternion.copy(cameraQuaternion);
        (fire.userData.animationController as TransientSpriteAnimationController).update(dt);
      }
    }
  }

  get renderEntities() {
    return [...this.plants.values()].flatMap(({ model, fire }) => [model, ...(fire.parent ? [fire] : [])]
      .map(object => ({ object, footPosition: model.position, cameraDepth: 0 })));
  }

  get digTargets(): readonly ShovelTarget[] {
    return [...this.plants.values()].map(({ definition, model, workable }) => ({
      id: String(model.userData.entityId), model, position: model.position, entity: actionEntity(model, definition.prefab),
      isValid: () => !this.disposed && this.plants.has(model) && workable.CanBeWorked(),
      dig: () => performToolWork('DIG', actionEntity(model, definition.prefab), {}),
    }));
  }

  protected exportPlants(): { prefab: string; record: PickablePlantRecord }[] {
    this.scheduler.advanceTo(this.scheduler.now);
    return [...this.plants.values()].filter(plant => plant.persistence.peek()).map(({ definition, model, pickable }) => ({
      prefab: definition.prefab,
      record: {
        id: String(model.userData.entityId),
        transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
        components: { pickable: pickable.exportState() },
      },
    }));
  }

  remove(model: THREE.Group): void {
    const plant = this.plants.get(model);
    if (!plant) return;
    this.plants.delete(model);
    plant.version++;
    model.userData.removed = true;
    plant.burnable.SetOnExtinguishFn(undefined);
    plant.burnable.dispose(); plant.propagator.dispose(); plant.workable.dispose();
    plant.pickable.dispose(); plant.phase.dispose();
    plant.stopBurning();
    plant.fireSound?.stop(); plant.extinguishSound?.stop();
    setPrefabLocalLight(model, null);
    plant.fireFactory.disposeSprite(plant.fire);
    for (const output of plant.outputs.values()) output.dispose();
    plant.stopEffect();
    plant.sound?.stop();
    plant.factory.disposeSprite(model);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopSeason();
    for (const model of this.plants.keys()) this.remove(model);
    if (this.ownsScheduler) this.scheduler.dispose();
    for (const request of this.factoryRequests.values()) void request.then(factory => factory.dispose(), () => undefined);
    void this.fireFactoryRequest?.then(factory => factory.dispose(), () => undefined);
  }
}
