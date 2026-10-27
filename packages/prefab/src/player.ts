import {
  createMaterials,
  loadAnim,
  loadAnimationArchive,
  loadBuild,
  smallHash,
  type Animation,
  type ParsedAnim,
  type ParsedBuild,
} from '@dontstarve-web/animation/animationAssets';
import { AnimState } from '@dontstarve-web/animation/animState';
import { createSpriteFactory, type SpriteArtSource } from '@dontstarve-web/animation/sprite';
import type { SymbolBuild } from '@dontstarve-web/animation/animState';
import type { FollowerFx, PrefabDisplay } from '@dontstarve-web/display';
import { createRenderEffect, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import { BufferedAction, WilsonStateGraph, type BufferedActionObject, type WilsonAction, type WilsonAnimationClip, type WilsonAnimationKey, type WilsonCombat, type WilsonFishingHost, type WilsonMovementState, type WilsonOneShotState, type WilsonSleepHost, type WilsonDeathHost, type WilsonRebirthHost } from '@dontstarve-web/stategraphs';
import type { ActionAnimationController } from '@dontstarve-web/stategraphs/actionContext';
import type * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { isAxeTool, type AxeTool } from './axe';
import { backpackVisual } from './backpack';
import { BookFxController, type BookFxPrefab } from './book_fx';
import { WILSON_EMOTES, type WilsonEmote, type WilsonEmoteDefinition } from './emotes';
import type { EquipmentVisual, EquipmentVisualContext, EquipmentVisualOwner } from './equipmentVisual';
import { isFarmHoeTool, type FarmHoeTool } from './farm_hoe';
import { FISHING_SOUNDS } from './fishingrod';
import { GroundItemAssets } from './groundItems';
import { getHandEquipmentDefinition } from './handEquipment';
import { HatEquipmentAssets, hatVisual } from './hats';
import { MiniMapEntity } from './minimapEntity';
import { isPickaxeTool, type PickaxeTool } from './pickaxe';
import { isPitchforkTool, type PitchforkTool } from './pitchfork';
import { equipSamePrefab } from './player_common';
import { isShovelTool, type ShovelTool } from './shovel';
import { PlaySound, PreloadSounds, type SoundEventPath, type SoundHandle } from './sound';
import { MakeCharacterPhysics, WORLD_SCALE } from './standardcomponents';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { PhysicsState } from '../../componets/src/physicsState';
import { actionEntity, disposeActionEntity } from './actionEntity';
import { createPrefabEntity, prefabInstance, type PrefabInstance } from './prefabInstance';
import { Builder, type BuilderWorld } from '../../componets/src/builder';
import type { WilsonSoulHopHost } from '../../stategraphs/src/SGwilson';
import { StaffCastingLight } from './yellowstaff';

export type WilsonFacing = 'up' | 'down' | 'side';
/** skinprefabs.lua wortox_none: normal_skin = wortox, ghost_skin = ghost_wortox_build. */
export const PLAYER_ART_CHARACTER = 'wortox' as const;

/** player_common.lua AddComponent("builder"); the scene supplies spatial queries. */
export function bindPlayerBuilder(model: THREE.Group, world: Omit<BuilderWorld, 'researchMachineDistance'>): Builder {
  const inst = actionEntity(model, PLAYER_ART_CHARACTER);
  inst.components.builder?.dispose();
  const builder = new Builder(inst, { ...world, researchMachineDistance: 4 * WORLD_SCALE });
  inst.components.builder = builder;
  return builder;
}
export interface SymbolFollower {
  readonly node: THREE.Object3D;
  remove(): void;
}

export type WilsonCarryItem = 'torch' | 'lantern' | 'yellowstaff' | 'opalstaff' | 'greenstaff' | 'firestaff' | 'trident' | 'bugnet' | 'fishingrod' | 'hammer' | 'nightsword' | 'reskin_tool' | PickaxeTool | AxeTool | PitchforkTool | FarmHoeTool | ShovelTool;
type ReadAnimationKey = 'action_uniqueitem_pre' | 'book' | 'flute';
type WilsonAnimations = Record<Exclude<WilsonAnimationKey, 'emote' | 'ghost' | 'amulet_rebirth' | ReadAnimationKey>, ParsedAnim>;
/** player_common_extensions.lua AddOverrideBuild; its anims are loaded with the first READ. */
const UNIQUE_ITEM_BUILD = 'player_actions_uniqueitem';

export interface WilsonAnimationController extends ActionAnimationController {
  readonly currentEmote: WilsonEmote | null;
  readonly isEmoting: boolean;
  /** The player inst's combat component, read by the attack state. */
  combat?: WilsonCombat;
  playEmote(emote: WilsonEmote): Promise<boolean>;
  start(state: WilsonMovementState): void;
  playEat(): void;
  /** Inventory searched when a broken tool is replaced by another of the same prefab. */
  bindInventory(inventory: Parameters<typeof equipSamePrefab>[0]): void;
  playItemTransition(state: 'item_in' | 'item_out', item?: WilsonCarryItem): void;
  playPickup(): void;
  playDrop(onDrop: () => boolean, onCancel: () => void): boolean;
  setCrafting(crafting: boolean): void;
  setCarryItem(item: WilsonCarryItem | null, skinId?: string): void;
  readonly AnimState: AnimState;
  readonly equipmentAssets: GroundItemAssets;
  readonly equipmentContext: EquipmentVisualContext;
  /** Action identity only; the equipped prefab applies its own art through AnimState. */
  setEquippedCarryItem(item: WilsonCarryItem | null): void;
  setHat(itemId: string | null, skinId?: string): void;
  /** Follower:FollowSymbol(owner.GUID, symbol, offsetX, offsetY): a node tracking the symbol, in the player's space. */
  /** `fx` is drawn at the follower by the player's display, which loads its art. */
  followSymbol(symbol: string, offsetX: number, offsetY: number, fx?: FollowerFx): SymbolFollower;
  setBackpack(equipped: boolean, skinId?: string): void;
  /** The application's sleeper services for SGwilson's tent and wakeup states. */
  bindSleep(sleep: WilsonSleepHost | undefined): void;
  /** SGwilson's death state: DropAllItemsForDeath through the application's inventory. */
  bindDeath(death: WilsonDeathHost | undefined): void;
  /** SGwilson's amulet_rebirth state: the inventory, HUD and sleepers it reaches (its light is the controller's). */
  bindRebirth(rebirth: Omit<WilsonRebirthHost, 'castLight'> | undefined): void;
  /** Load the ghost build, the `ghost` bank and the ghost's sounds, so the death animation's end can switch at once. */
  prepareGhost(): Promise<void>;
  /** AnimState:SetBank("ghost") + skinner ghost_skin + SetStateGraph("SGwilsonghost"); `loading` is inst.loading_ghost. */
  makeGhost(loading?: boolean): void;
  /** player_common_extensions.lua DoActualRez: the living bank and skin, SetStateGraph("SGwilson") and the source's rebirth state (portal_rez, or amulet_rebirth for an amulet). */
  makeAlive(state?: 'portal_rez' | 'amulet_rebirth'): void;
  bindSoulHop(host: Omit<WilsonSoulHopHost, 'setTint' | 'playSound'> | undefined): void;
  readonly isGhost: boolean;
  readonly isSleeping: boolean;
  wakeFromBed(): void;
  goToWakeup(): void;
  update(dt: number, jumpProgress?: number): void;
}

export type PlayerBody = CANNON.Body & { canJump: boolean };

export interface WilsonPlayerPrefab {
  /** inst.Physics: player_common.lua MakeCharacterPhysics(inst, 75, .5), swapped for ghost physics on death. */
  physics: PhysicsState;
  /** The bound body the movement and stategraphs drive. */
  body: PlayerBody;
  readonly instance: PrefabInstance;
  readonly display: PrefabDisplay;
  model: PlayerModel;
  readonly MiniMapEntity: MiniMapEntity;
  setNormal(cameraWorldQuaternion: THREE.Quaternion): void;
}

export type PlayerModel = THREE.Group & { readonly MiniMapEntity: MiniMapEntity };

export interface WilsonPlayerPrefabOptions {
  /** The owner's authoritative sanity ratio; standalone previews default to full sanity. */
  sanityPercent?: ReadonlySignal<number>;
}

/** Source tags: bugnet tool component and reskin_tool.lua's veryquickcast. */
const ACTION_TOOL_METADATA: Partial<Record<WilsonCarryItem, { tags: readonly string[]; spelltype?: string }>> = {
  bugnet: { tags: ['NET_tool'] },
  fishingrod: { tags: ['fishingrod'] },
  reskin_tool: { tags: ['veryquickcast'], spelltype: 'RESKIN' },
};

const facingValues: Record<WilsonFacing, number> = { down: 8, side: 5, up: 2 };

interface CarryBuild {
  build: ParsedBuild;
  materials: THREE.MeshBasicMaterial[];
}

/** player_common.lua ghost assets: the character's ghost_skin build and anim/player_ghost_withhat.zip's `ghost` bank. */
interface GhostAssets extends CarryBuild {
  animations: ParsedAnim;
}

interface EmoteAssets {
  animations: ParsedAnim;
  props?: CarryBuild;
}

interface ActiveEmote extends EmoteAssets {
  id: WilsonEmote;
  clips: readonly string[];
  loop: boolean;
}

class WilsonController implements WilsonAnimationController {
  private materials: THREE.MeshBasicMaterial[];
  readonly stategraph: WilsonStateGraph;
  private state: WilsonAnimationKey = 'idle';
  private clipName = 'idle_loop';
  private facing: WilsonFacing = 'down';
  private mirrored = false;
  private equippedCarryItem: WilsonCarryItem | null = null;
  private carryItem: WilsonCarryItem | null = null;
  private carryKey = '';
  readonly equipmentAssets: GroundItemAssets;
  readonly equipmentContext: EquipmentVisualContext;
  readonly AnimState: AnimState;
  private readonly visualOwner: EquipmentVisualOwner;
  private handVisual?: EquipmentVisual;
  private handReady = false;
  private readonly castingLight: StaffCastingLight;
  private animation!: Animation;
  private makeSound?: SoundHandle;
  private makeSoundActive = false;
  private makeSoundCycle = -1;
  private shaveSound?: SoundHandle;
  /** The player inst's combat component, read by the attack state. */
  combat?: WilsonCombat;
  private frameIndex = -1;
  private readonly model: PlayerModel;
  private readonly instance: PrefabInstance;
  private readonly fxScheduler = new GameTimeScheduler();
  private readonly cleanups: (() => void)[] = [];
  private disposed = false;
  private artSource?: SpriteArtSource;
  private readonly factoryAnimations: ParsedAnim;
  private build: ParsedBuild;
  private readonly animations: WilsonAnimations;
  private ghostAssets?: Promise<GhostAssets>;
  private ghostArt?: GhostAssets;
  /** The living build and materials set aside while the ghost's are shown. */
  private livingArt?: { build: ParsedBuild; materials: THREE.MeshBasicMaterial[] };
  private soulHopHost?: WilsonSoulHopHost;
  private readonly portalSounds = new Set<SoundHandle>();
  private readonly hatAssets: HatEquipmentAssets;
  private headVisual?: EquipmentVisual;
  private hatKey = '';
  private bodyVisual?: EquipmentVisual;
  private backpackKey = '';
  private readonly emoteAssets = new Map<string, Promise<EmoteAssets>>();
  private emote: ActiveEmote | null = null;
  private emoteRequest = 0;
  private emotePending = false;
  private uniqueItemAnimations: ParsedAnim | null = null;
  /** player_actions_uniqueitem's build, drawn for the unique-item clips' own symbols. */
  private uniqueItemBuild?: CarryBuild;
  private readonly bookFx: BookFxController;
  private sleepHost?: WilsonSleepHost;
  private deathHost?: WilsonDeathHost;
  private rebirthHost?: WilsonRebirthHost;
  private amuletAnimations: ParsedAnim | null = null;
  private fishingHost?: WilsonFishingHost;
  private readonly namedSounds = new Map<string, SoundHandle>();
  private inventory?: Parameters<typeof equipSamePrefab>[0];
  private readonly assetBaseUrl: string;

  constructor(
    instance: PrefabInstance,
    model: PlayerModel,
    build: ParsedBuild,
    animations: WilsonAnimations,
    materials: THREE.MeshBasicMaterial[],
    assetBaseUrl: string,
    factoryAnimations: ParsedAnim,
    sanityPercent?: ReadonlySignal<number>,
  ) {
    this.instance = instance;
    this.model = model;
    this.factoryAnimations = factoryAnimations;
    this.build = build;
    this.animations = animations;
    this.materials = materials;
    this.assetBaseUrl = assetBaseUrl;
    this.equipmentAssets = new GroundItemAssets();
    this.AnimState = new AnimState();
    const appearance = watchSignal(this.AnimState.json, stop => this.cleanups.push(stop));
    // The AnimState names builds; the player's display loads them from the equipment assets.
    createRenderEffect(() => instance.sprite.setAnimState(appearance.get(), this.equipmentAssets));
    this.visualOwner = { AnimState: this.AnimState, PushEvent: (name, data) => model.dispatchEvent({ type: name, data } as never) };
    for (const layer of ['ARM_carry', 'LANTERN_OVERLAY', 'HAT', 'HAIR_HAT', 'HEAD_HAT', 'HEAD_HAT_NOHELM', 'HEAD_HAT_HELM']) this.AnimState.Hide(layer);
    this.castingLight = new StaffCastingLight(model);
    this.hatAssets = new HatEquipmentAssets(assetBaseUrl);

    this.equipmentContext = { owner: this.visualOwner, assets: this.equipmentAssets, hats: this.hatAssets, lightParent: model, sanityPercent };
    this.bookFx = new BookFxController(instance, this.fxScheduler, assetBaseUrl);
    const controller = this;
    this.stategraph = new WilsonStateGraph({
      get soulHop() { return controller.soulHopHost; },
      get sleep() { return controller.sleepHost; },
      get death() { return controller.deathHost; },
      get rebirth() { return controller.rebirthHost; },
      rez: {
        setHidden: hidden => instance.sprite.setVisible(!hidden),
        get isHidden() { return instance.sprite.sprite.peek().visible === false; },
        setMultColour: (r, g, b) => this.setMultColour(r, g, b),
        setInvincible: invincible => { model.dispatchEvent({ type: 'setinvincible', data: invincible } as never); },
      },
      get fishing() { return controller.fishingHost; },
      playEvent: event => { PlaySound(event as SoundEventPath); },
      playAnimation: (clip) => this.selectAnimation(clip),
      getCombat: () => this.combat,
      playSound: (cue, castsound) => {
        if (cue === 'attack') { PlaySound(castsound as SoundEventPath); return; }
        if (cue === 'shave') {
          this.shaveSound?.stop();
          this.shaveSound = PlaySound('dontstarve/wilson/shave_LP');
          return;
        }
        if (cue === 'make') {
          this.makeSound?.stop();
          this.makeSound = undefined;
          this.makeSoundActive = true;
          this.makeSoundCycle = -1;
          return;
        }
        const event = cue === 'useBreak' ? 'dontstarve/wilson/use_break' : cue === 'dig' ? 'dontstarve/wilson/dig' : cue === 'tillEmerge' ? 'dontstarve_DLC001/creatures/mole/emerge'
          : cue === 'sip' ? 'dontstarve/wilson/sip' : cue === 'eat' ? 'dontstarve/wilson/eat' : cue === 'reskin' ? 'dontstarve/wilson/attack_weapon'
          : cue === 'cast' ? (castsound as SoundEventPath ?? 'dontstarve/wilson/use_gemstaff')
            : cue === 'bookLight' ? 'dontstarve/common/use_book_light' : cue === 'bookClose' ? 'dontstarve/common/use_book_close'
              : cue === 'hammer' ? 'dontstarve/wilson/hit' : 'dontstarve/wilson/use_pick_rock';
        PlaySound(event);
      },
      playNamedSound: (name, event) => {
        this.namedSounds.get(name)?.stop();
        this.namedSounds.set(name, PlaySound(event as SoundEventPath));
      },
      stopNamedSound: name => { this.namedSounds.get(name)?.stop(); this.namedSounds.delete(name); },
      isPlayingNamedSound: name => this.namedSounds.get(name)?.isPlaying() ?? false,
      setNamedSoundVolume: (name, volume) => this.namedSounds.get(name)?.setVolume(volume),
      showLayer: layer => this.AnimState.Show(layer),
      hideLayer: layer => this.AnimState.Hide(layer),
      clearOverrideSymbol: symbol => this.AnimState.ClearOverrideSymbol(symbol),
      spawnFx: (prefab, followSymbol) => this.bookFx.spawn(prefab, followSymbol),
      overrideSymbol: (symbol, build, sourceSymbol) => this.AnimState.OverrideSymbol(symbol, build, sourceSymbol),
      // Item skin builds are dynamic/<skin>.zip; the skin's symbol is drawn when its build has it, else the stock one.
      overrideItemSkinSymbol: (symbol, skinBuild, skinSymbol, build, sourceSymbol) =>
        this.AnimState.OverrideItemSkinSymbol(symbol, `dynamic/${skinBuild}.zip`, skinSymbol, 'player', build, sourceSymbol),
      stopSound: cue => {
        if (cue === 'shave') { this.shaveSound?.stop(); this.shaveSound = undefined; return; }
        this.makeSound?.stop(); this.makeSound = undefined;
        this.makeSoundActive = false;
        this.makeSoundCycle = -1;
      },
      setCasting: (casting, colour) => {
        if (casting) this.castingLight.start(colour);
        else this.castingLight.stop();
      },
      setControllerEnabled: enabled => { model.userData.controllerEnabled = enabled; },
      stopMovement: () => model.userData.locomotor?.stop(),
      pushPlayerEvent: (name, data) => { model.dispatchEvent({ type: name, data } as never); },
      slip: {
        runSpeed: () => model.userData.runSpeed as number,
        setMotorSpeed: speed => { model.userData.motorSpeed = speed; },
        resetSlipperiness: () => (model.userData.slipperyfeet as { SetCurrent(value: number): void } | undefined)?.SetCurrent(0),
        wantsToMoveForward: () => model.userData.wantsToMoveForward === true,
        playSound: (event, volume) => {
          const handle = PlaySound(event === 'hurt' ? 'dontstarve/characters/wilson/hurt' : `dontstarve/movement/${event}`);
          if (volume !== undefined) handle.setVolume(volume);
        },
      },
      equipSamePrefab: (prefab) => this.inventory !== undefined && equipSamePrefab(this.inventory, prefab),
      onStateChanged: (name) => {
        // toolbroke hides ARM_carry and shows ARM_normal.
        this.carryItem = name === 'toolbroke' ? null : this.equippedCarryItem;
        if (name !== 'emote') this.emote = null;
        // stategraph.lua pushes "newstate" to the inst; armorsnurtleshell's ProtectionLevels listens for it.
        model.dispatchEvent({ type: 'newstate', data: { statename: name } } as never);
      },
    });
  }

  start(state: WilsonMovementState) {
    if (state !== 'idle' && this.isEmoting) this.cancelEmote();
    this.stategraph.requestMovement(state);
  }

  /** Inventory searched when a broken tool is replaced by another of the same prefab. */
  bindInventory(inventory: Parameters<typeof equipSamePrefab>[0]): void { this.inventory = inventory; }

  prepareToolBroke(): Promise<unknown> {
    return Promise.all([this.bookFx.prepare('brokentool'), PreloadSounds('dontstarve/wilson/use_break')]);
  }

  playEat() {
    this.startOneShot('eat');
  }

  playQuickEat(onEat: () => boolean, foodDrink = false): boolean {
    return this.startAction('EAT', onEat, true, foodDrink);
  }
  /** ACTIONS.DROP: doshortaction performs the drop on its frame 6; onCancel runs if the action never performs. */
  playDrop(onDrop: () => boolean, onCancel: () => void): boolean {
    if (this.stategraph.hasStateTag('busy')) return false;
    this.cancelEmote();
    const action = new BufferedAction<WilsonAction>('DROP', onDrop);
    const stop = this.stategraph.listenForEvent('actionfailed', data => {
      if ((data as { action?: unknown } | undefined)?.action === action) { stop(); onCancel(); }
    });
    action.addSuccessAction(stop);
    if (this.stategraph.pushBufferedAction(action)) return true;
    stop();
    return false;
  }
  playPlant(onPlant: () => boolean): boolean { return this.startAction('PLANT', onPlant, true); }
  cancelFoodAction(): void {
    if (this.stategraph.isPerformingAction('EAT') || this.stategraph.isPerformingAction('PLANT')) this.stategraph.cancelAction();
  }

  get isReading(): boolean { return this.stategraph.isPerformingAction('READ'); }

  /** The application's sleeper services for SGwilson's tent and wakeup states. */
  bindSleep(sleep: WilsonSleepHost | undefined): void { this.sleepHost = sleep; }
  bindDeath(death: WilsonDeathHost | undefined): void { this.deathHost = death; }
  bindRebirth(rebirth: Omit<WilsonRebirthHost, 'castLight'> | undefined): void {
    this.rebirthHost = rebirth && { ...rebirth, castLight: (colour, duration, delay) => this.castingLight.start(colour, duration, delay) };
  }

  bindSoulHop(host: Omit<WilsonSoulHopHost, 'setTint' | 'playSound'> | undefined): void {
    if (!host) {
      this.stategraph.cancelAction('BLINK');
      this.stategraph.cancelAction('BLINK_MAP');
      for (const sound of this.portalSounds) sound.stop();
      this.portalSounds.clear();
      this.setTint(0);
    }
    this.soulHopHost = host && {
      ...host,
      setTint: value => this.setTint(value),
      playSound: (event, volume = 1) => {
        for (const sound of this.portalSounds) if (!sound.isPlaying()) this.portalSounds.delete(sound);
        const sound = PlaySound(event as SoundEventPath, this.model.position);
        sound.setVolume(volume);
        this.portalSounds.add(sound);
      },
    };
  }

  /** The ghost build is `ghost_<character>_build` (skinner ghost_skin of the default skin). */
  prepareGhost(): Promise<void> {
    this.ghostAssets ??= Promise.all([
      loadBuild(`dynamic/ghost_${PLAYER_ART_CHARACTER}_build.zip`, this.assetBaseUrl),
      loadAnim('player_ghost_withhat.zip', this.assetBaseUrl),
      // amulet_rebirth: the resurrecting amulet's clip, FX build and worn art, ready before a haunt can reach it.
      loadAnim('player_amulet_resurrect.zip', this.assetBaseUrl),
      PreloadSounds('dontstarve/ghost/ghost_howl', 'dontstarve/common/rebirth_amulet_raise', 'dontstarve/common/rebirth_amulet_poof'),
    ]).then(([buildPackage, animations, amulet]) => {
      this.amuletAnimations = amulet;
      this.registerAnimations(animations); this.registerAnimations(amulet);
      return (this.ghostArt = { build: buildPackage.build, materials: createMaterials(buildPackage), animations });
    });
    void this.ghostAssets.catch(() => { this.ghostAssets = undefined; });
    return this.ghostAssets.then(() => undefined);
  }

  get isGhost(): boolean { return this.stategraph.isGhost; }

  makeGhost(loading = false): void {
    const art = this.ghostArt;
    if (!art) throw new Error('Ghost art has not been prepared');
    if (this.isGhost) return;
    this.cancelEmote();
    this.livingArt = { build: this.build, materials: this.materials };
    this.build = art.build;
    this.materials = art.materials;
    this.stategraph.becomeGhost(loading);
    this.frameIndex = -1;
    this.showCurrentFrame();
  }

  makeAlive(state: 'portal_rez' | 'amulet_rebirth' = 'portal_rez'): void {
    const living = this.livingArt;
    if (!this.isGhost || !living) return;
    this.build = living.build;
    this.materials = living.materials;
    this.livingArt = undefined;
    this.stategraph.becomeAlive(state);
    this.frameIndex = -1;
    this.showCurrentFrame();
  }

  /** Character colour and Wortox's additive portal tint are per-instance appearance declarations. */
  private setMultColour(r: number, g: number, b: number): void { this.instance.sprite.setColour([r, g, b]); }
  private setTint(amount: number): void { this.instance.sprite.setTint({ colour: [154 / 255, 23 / 255, 19 / 255], amount }); }

  /** The equipped rod's component for SGwilson's fishing states. */
  bindFishing(fishing: WilsonFishingHost | undefined): void { this.fishingHost = fishing; }
  get isSleeping(): boolean { return this.stategraph.isSleeping; }
  /** Movement input while asleep: the locomote event wakes the sleeper. */
  wakeFromBed(): void { this.stategraph.pushLocomote(); }
  /** sleepingbaguser:DoWakeUp's `inst.sg:GoToState("wakeup")`. */
  goToWakeup(): void { this.stategraph.wakeUp(); }

  async prepareRead(book: BufferedActionObject): Promise<void> {
    const fx = (['book_fx', book.def?.fx_over_prefab, book.def?.fx_under_prefab] as const)
      .filter((prefab): prefab is BookFxPrefab => prefab !== undefined);
    const sounds = ['dontstarve/common/use_book_light', 'dontstarve/common/use_book_close',
      book.castsound ?? 'dontstarve/common/book_spell', ...book.def?.layer_sound ? [book.def.layer_sound.sound] : []];
    const [animations] = await Promise.all([
      this.uniqueItemAnimations ?? this.equipmentAssets.loadAnimation(`${UNIQUE_ITEM_BUILD}.zip`),
      this.loadUniqueItemBuild(),
      this.bookFx.prepare(...fx),
      PreloadSounds(...sounds as SoundEventPath[]),
    ]);
    this.uniqueItemAnimations = animations;
    this.registerAnimations(animations);
  }

  playRead(book: BufferedActionObject, onRead: () => boolean): boolean {
    if (this.stategraph.hasStateTag('busy') || !this.uniqueItemAnimations) return false;
    this.cancelEmote();
    return this.stategraph.pushBufferedAction(new BufferedAction('READ', onRead, undefined, { invobject: book }));
  }

  cancelRead(): void { this.stategraph.cancelAction('READ'); }

  get isPlayingInstrument(): boolean { return this.stategraph.isPerformingAction('PLAY'); }

  /** Load SGwilson's play_flute art and the flute loop before buffering the action. */
  async prepareFlute(): Promise<void> {
    const [animations] = await Promise.all([
      this.uniqueItemAnimations ?? this.equipmentAssets.loadAnimation(`${UNIQUE_ITEM_BUILD}.zip`),
      this.loadUniqueItemBuild(),
      PreloadSounds('dontstarve/wilson/flute_LP'),
    ]);
    this.uniqueItemAnimations = animations;
    this.registerAnimations(animations);
  }

  playFlute(instrument: BufferedActionObject, onPlay: () => boolean): boolean {
    if (this.stategraph.hasStateTag('busy') || !this.uniqueItemAnimations) return false;
    this.cancelEmote();
    return this.stategraph.pushBufferedAction(new BufferedAction('PLAY', onPlay, undefined, { invobject: instrument }));
  }

  cancelPlay(): void { this.stategraph.cancelAction('PLAY'); }

  private async loadUniqueItemBuild(): Promise<void> {
    this.uniqueItemBuild ??= await this.equipmentAssets.loadBuild(`${UNIQUE_ITEM_BUILD}.zip`);
  }

  get currentEmote(): WilsonEmote | null { return this.emote?.id ?? null; }
  get isEmoting(): boolean { return this.emotePending || this.emote !== null; }

  async playEmote(id: WilsonEmote): Promise<boolean> {
    const definition: WilsonEmoteDefinition | undefined = WILSON_EMOTES[id];
    if (!definition || !this.stategraph.canEmote()) return false;
    this.cancelEmote();
    const request = ++this.emoteRequest;
    this.emotePending = true;
    try {
      let assets = this.emoteAssets.get(definition.archive);
      if (!assets) {
        assets = definition.props
          ? loadAnimationArchive(definition.archive, this.assetBaseUrl).then(({ animations, buildPackage }) => ({
            animations, props: { build: buildPackage.build, materials: createMaterials(buildPackage) },
          }))
          : loadAnim(definition.archive, this.assetBaseUrl).then((animations) => ({ animations }));
        this.emoteAssets.set(definition.archive, assets);
        void assets.catch(() => this.emoteAssets.delete(definition.archive));
      }
      const loaded = await assets;
      this.registerAnimations(loaded.animations);
      if (request !== this.emoteRequest) return false;
      this.emotePending = false;
      this.emote = {
        ...loaded, id, clips: definition.variants[Math.floor(Math.random() * definition.variants.length)],
        loop: definition.loop === true,
      };
      if (!this.stategraph.requestEmote(this.emote.clips, this.emote.loop)) {
        this.emote = null;
        return false;
      }
      return true;
    } catch (error) {
      if (request !== this.emoteRequest) return false;
      this.cancelEmote();
      throw error;
    }
  }

  cancelEmote(): void {
    ++this.emoteRequest;
    this.emotePending = false;
    this.stategraph.cancelEmote();
    this.emote = null;
  }

  get isCasting(): boolean { return this.stategraph.isPerformingAction('CASTSPELL') && !this.isReskinning; }
  get isNetting(): boolean { return this.stategraph.isPerformingAction('NET'); }
  get isFishing(): boolean { return this.stategraph.isPerformingAction('FISH'); }
  get isMining(): boolean { return this.stategraph.isPerformingAction('MINE'); }
  get isChopping(): boolean { return this.stategraph.isPerformingAction('CHOP'); }
  get isHammering(): boolean { return this.stategraph.isPerformingAction('HAMMER'); }
  get isDigging(): boolean { return this.stategraph.isPerformingAction('TERRAFORM'); }
  get isReskinning(): boolean { return this.stategraph.isPerformingAction('CASTSPELL', 'reskin_tool'); }

  private startAction(action: WilsonAction, execute: () => void | boolean, ready: boolean, foodDrink = false): boolean {
    if (!ready || this.stategraph.hasStateTag('busy')) return false;
    this.cancelEmote();
    const tool = this.carryItem;
    const metadata = tool ? ACTION_TOOL_METADATA[tool] : undefined;
    const invobject: BufferedActionObject | undefined = tool
      ? { prefab: tool, spelltype: metadata?.spelltype, hasTag: tag => metadata?.tags.includes(tag) ?? false } : undefined;
    return this.stategraph.pushBufferedAction(new BufferedAction(action, execute, undefined, { invobject }), foodDrink);
  }

  playReskin(onCast: () => void): boolean {
    return this.startAction('CASTSPELL', onCast, this.carryItem === 'reskin_tool' && this.handReady);
  }

  cancelReskin(): void { if (this.isReskinning) this.stategraph.cancelAction('CASTSPELL'); }

  playDig(onDig: () => void): boolean {
    return this.startAction('TERRAFORM', onDig, isPitchforkTool(this.carryItem ?? '') && this.handReady);
  }

  cancelDig(): void { this.stategraph.cancelAction('TERRAFORM'); }
  playShovelDig(onDig: () => boolean): boolean {
    return this.startAction('DIG', onDig, isShovelTool(this.carryItem ?? '') && this.handReady);
  }
  cancelShovelDig(): void { this.stategraph.cancelAction('DIG'); }
  get isShoveling(): boolean { return this.stategraph.isPerformingAction('DIG'); }
  get isTilling(): boolean { return this.stategraph.isPerformingAction('TILL'); }
  playTill(onTill: () => boolean): boolean {
    return this.startAction('TILL', onTill, isFarmHoeTool(this.carryItem ?? '') && this.handReady);
  }
  cancelTill(): void { this.stategraph.cancelAction('TILL'); }

  playMine(onHit: () => void | boolean): boolean {
    const hammer = this.carryItem === 'hammer';
    const ready = hammer ? this.handReady : isPickaxeTool(this.carryItem ?? '') && this.handReady;
    return this.startAction(hammer ? 'HAMMER' : 'MINE', onHit, ready);
  }

  playHammer(onHit: () => void): boolean { return this.playMine(onHit); }

  playChop(onHit: () => void | boolean): boolean {
    return this.startAction('CHOP', onHit, isAxeTool(this.carryItem ?? '') && this.handReady);
  }

  /** ATTACK with the equipped inst as invobject; its tags select the attack branch. */
  playAttack(onHit: () => boolean, target: BufferedActionObject, invobject?: BufferedActionObject): boolean {
    if (this.stategraph.hasStateTag('busy')) return false;
    this.cancelEmote();
    return this.stategraph.pushBufferedAction(new BufferedAction('ATTACK', onHit, undefined, { invobject, target }));
  }
  get isAttacking(): boolean { return this.stategraph.hasStateTag('attack') || this.stategraph.isPerformingAction('ATTACK'); }
  cancelAttack(): void { if (this.stategraph.isPerformingAction('ATTACK')) this.stategraph.cancelAction('ATTACK'); }
  cancelMine(): void { this.stategraph.cancelAction('MINE'); }
  cancelChop(): void { this.stategraph.cancelAction('CHOP'); }
  cancelHammer(): void { this.stategraph.cancelAction('HAMMER'); }

  /** The fishing sounds, decoded before FISH is buffered; the catchfish state names its fish01 build. */
  async prepareFishing(): Promise<void> {
    await PreloadSounds(...FISHING_SOUNDS);
  }

  playFish(onFish: () => void): boolean {
    return this.startAction('FISH', onFish, this.carryItem === 'fishingrod' && this.handReady);
  }
  cancelFishing(): void { this.stategraph.cancelAction('FISH'); }

  playBugNet(onCatch: () => void): boolean {
    return this.startAction('NET', onCatch, this.carryItem === 'bugnet' && this.handReady);
  }

  playItemTransition(state: 'item_in' | 'item_out', item: WilsonCarryItem = 'torch') {
    if (this.stategraph.isDead) return;
    this.startOneShot(state);
    if (state === 'item_in') {
      this.carryItem = item;
      this.frameIndex = -1;
      this.showFrame(0);
    }
  }

  playPickup() {
    this.startOneShot('pickup');
  }

  setCrafting(crafting: boolean) {
    if (crafting) this.cancelEmote();
    this.stategraph.requestCrafting(crafting);
  }

  setFacing(facing: WilsonFacing, mirrored = false) {
    if (facing === this.facing && mirrored === this.mirrored) return;
    this.facing = facing;
    this.mirrored = mirrored;
    this.instance.sprite.setFacing(facingValues[facing], mirrored);
    // Facing changes select different art without restarting the state timeline.
    this.selectAnimation(this.stategraph.animationClip, false);
    this.showCurrentFrame();
    this.instance.sprite.update(0);
  }

  setEquippedCarryItem(item: WilsonCarryItem | null): void {
    this.stategraph.pushEvent('unequip');
    this.equippedCarryItem = item;
    this.carryItem = item;
    this.handReady = item !== null;
    this.refreshFrame();
  }

  /** Standalone preview adapter: use the same prefab equip/unequip functions as live inventory. */
  setCarryItem(item: WilsonCarryItem | null, skinId?: string): void {
    const key = item === null ? '' : `${item}:${skinId ?? ''}`;
    if (key === this.carryKey) return;
    this.carryKey = key;
    this.handVisual?.onunequip(); this.handVisual = undefined;
    this.setEquippedCarryItem(item);
    if (!item) return;
    this.handVisual = getHandEquipmentDefinition(item)!.definition.visual({ id: 'preview:hand', prefab: item, skinId });
    this.handVisual.onequip(this.visualOwner);
  }

  setHat(itemId: string | null, skinId?: string): void {
    const key = itemId === null ? '' : `${itemId}:${skinId ?? ''}`;
    if (key === this.hatKey) return;
    this.hatKey = key;
    this.headVisual?.onunequip(); this.headVisual = undefined;
    if (!itemId) return;
    this.headVisual = hatVisual({ id: 'preview:head', prefab: itemId, skinId }, this.equipmentContext);
    this.headVisual.onequip(this.visualOwner);
  }

  setBackpack(equipped: boolean, skinId?: string): void {
    const key = equipped ? `backpack:${skinId ?? ''}` : '';
    if (key === this.backpackKey) return;
    this.backpackKey = key;
    this.bodyVisual?.onunequip(); this.bodyVisual = undefined;
    if (!equipped) return;
    this.bodyVisual = backpackVisual({ id: 'preview:body', prefab: 'backpack', skinId });
    this.bodyVisual.onequip(this.visualOwner);
  }

  followSymbol(symbol: string, offsetX: number, offsetY: number, fx?: FollowerFx): SymbolFollower {
    return this.instance.sprite.followSymbol(symbol, offsetX, offsetY, fx);
  }

  private refreshFrame(): void { this.instance.sprite.update(0); }

  update(dt: number, jumpProgress?: number): void {
    if (this.disposed) return;
    const step = Math.max(0, Math.min(dt, 0.1));
    this.fxScheduler.advance(step);
    this.stategraph.update(step);
    this.castingLight.update(step);
    this.showCurrentFrame(jumpProgress);
    this.instance.sprite.update(step);
  }

  private registerAnimations(parsed: ParsedAnim): void {
    for (const animation of parsed.animations) if (!this.factoryAnimations.animations.includes(animation)) this.factoryAnimations.animations.push(animation);
  }

  private showCurrentFrame(jumpProgress?: number) {
    if (this.state === 'jump' && jumpProgress !== undefined) {
      const progress = THREE.MathUtils.clamp(jumpProgress, 0, 1);
      this.showFrame(Math.min(this.animation.frames.length - 1, Math.floor(progress * this.animation.frames.length)));
      return;
    }
    const clip = this.stategraph.animationClip;
    const speed = (clip.frameRate ?? this.animation.frameRate) * (clip.playbackRate ?? 1);
    const frame = Math.floor(this.stategraph.animationTime * speed);
    if (this.makeSoundActive && this.state === 'build_loop' && clip.loop) {
      const cycle = Math.floor(frame / this.animation.frames.length);
      if (cycle !== this.makeSoundCycle) {
        this.makeSoundCycle = cycle;
        this.makeSound?.stop();
        this.makeSound = PlaySound('dontstarve/wilson/make_trap');
      }
    }
    this.showFrame(clip.loop ? frame % this.animation.frames.length : Math.min(frame, this.animation.frames.length - 1));
  }

  private selectAnimation(clip: WilsonAnimationClip, restart = true): number {
    this.state = clip.key;
    this.clipName = clip.name;
    const parsed = this.state === 'ghost' ? this.ghostArt!.animations : this.state === 'emote' ? this.emote!.animations
      : this.state === 'amulet_rebirth' ? this.amuletAnimations
      : this.state === 'action_uniqueitem_pre' || this.state === 'book' || this.state === 'flute' ? this.uniqueItemAnimations : this.animations[this.state];
    if (!parsed) throw new Error(`Wilson animation ${clip.name} has not been loaded`);
    const bankHash = smallHash(this.state === 'ghost' ? 'ghost' : 'wilson');
    const facing = facingValues[this.facing];
    const candidates = parsed.animations.filter((animation) =>
      animation.name === this.clipName && animation.bankHash === bankHash);
    this.animation = candidates.find((animation) => animation.facing === facing) ??
      candidates.find((animation) => (animation.facing & facing) !== 0) ?? candidates[0];
    if (!this.animation) throw new Error(`Wilson animation ${this.clipName} is unavailable`);
    const fallbackBuilds = [this.uniqueItemBuild, this.emote?.props].filter((build): build is CarryBuild => build !== undefined);
    if (!this.artSource || this.artSource.animations !== parsed || this.artSource.build.build !== this.build
      || fallbackBuilds.length !== (this.artSource.fallbackBuilds?.length ?? 0)
      || fallbackBuilds.some((build, index) => build !== this.artSource!.fallbackBuilds?.[index])) {
      this.artSource = { animations: parsed, bank: bankHash, build: { build: this.build, materials: this.materials }, fallbackBuilds };
      this.instance.sprite.setArtSource(this.artSource);
    }
    if (restart) {
      if (clip.loop) this.instance.sprite.start(clip.name); else this.instance.sprite.playOnce(clip.name);
      this.frameIndex = -1;
      this.showFrame(0);
    }
    return this.animation.frames.length / ((clip.frameRate ?? this.animation.frameRate) * (clip.playbackRate ?? 1));
  }

  private startOneShot(state: WilsonOneShotState) {
    this.cancelEmote();
    this.stategraph.requestOneShot(state);
  }

  private showFrame(index: number): void {
    if (index === this.frameIndex) return;
    this.frameIndex = index;
    this.instance.sprite.setFrame(index);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.emoteRequest;
    this.stategraph.dispose();
    this.handVisual?.onunequip(); this.headVisual?.onunequip(); this.bodyVisual?.onunequip();
    this.cleanups.splice(0).forEach(stop => stop());
    this.bookFx.dispose(); this.fxScheduler.dispose(); this.castingLight.dispose();
    this.makeSound?.stop(); this.shaveSound?.stop();
    for (const sound of this.namedSounds.values()) sound.stop();
    for (const sound of this.portalSounds) sound.stop();
    this.namedSounds.clear(); this.portalSounds.clear();
  }

  releaseAssets(): void {
    this.equipmentAssets.dispose(); this.hatAssets.dispose();
    const release = (build: SymbolBuild) => { for (const material of build.materials) { material.map?.dispose(); material.dispose(); } };
    if (this.ghostAssets) void this.ghostAssets.then(release, () => {});
    for (const assets of this.emoteAssets.values()) void assets.then(assets => { if (assets.props) release(assets.props); }, () => {});
  }
}

export async function createWilsonPlayer(
  assetBaseUrl: string,
  options: Pick<WilsonPlayerPrefabOptions, 'sanityPercent'> = {},
): Promise<PlayerModel> {
  const [buildPackage, idle, movement, jump, itemActions, eat, staff, net, hammer, shovel, attacks, till, axe, actions, slip, strum, fishing, shell, portal] = await Promise.all([
    loadBuild(`dynamic/${PLAYER_ART_CHARACTER}.zip`, assetBaseUrl),
    loadAnim('player_idles.zip', assetBaseUrl),
    loadAnim('player_basic.zip', assetBaseUrl),
    loadAnim('player_jump.zip', assetBaseUrl),
    loadAnim('player_actions_item.zip', assetBaseUrl),
    loadAnim('player_actions_eat.zip', assetBaseUrl),
    loadAnim('player_staff.zip', assetBaseUrl),
    loadAnim('player_actions_bugnet.zip', assetBaseUrl),
    loadAnim('player_actions_pickaxe.zip', assetBaseUrl),
    loadAnim('player_actions_shovel.zip', assetBaseUrl),
    loadAnim('player_attacks.zip', assetBaseUrl),
    loadAnim('player_actions_till.zip', assetBaseUrl),
    loadAnim('player_actions_axe.zip', assetBaseUrl),
    loadAnim('player_actions.zip', assetBaseUrl),
    loadAnim('player_slip.zip', assetBaseUrl),
    loadAnim('player_strum.zip', assetBaseUrl),
    loadAnim('player_actions_fishing.zip', assetBaseUrl),
    loadAnim('player_slurtle_armor.zip', assetBaseUrl),
    loadAnim('wortox_portal.zip', assetBaseUrl),
    PreloadSounds('dontstarve/movement/iceslab_slipping', 'dontstarve/movement/slip_fall_whoop',
      'dontstarve/movement/slip_fall_thud', 'dontstarve/characters/wilson/hurt', 'dontstarve/wilson/make_trap', 'dontstarve/wilson/shave_LP', 'dontstarve/wilson/attack_whoosh',
      'dontstarve/wilson/attack_weapon', 'dontstarve/wilson/attack_nightsword',
      'dontstarve/movement/foley/hideshell', 'dontstarve/wilson/hit', 'dontstarve/wilson/hit_armour',
      'dontstarve/wilson/death', 'dontstarve/characters/maxwell/death_voice'),
  ]);
  if (buildPackage.build.name.toLowerCase() !== PLAYER_ART_CHARACTER) {
    throw new Error(`Expected ${PLAYER_ART_CHARACTER} build, received ${buildPackage.build.name}`);
  }

  const banks = [idle, movement, jump, itemActions, eat, staff, net, hammer, shovel, attacks, till, axe, actions, slip, strum, fishing, shell, portal];
  const factoryAnimations: ParsedAnim = { animations: banks.flatMap(bank => bank.animations) };
  const factory = createSpriteFactory(buildPackage, factoryAnimations);
  const { instance, display } = createPrefabEntity(PLAYER_ART_CHARACTER, {
    create: (name, frame) => factory.create({ initialAnimation: name, initialFrame: frame }),
    release: sprite => factory.disposeSprite(sprite),
  }, { name: 'idle_loop' }, 'Wortox', instance => {
    instance.sprite.setArtSource({ animations: idle, bank: smallHash('wilson'), build: factory.build });
    instance.sprite.setFacing(8, false);
    // SGwilson owns playback time and action completion; the display draws the declared frame.
    instance.sprite.setPaused(true);
  });
  const player = Object.assign(display.model, { MiniMapEntity: new MiniMapEntity(instance.position) });
  player.MiniMapEntity.SetIcon(`${PLAYER_ART_CHARACTER}.png`);
  player.MiniMapEntity.SetPriority(10);
  player.MiniMapEntity.SetCanUseCache(false);
  player.MiniMapEntity.SetDrawOverFogOfWar(true);
  player.userData.artCharacter = PLAYER_ART_CHARACTER;
  // player_common.lua's common tags; upgrades.lua uses these exact upgrade type names.
  for (const tag of ['player', 'scarytoprey', 'character', 'lightningtarget', 'waterplant_upgradeuser', 'mast_upgradeuser',
    'chest_upgradeuser', 'usesvegetarianequipment', 'ghostlyelixirable', 'trader', 'debuffable', 'stageactor',
    'playermonster', 'monster', 'soulstealer', 'souleater']) instance.addTag(tag);
  player.position.set(0, 30, 0);
  player.userData.billboard = true;
  actionEntity(player, PLAYER_ART_CHARACTER);

  const controller = new WilsonController(instance, player, buildPackage.build, {
    wortox_portal: portal,
    idle,
    walk: movement,
    run: movement,
    jump,
    build: itemActions,
    build_pre: itemActions,
    build_loop: itemActions,
    build_pst: itemActions,
    eat,
    quick_eat_pre: eat,
    quick_eat: eat,
    quick_drink_pre: eat,
    quick_drink: eat,
    item_in: itemActions,
    item_out: itemActions,
    pickup: itemActions,
    pickup_pst: itemActions,
    give: itemActions,
    give_pst: itemActions,
    light_fire: itemActions,
    light_fire_pst: itemActions,
    atk_pre: attacks,
    atk: attacks,
    punch: attacks,
    toolpunch: attacks,
    staff_pre: staff,
    staff,
    bugnet_pre: net,
    bugnet: net,
    pickaxe_pre: hammer,
    pickaxe_loop: hammer,
    pickaxe_pst: hammer,
    chop_pre: axe,
    chop_loop: axe,
    shovel_pre: shovel,
    shovel_loop: shovel,
    shovel_pst: shovel,
    till_pre: till,
    till_loop: till,
    till_pst: till,
    hit: actions,
    death: actions,
    wakeup: actions,
    strum_pre: strum, strum,
    fishing,
    hideshell: shell, hideshell_idle: shell, hitshell: shell,
    slip_pre: slip, slip_loop: slip, slip_pst: slip,
    slip_fall_pre: slip, slip_fall_idle: slip, slip_fall_pst: slip,
  }, factory.build.materials, assetBaseUrl, factoryAnimations, options.sanityPercent);
  instance.onRemove(() => { controller.dispose(); player.MiniMapEntity.dispose(); disposeActionEntity(player); });
  display.onDispose(() => { controller.releaseAssets(); factory.dispose(); });
  try { await controller.prepareToolBroke(); }
  catch (error) { instance.remove(); throw error; }
  instance.sprite.update(0);
  player.userData.animationController = controller;
  player.userData.stategraph = controller.stategraph;
  return player;
}

/** player_common.lua: MakeCharacterPhysics(inst, 75, .5), in DST units. */
export const PLAYER_PHYSICS_RADIUS = 0.5;
/** The player's collider radius in world units; UI anchored to the player scales from this. */
export const PLAYER_COLLIDER_RADIUS = PLAYER_PHYSICS_RADIUS * WORLD_SCALE;

/** `world` receives the player's body; Physics:Teleport after moving the model places it there. */
export async function createWilsonPlayerPrefab(
  assetBaseUrl: string,
  world: CANNON.World,
  options: WilsonPlayerPrefabOptions = {},
): Promise<WilsonPlayerPrefab> {
  const model = await createWilsonPlayer(assetBaseUrl, options);
  const entity = prefabInstance(model)!;
  MakeCharacterPhysics(entity, 75, PLAYER_PHYSICS_RADIUS);
  entity.bindPhysics(world);
  const body = entity.physicsBody as PlayerBody;
  body.canJump = false;
  const onCollide = () => { body.canJump = true; };
  body.addEventListener('collide', onCollide);
  entity.onRemove(() => body.removeEventListener('collide', onCollide));

  return {
    physics: entity.physics,
    body,
    instance: entity as PrefabInstance,
    display: model.userData.display as PrefabDisplay,
    model,
    MiniMapEntity: model.MiniMapEntity,
    setNormal(cameraWorldQuaternion) {
      model.quaternion.copy(cameraWorldQuaternion);
    },
  };
}
