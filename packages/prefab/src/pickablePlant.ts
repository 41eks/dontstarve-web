import { modelValues } from './modelRecords';
import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createEffect, createRenderEffect, createMemo, createSignal, readonlySignal, getBoundWatchWorldContent, WorldContentKey, type ReadonlySignal, type WorldContentSignal, type GetWatchWorldContent, type SeasonState, type TileStateQuery } from '@dontstarve-web/signals';
import { Witherable, type WitherableSave } from '../../componets/src/witherable';
import type { SpriteController, AnimatedSpriteOptions } from '@dontstarve-web/animation/sprite';
import { newEntityId } from './saveRecord';
import { Pickable, type PickableSaveState } from './components/pickable';
import { GameTimeScheduler } from './components/gameTimeScheduler';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import { Burnable, type BurnableInst } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import { Workable } from '../../componets/src/workable';
import { LootDropper } from '../../componets/src/lootdropper';
import { actionEntity, findActionEntity } from './actionEntity';
import { performToolWork } from '../../stategraphs/src/componentactions';
import type { ShovelTarget } from '../../stategraphs/src/shovel';
import type { SpawnGroundItem } from './groundPrefab';
import catalog from './groundItems.json' with { type: 'json' };
import { TILE_SIZE } from './tile';
import { MakeObstaclePhysics, MakeSmallObstaclePhysics } from './standardcomponents';
import type { MiniMapState } from '../../map/src/minimapState';
import type { PhysicsState } from '../../componets/src/physicsState';
import type { ItemEntity, InventoryStack } from '@dontstarve-web/inventory';
import type { PickDoer } from '@dontstarve-web/stategraphs/pick';
import { nextReskin } from './reskin_tool';
import type { ReskinFxMessage, ReskinTarget } from '../../stategraphs/src/reskin_tool';
import { watchTileActivity } from './tileActivity';
import { createArchiveEntity, createPrefabEntity, type PrefabInstance, prefabInstance } from './prefabInstance';
import { SpriteResources, type ArchiveSpriteCommands, type ArchiveSpriteSource, type PrefabDisplay, type SpriteState } from '@dontstarve-web/display';
import type { GrowableSave } from '../../componets/src/growable';
import type { ArchiveSpriteOptions } from '@dontstarve-web/animation/archiveSprite';

type PlantAnimation = SpriteController | SpriteState | ArchiveSpriteCommands;

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
  /** Loot, ash and dug plants are spawned when they are produced; their displays load the art. */
  spawnGroundItem: SpawnGroundItem;
  isOcean?(position: THREE.Vector3): boolean;
  /** SpawnPrefab for an inventory item a behavior hands to its picker. */
  spawnItem?(state: InventoryStack): ItemEntity;
  /** inventoryitem:DoDropPhysics at the plant, for pickers without an inventory. */
  dropItem?(entity: ItemEntity, position: THREE.Vector3): void;
}

export interface PickablePlantAppearanceContext<T extends PlantAnimation = PlantAnimation> {
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
  /** onpickedfn(inst, picker) */
  picked(doer?: PickDoer): void;
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
  /** The plant's Physics, for Physics:SetActive. */
  readonly physics: PhysicsState;
  spawnItem?(state: InventoryStack): ItemEntity;
  dropItem?(entity: ItemEntity, position: THREE.Vector3): void;
  /** Local bridges to world content, for behaviors watching phases or weather; each cleanup is the behavior's to run. */
  readonly getWatchWorldContent?: GetWatchWorldContent;
  readonly rain?: ReadonlySignal<'none' | 'rain' | 'snow'>;
}

/** The prefab-specific values of a renewable pickable plant: art, callbacks' clips and sounds, and loot. */
export interface PickablePlantDefinition {
  readonly prefab: string;
  readonly animArchive: string;
  readonly buildArchive: string;
  /**
   * Shared archive frames and instancing, with source playback kept in the prefab behavior. The plant's display loads
   * the art and draws the sprite only while its tile is in the tickingarea.
   */
  readonly archiveSprite: { readonly bank: string; readonly instancedAnimations: ArchiveSpriteOptions['instancedAnimations'] };
  readonly tags: readonly string[];
  readonly product: string;
  readonly regrowTime?: number;
  readonly numToHarvest?: number;
  readonly noGrowInWinter?: boolean;
  readonly persistBurning?: boolean;
  readonly createBehavior?: (context: PickablePlantBehaviorContext) => PickablePlantBehavior;
  /** Looping ready clip, optionally started on a random frame (AnimState:SetFrame). */
  readonly idle: { readonly name: string; readonly randomFrame?: boolean;
    /** PlayAnimation(name) without looping, as cave_fern's pose. */
    readonly loop?: false };
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
  /** MakeObstaclePhysics rather than MakeSmallObstaclePhysics for `physicsRadius`. */
  readonly obstaclePhysics?: boolean;
  /** MiniMapEntity:SetIcon. */
  readonly minimapIcon?: string;
  readonly propagatorSize?: 'small' | 'medium';
}

interface Plant {
  definition: PickablePlantDefinition;
  model: THREE.Group;
  pickable: Pickable;
  /** The plant entity; its display draws the sprite only while the tile is in the tickingarea. */
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  readonly animation: PlantAnimation;
  version: number;
  transitionAt: number;
  /** Its tile is in the tickingarea (always true without residency): the visual may exist and must be advanced and ordered. */
  awake: boolean;
  stopEffect: () => void;
  stopActivity?: () => void;
  sound?: SoundHandle;
  burnable: Burnable;
  propagator: Propagator;
  workable: Workable;
  persistence: ReturnType<typeof createSignal<boolean>>;
  /** The burning fx entity, in the scene while the plant burns. */
  fire: { readonly instance: PrefabInstance; readonly display: PrefabDisplay };
  fireSound?: SoundHandle;
  extinguishSound?: SoundHandle;
  stopBurning: () => void;
  phase: ReturnType<typeof createMemo<string>>;
  witherable?: Witherable;
  variant?: string;
  behavior?: PickablePlantBehavior;
  minimap?: MiniMapState;
}

/**
 * Renewable pickable plants (grass.lua, sapling.lua): source component ownership for PICK,
 * DIG and burning (MakeMediumBurnable, MakeSmallPropagator, MakeNoGrowInWinter).
 */
export class PickablePlantManager {
  private readonly resources: SpriteResources;
  private readonly plants = new Map<THREE.Group, Plant>();
  /** Plants that are awake or burning; the rest hold no visual and have nothing to advance or order. */
  private readonly running = new Set<Plant>();
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly cleanups: (() => void)[] = [];
  private readonly season?: WorldContentSignal<SeasonState>;
  private snowLevel?: WorldContentSignal<number>;
  private readonly getWatchWorldContent?: GetWatchWorldContent;
  private disposed = false;

  private readonly scene: THREE.Scene;
  private readonly world: PickablePlantWorld;

  constructor(scene: THREE.Scene, assetBaseUrl: string, world: PickablePlantWorld) {
    this.scene = scene; this.world = world;
    this.resources = new SpriteResources(assetBaseUrl, 'pickable_plant');
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

  /** SpawnPrefab: the plant, its components and its display exist now; the display loads and draws the art. */
  protected spawnPlant(definition: PickablePlantDefinition, position: THREE.Vector3, saved?: PickablePlantRecord,
    skinId = saved?.components.plant?.skinId): THREE.Group {
    const { prefab } = definition;
    if (this.disposed) throw new Error(`${prefab} manager has been disposed`);
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError(`Invalid ${prefab} position`);
    if (skinId !== undefined && !definition.skins?.includes(skinId)) throw new Error(`Unsupported ${prefab} skin: ${skinId}`);
    if (definition.snowCovered && !this.snowLevel && this.getWatchWorldContent) {
      const snowLevel = this.snowLevel = this.getWatchWorldContent(WorldContentKey.SnowLevel, stop => this.cleanups.push(stop));
      const covered = createMemo(() => snowLevel.get() >= .015);
      createRenderEffect(() => {
        const hidden = !covered.get();
        for (const plant of this.plants.values()) if (plant.definition.snowCovered) {
          if (hidden) plant.instance.sprite.hideLayer('snow'); else plant.instance.sprite.showLayer('snow');
        }
      });
    }
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
    // Held on its last frame, the looping idle, or a clip played once (PlayAnimation without loop).
    const held = initial.initialFrame === 'last';
    const loop = !held && initial.initialAnimation === idleName && definition.idle.loop !== false;
    const { instance, display } = createArchiveEntity(prefab, this.archiveSource(definition, skinId),
      { name: initial.initialAnimation, held, billboard: true }, prefab, entity => {
        entity.skinId = skinId;
        if (definition.skins) entity.sprite.setSkinSource({ art: this.resources.archives,
          archives: Object.fromEntries(definition.skins.map(skin => [skin, `dynamic/${skin}.zip`])) });
      });
    if (!held && !loop) instance.sprite.playOnce(initial.initialAnimation);
    const model = display.model;
    model.name = prefab;
    model.position.set(position.x, 0, position.z);
    instance.entityId = saved?.id ?? newEntityId();
    for (const tag of definition.tags) instance.addTag(tag);
    if (definition.snowCovered) {
      instance.sprite.setSymbolOverride('snow', 'snow.zip', 'snow');
      if ((this.snowLevel?.peek() ?? 0) >= .015) instance.sprite.showLayer('snow'); else instance.sprite.hideLayer('snow');
    }
    if (skinId) instance.skinId = skinId;
    if (definition.deploySmartRadius !== undefined) model.userData.deploySmartRadius = definition.deploySmartRadius;
    let animation: PlantAnimation = instance.sprite;
    model.userData.animationController = animation;
    if (held) instance.sprite.setFrameAt(1);
    // sapling.lua: AnimState:SetFrame(math.random(GetCurrentAnimationNumFrames()) - 1), resolved once the clip has loaded.
    if (!state?.picked && definition.idle.randomFrame) instance.sprite.setFrameAt(Math.random());
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
    const appearance = definition.createAppearance?.(animationContext);
    const pickable: Pickable = new Pickable(model, definition.product, definition.regrowTime, definition.numToHarvest ?? 1, doer => {
      plant.sound?.stop();
      if (definition.picked.sound) plant.sound = PlaySound(definition.picked.sound, model.position);
      if (definition.removeWhenPicked) return;
      if (plant.behavior) { plant.behavior.picked(doer); return; }
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
    const fire = createPrefabEntity('fire', this.resources.factory({ animationArchive: 'fire.zip', buildArchive: 'fire.zip' }),
      { name: `level${definition.burnFxLevel ?? 3}` }, 'fire');
    for (const tag of ['FX', 'NOCLICK']) fire.instance.addTag(tag);
    fire.instance.persists = false;
    const workable = new Workable(entity);
    if (definition.dugLoot) {
      entity.components.workable = workable;
      workable.SetWorkAction('DIG'); workable.SetWorkLeft(1);
    } else workable.SetWorkable(false);
    // lootdropper:SpawnLootPrefab, flung from the plant.
    const lootdropper = new LootDropper(entity, (lootPrefab, point, lootSkin) => this.world.spawnGroundItem(
      { ...catalog.items[lootPrefab as keyof typeof catalog.items], itemId: lootPrefab, count: 1, ...(lootSkin ? { skinId: lootSkin } : {}) },
      new THREE.Vector3(point.x, point.y, point.z), { fling: true }));
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
      // DefaultBurntFn: one ash at the plant, placed rather than flung.
      if (!this.world.isOcean?.(model.position)) this.world.spawnGroundItem({ ...catalog.items.ash, itemId: 'ash', count: 1 }, model.position.clone());
      this.remove(model);
    });
    const plant: Plant = { definition, model, get animation() { return animation; }, pickable, instance, display, version: 0,
      transitionAt: this.scheduler.now, awake: false, stopEffect: () => {}, stopBurning: () => {},
      burnable, propagator, workable, persistence, fire, phase, variant };
    plant.behavior = definition.createBehavior?.({ ...animationContext, get animation() { return animation; }, pickable,
      scheduler: this.scheduler,
      growthDuration: seconds => this.season?.peek().season === 'spring' ? seconds * .75 : seconds,
      spawnLoot: prefab => { lootdropper.SpawnLootPrefab(prefab); },
      physics: instance.physics, spawnItem: this.world.spawnItem, dropItem: this.world.dropItem,
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
        fire.instance.position.copy(model.position);
        this.scene.add(fire.display.model);
        this.track(plant);
        plant.fireSound = PlaySound('dontstarve/common/campfire', model.position);
        const large = definition.burnFxLevel === 4;
        prefabInstance(model)!.light.set({ colour: large ? [1, 190 / 255, 121 / 255] : [1, 1, 192 / 255],
          radius: ((definition.burnFxLevel ?? 3) + 1) * (TILE_SIZE / 4), intensity: large ? .9 : .8, falloff: large ? .25 : .33 });
      } else {
        fire.display.model.removeFromParent(); plant.fireSound?.stop(); plant.fireSound = undefined;
        this.track(plant);
        prefabInstance(model)!.light.set(null);
        if (this.plants.get(model) === plant && !this.disposed) {
          plant.extinguishSound?.stop(); plant.extinguishSound = PlaySound('dontstarve/common/fireOut', model.position);
        }
      }
    });
    this.plants.set(model, plant);
    entity.reskinTarget = this.createReskinTarget(plant);
    this.track(plant);
    // Layers and snow are prefab state: dress every drawn sprite again from the plant's own components.
    plant.stopActivity = watchTileActivity(model, this.world.tickingarea, active => {
      instance.setActive(active);
      plant.awake = active;
      this.track(plant);
    });
    if (definition.minimapIcon) {
      plant.minimap = plant.instance.minimap;
      plant.minimap.SetIcon(definition.minimapIcon);
    }
    if (definition.physicsRadius !== undefined) {
      (definition.obstaclePhysics ? MakeObstaclePhysics : MakeSmallObstaclePhysics)(instance, definition.physicsRadius);
      if (this.world.physics) instance.bindPhysics(this.world.physics);
    }
    plant.behavior?.initialize(saved);
    appearance?.restore(pickable);
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
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
    const now = this.scheduler.now;
    for (const plant of this.running) {
      const { animation, transitionAt, fire, model } = plant;
      animation.update(Math.min(dt, now - transitionAt));
      if (fire.display.model.parent) {
        fire.instance.position.copy(model.position); fire.display.model.quaternion.copy(cameraQuaternion);
        fire.instance.sprite.update(dt);
      }
    }
  }


  /** A sleeping plant draws nothing, so it has no order to resolve. */
  get renderEntities() {
    const entries: { object: THREE.Object3D; footPosition: THREE.Vector3; cameraDepth: number }[] = [];
    for (const { model, fire, awake } of this.running) {
      if (awake) entries.push({ object: model, footPosition: model.position, cameraDepth: 0 });
      if (fire.display.model.parent) entries.push({ object: fire.display.model, footPosition: model.position, cameraDepth: 0 });
    }
    return entries;
  }

  private track(plant: Plant): void {
    if (plant.awake || plant.fire.display.model.parent) this.running.add(plant); else this.running.delete(plant);
  }
  get digTargets(): readonly ShovelTarget[] { return this.getDigTargets(); }

  getDigTargets(model?: THREE.Object3D): readonly ShovelTarget[] {
    return modelValues(this.plants, model).filter(({ definition }) => definition.dugLoot).map(({ definition, model, workable, instance }) => ({
      id: String(instance.entityId), model, position: model.position, entity: actionEntity(model, definition.prefab),
      isValid: () => !this.disposed && this.plants.has(model) && workable.CanBeWorked(),
      dig: () => performToolWork('DIG', actionEntity(model, definition.prefab), {}),
    }));
  }
  get reskinTargets(): readonly ReskinTarget[] {
    return Array.from(this.plants.values(), plant => findActionEntity(plant.model)?.reskinTarget)
      .filter((target): target is ReskinTarget => target !== undefined);
  }

  private createReskinTarget(plant: Plant): ReskinTarget | undefined {
    const { definition, model, instance } = plant;
    if (!definition.skins) return undefined;
    const isValid = () => !this.disposed && this.plants.get(model) === plant && !model.userData.removed;
    return {
      get id() { return String(instance.entityId); }, prefabId: definition.prefab, model, position: model.position,
      skins: definition.skins, isValid, get skinId() { return instance.skinId; },
      get isRemoved() { return !isValid(); }, hasTag: (tag: string) => actionEntity(model, definition.prefab).hasTag(tag),
      prepareNextSkin: async (tool?: Parameters<ReskinTarget['prepareNextSkin']>[0]) => {
        const previousSkin = instance.skinId;
        const skinId = nextReskin(definition.skins!, previousSkin, tool?._cached_reskinname, definition.prefab);
        let used = false;
        return {
          skinId,
          apply: (fx?: ReskinFxMessage) => {
            if (used || !isValid() || instance.skinId !== previousSkin) return false;
            plant.instance.skinId = skinId || undefined;
            used = true;
            fx?.play(model.position, definition.prefab);
            return true;
          }, dispose: () => { used = true; }
        };
      },
    };
  }

  /** The plant's shared archive art for a skin; its displays load it. */
  private archiveSource(definition: PickablePlantDefinition, skinId?: string): ArchiveSpriteSource {
    if (skinId !== undefined && !definition.skins?.includes(skinId)) throw new Error(`Unsupported ${definition.prefab} skin: ${skinId}`);
    return this.resources.archive({ animationArchive: definition.animArchive,
      buildArchives: [definition.buildArchive, ...definition.snowCovered ? ['snow.zip'] : []], bank: definition.archiveSprite.bank,
      hiddenLayers: definition.snowCovered ? ['snow'] : [] },
    { instancedAnimations: definition.archiveSprite.instancedAnimations, staticBillboard: true });
  }

  protected exportPlants(): { prefab: string; record: PickablePlantRecord }[] {
    this.scheduler.advanceTo(this.scheduler.now);
    return [...this.plants.values()].filter(plant => plant.persistence.peek()).map(({ definition, model, pickable, witherable, behavior, burnable, variant, instance }) => ({
      prefab: definition.prefab,
      record: {
        id: String(instance.entityId),
        transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
        components: { ...(definition.skins ? { plant: instance.skinId ? { skinId: instance.skinId } : {} } : {}), pickable: pickable.exportState(), ...(witherable ? { witherable: witherable.exportState() } : {}),
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
    plant.burnable.SetOnExtinguishFn(undefined);
    plant.burnable.dispose(); plant.propagator.dispose(); plant.workable.dispose();
    plant.witherable?.dispose();
    plant.behavior?.dispose();

    plant.pickable.dispose(); plant.phase.dispose();
    plant.stopBurning();
    plant.fireSound?.stop(); plant.extinguishSound?.stop();
    prefabInstance(model)!.light.set(null);
    plant.fire.instance.remove(); plant.fire.display.dispose();
    plant.stopActivity?.();
    plant.stopEffect();
    plant.sound?.stop();
    plant.instance.remove();
    plant.display.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanups.splice(0).forEach(cleanup => cleanup());
    for (const model of this.plants.keys()) this.remove(model);
    this.resources.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();
  }
}
