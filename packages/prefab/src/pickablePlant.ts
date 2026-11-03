import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { Transform } from './transform';
import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createRenderEffect, createMemo, getBoundWatchWorldContent, WorldContentKey, type Memo, type ReadonlySignal, type WorldContentSignal, type GetWatchWorldContent, type SeasonState, type TileStateQuery } from '@dontstarve-web/signals';
import { Witherable, type WitherableSave } from '../../componets/src/witherable';
import { newEntityId } from './saveRecord';
import type { Pickable, PickableSaveState } from './components/pickable';
import { GameTimeScheduler } from './components/gameTimeScheduler';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import type { Burnable } from '../../componets/src/burnable';
import type { Propagator } from '../../componets/src/propagator';
import { LootDropper } from '../../componets/src/lootdropper';
import { actionEntity } from './actionEntity';
import type { SpawnGroundItem } from './groundPrefab';
import catalog from './groundItems.json' with { type: 'json' };
import { MakeObstaclePhysics, MakeSmallObstaclePhysics } from './standardcomponents';
import type { ItemEntity, InventoryStack } from '@dontstarve-web/inventory';
import { reskinTarget } from './reskin_tool';
import type { ReskinTarget } from '../../stategraphs/src/reskin_tool';
import { watchTileActivity } from './tileActivity';
import { bindInstance, PrefabInstance } from './prefabInstance';
import { PrefabDisplayGroup, SpriteResources, SpriteState, type ArchiveSpriteSource, type PrefabDisplay } from '@dontstarve-web/display';
import type { GrowableSave } from '../../componets/src/growable';
import type { Growable } from '../../componets/src/growable';
import type { SimpleMagicGrower } from '../../componets/src/simplemagicgrower';
import type { ArchiveSpriteOptions } from '@dontstarve-web/animation/archiveSprite';
import { BurnableBinding, FireFxHost, type BurnSpec } from './treeFire';

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
  getLocalTemperature?(position: ReadonlyVector3): number;
  /** Loot, ash and dug plants are spawned when they are produced; their displays load the art. */
  spawnGroundItem: SpawnGroundItem;
  isOcean?(position: ReadonlyVector3): boolean;
  /** SpawnPrefab for an inventory item a prefab hands to its picker. */
  spawnItem?(state: InventoryStack): ItemEntity;
  /** inventoryitem:DoDropPhysics at the plant, for pickers without an inventory. */
  dropItem?(entity: ItemEntity, position: ReadonlyVector3): void;
}

/** Dependencies for a prefab's synchronous logical construction. No display or manager is captured. */
export interface PickablePlantContext {
  readonly position: ReadonlyVector3;
  readonly saved?: PickablePlantRecord;
  readonly skinId?: string;
  readonly world: PickablePlantWorld;
  readonly scheduler: GameTimeScheduler;
  readonly fire: FireFxHost;
  readonly getWatchWorldContent?: GetWatchWorldContent;
  readonly growthDuration: (seconds: number) => number;
}

/** Shared art and construction metadata. Behavior is implemented and registered by each prefab. */
export interface PickablePlantDefinition {
  readonly prefab: string;
  readonly animArchive: string;
  readonly buildArchive: string;
  /**
   * Shared archive frames and instancing, with source playback kept in the prefab instance. The plant's display loads
   * the art and draws the sprite only while its tile is in the tickingarea.
   */
  readonly archiveSprite: { readonly bank: string; readonly instancedAnimations: ArchiveSpriteOptions['instancedAnimations'] };
  readonly tags: readonly string[];
  readonly createInstance: (context: PickablePlantContext) => PickablePlantInstance;
  /** Looping ready clip, optionally started on a random frame (AnimState:SetFrame). */
  readonly idle: { readonly name: string; readonly randomFrame?: boolean;
    /** PlayAnimation(name) without looping, as cave_fern's pose. */
    readonly loop?: false };
  /** fn: AnimState:SetMultColour(c, c, c, 1) with a grey level chosen per plant (lichen.lua: .75 + random * .25). */
  readonly multColour?: () => number;
  /** makeemptyfn as restored by Pickable:OnLoad; absent when the plant is removed once picked. */
  readonly empty?: { readonly name: string; readonly frame: 'first' | 'last' };
  /** cave_fern.lua: one pose clip is chosen at random per plant and saved as `variant.anim`. */
  readonly variants?: readonly string[];
  readonly barren?: string;
  readonly deploySmartRadius?: number;
  readonly skins?: readonly string[];
  readonly snowCovered?: boolean;
  readonly physicsRadius?: number;
  /** MakeObstaclePhysics rather than MakeSmallObstaclePhysics for `physicsRadius`. */
  readonly obstaclePhysics?: boolean;
  /** MiniMapEntity:SetIcon. */
  readonly minimapIcon?: string;
}

/** The logical plant owns its components, skin, persistence and phase while its visual is unloaded. */
export abstract class PickablePlantInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    pickable: Pickable;
    burnable: Burnable;
    propagator: Propagator;
    lootdropper: LootDropper;
    witherable?: Witherable;
    growable?: Growable;
    simplemagicgrower?: SimpleMagicGrower;
  };
  readonly variant?: string;
  readonly definition: PickablePlantDefinition;
  readonly context: PickablePlantContext;
  transitionAt: number;
  private animationVersion = 0;
  private pickSound?: SoundHandle;
  private phaseMemo?: Memo<string>;
  private burn?: BurnableBinding;

  constructor(definition: PickablePlantDefinition, context: PickablePlantContext) {
    const { prefab } = definition, { saved, position } = context, state = saved?.components.pickable;
    const savedVariant = saved?.components.variant?.anim;
    if (savedVariant !== undefined && !definition.variants?.includes(savedVariant)) throw new Error(`Unsupported ${prefab} variant: ${savedVariant}`);
    const variant = definition.variants ? savedVariant ?? definition.variants[Math.floor(Math.random() * definition.variants.length)] : undefined;
    const idleName = variant ?? definition.idle.name;
    const initial = state?.cyclesLeft === 0 && definition.barren ? { name: definition.barren, held: true }
      : state?.picked && definition.empty ? { name: definition.empty.name, held: definition.empty.frame === 'last' }
      : { name: idleName, held: false };
    const animation = new SpriteState({ ...initial, billboard: true });
    super(prefab, animation, Transform.stationary());
    this.definition = definition; this.context = context; this.variant = variant;
    this.transitionAt = context.scheduler.now;
    this.skinId = context.skinId; this.saveRecord = saved;
    this.entityId = saved?.id ?? newEntityId();
    this.setPosition(position.x, position.y, position.z);
    this.deploySmartRadius = definition.deploySmartRadius;
    for (const tag of definition.tags) this.addTag(tag);
    if (!initial.held && (initial.name !== idleName || definition.idle.loop === false)) animation.playOnce(initial.name);
    if (initial.held) animation.setFrameAt(1);
    if (!state?.picked && definition.idle.randomFrame) animation.setFrameAt(Math.random());
    if (definition.multColour) { const grey = definition.multColour(); animation.setColour([grey, grey, grey]); }
    this.components.lootdropper = new LootDropper(this, (prefab, point, skinId) => context.world.spawnGroundItem(
      { ...catalog.items[prefab as keyof typeof catalog.items], itemId: prefab, count: 1, ...(skinId ? { skinId } : {}) },
      point, { fling: true }));
    this.onRemove(() => {
      this.animationVersion++;
      this.burn?.dispose();
      this.components.workable?.dispose();
      this.components.witherable?.dispose();
      this.components.simplemagicgrower?.dispose();
      this.components.growable?.dispose();
      this.components.pickable?.dispose();
      this.pickSound?.stop();
    });
  }

  /** Generic clip playback; each prefab supplies its own clips and callbacks. */
  play(clips: readonly string[], loopLast = false, onFirstOver?: () => void): void {
    const version = ++this.animationVersion;
    this.transitionAt = this.context.scheduler.now;
    const play = (index: number) => {
      if (this.isRemoved || this.animationVersion !== version) return;
      if (index === clips.length - 1 && loopLast) this.sprite.start(clips[index]);
      else this.sprite.playOnce(clips[index], index + 1 < clips.length ? () => {
        if (this.isRemoved || this.animationVersion !== version) return;
        if (index === 0) onFirstOver?.();
        play(index + 1);
      } : undefined);
    };
    if (clips.length) play(0);
  }

  playPickSound(sound: SoundEventPath): void {
    this.pickSound?.stop(); this.pickSound = PlaySound(sound, this.position);
  }

  protected bindBurnable(spec: BurnSpec): void {
    this.burn = new BurnableBinding(this, spec, this.context);
  }

  protected bindWitherable(): void {
    const { world, scheduler, saved } = this.context;
    this.components.witherable = new Witherable(this, this.components.pickable, scheduler,
      () => world.getLocalTemperature?.(this.position) ?? 20, world.rain,
      saved?.components.witherable, saved?.components.pickable?.protectedCycles);
  }

  /** Prefab-owned initialization/restoration after the world's activity and physics bindings exist. */
  initialize(): void {}
  exportState(): PickablePlantRecord['components'] { return {}; }

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
  stopActivity?: () => void;
}

/** Tracks prefab-owned plants and their shared display resources. */
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

  private readonly world: PickablePlantWorld;

  constructor(scene: THREE.Scene, assetBaseUrl: string, world: PickablePlantWorld) {
    this.world = world;
    this.displays = new PrefabDisplayGroup(scene);
    this.fire = FireFxHost.create(assetBaseUrl);
    this.resources = new SpriteResources(assetBaseUrl, 'pickable_plant');
    this.getWatchWorldContent = getBoundWatchWorldContent();
    if (this.getWatchWorldContent) {
      this.season = this.getWatchWorldContent(WorldContentKey.Season, cleanup => this.cleanups.push(cleanup));
    }
    this.scheduler = this.season?.scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !this.season;
  }

  /** SpawnPrefab: the plant, its components and its display exist now; the display loads and draws the art. */
  protected spawnPlant(definition: PickablePlantDefinition, position: ReadonlyVector3, saved?: PickablePlantRecord,
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
    const season = this.season;
    const instance = definition.createInstance({ position, saved, skinId, world: this.world, scheduler: this.scheduler,
      fire: this.fire, getWatchWorldContent: this.getWatchWorldContent,
      growthDuration: seconds => season?.peek().season === 'spring' ? seconds * .75 : seconds });
    if (definition.skins) instance.sprite.setSkinSource({ art: this.resources.archives,
      archives: Object.fromEntries(definition.skins.map(skin => [skin, `dynamic/${skin}.zip`])) });
    const display = this.displays.add({ root: instance.transform.model, name: prefab, archive: this.archiveSource(definition),
      status: instance.status, sprite: instance.sprite, light: instance.light });
    bindInstance(display.model, instance);
    const model = display.model;
    if (definition.snowCovered) {
      instance.sprite.setSymbolOverride('snow', 'snow.zip', 'snow');
      if ((this.snowLevel?.peek() ?? 0) >= .015) instance.sprite.showLayer('snow'); else instance.sprite.hideLayer('snow');
    }
    const entity = actionEntity(model, prefab, instance);
    const plant: Plant = { definition, instance, display, entity };
    this.plants.set(model, plant);
    instance.onRemove(() => this.releasePlant(plant));
    entity.reskinTarget = this.createReskinTarget(plant);
    plant.stopActivity = watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active));
    if (definition.minimapIcon) {
      instance.minimap.SetIcon(definition.minimapIcon);
    }
    if (definition.physicsRadius !== undefined) {
      (definition.obstaclePhysics ? MakeObstaclePhysics : MakeSmallObstaclePhysics)(instance, definition.physicsRadius);
      if (this.world.physics) instance.bindPhysics(this.world.physics);
    }
    instance.initialize();
    return model;
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
    const now = this.scheduler.now;
    for (const { display, instance } of this.plants.values()) {
      display.update(Math.min(dt, now - instance.transitionAt), cameraQuaternion);
      instance.components.burnable.UpdateFX(dt);
    }
  }

  /** A sleeping plant draws nothing, so it has no order to resolve. */
  get renderEntities() {
    return this.displays.renderEntities;
  }

  /** The logical plant behind this manager's display, including while it sleeps. */
  getInstance(model: THREE.Object3D): PickablePlantInstance | undefined {
    return this.plants.get(model)?.instance;
  }
  get reskinTargets(): readonly ReskinTarget[] {
    return Array.from(this.plants.values(), plant => plant.entity.reskinTarget)
      .filter((target): target is ReskinTarget => target !== undefined);
  }

  private createReskinTarget(plant: Plant): ReskinTarget | undefined {
    const { definition, display, instance } = plant;
    if (!definition.skins) return undefined;
    const isValid = () => !this.disposed && !instance.isRemoved && this.plants.get(display.model) === plant;
    return reskinTarget({
      get id() { return String(instance.entityId); }, prefabId: definition.prefab, instance, display, sprite: instance.sprite as SpriteState,
      position: instance.position, skins: definition.skins, isValid, hasTag: (tag: string) => instance.hasTag(tag),
    });
  }

  /** The plant's shared archive art for a skin; its displays load it. */
  private archiveSource(definition: PickablePlantDefinition): ArchiveSpriteSource {
    return this.resources.archive({ animationArchive: definition.animArchive,
      buildArchives: [definition.buildArchive, ...definition.snowCovered ? ['snow.zip'] : []], bank: definition.archiveSprite.bank,
      hiddenLayers: definition.snowCovered ? ['snow'] : [] },
    // A per-plant SetMultColour needs sprites that own their colour.
    { instancedAnimations: definition.archiveSprite.instancedAnimations, staticBillboard: true,
      ...definition.multColour ? { colour: [1, 1, 1] as [number, number, number] } : {} });
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
            ...instance.exportState(), ...(instance.variant ? { variant: { anim: instance.variant } } : {}), ...(burnable.IsBurning() ? { burning: true as const } : {}) },
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
    const { display } = plant;
    this.plants.delete(display.model);
    plant.stopActivity?.();
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
