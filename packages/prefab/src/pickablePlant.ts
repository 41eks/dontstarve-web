import { modelValues } from './modelRecords';
import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createEffect, createMemo, createSignal, readonlySignal, getBoundWatchWorldContent, WorldContentKey, type ReadonlySignal, type WorldContentSignal, type GetWatchWorldContent, type SeasonState } from '@dontstarve-web/signals';
import { Witherable, type WitherableSave } from '../../componets/src/witherable';
import { loadAnim, loadBuild, loadSpriteSkinArchive } from '@dontstarve-web/animation/animationAssets';
import {
  createSpriteFactory, SpriteController, loadBuildOverride, type LoadedBuildOverride, type AnimatedSpriteFactory, type TransientSpriteAnimationController,
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
import { MakeObstaclePhysics } from './standardcomponents';
import { nextReskin } from './reskin_tool';
import type { ReskinTarget } from '../../stategraphs/src/reskin_tool';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import type { GrowableSave } from '../../componets/src/growable';

export interface PickablePlantRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { pickable?: PickableSaveState; witherable?: WitherableSave; plant?: { skinId?: string }; growable?: GrowableSave; burning?: true;
    /** mushrooms.lua OnSave: the rain days left before a picked mushroom regrows. */
    mushroom?: { rain: number } };
}

export interface PickablePlantWorld {
  /** Season, snow level and the scheduler come from the bound world content. */
  rain?: ReadonlySignal<'none' | 'rain' | 'snow'>;
  physics?: CANNON.World;
  getLocalTemperature?(position: THREE.Vector3): number;
  prepareSpawn(definition: GroundItemDefinition, fling?: boolean): Promise<PreparedGroundSpawn>;
  isOcean?(position: THREE.Vector3): boolean;
}

export interface PickablePlantAppearanceContext {
  readonly model: THREE.Group;
  readonly animation: SpriteController;
  play(clips: readonly string[], loopLast?: boolean, onFirstOver?: () => void): void;
}
export interface PickablePlantAppearance {
  restore(pickable: Pickable): void;
  picked(pickable: Pickable): void;
  regen(pickable: Pickable): void;
  empty(pickable: Pickable): void;
  barren(pickable: Pickable, wasEmpty: boolean): void;
  transplant(): void;
}

/** Source prefab callbacks coordinating components, independently of presentation effects. */
export interface PickablePlantBehavior {
  initialize(saved?: PickablePlantRecord): void;
  picked(): void;
  regen(): void;
  empty(): void;
  barren(): void;
  burnt(): void;
  exportState(): PickablePlantRecord['components'];
  dispose(): void;
}
export interface PickablePlantBehaviorContext extends PickablePlantAppearanceContext {
  readonly pickable: Pickable;
  readonly scheduler: GameTimeScheduler;
  growthDuration(seconds: number): number;
  spawnLoot(prefab: string): void;
  /** Local bridges to world content, for behaviors watching phases or weather; each cleanup is the behavior's to run. */
  readonly getWatchWorldContent?: GetWatchWorldContent;
  readonly rain?: ReadonlySignal<'none' | 'rain' | 'snow'>;
}

/** The prefab-specific values of a renewable pickable plant: art, callbacks' clips and sounds, and loot. */
export interface PickablePlantDefinition {
  readonly prefab: string;
  readonly animArchive: string;
  readonly buildArchive: string;
  readonly tags: readonly string[];
  readonly product: string;
  readonly regrowTime?: number;
  readonly numToHarvest?: number;
  readonly noGrowInWinter?: boolean;
  readonly persistBurning?: boolean;
  readonly createBehavior?: (context: PickablePlantBehaviorContext) => PickablePlantBehavior;
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
  readonly maxCycles?: () => number;
  readonly barren?: string;
  readonly witherable?: boolean;
  readonly burnTime?: number;
  readonly burnFxLevel?: 2 | 3 | 4;
  readonly deploySmartRadius?: number;
  readonly getRegenTime?: (pickable: Pickable) => number;
  readonly extraLoot?: readonly string[];
  readonly digLoot?: (model: THREE.Group, pickable: Pickable, withered: boolean) => readonly { prefab: string; skinId?: string }[];
  readonly onTransplant?: (pickable: Pickable) => void;
  readonly createAppearance?: (context: PickablePlantAppearanceContext) => PickablePlantAppearance;
  readonly skins?: readonly string[];
  readonly dugSkins?: readonly string[];
  readonly snowCovered?: boolean;
  readonly physicsRadius?: number;
  readonly propagatorSize?: 'small' | 'medium';
}

interface Plant {
  definition: PickablePlantDefinition;
  model: THREE.Group;
  pickable: Pickable;
  factory: AnimatedSpriteFactory;
  readonly animation: TransientSpriteAnimationController;
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
  outputs: Map<string, PreparedGroundSpawn[]>;
  witherable?: Witherable;
  body?: CANNON.Body;
  behavior?: PickablePlantBehavior;
}

/**
 * Renewable pickable plants (grass.lua, sapling.lua): source component ownership for PICK,
 * DIG and burning (MakeMediumBurnable, MakeSmallPropagator, MakeNoGrowInWinter).
 */
export class PickablePlantManager {
  private readonly factoryRequests = new Map<string, Promise<AnimatedSpriteFactory>>();
  private fireFactoryRequest?: Promise<AnimatedSpriteFactory>;
  private snowRequest?: Promise<LoadedBuildOverride>;
  private readonly plants = new Map<THREE.Group, Plant>();
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly cleanups: (() => void)[] = [];
  private readonly season?: WorldContentSignal<SeasonState>;
  private readonly getWatchWorldContent?: GetWatchWorldContent;
  private disposed = false;

  private readonly scene: THREE.Scene;
  private readonly assetBaseUrl: string;
  private readonly world: PickablePlantWorld;

  constructor(scene: THREE.Scene, assetBaseUrl: string, world: PickablePlantWorld) {
    this.scene = scene; this.assetBaseUrl = assetBaseUrl; this.world = world;
    // MakeNoGrowInWinter belongs to the component/world binding, not the appearance effect.
    this.getWatchWorldContent = getBoundWatchWorldContent();
    if (this.getWatchWorldContent) {
      this.season = this.getWatchWorldContent(WorldContentKey.Season, cleanup => this.cleanups.push(cleanup));
    }
    this.scheduler = this.season?.scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !this.season;
    // Preserve the existing immediate world-state callback; ownership stays on the local bridge.
    this.season?.subscribe((current, previous) => {
      if ((current.season === 'winter') === (previous.season === 'winter')) return;
      for (const { pickable, definition } of this.plants.values()) {
        if (definition.noGrowInWinter === false) continue;
        if (current.season === 'winter') pickable.pause();
        else pickable.resume();
      }
    });
  }

  protected async spawnPlant(definition: PickablePlantDefinition, position: THREE.Vector3,
    saved?: PickablePlantRecord): Promise<THREE.Group> {
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError(`Invalid ${definition.prefab} position`);
    const prepared = await this.preparePlant(definition, saved?.components.plant?.skinId);
    return prepared.spawn(position, saved);
  }

  protected async preparePlant(definition: PickablePlantDefinition, skinId?: string): Promise<{
    spawn(position: THREE.Vector3, saved?: PickablePlantRecord): THREE.Group; dispose(): void;
  }> {
    const { prefab } = definition;
    if (this.disposed) throw new Error(`${prefab} manager has been disposed`);
    const factoryRequest = this.getFactory(definition, skinId);
    if (definition.snowCovered && !this.snowRequest) this.snowRequest = loadBuildOverride(this.assetBaseUrl, 'snow.zip');
    /* Plant art is shared by skin; each pending deployment owns its prepared loot. */
    if (!this.fireFactoryRequest) {
      this.fireFactoryRequest = Promise.all([
        loadBuild('fire.zip', this.assetBaseUrl), loadAnim('fire.zip', this.assetBaseUrl),
      ]).then(([build, anim]) => createSpriteFactory(build, anim));
      void this.fireFactoryRequest.catch(() => { this.fireFactoryRequest = undefined; });
    }
    const outputIds = ['ash', definition.dugLoot, definition.product, ...(definition.extraLoot ?? [])];
    const outputDefinitions = outputIds.flatMap(itemId => [undefined, ...(itemId === definition.dugLoot ? definition.dugSkins ?? [] : [])]
      .map(skinId => ({ ...catalog.items[itemId as keyof typeof catalog.items], itemId, count: 1, ...(skinId ? { skinId } : {}) })));
    let snow: LoadedBuildOverride | undefined;
    const resources = await Promise.allSettled([
      Promise.all([factoryRequest, definition.snowCovered ? this.snowRequest : undefined]).then(([factory, loadedSnow]) => { snow = loadedSnow; return factory; }), this.fireFactoryRequest,
      ...outputDefinitions.map(output => this.world.prepareSpawn(output, output.itemId !== 'ash')),
    ]);
    const failed = resources.find(result => result.status === 'rejected');
    if (failed || this.disposed) {
      for (const result of resources.slice(2)) if (result.status === 'fulfilled') result.value.dispose();
      if (failed?.status === 'rejected') throw failed.reason;
      throw new Error(`${prefab} manager has been disposed`);
    }
    const factory = (resources[0] as PromiseFulfilledResult<AnimatedSpriteFactory>).value;
    const fireFactory = (resources[1] as PromiseFulfilledResult<AnimatedSpriteFactory>).value;
    const outputs = new Map<string, PreparedGroundSpawn[]>();
    outputDefinitions.forEach((output, i) => {
      const key = `${output.itemId}:${output.skinId ?? ''}`;
      const pieces = outputs.get(key) ?? [];
      pieces.push((resources[i + 2] as PromiseFulfilledResult<PreparedGroundSpawn>).value);
      outputs.set(key, pieces);
    });
    let consumed = false;
    return {
      dispose: () => { if (!consumed) { consumed = true; outputs.forEach(pieces => pieces.forEach(output => output.dispose())); } },
      spawn: (position, saved) => {
        if (consumed || this.disposed) throw new Error(`${prefab} prepared spawn is unavailable`);
        if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError(`Invalid ${prefab} position`);
        consumed = true;
        const state = saved?.components.pickable;
        const model = factory.create({ ...(state?.cyclesLeft === 0 && definition.barren
          ? { initialAnimation: definition.barren, initialFrame: 'last', name: prefab }
          : state?.picked
          ? { initialAnimation: definition.empty.name, initialFrame: definition.empty.frame, name: prefab }
          : { initialAnimation: definition.idle.name, initialFrame: 'first', name: prefab }),
          getWatchWorldContent: this.getWatchWorldContent, snowCovered: snow });
        model.position.set(position.x, 0, position.z);
        Object.assign(model.userData, { prefab, entityId: saved?.id ?? newEntityId(), tags: [...definition.tags] });
        if (skinId) model.userData.skinId = skinId;
        if (definition.physicsRadius !== undefined) model.userData.physicsRadius = definition.physicsRadius * (TILE_SIZE / 4);
        if (definition.deploySmartRadius !== undefined) model.userData.deploySmartRadius = definition.deploySmartRadius;
        let animation = model.userData.animationController as SpriteController;
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
        const animationContext: PickablePlantAppearanceContext = { model, get animation() { return animation; },
          play: (clips, loopLast = false, onFirstOver) => {
            const version = ++plant.version;
            plant.transitionAt = this.scheduler.now;
            const play = (index: number) => {
              if (this.disposed || this.plants.get(model) !== plant || plant.version !== version) return;
              if (index === clips.length - 1 && loopLast) animation.start(clips[index]);
              else animation.playOnce(clips[index], index + 1 < clips.length ? () => {
                if (this.plants.get(model) !== plant || plant.version !== version) return;
                if (index === 0) onFirstOver?.();
                play(index + 1);
              } : undefined);
            };
            play(0);
          },
        };
        const appearance = definition.createAppearance?.(animationContext);
        const pickable: Pickable = new Pickable(model, definition.product, definition.regrowTime, definition.numToHarvest ?? 1, () => {
          plant.sound?.stop();
          if (definition.picked.sound) plant.sound = PlaySound(definition.picked.sound, model.position);
          if (plant.behavior) { plant.behavior.picked(); return; }
          if (appearance) { appearance.picked(pickable); return; }
          const [first, last] = definition.picked.clips;
          if (pickable.IsBarren() && definition.barren) {
            const version = ++plant.version;
            plant.transitionAt = this.scheduler.now;
            animation.playOnce(first, () => {
              if (this.plants.get(model) !== plant || plant.version !== version) return;
              animation.playOnce('empty_to_dead', () => {
                if (this.plants.get(model) === plant && plant.version === version) animation.playOnce(definition.barren!);
              });
            });
          } else playSequence(first, last);
        }, () => plant.behavior ? plant.behavior.regen() : appearance ? appearance.regen(pickable) : playSequence(definition.grow, definition.idle.name, true), state, {
          scheduler: this.scheduler,
          growthDuration: seconds => this.season?.peek().season === 'spring' ? seconds * 0.75 : seconds,
          maxCycles: definition.maxCycles?.(),
          getRegenTime: definition.getRegenTime,
          onTransplant: definition.onTransplant ? () => definition.onTransplant!(pickable)
            : definition.barren ? () => { appearance?.transplant(); pickable.MakeBarren(); } : undefined,
          onBarren: definition.barren ? wasEmpty => {
            if (plant.behavior) { plant.behavior.barren(); return; }
            if (appearance) { appearance.barren(pickable, wasEmpty); return; }
            if (plant.witherable?.IsWithered()) playSequence(wasEmpty ? 'empty_to_dead' : 'full_to_dead', definition.barren);
            else playSequence(definition.barren!);
          } : undefined,
          onEmpty: () => {
            if (plant.behavior) { plant.behavior.empty(); return; }
            if (appearance) { appearance.empty(pickable); return; }
            if (definition.witherable && (plant.witherable?.IsWithered() || animation.currentAnimation === definition.barren)) {
              playSequence('dead_to_empty', definition.empty.name);
            } else playSequence(definition.empty.name);
          },
        });
        const entity = actionEntity(model, prefab);
        const burnable = new Burnable(entity, this.scheduler);
        entity.components.burnable = burnable;
        burnable.SetBurnTime(definition.burnTime ?? 20);
        const propagator = new Propagator(entity, definition.propagatorSize ?? 'small', radius => {
          const nearby: BurnableInst[] = [];
          this.scene.traverse(object => {
            const other = object.userData.actionEntity as BurnableInst | undefined;
            if (!other?.components.propagator || other.isRemoved || other.hasTag('INLIMBO')) return;
            if (other.getPosition().distanceToSquared(model.position) <= radius ** 2) nearby.push(other);
          });
          return nearby;
        }, TILE_SIZE / 4, this.scheduler, this.getWatchWorldContent);
        entity.components.propagator = propagator;
        const persistence = createSignal(true);
        const phase = createMemo(() => pickable.state.removed.get() ? 'removed'
          : burnable.burning.get() ? 'burning' : pickable.state.phase.get());
        const fire = fireFactory.create({ initialAnimation: `level${definition.burnFxLevel ?? 3}`, name: 'fire' });
        fire.userData.tags = ['FX', 'NOCLICK'];
        const workable = new Workable(entity);
        entity.components.workable = workable;
        workable.SetWorkAction('DIG'); workable.SetWorkLeft(1);
        const lootdropper = new LootDropper(entity, (lootPrefab, point, lootSkin) => {
          const output = outputs.get(`${lootPrefab}:${lootSkin ?? ''}`)?.shift();
          if (!output?.spawn(new THREE.Vector3(point.x, point.y, point.z))) throw new Error(`${prefab} loot not prepared: ${lootPrefab}`);
          return output.spawnedEntity;
        });
        model.userData.components.lootdropper = lootdropper;
        workable.SetOnFinishCallback(() => {
          if (definition.digLoot) {
            for (const loot of definition.digLoot(model, pickable, plant.witherable?.IsWithered() ?? false)) {
              lootdropper.SpawnLootPrefab(loot.prefab, model.position, loot.skinId);
            }
            this.remove(model);
            return;
          }
          if (pickable.canBePicked && pickable.product) lootdropper.SpawnLootPrefab(pickable.product);
          lootdropper.SpawnLootPrefab(plant.witherable?.IsWithered() ? definition.product : definition.dugLoot);
          this.remove(model);
        });
        burnable.SetOnIgniteFn(() => persistence.set(definition.persistBurning ?? false));
        burnable.SetOnExtinguishFn(() => persistence.set(true));
        burnable.SetOnBurntFn(() => {
          plant.behavior?.burnt();
          if (!this.world.isOcean?.(model.position) && !outputs.get('ash:')![0].spawn(model.position.clone())) {
            throw new Error(`${prefab} ash not prepared`);
          }
          this.remove(model);
        });
        const plant: Plant = { definition, model, get animation() { return animation; }, pickable, factory, version: 0,
          transitionAt: this.scheduler.now, stopEffect: () => {}, stopBurning: () => {},
          burnable, propagator, workable, persistence, fire, fireFactory, phase, outputs };
        plant.behavior = definition.createBehavior?.({ ...animationContext, get animation() { return animation; }, pickable,
          scheduler: this.scheduler,
          growthDuration: seconds => this.season?.peek().season === 'spring' ? seconds * .75 : seconds,
          spawnLoot: prefab => { lootdropper.SpawnLootPrefab(prefab); },
          getWatchWorldContent: this.getWatchWorldContent, rain: this.world.rain,
        });
        if (definition.witherable) {
          plant.witherable = new Witherable(entity, pickable, this.scheduler,
            () => this.world.getLocalTemperature?.(model.position) ?? 20, this.world.rain,
            saved?.components.witherable, state?.protectedCycles);
          model.userData.components.witherable = plant.witherable;
        }
        model.userData.pickablePlantState = Object.freeze({ ...pickable.state, phase: readonlySignal(phase),
          burning: burnable.burning, burnTimer: burnable.timer, persistence: readonlySignal(persistence) });
        plant.stopBurning = burnable.burning.subscribe(burning => {
          if (burning) {
            fire.position.copy(model.position);
            this.scene.add(fire);
            plant.fireSound = PlaySound('dontstarve/common/campfire', model.position);
            const large = definition.burnFxLevel === 4;
            setPrefabLocalLight(model, { colour: large ? [1, 190 / 255, 121 / 255] : [1, 1, 192 / 255],
              radius: ((definition.burnFxLevel ?? 3) + 1) * (TILE_SIZE / 4), intensity: large ? .9 : .8, falloff: large ? .25 : .33 });
          } else {
            fire.removeFromParent(); plant.fireSound?.stop(); plant.fireSound = undefined;
            setPrefabLocalLight(model, null);
            if (this.plants.get(model) === plant && !this.disposed) {
              plant.extinguishSound?.stop(); plant.extinguishSound = PlaySound('dontstarve/common/fireOut', model.position);
            }
          }
        });
        this.plants.set(model, plant);
        if (definition.physicsRadius !== undefined && this.world.physics) {
          plant.body = MakeObstaclePhysics(model.position, definition.physicsRadius);
          model.userData.physicsBody = plant.body;
          this.world.physics.addBody(plant.body);
        }
        plant.behavior?.initialize(saved);
        appearance?.restore(pickable);
        model.userData.replacePlantAppearance = (replacement: THREE.Group) => {
          const previous = animation;
          previous.dispose();
          for (const child of [...model.children]) {
            child.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
            model.remove(child);
          }
          for (const child of [...replacement.children]) model.add(child);
          const controller = replacement.userData.animationController as SpriteController;
          controller.copyPlaybackFrom(previous);
          registerSpriteRenderGroup(model, model.children[0] as THREE.Group);
          animation = controller;
          model.userData.animationController = controller;
          // The live plant owns the transferred controller; only the empty wrapper is disposed.
          delete replacement.userData.animationController;
        };
        if (definition.noGrowInWinter !== false && this.season?.peek().season === 'winter') pickable.pause();
        else pickable.resume();
        const readyClips = [definition.idle.name, definition.grow];
        const emptyClips: string[] = [...definition.picked.clips, definition.empty.name, 'dead_to_empty'];
        plant.stopEffect = appearance || plant.behavior ? () => {} : createEffect(() => {
          const current = plant.phase.get();
          if (current === 'ready' && !readyClips.includes(animation.currentAnimation)) animation.start(definition.idle.name);
          else if (current === 'picked' && !emptyClips.includes(animation.currentAnimation)) animation.playOnce(definition.empty.name);
          else if (current === 'barren' && definition.barren
            && ![...emptyClips, definition.barren, 'empty_to_dead', 'full_to_dead'].includes(animation.currentAnimation)) animation.playOnce(definition.barren);
        });
        this.scene.add(model);
        if (saved?.components.burning) {
          plant.behavior?.burnt();
          if (!this.world.isOcean?.(model.position)) lootdropper.SpawnLootPrefab('ash');
          this.remove(model);
        }
        return model;
      },
    };
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
  get digTargets(): readonly ShovelTarget[] { return this.getDigTargets(); }

  getDigTargets(model?: THREE.Object3D): readonly ShovelTarget[] {
    return modelValues(this.plants, model).map(({ definition, model, workable }) => ({
      id: String(model.userData.entityId), model, position: model.position, entity: actionEntity(model, definition.prefab),
      isValid: () => !this.disposed && this.plants.has(model) && workable.CanBeWorked(),
      dig: () => performToolWork('DIG', actionEntity(model, definition.prefab), {}),
    }));
  }
  get reskinTargets(): readonly ReskinTarget[] { return this.getReskinTargets(); }

  getReskinTargets(model?: THREE.Object3D): readonly ReskinTarget[] {
    return modelValues(this.plants, model).flatMap(plant => {
      const { definition, model } = plant;
      if (!definition.skins) return [];
      const isValid = () => !this.disposed && this.plants.get(model) === plant && !model.userData.removed;
      return [{ id: String(model.userData.entityId), prefabId: definition.prefab, model, position: model.position,
        skins: definition.skins, isValid, get skinId() { return model.userData.skinId as string | undefined; },
        get isRemoved() { return !isValid(); }, hasTag: (tag: string) => actionEntity(model, definition.prefab).hasTag(tag),
        prepareNextSkin: async (tool?: Parameters<ReskinTarget['prepareNextSkin']>[0]) => {
          const previousSkin = model.userData.skinId as string | undefined;
          const skinId = nextReskin(definition.skins!, previousSkin, tool?._cached_reskinname, definition.prefab);
          const factory = await this.getFactory(definition, skinId);
          if (!isValid()) throw new Error('Plant is no longer available');
          const replacement = factory.create({ initialAnimation: definition.idle.name,
            getWatchWorldContent: this.getWatchWorldContent,
            snowCovered: definition.snowCovered ? await this.snowRequest : undefined });
          let used = false;
          return { apply: () => {
            if (used || !isValid() || model.userData.skinId !== previousSkin) return false;
            model.userData.replacePlantAppearance(replacement);
            if (skinId) model.userData.skinId = skinId; else delete model.userData.skinId;
            factory.disposeSprite(replacement); used = true;
            return true;
          }, dispose: () => { if (!used) { factory.disposeSprite(replacement); used = true; } } };
        },
      }];
    });
  }

  private getFactory(definition: PickablePlantDefinition, skinId?: string): Promise<AnimatedSpriteFactory> {
    if (skinId !== undefined && !definition.skins?.includes(skinId)) throw new Error(`Unsupported ${definition.prefab} skin: ${skinId}`);
    const key = `${definition.prefab}:${skinId ?? ''}`;
    let request = this.factoryRequests.get(key);
    if (!request) {
      request = Promise.all([
        loadBuild(definition.buildArchive, this.assetBaseUrl), loadAnim(definition.animArchive, this.assetBaseUrl),
        skinId ? loadSpriteSkinArchive(`dynamic/${skinId}.zip`, this.assetBaseUrl) : undefined,
        PreloadSounds(...definition.picked.sound ? [definition.picked.sound] : [],
          'dontstarve/common/campfire', 'dontstarve/common/fireOut'),
      ]).then(([build, animations, skin]) => createSpriteFactory(build, animations, SpriteController, skin));
      this.factoryRequests.set(key, request);
      void request.catch(() => { this.factoryRequests.delete(key); });
    }
    return request;
  }

  protected exportPlants(): { prefab: string; record: PickablePlantRecord }[] {
    this.scheduler.advanceTo(this.scheduler.now);
    return [...this.plants.values()].filter(plant => plant.persistence.peek()).map(({ definition, model, pickable, witherable, behavior, burnable }) => ({
      prefab: definition.prefab,
      record: {
        id: String(model.userData.entityId),
        transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
        components: { ...(definition.skins ? { plant: model.userData.skinId ? { skinId: model.userData.skinId } : {} } : {}), pickable: pickable.exportState(), ...(witherable ? { witherable: witherable.exportState() } : {}),
          ...behavior?.exportState(), ...(definition.persistBurning && burnable.IsBurning() ? { burning: true as const } : {}) },
      },
    }));
  }

  remove(model: THREE.Group): void {
    const plant = this.plants.get(model);
    if (!plant) return;
    this.plants.delete(model);
    plant.version++;
    model.userData.removed = true;
    if (plant.body) this.world.physics?.removeBody(plant.body);
    delete model.userData.replacePlantAppearance;
    plant.burnable.SetOnExtinguishFn(undefined);
    plant.burnable.dispose(); plant.propagator.dispose(); plant.workable.dispose();
    plant.witherable?.dispose();
    plant.behavior?.dispose();
    plant.pickable.dispose(); plant.phase.dispose();
    plant.stopBurning();
    plant.fireSound?.stop(); plant.extinguishSound?.stop();
    setPrefabLocalLight(model, null);
    plant.fireFactory.disposeSprite(plant.fire);
    for (const pieces of plant.outputs.values()) for (const output of pieces) output.dispose();
    plant.stopEffect();
    plant.sound?.stop();
    plant.factory.disposeSprite(model);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanups.splice(0).forEach(cleanup => cleanup());
    for (const model of this.plants.keys()) this.remove(model);
    if (this.ownsScheduler) this.scheduler.dispose();
    for (const request of this.factoryRequests.values()) void request.then(factory => factory.dispose(), () => undefined);
    void this.snowRequest?.then(snow => snow.dispose(), () => undefined);
    void this.fireFactoryRequest?.then(factory => factory.dispose(), () => undefined);
  }
}
