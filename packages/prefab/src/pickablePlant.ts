import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { Transform } from './transform';
import type * as CANNON from 'cannon-es';
import { createRenderEffect, createMemo, WorldContentKey, type Memo, type ReadonlySignal, type GetWatchWorldContent, type TileStateQuery } from '@dontstarve-web/signals';
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
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { SpriteState, prefabDisplay } from '@dontstarve-web/display';
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
  readonly scheduler: GameTimeScheduler;
  readonly fire: FireFxHost;
  readonly getWatchWorldContent?: GetWatchWorldContent;
  /** Rain belongs to the injected world. */
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
  variant?: string;
  readonly definition: PickablePlantDefinition;
  readonly context: PickablePlantContext;
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
    if (definition.snowCovered) {
      this.sprite.setSymbolOverride('snow', 'snow.zip', 'snow');
      const snow = context.getWatchWorldContent?.(WorldContentKey.SnowLevel, stop => this.onRemove(stop));
      const stopEffect = createRenderEffect(() => {
        if ((snow?.get() ?? 0) >= .015) this.sprite.showLayer('snow'); else this.sprite.hideLayer('snow');
      });
      this.onRemove(stopEffect);
    }
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

  /** The common normalized plant record; component state is supplied by its owner. */
  OnSave(_inst: unknown, data: PickablePlantRecord['components']): void {
    data.pickable = this.components.pickable.OnSave();
    if (this.components.witherable) data.witherable = this.components.witherable.OnSave();
    if (this.definition.skins) data.plant = this.skinId ? { skinId: this.skinId } : {};
    if (this.variant) data.variant = { anim: this.variant };
    if (this.components.burnable.IsBurning()) data.burning = true;
    Object.assign(data, this.exportState());
  }

  OnLoad(_inst: unknown, data: PickablePlantRecord['components']): void {
    const skinId = data.plant?.skinId;
    if (skinId !== undefined && !this.definition.skins?.includes(skinId)) throw new Error(`Unsupported ${this.prefab} skin: ${skinId}`);
    this.skinId = skinId;
    if (data.variant) {
      if (!this.definition.variants?.includes(data.variant.anim)) throw new Error(`Unsupported ${this.prefab} variant: ${data.variant.anim}`);
      this.variant = data.variant.anim; this.sprite.playOnce(this.variant);
    }
    // Loading restores the settled pose instead of replaying a pick or a wither transition.
    if (data.pickable?.cyclesLeft === 0 && this.definition.barren) { this.sprite.playOnce(this.definition.barren); this.sprite.setFrameAt(1); }
    else if (data.pickable?.picked && this.definition.empty) {
      this.sprite.playOnce(this.definition.empty.name);
      if (this.definition.empty.frame === 'last') this.sprite.setFrameAt(1);
    }
  }

  /** Bind an optional reskin operation on the real entity once its display exists. */
  onSpawned(): void {
    const { skins } = this.definition;
    if (skins) {
      const display = prefabDisplay(this.transform.model)!;
      actionEntity(this.transform.model, this.prefab).reskinTarget = reskinTarget({
        id: String(this.entityId), prefabId: this.prefab, instance: this, display, sprite: this.sprite,
        position: this.position, skins, isValid: () => !this.isRemoved, hasTag: tag => this.hasTag(tag),
      });
    }
    this.initialize();
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

/** Art and component-update declarations handed to the generic SpawnPrefab manager. */
export function plantEntityDefinition(definition: PickablePlantDefinition, world: PickablePlantWorld): PrefabEntityDefinition<PickablePlantInstance> {
  return {
    fn: position => {
      let stopSeason: (() => void) | undefined;
      const season = world.getWatchWorldContent?.(WorldContentKey.Season, stop => { stopSeason = stop; });
      const instance = definition.createInstance({ position, world, scheduler: world.scheduler, fire: world.fire,
        getWatchWorldContent: world.getWatchWorldContent, growthDuration: seconds => season?.peek().season === 'spring' ? seconds * .75 : seconds });
      if (stopSeason) instance.onRemove(stopSeason);
      return instance;
    },
    assets: { animationArchive: definition.animArchive, buildArchives: [definition.buildArchive, ...definition.snowCovered ? ['snow.zip'] : []],
      bank: definition.archiveSprite.bank, hiddenLayers: definition.snowCovered ? ['snow'] : [] },
    assetOptions: { instancedAnimations: definition.archiveSprite.instancedAnimations, staticBillboard: true,
      ...definition.multColour ? { colour: [1, 1, 1] as [number, number, number] } : {} },
    skins: definition.skins && Object.fromEntries(definition.skins.map(skin => [skin, `dynamic/${skin}.zip`])),
    physics: definition.physicsRadius === undefined ? undefined : {
      make: definition.obstaclePhysics ? MakeObstaclePhysics : MakeSmallObstaclePhysics, radius: definition.physicsRadius },
    minimapIcon: definition.minimapIcon,
    onSpawned: plant => plant.onSpawned(),
  };
}
