import { modelValues } from './modelRecords';
import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createEffect, createMemo, createSignal, readonlySignal, getBoundWatchWorldContent, WorldContentKey, type ReadonlySignal, type WorldContentSignal, type GetWatchWorldContent, type SeasonState, type TileStateQuery } from '@dontstarve-web/signals';
import { Witherable, type WitherableSave } from '../../componets/src/witherable';
import { loadAnim, loadBuild, loadSpriteSkinArchive } from '@dontstarve-web/animation/animationAssets';
import {
  createSpriteFactory, SpriteController, loadBuildOverride, type LoadedBuildOverride, type AnimatedSpriteFactory, type AnimatedSpriteOptions, type TransientSpriteAnimationController,
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
import { ResidentSprite } from '@dontstarve-web/animation/residentSprite';
import { watchTileActivity } from './tileActivity';
import { createPrefabEntity, type PrefabInstance } from './prefabInstance';
import { SpriteState, type PrefabDisplay } from '@dontstarve-web/display';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import type { GrowableSave } from '../../componets/src/growable';
import { ArchiveSpriteAssets, preloadSharedArchiveSprite, type ArchiveSprite, type ArchiveSpriteOptions } from '@dontstarve-web/animation/archiveSprite';

type PlantAnimation = SpriteController | SpriteState | ArchiveSprite;
type CreatePlantArchiveSprite = Awaited<ReturnType<typeof preloadSharedArchiveSprite>>;

export interface PickablePlantRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { pickable?: PickableSaveState; witherable?: WitherableSave; plant?: { skinId?: string }; growable?: GrowableSave; burning?: true;
    /** mushrooms.lua OnSave: the rain days left before a picked mushroom regrows. */
    mushroom?: { rain: number };
    /** cave_fern.lua OnSave: data.anim, the chosen pose clip. */
    variant?: { anim: string } };
}

export interface PickablePlantWorld {
  /** Season, snow level and the scheduler come from the bound world content. */
  rain?: ReadonlySignal<'none' | 'rain' | 'snow'>;
  /** Without it every plant is active. */
  tickingarea?: TileStateQuery;
  physics?: CANNON.World;
  getLocalTemperature?(position: THREE.Vector3): number;
  prepareSpawn(definition: GroundItemDefinition, fling?: boolean): Promise<PreparedGroundSpawn>;
  isOcean?(position: THREE.Vector3): boolean;
}

export interface PickablePlantAppearanceContext<T extends PlantAnimation = SpriteController | SpriteState> {
  readonly model: THREE.Group;
  readonly animation: T;
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
export interface PickablePlantBehaviorContext extends PickablePlantAppearanceContext<PlantAnimation> {
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
  /** Opt into shared archive frames and instancing while keeping source playback in the prefab behavior. */
  readonly archiveSprite?: { readonly bank: string; readonly instancedAnimations: ArchiveSpriteOptions['instancedAnimations'];
    /** Release the sprite while the plant's tile is outside the tickingarea (see `ResidentSprite`). */
    readonly resident?: boolean };
  /** Factory-path plants: release the sprite while the tile is outside the tickingarea (see `ResidentSpriteController`). */
  readonly resident?: boolean;
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
  readonly picked: { readonly sound?: SoundEventPath; readonly clips: readonly [] | readonly [string] | readonly [string, string] };
  /** makeemptyfn as restored by Pickable:OnLoad; absent when the plant is removed once picked. */
  readonly empty?: { readonly name: string; readonly frame: 'first' | 'last' };
  /** onregenfn: grow, then the looping idle clip. */
  readonly grow?: string;
  /** workable dig_up loot after the ready product. */
  /** Omitted for plants without a `workable` (cave_fern): they cannot be dug. */
  readonly dugLoot?: string;
  /** pickable.remove_when_picked: the plant is removed by a successful pick instead of showing a picked pose. */
  readonly removeWhenPicked?: boolean;
  /** pickable.quickpick, read by the SGwilson PICK deststate. */
  readonly quickpick?: boolean;
  /** cave_fern.lua: one pose clip is chosen at random per plant and saved as `variant.anim`. */
  readonly variants?: readonly string[];
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
  factory?: AnimatedSpriteFactory;
  sprite?: ArchiveSprite;
  /** A resident factory plant's sprite json; its display draws it only while the tile is active. */
  residentController?: SpriteState;
  /** The entity behind a resident factory plant. */
  instance?: PrefabInstance;
  display?: PrefabDisplay;
  readonly animation: PlantAnimation;
  version: number;
  transitionAt: number;
  /** Its tile is in the tickingarea (always true without residency): the visual may exist and must be advanced and ordered. */
  awake: boolean;
  stopEffect: () => void;
  stopArt?: () => void;
  stopActivity?: () => void;
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
  variant?: string;
  body?: CANNON.Body;
  behavior?: PickablePlantBehavior;
}

/**
 * Renewable pickable plants (grass.lua, sapling.lua): source component ownership for PICK,
 * DIG and burning (MakeMediumBurnable, MakeSmallPropagator, MakeNoGrowInWinter).
 */
export class PickablePlantManager {
  private readonly factoryRequests = new Map<string, Promise<AnimatedSpriteFactory>>();
  private readonly archiveSpriteRequests = new Map<PickablePlantDefinition, Promise<CreatePlantArchiveSprite>>();
  private readonly archiveAssets: ArchiveSpriteAssets;
  private fireFactoryRequest?: Promise<AnimatedSpriteFactory>;
  private snowRequest?: Promise<LoadedBuildOverride>;
  private readonly plants = new Map<THREE.Group, Plant>();
  /** Plants that are awake or burning; the rest hold no visual and have nothing to advance or order. */
  private readonly running = new Set<Plant>();
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly cleanups: (() => void)[] = [];
  private readonly season?: WorldContentSignal<SeasonState>;
  private readonly cameraRotation?: WorldContentSignal<THREE.Quaternion>;
  private readonly getWatchWorldContent?: GetWatchWorldContent;
  private disposed = false;

  private readonly scene: THREE.Scene;
  private readonly assetBaseUrl: string;
  private readonly world: PickablePlantWorld;

  constructor(scene: THREE.Scene, assetBaseUrl: string, world: PickablePlantWorld) {
    this.scene = scene; this.assetBaseUrl = assetBaseUrl; this.world = world;
    this.archiveAssets = new ArchiveSpriteAssets('pickable_plant', assetBaseUrl);
    // MakeNoGrowInWinter belongs to the component/world binding, not the appearance effect.
    this.getWatchWorldContent = getBoundWatchWorldContent();
    if (this.getWatchWorldContent) {
      this.season = this.getWatchWorldContent(WorldContentKey.Season, cleanup => this.cleanups.push(cleanup));
      // Billboards face the camera: re-orient them only when it turns.
      const rotation = this.cameraRotation = this.getWatchWorldContent(WorldContentKey.CameraRotation, cleanup => this.cleanups.push(cleanup));
      createEffect(() => {
        const quaternion = rotation.get();
        for (const plant of this.plants.values()) this.face(plant, quaternion);
      });
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

  private face({ sprite, model }: Pick<Plant, 'sprite' | 'model'>, quaternion: THREE.Quaternion): void {
    if (sprite) sprite.faceCamera(quaternion); else model.quaternion.copy(quaternion);
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
    const factoryRequest = definition.archiveSprite ? this.getArchiveSprite(definition) : this.getFactory(definition, skinId);
    if (definition.snowCovered && !this.snowRequest) this.snowRequest = loadBuildOverride(this.assetBaseUrl, 'snow.zip');
    /* Plant art is shared by skin; each pending deployment owns its prepared loot. */
    if (!this.fireFactoryRequest) {
      this.fireFactoryRequest = Promise.all([
        loadBuild('fire.zip', this.assetBaseUrl), loadAnim('fire.zip', this.assetBaseUrl),
      ]).then(([build, anim]) => createSpriteFactory(build, anim));
      void this.fireFactoryRequest.catch(() => { this.fireFactoryRequest = undefined; });
    }
    const outputIds = ['ash', ...definition.dugLoot ? [definition.dugLoot] : [], definition.product, ...(definition.extraLoot ?? [])];
    const outputDefinitions = outputIds.flatMap(itemId => [undefined, ...(itemId === definition.dugLoot ? definition.dugSkins ?? [] : [])]
      .map(skinId => ({ ...catalog.items[itemId as keyof typeof catalog.items], itemId, count: 1, ...(skinId ? { skinId } : {}) })));
    let snow: LoadedBuildOverride | undefined;
    const resources = await Promise.allSettled([
      Promise.all([factoryRequest, definition.snowCovered ? this.snowRequest : undefined]).then(([factory, loadedSnow]) => { snow = loadedSnow; return factory; }), this.fireFactoryRequest,
      ...outputDefinitions.map(output => this.world.prepareSpawn(output, output.itemId !== 'ash')),
    ]);
    const failed = resources.find(result => result.status === 'rejected');
    if (failed || this.disposed) {
      for (const result of resources.slice(2) as PromiseSettledResult<PreparedGroundSpawn>[]) if (result.status === 'fulfilled') result.value.dispose();
      if (failed?.status === 'rejected') throw failed.reason;
      throw new Error(`${prefab} manager has been disposed`);
    }
    const source = (resources[0] as PromiseFulfilledResult<AnimatedSpriteFactory | CreatePlantArchiveSprite>).value;
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
        // cave_fern.lua onload restores data.anim; otherwise names[math.random(#names)].
        const savedVariant = saved?.components.variant?.anim;
        if (savedVariant !== undefined && !definition.variants?.includes(savedVariant)) throw new Error(`Unsupported ${prefab} variant: ${savedVariant}`);
        const variant = definition.variants ? savedVariant ?? definition.variants[Math.floor(Math.random() * definition.variants.length)] : undefined;
        const idleName = variant ?? definition.idle.name;
        const emptyName = definition.empty?.name ?? idleName;
        const initial: Pick<AnimatedSpriteOptions, 'initialAnimation' | 'initialFrame' | 'name'> = state?.cyclesLeft === 0 && definition.barren
          ? { initialAnimation: definition.barren, initialFrame: 'last', name: prefab }
          : state?.picked && definition.empty
          ? { initialAnimation: definition.empty.name, initialFrame: definition.empty.frame, name: prefab }
          : { initialAnimation: idleName, initialFrame: 'first', name: prefab };
        const created = typeof source === 'function' ? source(initial.initialAnimation, false, prefab) : undefined;
        const resident = created && definition.archiveSprite?.resident
          ? new ResidentSprite(clip => (source as CreatePlantArchiveSprite)(clip.name, false, prefab), { name: initial.initialAnimation, loop: false }, created, prefab)
          : undefined;
        const sprite = resident ?? created;
        const factory = typeof source === 'function' ? undefined : source;
        if (sprite && initial.initialFrame === 'last') sprite.setFrame(sprite.frameCount - 1);
        const factoryOptions = (animationName: string, frame?: AnimatedSpriteOptions['initialFrame']): AnimatedSpriteOptions => ({
          ...initial, initialAnimation: animationName, ...frame ? { initialFrame: frame } : {},
          getWatchWorldContent: this.getWatchWorldContent, snowCovered: snow });
        const residentEntity = factory && definition.resident
          ? createPrefabEntity(prefab, { create: (animationName, frame) => factory.create(factoryOptions(animationName, frame)),
            release: drawn => factory.disposeSprite(drawn) },
            { name: initial.initialAnimation, held: initial.initialFrame === 'last' }, prefab)
          : undefined;
        const instance = residentEntity?.instance, residentController = instance?.sprite;
        const model = sprite?.model ?? residentEntity?.display.model ?? factory!.create(factoryOptions(initial.initialAnimation, initial.initialFrame));
        if (residentController) model.name = prefab;
        model.position.set(position.x, 0, position.z);
        this.face({ sprite, model }, this.cameraRotation?.peek() ?? model.quaternion);
        Object.assign(model.userData, { prefab, entityId: saved?.id ?? newEntityId(), tags: [...definition.tags] });
        if (skinId) model.userData.skinId = skinId;
        if (definition.physicsRadius !== undefined) model.userData.physicsRadius = definition.physicsRadius * (TILE_SIZE / 4);
        if (definition.deploySmartRadius !== undefined) model.userData.deploySmartRadius = definition.deploySmartRadius;
        let animation: PlantAnimation = sprite ?? residentController ?? model.userData.animationController as SpriteController;
        model.userData.animationController = animation;
        // sapling.lua: AnimState:SetFrame(math.random(GetCurrentAnimationNumFrames()) - 1).
        if (!state?.picked && definition.idle.randomFrame) animation.setFrame(Math.floor(Math.random()
          * ('numFrames' in animation ? animation.numFrames : animation.frameCount)));
        const playSequence = (first: string, last?: string, loop = false) => {
          const version = ++plant.version;
          plant.transitionAt = this.scheduler.now;
          animation.playOnce(first, last === undefined ? undefined : () => {
            if (this.disposed || this.plants.get(model) !== plant || plant.version !== version) return;
            if (loop) animation.start(last);
            else animation.playOnce(last);
          });
        };
        const animationContext: PickablePlantAppearanceContext<PlantAnimation> = { model, get animation() { return animation; },
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
        const appearance = definition.createAppearance?.({ ...animationContext, get animation() {
          if (animation instanceof SpriteController || animation instanceof SpriteState) return animation;
          throw new Error('Layered plant appearance requires a factory controller');
        } });
        const pickable: Pickable = new Pickable(model, definition.product, definition.regrowTime, definition.numToHarvest ?? 1, () => {
          plant.sound?.stop();
          if (definition.picked.sound) plant.sound = PlaySound(definition.picked.sound, model.position);
          if (definition.removeWhenPicked) return;
          if (plant.behavior) { plant.behavior.picked(); return; }
          if (appearance) { appearance.picked(pickable); return; }
          const [first, last] = definition.picked.clips;
          if (first === undefined) return;
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
        }, () => plant.behavior ? plant.behavior.regen() : appearance ? appearance.regen(pickable) : playSequence(definition.grow ?? idleName, idleName, true), state, {
          scheduler: this.scheduler,
          onRemove: definition.removeWhenPicked ? () => this.remove(model) : undefined,
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
              playSequence('dead_to_empty', emptyName);
            } else playSequence(emptyName);
          },
        });
        pickable.quickpick = definition.quickpick ?? false;
        pickable.remove_when_picked = definition.removeWhenPicked ?? false;
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
        if (definition.dugLoot) {
          entity.components.workable = workable;
          workable.SetWorkAction('DIG'); workable.SetWorkLeft(1);
        } else workable.SetWorkable(false);
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
          lootdropper.SpawnLootPrefab(plant.witherable?.IsWithered() ? definition.product : definition.dugLoot!);
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
        const plant: Plant = { definition, model, get animation() { return animation; }, pickable, factory, sprite, residentController, instance, display: residentEntity?.display, version: 0,
          transitionAt: this.scheduler.now, awake: !resident && !residentController, stopEffect: () => {}, stopBurning: () => {},
          burnable, propagator, workable, persistence, fire, fireFactory, phase, outputs, variant };
        if (resident && this.cameraRotation) plant.stopArt = createEffect(() => {
          resident.art.get();
          // Camera changes have their own manager effect; restore its current
          // orientation when residency replaces this plant's drawn sprite.
          resident.faceCamera(this.cameraRotation!.peek());
        });
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
            this.track(plant);
            plant.fireSound = PlaySound('dontstarve/common/campfire', model.position);
            const large = definition.burnFxLevel === 4;
            setPrefabLocalLight(model, { colour: large ? [1, 190 / 255, 121 / 255] : [1, 1, 192 / 255],
              radius: ((definition.burnFxLevel ?? 3) + 1) * (TILE_SIZE / 4), intensity: large ? .9 : .8, falloff: large ? .25 : .33 });
          } else {
            fire.removeFromParent(); plant.fireSound?.stop(); plant.fireSound = undefined;
            this.track(plant);
            setPrefabLocalLight(model, null);
            if (this.plants.get(model) === plant && !this.disposed) {
              plant.extinguishSound?.stop(); plant.extinguishSound = PlaySound('dontstarve/common/fireOut', model.position);
            }
          }
        });
        this.plants.set(model, plant);
        this.track(plant);
        if (resident) plant.stopActivity = watchTileActivity(model, this.world.tickingarea, active => {
          resident.setActive(active);
          plant.awake = active;
          this.track(plant);
        });
        if (residentController) {
          // Layers and snow are prefab state: dress every drawn sprite again from the plant's own components.
          if (appearance) plant.stopArt = createEffect(() => { residentController.art.get(); appearance.restore(pickable); });
          plant.stopActivity = watchTileActivity(model, this.world.tickingarea, active => {
            instance!.setActive(active);
            plant.awake = active;
            this.track(plant);
          });
        }
        if (definition.physicsRadius !== undefined && this.world.physics) {
          plant.body = MakeObstaclePhysics(model.position, definition.physicsRadius);
          model.userData.physicsBody = plant.body;
          this.world.physics.addBody(plant.body);
        }
        plant.behavior?.initialize(saved);
        appearance?.restore(pickable);
        model.userData.replacePlantAppearance = (replacement: THREE.Group) => {
          const previous = animation;
          if (!(previous instanceof SpriteController)) throw new Error('Plant reskin requires a SpriteController');
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
        const readyClips = [idleName, definition.grow ?? idleName];
        const emptyClips: string[] = [...definition.picked.clips, emptyName, 'dead_to_empty'];
        plant.stopEffect = appearance || plant.behavior ? () => {} : createEffect(() => {
          const current = plant.phase.get();
          if (current === 'ready' && !readyClips.includes(animation.currentAnimation)) animation.start(idleName);
          else if (current === 'picked' && !emptyClips.includes(animation.currentAnimation)) animation.playOnce(emptyName);
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
    const now = this.scheduler.now;
    for (const plant of this.running) {
      const { animation, transitionAt, fire, model } = plant;
      if (!this.cameraRotation) this.face(plant, cameraQuaternion);
      animation.update(Math.min(dt, now - transitionAt));
      if (fire.parent) {
        fire.position.copy(model.position); fire.quaternion.copy(cameraQuaternion);
        (fire.userData.animationController as TransientSpriteAnimationController).update(dt);
      }
    }
  }

  /** A sleeping plant draws nothing, so it has no order to resolve. */
  get renderEntities() {
    const entries: { object: THREE.Object3D; footPosition: THREE.Vector3; cameraDepth: number }[] = [];
    for (const { model, fire, awake } of this.running) {
      if (awake) entries.push({ object: model, footPosition: model.position, cameraDepth: 0 });
      if (fire.parent) entries.push({ object: fire, footPosition: model.position, cameraDepth: 0 });
    }
    return entries;
  }

  private track(plant: Plant): void {
    if (plant.awake || plant.fire.parent) this.running.add(plant); else this.running.delete(plant);
  }
  get digTargets(): readonly ShovelTarget[] { return this.getDigTargets(); }

  getDigTargets(model?: THREE.Object3D): readonly ShovelTarget[] {
    return modelValues(this.plants, model).filter(({ definition }) => definition.dugLoot).map(({ definition, model, workable }) => ({
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
          const snowCovered = definition.snowCovered ? await this.snowRequest : undefined;
          const options = (initialAnimation: string) => ({ initialAnimation,
            getWatchWorldContent: this.getWatchWorldContent, snowCovered });
          const replacement = plant.display
            ? createPrefabEntity(definition.prefab, { create: animationName => factory.create(options(animationName)),
              release: drawn => factory.disposeSprite(drawn) }, { name: definition.idle.name }).display
            : factory.create(options(definition.idle.name));
          const release = () => {
            if (replacement instanceof THREE.Group) factory.disposeSprite(replacement); else replacement.dispose();
          };
          let used = false;
          return { apply: () => {
            if (used || !isValid() || model.userData.skinId !== previousSkin) return false;
            if (replacement instanceof THREE.Group) model.userData.replacePlantAppearance(replacement);
            else plant.display!.adopt(replacement);
            model.userData.skinId = skinId || undefined;
            release(); used = true;
            return true;
          }, dispose: () => { if (!used) { release(); used = true; } } };
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

  private getArchiveSprite(definition: PickablePlantDefinition): Promise<CreatePlantArchiveSprite> {
    let request = this.archiveSpriteRequests.get(definition);
    if (!request) {
      request = Promise.all([
        preloadSharedArchiveSprite(this.archiveAssets, { animationArchive: definition.animArchive,
          buildArchives: [definition.buildArchive], bank: definition.archiveSprite!.bank },
        { instancedAnimations: definition.archiveSprite!.instancedAnimations, staticBillboard: true }),
        PreloadSounds(...definition.picked.sound ? [definition.picked.sound] : [],
          'dontstarve/common/campfire', 'dontstarve/common/fireOut'),
      ]).then(([create]) => create);
      this.archiveSpriteRequests.set(definition, request);
      void request.catch(() => this.archiveSpriteRequests.delete(definition));
    }
    return request;
  }

  protected exportPlants(): { prefab: string; record: PickablePlantRecord }[] {
    this.scheduler.advanceTo(this.scheduler.now);
    return [...this.plants.values()].filter(plant => plant.persistence.peek()).map(({ definition, model, pickable, witherable, behavior, burnable, variant }) => ({
      prefab: definition.prefab,
      record: {
        id: String(model.userData.entityId),
        transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
        components: { ...(definition.skins ? { plant: model.userData.skinId ? { skinId: model.userData.skinId } : {} } : {}), pickable: pickable.exportState(), ...(witherable ? { witherable: witherable.exportState() } : {}),
          ...behavior?.exportState(), ...(variant ? { variant: { anim: variant } } : {}), ...(definition.persistBurning && burnable.IsBurning() ? { burning: true as const } : {}) },
      },
    }));
  }

  remove(model: THREE.Group): void {
    const plant = this.plants.get(model);
    if (!plant) return;
    this.plants.delete(model);
    this.running.delete(plant);
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
    plant.stopActivity?.();
    plant.stopArt?.();
    plant.stopEffect();
    plant.sound?.stop();
    if (plant.sprite) plant.sprite.dispose();
    else if (plant.instance) { plant.instance.remove(); plant.display!.dispose(); }
    else plant.factory!.disposeSprite(model);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanups.splice(0).forEach(cleanup => cleanup());
    for (const model of this.plants.keys()) this.remove(model);
    this.archiveAssets.dispose();
    this.archiveSpriteRequests.clear();
    if (this.ownsScheduler) this.scheduler.dispose();
    for (const request of this.factoryRequests.values()) void request.then(factory => factory.dispose(), () => undefined);
    void this.snowRequest?.then(snow => snow.dispose(), () => undefined);
    void this.fireFactoryRequest?.then(factory => factory.dispose(), () => undefined);
  }
}
