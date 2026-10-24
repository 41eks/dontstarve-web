import {
  createMaterials,
  findImage,
  loadAnim,
  loadAnimationArchive,
  loadBuild,
  smallHash,
  SpriteFrameRenderer,
  type Animation,
  type ParsedAnim,
  type ParsedBuild,
  type ResolvedSprite,
} from '@dontstarve-web/animation/animationAssets';
import { AnimState } from '@dontstarve-web/animation/animState';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { type ReadonlySignal } from '@dontstarve-web/signals';
import { BufferedAction, WilsonStateGraph, type BufferedActionObject, type WilsonAction, type WilsonAnimationClip, type WilsonAnimationKey, type WilsonCombat, type WilsonFishingHost, type WilsonMovementState, type WilsonOneShotState, type WilsonSleepHost, type WilsonDeathHost, type WilsonRebirthHost } from '@dontstarve-web/stategraphs';
import type { ActionAnimationController } from '@dontstarve-web/stategraphs/actionContext';
import type * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { isAxeTool, type AxeTool } from './axe';
import { prepareBackpackVisual } from './backpack';
import { BookFxController, type BookFxPrefab } from './book_fx';
import { WILSON_EMOTES, type WilsonEmote, type WilsonEmoteDefinition } from './emotes';
import { equipmentVisualLifecycle, type EquipmentVisualContext, type EquipmentVisualOwner } from './equipmentVisual';
import { isFarmHoeTool, type FarmHoeTool } from './farm_hoe';
import { FISHING_SOUNDS } from './fishingrod';
import { GroundItemAssets } from './groundItems';
import { getHandEquipmentDefinition } from './handEquipment';
import { HatEquipmentAssets, prepareHatVisual } from './hats';
import { MiniMapEntity } from './minimapEntity';
import { isPickaxeTool, type PickaxeTool } from './pickaxe';
import { isPitchforkTool, type PitchforkTool } from './pitchfork';
import { equipSamePrefab } from './player_common';
import { isShovelTool, type ShovelTool } from './shovel';
import { PlaySound, PreloadSounds, type SoundEventPath, type SoundHandle } from './sound';
import { MakeCharacterPhysics, WORLD_SCALE } from './standardcomponents';
import { bindPhysics, type PhysicsBinding } from '../../componets/src/physicsBinding';
import { PhysicsState } from '../../componets/src/physicsState';
import { actionEntity } from './actionEntity';
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
  setCarryItem(item: WilsonCarryItem | null, skinId?: string): Promise<void>;
  readonly AnimState: AnimState;
  readonly equipmentAssets: GroundItemAssets;
  readonly equipmentContext: EquipmentVisualContext;
  /** Action identity only; the equipped prefab applies its own art through AnimState. */
  setEquippedCarryItem(item: WilsonCarryItem | null): void;
  setHat(itemId: string | null, skinId?: string): Promise<void>;
  /** Follower:FollowSymbol(owner.GUID, symbol, offsetX, offsetY): a node tracking the symbol, in the player's space. */
  followSymbol(symbol: string, offsetX: number, offsetY: number): SymbolFollower;
  setBackpack(equipped: boolean, skinId?: string): Promise<void>;
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
  /** Disposed before the world it registers in. */
  physicsBinding: PhysicsBinding;
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
  private readonly renderer: SpriteFrameRenderer;
  private materials: THREE.MeshBasicMaterial[];
  readonly stategraph: WilsonStateGraph;
  private state: WilsonAnimationKey = 'idle';
  private clipName = 'idle_loop';
  private facing: WilsonFacing = 'down';
  private mirrored = false;
  private equippedCarryItem: WilsonCarryItem | null = null;
  private carryItem: WilsonCarryItem | null = null;
  private carryKey = '';
  private carryRequest = 0;
  readonly equipmentAssets: GroundItemAssets;
  readonly equipmentContext: EquipmentVisualContext;
  readonly AnimState: AnimState;
  private readonly visualOwner: EquipmentVisualOwner;
  private handVisual?: ReturnType<typeof equipmentVisualLifecycle>;
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
  private readonly visual: THREE.Group;
  private build: ParsedBuild;
  private readonly animations: WilsonAnimations;
  private ghostAssets?: Promise<GhostAssets>;
  private ghostArt?: GhostAssets;
  /** The living build and materials set aside while the ghost's are shown. */
  private livingArt?: { build: ParsedBuild; materials: THREE.MeshBasicMaterial[] };
  private soulHopHost?: WilsonSoulHopHost;
  private readonly portalTint = { value: 0 };
  private readonly tintedMaterials = new WeakSet<THREE.Material>();
  private readonly portalSounds = new Set<SoundHandle>();
  private multColour: readonly [number, number, number] = [1, 1, 1];
  private readonly hatAssets: HatEquipmentAssets;
  private readonly sanityPercent?: ReadonlySignal<number>;
  private readonly symbolFollowers = new Set<{ hash: number; offset: readonly [number, number]; node: THREE.Object3D }>();
  private headVisual?: ReturnType<typeof equipmentVisualLifecycle>;
  private hatKey = '';
  private bodyVisual?: ReturnType<typeof equipmentVisualLifecycle>;
  private backpackKey = '';
  private readonly emoteAssets = new Map<string, Promise<EmoteAssets>>();
  private emote: ActiveEmote | null = null;
  private emoteRequest = 0;
  private emotePending = false;
  private uniqueItemAnimations: ParsedAnim | null = null;
  /** Loaded builds by name, for AnimState:OverrideSymbol and AddOverrideBuild. */
  private readonly symbolBuilds = new Map<string, CarryBuild>();
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
    visual: THREE.Group,
    build: ParsedBuild,
    animations: WilsonAnimations,
    materials: THREE.MeshBasicMaterial[],
    assetBaseUrl: string,
    sanityPercent?: ReadonlySignal<number>,
  ) {
    this.visual = visual;
    this.build = build;
    this.animations = animations;
    this.materials = materials;
    this.assetBaseUrl = assetBaseUrl;
    this.equipmentAssets = new GroundItemAssets();
    this.AnimState = new AnimState(() => { if (this.animation) this.refreshFrame(); });
    this.visualOwner = { AnimState: this.AnimState, PushEvent: (name, data) => visual.parent!.dispatchEvent({ type: name, data } as never) };
    for (const layer of ['ARM_carry', 'LANTERN_OVERLAY', 'HAT', 'HAIR_HAT', 'HEAD_HAT', 'HEAD_HAT_NOHELM', 'HEAD_HAT_HELM']) this.AnimState.Hide(layer);
    this.castingLight = new StaffCastingLight(visual.parent!);
    this.hatAssets = new HatEquipmentAssets(assetBaseUrl);
    this.sanityPercent = sanityPercent;
    this.equipmentContext = { owner: this.visualOwner, assets: this.equipmentAssets, hats: this.hatAssets, lightParent: visual.parent!, sanityPercent };
    this.renderer = new SpriteFrameRenderer(visual);
    this.bookFx = new BookFxController(this.equipmentAssets, visual);
    const controller = this;
    this.stategraph = new WilsonStateGraph({
      get soulHop() { return controller.soulHopHost; },
      get sleep() { return controller.sleepHost; },
      get death() { return controller.deathHost; },
      get rebirth() { return controller.rebirthHost; },
      rez: {
        setHidden: hidden => { this.visual.visible = !hidden; },
        get isHidden() { return !controller.visual.visible; },
        setMultColour: (r, g, b) => this.setMultColour(r, g, b),
        setInvincible: invincible => { visual.parent!.dispatchEvent({ type: 'setinvincible', data: invincible } as never); },
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
      overrideSymbol: (symbol, build, sourceSymbol) => this.overrideSymbol(symbol, build, sourceSymbol),
      overrideItemSkinSymbol: (symbol, skinBuild, skinSymbol, build, sourceSymbol) => {
        const skin = this.symbolBuilds.get(skinBuild);
        if (skin?.build.symbols.has(smallHash(skinSymbol))) this.overrideSymbol(symbol, skinBuild, skinSymbol);
        else this.overrideSymbol(symbol, build, sourceSymbol);
      },
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
      setControllerEnabled: enabled => { visual.parent!.userData.controllerEnabled = enabled; },
      stopMovement: () => visual.parent!.userData.locomotor?.stop(),
      pushPlayerEvent: (name, data) => { visual.parent!.dispatchEvent({ type: name, data } as never); },
      slip: {
        runSpeed: () => visual.parent!.userData.runSpeed as number,
        setMotorSpeed: speed => { visual.parent!.userData.motorSpeed = speed; },
        resetSlipperiness: () => (visual.parent!.userData.slipperyfeet as { SetCurrent(value: number): void } | undefined)?.SetCurrent(0),
        wantsToMoveForward: () => visual.parent!.userData.wantsToMoveForward === true,
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
        visual.parent!.dispatchEvent({ type: 'newstate', data: { statename: name } } as never);
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
      this.portalTint.value = 0;
    }
    this.soulHopHost = host && {
      ...host,
      setTint: value => { this.portalTint.value = value; },
      playSound: (event, volume = 1) => {
        for (const sound of this.portalSounds) if (!sound.isPlaying()) this.portalSounds.delete(sound);
        const sound = PlaySound(event as SoundEventPath, this.visual.parent!.position);
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
      this.loadSymbolBuild('player_amulet_resurrect.zip'),
      this.loadSymbolBuild('torso_amulets.zip'),
      PreloadSounds('dontstarve/ghost/ghost_howl', 'dontstarve/common/rebirth_amulet_raise', 'dontstarve/common/rebirth_amulet_poof'),
    ]).then(([buildPackage, animations, amulet]) => {
      this.amuletAnimations = amulet;
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
    this.applyMultColour();
    this.stategraph.becomeGhost(loading);
    this.frameIndex = -1;
    this.showCurrentFrame();
  }

  makeAlive(state: 'portal_rez' | 'amulet_rebirth' = 'portal_rez'): void {
    const living = this.livingArt;
    if (!this.isGhost || !living) return;
    this.build = living.build;
    this.materials = living.materials;
    this.applyMultColour();
    this.livingArt = undefined;
    this.stategraph.becomeAlive(state);
    this.frameIndex = -1;
    this.showCurrentFrame();
  }

  /** AnimState:SetMultColour(r, g, b, 1) on the character's body sprites. */
  private setMultColour(r: number, g: number, b: number): void {
    this.multColour = [r, g, b];
    this.applyMultColour();
  }

  private applyMultColour(): void {
    for (const material of this.materials) material.color.setRGB(...this.multColour);
  }
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
      this.loadSymbolBuild(`${UNIQUE_ITEM_BUILD}.zip`),
      book.swap_build ? this.loadSymbolBuild(`${book.swap_build}.zip`) : undefined,
      book.skinBuild ? this.loadSymbolBuild(`dynamic/${book.skinBuild}.zip`) : undefined,
      this.bookFx.prepare(...fx),
      PreloadSounds(...sounds as SoundEventPath[]),
    ]);
    this.uniqueItemAnimations = animations;
  }

  playRead(book: BufferedActionObject, onRead: () => boolean): boolean {
    if (this.stategraph.hasStateTag('busy') || !this.uniqueItemAnimations
      || (book.swap_build && !this.symbolBuilds.has(book.swap_build))) return false;
    this.cancelEmote();
    return this.stategraph.pushBufferedAction(new BufferedAction('READ', onRead, undefined, { invobject: book }));
  }

  cancelRead(): void { this.stategraph.cancelAction('READ'); }

  get isPlayingInstrument(): boolean { return this.stategraph.isPerformingAction('PLAY'); }

  /** Load SGwilson's play_flute art and the flute loop before buffering the action. */
  async prepareFlute(skinArchive?: string): Promise<void> {
    const [animations] = await Promise.all([
      this.uniqueItemAnimations ?? this.equipmentAssets.loadAnimation(`${UNIQUE_ITEM_BUILD}.zip`),
      this.loadSymbolBuild(`${UNIQUE_ITEM_BUILD}.zip`),
      this.loadSymbolBuild('pan_flute.zip'),
      skinArchive ? this.loadSymbolBuild(skinArchive) : undefined,
      PreloadSounds('dontstarve/wilson/flute_LP'),
    ]);
    this.uniqueItemAnimations = animations;
  }

  playFlute(instrument: BufferedActionObject, onPlay: () => boolean): boolean {
    if (this.stategraph.hasStateTag('busy') || !this.uniqueItemAnimations || !this.symbolBuilds.has('pan_flute')) return false;
    this.cancelEmote();
    return this.stategraph.pushBufferedAction(new BufferedAction('PLAY', onPlay, undefined, { invobject: instrument }));
  }

  cancelPlay(): void { this.stategraph.cancelAction('PLAY'); }

  private async loadSymbolBuild(archive: string): Promise<void> {
    const build = await this.equipmentAssets.loadBuild(archive);
    this.symbolBuilds.set(build.build.name.toLowerCase(), build);
    this.AnimState.RegisterBuild(build.build.name.toLowerCase(), build);
  }

  private overrideSymbol(symbol: string, build: string, sourceSymbol: string): void {
    const source = this.symbolBuilds.get(build);
    this.AnimState.OverrideSymbol(symbol, source ?? build, sourceSymbol);
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

  /** Load the catchfish state's fish01 swap build and the fishing sounds before FISH is buffered. */
  async prepareFishing(): Promise<void> {
    await Promise.all([this.symbolBuilds.has('fish01') ? undefined : this.loadSymbolBuild('fish01.zip'), PreloadSounds(...FISHING_SOUNDS)]);
  }

  playFish(onFish: () => void): boolean {
    return this.symbolBuilds.has('fish01')
      && this.startAction('FISH', onFish, this.carryItem === 'fishingrod' && this.handReady);
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
    this.visual.scale.x = Math.abs(this.visual.scale.x) * (mirrored ? -1 : 1);
    // Facing changes select different art without restarting the state timeline.
    this.selectAnimation(this.stategraph.animationClip);
    this.showCurrentFrame();
    this.updateSymbolFollowers();
  }

  setEquippedCarryItem(item: WilsonCarryItem | null): void {
    this.stategraph.pushEvent('unequip');
    this.equippedCarryItem = item;
    this.carryItem = item;
    this.handReady = item !== null;
    this.refreshFrame();
  }

  /** Standalone preview adapter: use the same prefab equip/unequip functions as live inventory. */
  async setCarryItem(item: WilsonCarryItem | null, skinId?: string): Promise<void> {
    const key = item === null ? '' : `${item}:${skinId ?? ''}`;
    if (key === this.carryKey) return this.handVisual?.ready;
    this.carryKey = key;
    const request = ++this.carryRequest;
    this.handVisual?.onunequip(); this.handVisual = undefined;
    this.setEquippedCarryItem(item);
    this.handReady = false;
    if (!item) return;
    const definition = getHandEquipmentDefinition(item)!.definition;
    const lifecycle = equipmentVisualLifecycle(() => definition.prepareVisual(this.equipmentAssets, { id: 'preview:hand', prefab: item, skinId }), this.visualOwner);
    this.handVisual = lifecycle;
    try { await lifecycle.ready; if (request === this.carryRequest) this.handReady = true; }
    catch (error) { if (request === this.carryRequest) { this.carryKey = ''; throw error; } }
  }

  async setHat(itemId: string | null, skinId?: string): Promise<void> {
    const key = itemId === null ? '' : `${itemId}:${skinId ?? ''}`;
    if (key === this.hatKey) return this.headVisual?.ready;
    this.hatKey = key;
    this.headVisual?.onunequip(); this.headVisual = undefined;
    if (!itemId) return;
    const lifecycle = equipmentVisualLifecycle(() => prepareHatVisual(this.hatAssets,
      { id: 'preview:head', prefab: itemId, skinId }, this.visual.parent!, this.sanityPercent), this.visualOwner);
    this.headVisual = lifecycle;
    try { await lifecycle.ready; } catch (error) { if (this.headVisual === lifecycle) { this.hatKey = ''; throw error; } }
  }

  async setBackpack(equipped: boolean, skinId?: string): Promise<void> {
    const key = equipped ? `backpack:${skinId ?? ''}` : '';
    if (key === this.backpackKey) return this.bodyVisual?.ready;
    this.backpackKey = key;
    this.bodyVisual?.onunequip(); this.bodyVisual = undefined;
    if (!equipped) return;
    const lifecycle = equipmentVisualLifecycle(() => prepareBackpackVisual(this.equipmentAssets,
      { id: 'preview:body', prefab: 'backpack', skinId }), this.visualOwner);
    this.bodyVisual = lifecycle;
    try { await lifecycle.ready; } catch (error) { if (this.bodyVisual === lifecycle) { this.backpackKey = ''; throw error; } }
  }

  followSymbol(symbol: string, offsetX: number, offsetY: number): SymbolFollower {
    const node = new THREE.Object3D();
    node.name = `Follow:${symbol}`;
    this.visual.parent!.add(node);
    const follower = { hash: smallHash(symbol), offset: [offsetX, offsetY] as const, node };
    this.symbolFollowers.add(follower);
    this.updateSymbolFollowers();
    return { node, remove: () => { this.symbolFollowers.delete(follower); node.removeFromParent(); } };
  }

  /** The symbol's matrix places the offset in animation pixels; the visual's scale and mirroring map it to the scene. */
  private updateSymbolFollowers(): void {
    if (!this.symbolFollowers.size) return;
    const elements = this.animation.frames[Math.max(0, this.frameIndex)]?.elements ?? [];
    this.visual.updateMatrix();
    for (const { hash, offset: [x, y], node } of this.symbolFollowers) {
      const element = elements.find((candidate) => candidate.imageHash === hash);
      node.visible = !!element;
      if (!element) continue;
      const [a, b, c, d, tx, ty] = element.matrix;
      node.position.set(a * x + c * y + tx, b * x + d * y + ty, 0).applyMatrix4(this.visual.matrix);
    }
  }

  private refreshFrame() {
    const currentFrame = Math.max(0, this.frameIndex);
    this.frameIndex = -1;
    this.showFrame(currentFrame);
  }

  update(dt: number, jumpProgress?: number) {
    const step = Math.max(0, Math.min(dt, 0.1));
    const fxWasAnimating = this.bookFx.isAnimating;
    this.bookFx.update(step);
    if (fxWasAnimating) this.frameIndex = -1;
    this.stategraph.update(step);
    this.castingLight.update(step);
    const equipmentWasAnimating = this.AnimState.isAnimating;
    this.AnimState.Update(step);
    if (equipmentWasAnimating) this.frameIndex = -1;
    this.showCurrentFrame(jumpProgress);
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

  private selectAnimation(clip: WilsonAnimationClip): number {
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
    this.frameIndex = -1;
    this.showFrame(0);
    return this.animation.frames.length / ((clip.frameRate ?? this.animation.frameRate) * (clip.playbackRate ?? 1));
  }

  private startOneShot(state: WilsonOneShotState) {
    this.cancelEmote();
    this.stategraph.requestOneShot(state);
  }

  private showFrame(index: number) {
    if (index === this.frameIndex && !this.AnimState.isAnimating && !this.bookFx.isAnimating) return;
    this.frameIndex = index;
    this.updateSymbolFollowers();
    const bookFx = this.bookFx.resolve(this.animation.frames[index].elements);
    const sprites = [...this.animation.frames[index].elements]
      .filter(element => this.AnimState.IsVisible(element))
      .sort((a, b) => b.z - a.z)
      .flatMap((element): ResolvedSprite[] => {
        const followers = bookFx.followers.get(element);
        if (followers) return followers;
        const override = this.AnimState.ResolveSymbol(element);
        if (override) return override;
        const source = { build: this.build, materials: this.materials };
        const image = findImage(source.build, element.imageHash, element.imageIndex);
        if (image) return [{ element, image, materials: source.materials }];
        const uniqueItem = this.symbolBuilds.get(UNIQUE_ITEM_BUILD);
        const uniqueImage = uniqueItem && findImage(uniqueItem.build, element.imageHash, element.imageIndex);
        if (uniqueImage) return [{ element, image: uniqueImage, materials: uniqueItem.materials }];
        const props = this.emote?.props;
        const propImage = props && findImage(props.build, element.imageHash, element.imageIndex);
        return propImage ? [{ element, image: propImage, materials: props!.materials }] : [];
      });
    const fx = this.AnimState.ResolveEffects(this.animation.frames[index].elements, this.mirrored);
    const resolved = [...fx.back, ...sprites, ...fx.front, ...bookFx.front];
    // DoWortoxPortalTint: texture RGB *= 1-val, then colouradder adds (154,23,19)/255 * val.
    for (const sprite of resolved) for (const material of sprite.materials) {
      if (this.tintedMaterials.has(material)) continue;
      this.tintedMaterials.add(material);
      const previousCompile = material.onBeforeCompile.bind(material);
      const previousKey = material.customProgramCacheKey();
      material.onBeforeCompile = (shader, renderer) => {
        previousCompile(shader, renderer);
        shader.uniforms.wortoxPortalTint = this.portalTint;
        shader.fragmentShader = 'uniform float wortoxPortalTint;\n' + shader.fragmentShader.replace(
          '#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = diffuseColor.rgb * (1.0 - wortoxPortalTint) + vec3(154.0, 23.0, 19.0) / 255.0 * wortoxPortalTint;');
      };
      material.customProgramCacheKey = () => previousKey + ':wortox_portaltint';
      material.needsUpdate = true;
    }
    this.renderer.show(resolved);
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

  const group = new THREE.Group();
  const player = Object.assign(group, { MiniMapEntity: new MiniMapEntity(group.position) });
  // player_common.lua common initialization uses the character name, not the
  // shared Wilson animation bank. Wortox's default skin supplies the build.
  player.MiniMapEntity.SetIcon(`${buildPackage.build.name.toLowerCase()}.png`);
  player.MiniMapEntity.SetPriority(10);
  player.MiniMapEntity.SetCanUseCache(false);
  player.MiniMapEntity.SetDrawOverFogOfWar(true);
  player.name = 'Wortox';
  player.userData.artCharacter = PLAYER_ART_CHARACTER;
  // player_common.lua: deployment queries ignore the player's own entity.
  actionEntity(player, PLAYER_ART_CHARACTER).addTag('player');
  player.position.set(0, 30, 0);
  player.userData.billboard = true;

  const visual = new THREE.Group();
  const assetToWorldScale = 0.02;
  visual.scale.set(assetToWorldScale, -assetToWorldScale, assetToWorldScale);
  player.add(visual);
  registerSpriteRenderGroup(player, visual);

  const controller = new WilsonController(visual, buildPackage.build, {
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
  }, createMaterials(buildPackage), assetBaseUrl, options.sanityPercent);
  await controller.prepareToolBroke();
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
  const entity = { physics: new PhysicsState() };
  MakeCharacterPhysics(entity, 75, PLAYER_PHYSICS_RADIUS);
  const physicsBinding = bindPhysics(world, entity.physics, () => model.position);
  const body = physicsBinding.body as PlayerBody;
  body.canJump = false;
  body.addEventListener('collide', () => {
    body.canJump = true;
  });

  return {
    physics: entity.physics,
    body,
    physicsBinding,
    model,
    MiniMapEntity: model.MiniMapEntity,
    setNormal(cameraWorldQuaternion) {
      model.quaternion.copy(cameraWorldQuaternion);
    },
  };
}
