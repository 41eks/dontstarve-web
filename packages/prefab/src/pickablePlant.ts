import { modelValues } from './modelRecords';
import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createEffect, createRenderEffect, createMemo, getBoundWatchWorldContent, WorldContentKey, type Memo, type ReadonlySignal, type WorldContentSignal, type GetWatchWorldContent, type SeasonState, type TileStateQuery } from '@dontstarve-web/signals';
import { Witherable, type WitherableSave } from '../../componets/src/witherable';
import type { AnimatedSpriteOptions } from '@dontstarve-web/animation/sprite';
import { newEntityId } from './saveRecord';
import { Pickable, type PickableSaveState } from './components/pickable';
import { GameTimeScheduler } from './components/gameTimeScheduler';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import type { Burnable } from '../../componets/src/burnable';
import type { Propagator } from '../../componets/src/propagator';
import { Workable } from '../../componets/src/workable';
import { LootDropper } from '../../componets/src/lootdropper';
import { actionEntity } from './actionEntity';
import { performToolWork } from '../../stategraphs/src/componentactions';
import type { ShovelTarget } from '../../stategraphs/src/shovel';
import type { SpawnGroundItem } from './groundPrefab';
import catalog from './groundItems.json' with { type: 'json' };
import { MakeObstaclePhysics, MakeSmallObstaclePhysics } from './standardcomponents';
import type { PhysicsState } from '../../componets/src/physicsState';
import type { ItemEntity, InventoryStack } from '@dontstarve-web/inventory';
import type { PickDoer } from '@dontstarve-web/stategraphs/pick';
import { nextReskin } from './reskin_tool';
import type { ReskinFxMessage, ReskinTarget } from '../../stategraphs/src/reskin_tool';
import { watchTileActivity } from './tileActivity';
import { bindInstance, PrefabInstance } from './prefabInstance';
import { PrefabDisplayGroup, SpriteResources, SpriteState, type ArchiveSpriteCommands, type ArchiveSpriteSource, type PrefabDisplay } from '@dontstarve-web/display';
import type { GrowableSave } from '../../componets/src/growable';
import type { Growable } from '../../componets/src/growable';
import type { SimpleMagicGrower } from '../../componets/src/simplemagicgrower';
import type { ArchiveSpriteOptions } from '@dontstarve-web/animation/archiveSprite';
import { BurnableBinding, FireFxHost } from './treeFire';

type PlantAnimation = ArchiveSpriteCommands;

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
  readonly instance: PickablePlantInstance;
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
  readonly digLoot?: (instance: PickablePlantInstance, pickable: Pickable, withered: boolean) => readonly { prefab: string; skinId?: string }[];
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

/** The logical plant owns its components, skin, persistence and phase while its visual is unloaded. */
export class PickablePlantInstance extends PrefabInstance<ArchiveSpriteCommands> {
  declare readonly components: PrefabInstance<ArchiveSpriteCommands>['components'] & {
    pickable: Pickable;
    burnable: Burnable;
    propagator: Propagator;
    lootdropper: LootDropper;
    witherable?: Witherable;
    growable?: Growable;
    simplemagicgrower?: SimpleMagicGrower;
  };
  variant?: string;
  behavior?: PickablePlantBehavior;
  animationVersion = 0;
  transitionAt = 0;
  pickSound?: SoundHandle;
  private phaseMemo?: Memo<string>;

  get phase(): ReadonlySignal<string> {
    if (!this.phaseMemo) {
      const phase = this.phaseMemo = createMemo(() => this.removal.get() ? 'removed'
        : this.components.burnable.burning.get() ? 'burning' : this.components.pickable.state.phase.get());
      this.onRemove(() => phase.dispose());
    }
    return this.phaseMemo;
  }
}

interface Plant {
  readonly definition: PickablePlantDefinition;
  readonly instance: PickablePlantInstance;
  readonly display: PrefabDisplay;
  readonly entity: ReturnType<typeof actionEntity>;
  stopEffect: () => void;
  stopActivity?: () => void;
  burn: BurnableBinding;
}

/**
 * Renewable pickable plants (grass.lua, sapling.lua): source component ownership for PICK,
 * DIG and burning (MakeMediumBurnable, MakeSmallPropagator, MakeNoGrowInWinter).
 */
export class PickablePlantManager {
  private readonly resources: SpriteResources;
  private readonly displays: PrefabDisplayGroup;
  private readonly fire: FireFxHost;
  private readonly plants = new Map<THREE.Object3D, Plant>();
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
    this.displays = new PrefabDisplayGroup(scene);
    this.fire = FireFxHost.create(assetBaseUrl);
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
      for (const { instance, definition } of this.plants.values()) {
        const { pickable } = instance.components;
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
    const animation = new SpriteState({ name: initial.initialAnimation, held, billboard: true });
    const instance = new PickablePlantInstance(prefab, animation);
    instance.skinId = skinId;
    instance.saveRecord = saved;
    instance.variant = variant;
    instance.transitionAt = this.scheduler.now;
    instance.deploySmartRadius = definition.deploySmartRadius;
    if (definition.skins) instance.sprite.setSkinSource({ art: this.resources.archives,
      archives: Object.fromEntries(definition.skins.map(skin => [skin, `dynamic/${skin}.zip`])) });
    const display = this.displays.add({ name: prefab, archive: this.archiveSource(definition),
      status: instance.status, sprite: animation, light: instance.light });
    bindInstance(display.model, instance);
    if (!held && !loop) instance.sprite.playOnce(initial.initialAnimation);
    const model = display.model;
    instance.position.copy(position);
    instance.entityId = saved?.id ?? newEntityId();
    for (const tag of definition.tags) instance.addTag(tag);
    if (definition.snowCovered) {
      instance.sprite.setSymbolOverride('snow', 'snow.zip', 'snow');
      if ((this.snowLevel?.peek() ?? 0) >= .015) instance.sprite.showLayer('snow'); else instance.sprite.hideLayer('snow');
    }
    if (held) instance.sprite.setFrameAt(1);
    // sapling.lua: AnimState:SetFrame(math.random(GetCurrentAnimationNumFrames()) - 1), resolved once the clip has loaded.
    if (!state?.picked && definition.idle.randomFrame) instance.sprite.setFrameAt(Math.random());
    const playSequence = (first: string, last?: string, loop = false) => {
      const version = ++instance.animationVersion;
      instance.transitionAt = this.scheduler.now;
      animation.playOnce(first, last === undefined ? undefined : () => {
        if (this.disposed || instance.isRemoved || instance.animationVersion !== version) return;
        if (loop) animation.start(last);
        else animation.playOnce(last);
      });
    };
    const animationContext: PickablePlantAppearanceContext = { instance, animation: instance.sprite,
      play: (clips, loopLast = false, onFirstOver) => {
        const version = ++instance.animationVersion;
        instance.transitionAt = this.scheduler.now;
        const play = (index: number) => {
          if (this.disposed || instance.isRemoved || instance.animationVersion !== version) return;
          if (index === clips.length - 1 && loopLast) animation.start(clips[index]);
          else animation.playOnce(clips[index], index + 1 < clips.length ? () => {
            if (instance.isRemoved || instance.animationVersion !== version) return;
            if (index === 0) onFirstOver?.();
            play(index + 1);
          } : undefined);
        };
        play(0);
      },
    };
    const appearance = definition.createAppearance?.(animationContext);
    const pickable: Pickable = new Pickable(instance, definition.product, definition.regrowTime, definition.numToHarvest ?? 1, doer => {
      instance.pickSound?.stop();
      if (definition.picked.sound) instance.pickSound = PlaySound(definition.picked.sound, instance.position);
      if (definition.removeWhenPicked) return;
      if (instance.behavior) { instance.behavior.picked(doer); return; }
      if (appearance) { appearance.picked(pickable); return; }
      const [first, last] = definition.picked.clips;
      if (first === undefined) return;
      if (pickable.IsBarren() && definition.barren) {
        const version = ++instance.animationVersion;
        instance.transitionAt = this.scheduler.now;
        animation.playOnce(first, () => {
          if (instance.isRemoved || instance.animationVersion !== version) return;
          animation.playOnce('empty_to_dead', () => {
            if (!instance.isRemoved && instance.animationVersion === version) animation.playOnce(definition.barren!);
          });
        });
      } else playSequence(first, last);
    }, () => instance.behavior ? instance.behavior.regen() : appearance ? appearance.regen(pickable) : playSequence(definition.grow ?? idleName, idleName, true), state, {
      scheduler: this.scheduler,
      onRemove: definition.removeWhenPicked ? () => this.remove(model) : undefined,
      growthDuration: seconds => this.season?.peek().season === 'spring' ? seconds * 0.75 : seconds,
      maxCycles: definition.maxCycles?.(),
      getRegenTime: definition.getRegenTime,
      onTransplant: definition.onTransplant ? () => definition.onTransplant!(pickable)
        : definition.barren ? () => { appearance?.transplant(); pickable.MakeBarren(); } : undefined,
      onBarren: definition.barren ? wasEmpty => {
        if (instance.behavior) { instance.behavior.barren(); return; }
        if (appearance) { appearance.barren(pickable, wasEmpty); return; }
        if (instance.components.witherable?.IsWithered()) playSequence(wasEmpty ? 'empty_to_dead' : 'full_to_dead', definition.barren);
        else playSequence(definition.barren!);
      } : undefined,
      onEmpty: () => {
        if (instance.behavior) { instance.behavior.empty(); return; }
        if (appearance) { appearance.empty(pickable); return; }
        if (definition.witherable && (instance.components.witherable?.IsWithered() || animation.currentAnimation === definition.barren)) {
          playSequence('dead_to_empty', emptyName);
        } else playSequence(emptyName);
      },
    });
    pickable.quickpick = definition.quickpick ?? false;
    pickable.remove_when_picked = definition.removeWhenPicked ?? false;
    const entity = actionEntity(model, prefab, instance);
    const burn = new BurnableBinding(entity, {
      propagator: definition.propagatorSize ?? 'small', burnTime: definition.burnTime ?? 20, fxLevel: definition.burnFxLevel ?? 3,
      onIgnite: () => { instance.persists = definition.persistBurning ?? false; },
      onExtinguish: () => { instance.persists = true; },
      onBurnt: () => {
        instance.behavior?.burnt();
        // DefaultBurntFn: one ash at the plant, placed rather than flung.
        if (!this.world.isOcean?.(instance.position)) this.world.spawnGroundItem({ ...catalog.items.ash, itemId: 'ash', count: 1 }, instance.position);
        instance.remove();
      },
    }, { scheduler: this.scheduler, root: this.scene, fire: this.fire });
    // lootdropper:SpawnLootPrefab, flung from the plant.
    const lootdropper = new LootDropper(instance, (lootPrefab, point, lootSkin) => this.world.spawnGroundItem(
      { ...catalog.items[lootPrefab as keyof typeof catalog.items], itemId: lootPrefab, count: 1, ...(lootSkin ? { skinId: lootSkin } : {}) },
      new THREE.Vector3(point.x, point.y, point.z), { fling: true }));
    instance.components.lootdropper = lootdropper;
    if (definition.dugLoot) {
      const workable = instance.components.workable = new Workable(instance);
      workable.SetWorkAction('DIG'); workable.SetWorkLeft(1);
      workable.SetOnFinishCallback(() => {
        if (definition.digLoot) {
          for (const loot of definition.digLoot(instance, pickable, instance.components.witherable?.IsWithered() ?? false)) {
            lootdropper.SpawnLootPrefab(loot.prefab, instance.position, loot.skinId);
          }
          instance.remove();
          return;
        }
        if (pickable.canBePicked && pickable.product) lootdropper.SpawnLootPrefab(pickable.product);
        lootdropper.SpawnLootPrefab(instance.components.witherable?.IsWithered() ? definition.product : definition.dugLoot!);
        instance.remove();
      });
    }
    const plant: Plant = { definition, instance, display, entity, stopEffect: () => {}, burn };
    instance.behavior = definition.createBehavior?.({ ...animationContext, pickable,
      scheduler: this.scheduler,
      growthDuration: seconds => this.season?.peek().season === 'spring' ? seconds * .75 : seconds,
      spawnLoot: prefab => { lootdropper.SpawnLootPrefab(prefab); },
      physics: instance.physics, spawnItem: this.world.spawnItem, dropItem: this.world.dropItem,
      getWatchWorldContent: this.getWatchWorldContent, rain: this.world.rain,
    });
    if (definition.witherable) {
      instance.components.witherable = new Witherable(instance, pickable, this.scheduler,
        () => this.world.getLocalTemperature?.(instance.position) ?? 20, this.world.rain,
        saved?.components.witherable, state?.protectedCycles);
    }
    this.plants.set(model, plant);
    instance.onRemove(() => this.releasePlant(plant));
    entity.reskinTarget = this.createReskinTarget(plant);
    // Layers and snow are prefab state: dress every drawn sprite again from the plant's own components.
    plant.stopActivity = watchTileActivity(model, this.world.tickingarea, active => {
      instance.setActive(active);
      burn.setActive(active);
    });
    if (definition.minimapIcon) {
      instance.minimap.SetIcon(definition.minimapIcon);
    }
    if (definition.physicsRadius !== undefined) {
      (definition.obstaclePhysics ? MakeObstaclePhysics : MakeSmallObstaclePhysics)(instance, definition.physicsRadius);
      if (this.world.physics) instance.bindPhysics(this.world.physics);
    }
    instance.behavior?.initialize(saved);
    appearance?.restore(pickable);
    if (definition.noGrowInWinter !== false && this.season?.peek().season === 'winter') pickable.pause();
    else pickable.resume();
    const readyClips = [idleName, definition.grow ?? idleName];
    const emptyClips: string[] = [...definition.picked.clips, emptyName, 'dead_to_empty'];
    plant.stopEffect = appearance || instance.behavior ? () => {} : createEffect(() => {
      const current = instance.phase.get();
      if (current === 'ready' && !readyClips.includes(animation.currentAnimation)) animation.start(idleName);
      else if (current === 'picked' && !emptyClips.includes(animation.currentAnimation)) animation.playOnce(emptyName);
      else if (current === 'barren' && definition.barren
        && ![...emptyClips, definition.barren, 'empty_to_dead', 'full_to_dead'].includes(animation.currentAnimation)) animation.playOnce(definition.barren);
    });
    if (saved?.components.burning) {
      instance.behavior?.burnt();
      if (!this.world.isOcean?.(instance.position)) lootdropper.SpawnLootPrefab('ash');
      this.remove(model);
    }
    return model;
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
    const now = this.scheduler.now;
    for (const { display, instance } of this.plants.values()) display.update(Math.min(dt, now - instance.transitionAt), cameraQuaternion);
  }


  /** A sleeping plant draws nothing, so it has no order to resolve. */
  get renderEntities() {
    return this.displays.renderEntities;
  }

  get digTargets(): readonly ShovelTarget[] { return this.getDigTargets(); }

  /** The logical plant behind this manager's display, including while it sleeps. */
  getInstance(model: THREE.Object3D): PickablePlantInstance | undefined {
    return this.plants.get(model)?.instance;
  }

  getDigTargets(model?: THREE.Object3D): readonly ShovelTarget[] {
    return modelValues(this.plants, model).filter(({ definition }) => definition.dugLoot).map(({ display, instance }) => ({
      id: String(instance.entityId), instance, display, position: instance.position, entity: instance,
      isValid: () => !this.disposed && !instance.isRemoved && instance.components.workable!.CanBeWorked(),
      dig: () => performToolWork('DIG', instance, {}),
    }));
  }
  get reskinTargets(): readonly ReskinTarget[] {
    return Array.from(this.plants.values(), plant => plant.entity.reskinTarget)
      .filter((target): target is ReskinTarget => target !== undefined);
  }

  private createReskinTarget(plant: Plant): ReskinTarget | undefined {
    const { definition, display, instance } = plant;
    if (!definition.skins) return undefined;
    const isValid = () => !this.disposed && !instance.isRemoved && this.plants.get(display.model) === plant;
    return {
      get id() { return String(instance.entityId); }, prefabId: definition.prefab, instance, display, position: instance.position,
      skins: definition.skins, isValid, get skinId() { return instance.skinId; },
      get isRemoved() { return !isValid(); }, hasTag: (tag: string) => instance.hasTag(tag),
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
            fx?.play(instance.position, definition.prefab);
            return true;
          }, dispose: () => { used = true; }
        };
      },
    };
  }

  /** The plant's shared archive art for a skin; its displays load it. */
  private archiveSource(definition: PickablePlantDefinition): ArchiveSpriteSource {
    return this.resources.archive({ animationArchive: definition.animArchive,
      buildArchives: [definition.buildArchive, ...definition.snowCovered ? ['snow.zip'] : []], bank: definition.archiveSprite.bank,
      hiddenLayers: definition.snowCovered ? ['snow'] : [] },
    { instancedAnimations: definition.archiveSprite.instancedAnimations, staticBillboard: true });
  }

  protected exportPlants(): { prefab: string; record: PickablePlantRecord }[] {
    this.scheduler.advanceTo(this.scheduler.now);
    return [...this.plants.values()].filter(({ instance }) => instance.persists).map(({ definition, instance }) => {
      const { pickable, witherable, burnable } = instance.components;
      return {
        prefab: definition.prefab,
        record: {
          id: String(instance.entityId),
          transform: { position: instance.position.toArray() as [number, number, number], rotationY: 0 },
          components: { ...(definition.skins ? { plant: instance.skinId ? { skinId: instance.skinId } : {} } : {}), pickable: pickable.exportState(), ...(witherable ? { witherable: witherable.exportState() } : {}),
            ...instance.behavior?.exportState(), ...(instance.variant ? { variant: { anim: instance.variant } } : {}), ...(definition.persistBurning && burnable.IsBurning() ? { burning: true as const } : {}) },
        },
      };
    });
  }

  remove(model: THREE.Object3D): void {
    const plant = this.plants.get(model);
    if (!plant) return;
    plant.instance.remove();
  }

  private releasePlant(plant: Plant): void {
    const { instance, display } = plant;
    this.plants.delete(display.model);
    instance.animationVersion++;
    plant.stopActivity?.();
    plant.stopEffect();
    plant.burn.dispose();
    instance.components.workable?.dispose();
    instance.components.witherable?.dispose();
    instance.behavior?.dispose();
    instance.components.pickable.dispose();
    instance.pickSound?.stop();
    display.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanups.splice(0).forEach(cleanup => cleanup());
    for (const model of this.plants.keys()) this.remove(model);
    this.displays.dispose();
    this.fire.dispose();
    this.resources.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();
  }
}
