import { smallHash } from '@dontstarve-web/animation/animationAssets';
import { AnimState } from '@dontstarve-web/animation/animState';
import { SpriteResources, type NamedSpriteArt, type FollowerFx, type PrefabDisplay } from '@dontstarve-web/display';
import type { ReadonlySignal } from '@dontstarve-web/signals';
import { BufferedAction, WilsonStateGraph, type WilsonAction, type WilsonAnimationClip, type WilsonAnimationKey, type WilsonCombat, type WilsonFishingHost, type WilsonMovementState, type WilsonOneShotState, type WilsonSleepHost, type WilsonDeathHost, type WilsonRebirthHost } from '@dontstarve-web/stategraphs';
import type * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { AxeTool } from './axe';
import { backpackVisual } from './backpack';
import { BookFxController } from './book_fx';
import { animationTiming } from './animationTimings';
import { WILSON_EMOTES, type WilsonEmote, type WilsonEmoteDefinition } from './emotes';
import { wornEquipmentLifecycle, type EquipmentVisualContext } from './equipmentVisual';
import type { FarmHoeTool } from './farm_hoe';
import { GroundItemAssets } from './groundItems';
import { getHandEquipmentDefinition } from './handEquipment';
import { HatEquipmentAssets, hatVisual } from './hats';
import type { PickaxeTool } from './pickaxe';
import type { PitchforkTool } from './pitchfork';
import { createPlayerStats, equipSamePrefab, type PlayerStats, type PlayerStatsSave } from './player_common';
import type { ShovelTool } from './shovel';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import { MakeCharacterPhysics, WORLD_SCALE } from './standardcomponents';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { PhysicsState } from '../../componets/src/physicsState';
import { actionEntity, disposeActionEntity } from './actionEntity';
import { createPrefabEntity, prefabInstance, type PrefabInstance } from './prefabInstance';
import { Builder, type BuilderWorld } from '../../componets/src/builder';
import type { WilsonSoulHopHost } from '../../stategraphs/src/SGwilson';
import { StaffCastingLight } from './staff_castinglight';
import type { SlipperyFeet } from '../../componets/src/slipperyfeet';
import type { ComponentUpdates } from '../../componets/src/componentUpdates';

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
type WilsonAnimations = Record<Exclude<WilsonAnimationKey, 'emote' | 'ghost' | 'amulet_rebirth' | ReadAnimationKey>, string>;
const WILSON_ANIMATION_ARCHIVES: WilsonAnimations = {
  wortox_portal: 'wortox_portal.zip',
  idle: 'player_idles.zip',
  walk: 'player_basic.zip',
  run: 'player_basic.zip',
  jump: 'player_jump.zip',
  build: 'player_actions_item.zip',
  build_pre: 'player_actions_item.zip',
  build_loop: 'player_actions_item.zip',
  build_pst: 'player_actions_item.zip',
  eat: 'player_actions_eat.zip',
  quick_eat_pre: 'player_actions_eat.zip',
  quick_eat: 'player_actions_eat.zip',
  quick_drink_pre: 'player_actions_eat.zip',
  quick_drink: 'player_actions_eat.zip',
  item_in: 'player_actions_item.zip',
  item_out: 'player_actions_item.zip',
  pickup: 'player_actions_item.zip',
  pickup_pst: 'player_actions_item.zip',
  give: 'player_actions_item.zip',
  give_pst: 'player_actions_item.zip',
  light_fire: 'player_actions_item.zip',
  light_fire_pst: 'player_actions_item.zip',
  atk_pre: 'player_attacks.zip',
  atk: 'player_attacks.zip',
  punch: 'player_attacks.zip',
  toolpunch: 'player_attacks.zip',
  staff_pre: 'player_staff.zip',
  staff: 'player_staff.zip',
  bugnet_pre: 'player_actions_bugnet.zip',
  bugnet: 'player_actions_bugnet.zip',
  pickaxe_pre: 'player_actions_pickaxe.zip',
  pickaxe_loop: 'player_actions_pickaxe.zip',
  pickaxe_pst: 'player_actions_pickaxe.zip',
  chop_pre: 'player_actions_axe.zip',
  chop_loop: 'player_actions_axe.zip',
  shovel_pre: 'player_actions_shovel.zip',
  shovel_loop: 'player_actions_shovel.zip',
  shovel_pst: 'player_actions_shovel.zip',
  till_pre: 'player_actions_till.zip',
  till_loop: 'player_actions_till.zip',
  till_pst: 'player_actions_till.zip',
  hit: 'player_actions.zip',
  death: 'player_actions.zip',
  wakeup: 'player_actions.zip',
  strum_pre: 'player_strum.zip',
  strum: 'player_strum.zip',
  fishing: 'player_actions_fishing.zip',
  hideshell: 'player_slurtle_armor.zip',
  hideshell_idle: 'player_slurtle_armor.zip',
  hitshell: 'player_slurtle_armor.zip',
  slip_pre: 'player_slip.zip',
  slip_loop: 'player_slip.zip',
  slip_pst: 'player_slip.zip',
  slip_fall_pre: 'player_slip.zip',
  slip_fall_idle: 'player_slip.zip',
  slip_fall_pst: 'player_slip.zip',
};
/** player_common_extensions.lua AddOverrideBuild, named in the display declaration. */
const UNIQUE_ITEM_BUILD = 'player_actions_uniqueitem';

export interface WilsonAnimationController {
  readonly stategraph: WilsonStateGraph;
  cancelEmote(): void;
  readonly currentEmote: WilsonEmote | null;
  readonly isEmoting: boolean;
  /** The player inst's combat component, read by the attack state. */
  combat?: WilsonCombat;
  playEmote(emote: WilsonEmote): boolean;
  start(state: WilsonMovementState): void;
  playEat(): void;
  /** Inventory searched when a broken tool is replaced by another of the same prefab. */
  bindInventory(inventory: Parameters<typeof equipSamePrefab>[0]): void;
  playItemTransition(state: 'item_in' | 'item_out', item?: WilsonCarryItem): void;
  playPickup(): void;
  playDrop(onDrop: () => boolean, onCancel?: () => void): boolean;
  setCrafting(crafting: boolean): void;
  setCarryItem(item: WilsonCarryItem | null, skinId?: string): void;
  readonly AnimState: AnimState;
  readonly equipmentAssets: GroundItemAssets;
  readonly equipmentContext: EquipmentVisualContext;
  /** SGwilson's unequip event on a hand change; actions read the equipped entity itself as their invobject. */
  setEquippedCarryItem(item: WilsonCarryItem | null): void;
  setHat(itemId: string | null, skinId?: string): void;
  /** Follower:FollowSymbol(owner.GUID, symbol, offsetX, offsetY): a node tracking the symbol, in the player's space. */
  /** `fx` is drawn at the follower by the player's display, which loads its art. */
  followSymbol(symbol: string, offsetX: number, offsetY: number, fx?: FollowerFx): SymbolFollower;
  setBackpack(equipped: boolean, skinId?: string): void;
  /** The application's sleeper services for SGwilson's tent and wakeup states; inst:Hide() / inst:Show() is the player's own sprite. */
  bindSleep(sleep: Omit<WilsonSleepHost, 'setHidden'> | undefined): void;
  /** SGwilson's death state: DropAllItemsForDeath through the application's inventory. */
  bindDeath(death: WilsonDeathHost | undefined): void;
  /** The equipped rod's component for SGwilson's fishing states. */
  bindFishing(fishing: WilsonFishingHost | undefined): void;
  /** SGwilson's amulet_rebirth state: the inventory, HUD and sleepers it reaches (its light is the controller's). */
  bindRebirth(rebirth: Omit<WilsonRebirthHost, 'castLight'> | undefined): void;
  /** AnimState:SetBank("ghost") + skinner ghost_skin + SetStateGraph("SGwilsonghost"); `loading` is inst.loading_ghost. */
  makeGhost(loading?: boolean): void;
  /** player_common_extensions.lua DoActualRez: the living bank and skin, SetStateGraph("SGwilson") and the source's rebirth state (portal_rez, or amulet_rebirth for an amulet). */
  makeAlive(state?: 'portal_rez' | 'amulet_rebirth'): void;
  bindSoulHop(host: Omit<WilsonSoulHopHost, 'setTint' | 'playSound'> | undefined): void;
  readonly isGhost: boolean;
  readonly isSleeping: boolean;
  wakeFromBed(): void;
  goToWakeup(): void;
  update(dt: number): void;
}

export type PlayerBody = CANNON.Body & { canJump: boolean };

export interface WilsonPlayerPrefab {
  /** inst.Physics: player_common.lua MakeCharacterPhysics(inst, 75, .5), swapped for ghost physics on death. */
  physics: PhysicsState;
  /** The bound body the movement and stategraphs drive. */
  body: PlayerBody;
  readonly instance: WilsonPlayerInstance;
  readonly display: PrefabDisplay;
  model: PlayerModel;
}

export type PlayerModel = THREE.Group;

/** Player-owned state kept on the logical inst, including the movement facts read by SGwilson. */
export interface WilsonPlayerInstance extends PrefabInstance {
  readonly stats: PlayerStats;
  readonly components: PrefabInstance['components'] & {
    inventory?: import('@dontstarve-web/inventory').InventoryStore;
    sanity?: import('../../componets/src/sanity').Sanity;
  };
  animationController: WilsonAnimationController;
  controllerEnabled: boolean;
  locomotor?: { stop(): void };
  runSpeed: number;
  motorSpeed?: number;
  currentMotorSpeed: number;
  wantsToMoveForward: boolean;
  worldHeading: number;
  slipperyfeet?: SlipperyFeet;
  wortox?: import('./wortox').Wortox;
}

export function wilsonPlayerInstance(model: THREE.Object3D): WilsonPlayerInstance {
  const instance = prefabInstance(model);
  if (!instance || instance.prefab !== PLAYER_ART_CHARACTER) throw new Error('Expected a Wilson player instance');
  return instance as WilsonPlayerInstance;
}

export interface WilsonPlayerPrefabOptions {
  /** The owner's authoritative sanity ratio; standalone previews default to full sanity. */
  sanityPercent?: ReadonlySignal<number>;
  stats?: PlayerStatsSave;
  scheduler?: GameTimeScheduler;
  componentUpdates?: ComponentUpdates;
}

interface ActiveEmote {
  id: WilsonEmote;
  archive: string;
  props: boolean;
  clips: readonly string[];
  loop: boolean;
}

class WilsonController implements WilsonAnimationController {
  readonly stategraph: WilsonStateGraph;
  private state: WilsonAnimationKey = 'idle';
  private carryKey = '';
  readonly equipmentAssets: GroundItemAssets;
  readonly equipmentContext: EquipmentVisualContext;
  /** inst.AnimState: the player's own declaration, beneath the slots its equipped items declare. */
  readonly AnimState: AnimState;
  private handVisual?: ReturnType<typeof wornEquipmentLifecycle>;
  private readonly castingLight: StaffCastingLight;
  private makeSound?: SoundHandle;
  private makeSoundActive = false;
  private shaveSound?: SoundHandle;
  /** The player inst's combat component, read by the attack state. */
  combat?: WilsonCombat;
  private readonly instance: WilsonPlayerInstance;
  private readonly fxScheduler = new GameTimeScheduler();
  private readonly cleanups: (() => void)[] = [];
  private disposed = false;
  private artSource?: NamedSpriteArt;
  private readonly resources: SpriteResources;
  private soulHopHost?: WilsonSoulHopHost;
  private readonly portalSounds = new Set<SoundHandle>();
  private readonly hatAssets: HatEquipmentAssets;
  private headVisual?: ReturnType<typeof wornEquipmentLifecycle>;
  private hatKey = '';
  private bodyVisual?: ReturnType<typeof wornEquipmentLifecycle>;
  private backpackKey = '';
  private emote: ActiveEmote | null = null;
  readonly bookFx: BookFxController;
  private sleepHost?: WilsonSleepHost;
  private deathHost?: WilsonDeathHost;
  private rebirthHost?: WilsonRebirthHost;
  private fishingHost?: WilsonFishingHost;
  private readonly namedSounds = new Map<string, SoundHandle>();
  private inventory?: Parameters<typeof equipSamePrefab>[0];

  constructor(
    instance: WilsonPlayerInstance,
    assetBaseUrl: string,
    resources: SpriteResources,
    sanityPercent?: ReadonlySignal<number>,
  ) {
    this.instance = instance;
    this.resources = resources;
    this.equipmentAssets = new GroundItemAssets();
    // The sprite holds the AnimState's own json signal; the player's display follows it and loads the builds it names from the equipment assets.
    this.AnimState = new AnimState();
    instance.sprite.setAnimState(this.AnimState.json, this.equipmentAssets);
    for (const layer of ['ARM_carry', 'LANTERN_OVERLAY', 'HAT', 'HAIR_HAT', 'HEAD_HAT', 'HEAD_HAT_NOHELM', 'HEAD_HAT_HELM']) this.AnimState.Hide(layer);
    this.castingLight = new StaffCastingLight(instance);
    this.hatAssets = new HatEquipmentAssets(assetBaseUrl);

    this.equipmentContext = { owner: instance, sprite: { sprite: instance.sprite, art: this.equipmentAssets }, assets: this.equipmentAssets, hats: this.hatAssets, lightParent: instance, sanityPercent };
    this.bookFx = new BookFxController(instance, this.fxScheduler, resources);
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
        setInvincible: invincible => { instance.components.health!.SetInvincible(invincible); },
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
      },
      setCasting: (casting, colour) => {
        if (casting) this.castingLight.start(colour);
        else this.castingLight.stop();
      },
      setControllerEnabled: enabled => { instance.controllerEnabled = enabled; },
      stopMovement: () => instance.locomotor?.stop(),
      pushPlayerEvent: (name, data) => instance.PushEvent(name, data),
      slip: {
        runSpeed: () => instance.runSpeed,
        setMotorSpeed: speed => { instance.motorSpeed = speed; },
        resetSlipperiness: () => instance.slipperyfeet?.SetCurrent(0),
        wantsToMoveForward: () => instance.wantsToMoveForward,
        playSound: (event, volume) => {
          const handle = PlaySound(event === 'hurt' ? 'dontstarve/characters/wilson/hurt' : `dontstarve/movement/${event}`);
          if (volume !== undefined) handle.setVolume(volume);
        },
      },
      equipSamePrefab: (prefab) => this.inventory !== undefined && equipSamePrefab(this.inventory, prefab),
      onStateChanged: (name) => {
        if (name !== 'emote') this.emote = null;
        // stategraph.lua pushes "newstate" to the inst; armorsnurtleshell's ProtectionLevels listens for it.
        instance.PushEvent('newstate', { statename: name });
      },
    });
  }

  start(state: WilsonMovementState) {
    if (state !== 'idle' && this.isEmoting) this.cancelEmote();
    this.stategraph.requestMovement(state);
  }

  /** Inventory searched when a broken tool is replaced by another of the same prefab. */
  bindInventory(inventory: Parameters<typeof equipSamePrefab>[0]): void { this.inventory = inventory; }

  playEat() {
    this.startOneShot('eat');
  }

  /** ACTIONS.DROP: doshortaction performs the drop on its frame 6; onCancel runs if the action never performs. */
  playDrop(onDrop: () => boolean, onCancel?: () => void): boolean {
    if (this.stategraph.hasStateTag('busy')) return false;
    this.cancelEmote();
    const action = new BufferedAction<WilsonAction>('DROP', onDrop);
    const stop = this.stategraph.listenForEvent('actionfailed', data => {
      if ((data as { action?: unknown } | undefined)?.action === action) { stop(); onCancel?.(); }
    });
    action.addSuccessAction(stop);
    if (this.stategraph.pushBufferedAction(action)) return true;
    stop();
    return false;
  }
  /** The application's sleeper services for SGwilson's tent and wakeup states. */
  bindSleep(sleep: Omit<WilsonSleepHost, 'setHidden'> | undefined): void {
    const { sprite } = this.instance;
    // A sleeper unbound while hidden in its bed (scene teardown) is shown again, as the tent state's onexit would.
    if (!sleep && this.sleepHost && this.stategraph.hasStateTag('sleeping')) sprite.setVisible(true);
    // SGwilson.lua tent: inst:Hide() / inst:Show() with the DynamicShadow, declared on the sprite for the player's display.
    this.sleepHost = sleep && Object.assign(Object.create(sleep) as WilsonSleepHost,
      { setHidden: (hidden: boolean) => sprite.setVisible(!hidden) });
  }
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
        const sound = PlaySound(event as SoundEventPath, this.instance.position);
        sound.setVolume(volume);
        this.portalSounds.add(sound);
      },
    };
  }

  get isGhost(): boolean { return this.stategraph.isGhost; }

  makeGhost(loading = false): void {
    if (this.isGhost) return;
    this.cancelEmote();
    this.stategraph.becomeGhost(loading);
  }

  makeAlive(state: 'portal_rez' | 'amulet_rebirth' = 'portal_rez'): void {
    if (!this.isGhost) return;
    this.stategraph.becomeAlive(state);
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

  get currentEmote(): WilsonEmote | null { return this.emote?.id ?? null; }
  get isEmoting(): boolean { return this.emote !== null; }

  playEmote(id: WilsonEmote): boolean {
    const definition: WilsonEmoteDefinition | undefined = WILSON_EMOTES[id];
    if (!definition || !this.stategraph.canEmote()) return false;
    this.cancelEmote();
    this.emote = {
      id, archive: definition.archive, props: definition.props === true,
      clips: definition.variants[Math.floor(Math.random() * definition.variants.length)],
      loop: definition.loop === true,
    };
    if (!this.stategraph.requestEmote(this.emote.clips, this.emote.loop)) {
      this.emote = null;
      return false;
    }
    return true;
  }

  cancelEmote(): void {
    this.stategraph.cancelEmote();
    this.emote = null;
  }

  playItemTransition(state: 'item_in' | 'item_out') {
    if (this.stategraph.isDead) return;
    this.startOneShot(state);
  }

  playPickup() {
    this.startOneShot('pickup');
  }

  setCrafting(crafting: boolean) {
    if (crafting) this.cancelEmote();
    this.stategraph.requestCrafting(crafting);
  }

  setEquippedCarryItem(): void {
    this.stategraph.pushEvent('unequip');
  }

  /** Standalone preview adapter: use the same prefab equip/unequip functions as live inventory. */
  setCarryItem(item: WilsonCarryItem | null, skinId?: string): void {
    const key = item === null ? '' : `${item}:${skinId ?? ''}`;
    if (key === this.carryKey) return;
    this.carryKey = key;
    this.handVisual?.onunequip(); this.handVisual = undefined;
    this.setEquippedCarryItem();
    if (!item) return;
    this.handVisual = wornEquipmentLifecycle(getHandEquipmentDefinition(item)!.definition.visual({ id: 'preview:hand', prefab: item, skinId }), this.equipmentContext);
    this.handVisual.onequip();
  }

  setHat(itemId: string | null, skinId?: string): void {
    const key = itemId === null ? '' : `${itemId}:${skinId ?? ''}`;
    if (key === this.hatKey) return;
    this.hatKey = key;
    this.headVisual?.onunequip(); this.headVisual = undefined;
    if (!itemId) return;
    this.headVisual = wornEquipmentLifecycle(hatVisual({ id: 'preview:head', prefab: itemId, skinId }, this.equipmentContext), this.equipmentContext);
    this.headVisual.onequip();
  }

  setBackpack(equipped: boolean, skinId?: string): void {
    const key = equipped ? `backpack:${skinId ?? ''}` : '';
    if (key === this.backpackKey) return;
    this.backpackKey = key;
    this.bodyVisual?.onunequip(); this.bodyVisual = undefined;
    if (!equipped) return;
    this.bodyVisual = wornEquipmentLifecycle(backpackVisual({ id: 'preview:body', prefab: 'backpack', skinId }), this.equipmentContext);
    this.bodyVisual.onequip();
  }

  followSymbol(symbol: string, offsetX: number, offsetY: number, fx?: FollowerFx): SymbolFollower {
    return this.instance.sprite.followSymbol(symbol, offsetX, offsetY, fx);
  }

  update(dt: number): void {
    if (this.disposed) return;
    const step = Math.max(0, Math.min(dt, 0.1));
    this.fxScheduler.advance(step);
    this.stategraph.update(step);
    this.castingLight.update(step);
  }

  private selectAnimation(clip: WilsonAnimationClip): number {
    this.state = clip.key;
    const archive = this.state === 'ghost' ? 'player_ghost_withhat.zip' : this.state === 'emote' ? this.emote!.archive
      : this.state === 'amulet_rebirth' ? 'player_amulet_resurrect.zip'
      : this.state === 'action_uniqueitem_pre' || this.state === 'book' || this.state === 'flute' ? `${UNIQUE_ITEM_BUILD}.zip`
        : WILSON_ANIMATION_ARCHIVES[this.state];
    const bank = this.state === 'ghost' ? 'ghost' : 'wilson';
    const animation = animationTiming(archive, clip.name, smallHash(bank));
    const playbackRate = (clip.frameRate ?? animation.frameRate) / animation.frameRate * (clip.playbackRate ?? 1);
    this.instance.sprite.setPlaybackRate(playbackRate);
    const buildArchive = this.state === 'ghost' ? `dynamic/ghost_${PLAYER_ART_CHARACTER}_build.zip` : `dynamic/${PLAYER_ART_CHARACTER}.zip`;
    const fallbackBuilds = [`${UNIQUE_ITEM_BUILD}.zip`, ...(this.emote?.props ? [this.emote.archive] : [])];
    if (!this.artSource || this.artSource.animationArchive !== archive || this.artSource.buildArchive !== buildArchive
      || fallbackBuilds.join() !== this.artSource.fallbackBuilds?.join()) {
      this.artSource = { animationArchive: archive, bank, buildArchive, fallbackBuilds, art: this.resources.archives };
      this.instance.sprite.setArtSource(this.artSource);
    }
    if (clip.loop) this.instance.sprite.start(clip.name); else this.instance.sprite.playOnce(clip.name);
    if (this.makeSoundActive && this.state === 'build_loop') {
      this.makeSound?.stop();
      this.makeSound = PlaySound('dontstarve/wilson/make_trap');
    }
    return animation.frames / (animation.frameRate * playbackRate);
  }

  private startOneShot(state: WilsonOneShotState) {
    this.cancelEmote();
    this.stategraph.requestOneShot(state);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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
    this.resources.dispose();
  }
}

function createWilsonPlayerEntity(
  assetBaseUrl: string,
  options: WilsonPlayerPrefabOptions = {},
): { model: PlayerModel; instance: WilsonPlayerInstance; display: PrefabDisplay } {
  const resources = new SpriteResources(assetBaseUrl);
  const archives = [...new Set([...Object.values(WILSON_ANIMATION_ARCHIVES), `${UNIQUE_ITEM_BUILD}.zip`,
    'player_ghost_withhat.zip', 'player_amulet_resurrect.zip', ...Object.values(WILSON_EMOTES).map(definition => definition.archive)])];
  const { instance: baseInstance, display } = createPrefabEntity(PLAYER_ART_CHARACTER, resources.factory({
    buildArchive: `dynamic/${PLAYER_ART_CHARACTER}.zip`, animationArchive: 'player_idles.zip',
    extraAnimationArchives: archives.filter(archive => archive !== 'player_idles.zip'),
  }), { name: 'idle_loop', billboard: true }, 'Wortox', instance => {
    instance.sprite.setArtSource({ animationArchive: 'player_idles.zip', bank: 'wilson',
      buildArchive: `dynamic/${PLAYER_ART_CHARACTER}.zip`, fallbackBuilds: [`${UNIQUE_ITEM_BUILD}.zip`], art: resources.archives });
    instance.sprite.setFacingRotation(0, 4);
  });
  const instance = Object.assign(baseInstance, {
    stats: createPlayerStats(baseInstance, options.stats, options.scheduler),
    controllerEnabled: true, runSpeed: 0, currentMotorSpeed: 0, wantsToMoveForward: false, worldHeading: 0,
  }) as WilsonPlayerInstance;
  const player = display.model;
  const stopSanity = options.componentUpdates?.register(instance.stats.sanity);
  if (stopSanity) instance.onRemove(stopSanity);
  instance.minimap.SetIcon(`${PLAYER_ART_CHARACTER}.png`);
  instance.minimap.SetPriority(10);
  instance.minimap.SetCanUseCache(false);
  instance.minimap.SetDrawOverFogOfWar(true);
  // player_common.lua's common tags; upgrades.lua uses these exact upgrade type names.
  for (const tag of ['player', 'scarytoprey', 'character', 'lightningtarget', 'waterplant_upgradeuser', 'mast_upgradeuser',
    'chest_upgradeuser', 'usesvegetarianequipment', 'ghostlyelixirable', 'trader', 'debuffable', 'stageactor',
    'playermonster', 'monster', 'soulstealer', 'souleater']) instance.addTag(tag);
  player.position.set(0, 30, 0);
  actionEntity(player, PLAYER_ART_CHARACTER);

  const controller = new WilsonController(instance, assetBaseUrl, resources,
    options.sanityPercent ?? (options.stats ? instance.stats.sanity.percent : undefined));
  const stopDeath = instance.ListenForEvent('death', data => controller.stategraph.pushEvent('death', data));
  instance.onRemove(() => { stopDeath(); controller.dispose(); disposeActionEntity(player); });
  display.onDispose(() => controller.releaseAssets());
  display.update(0);
  instance.animationController = controller;
  instance.sg = controller.stategraph as never;
  return { model: player, instance, display };
}

export function createWilsonPlayer(assetBaseUrl: string, options: WilsonPlayerPrefabOptions = {}): PlayerModel {
  return createWilsonPlayerEntity(assetBaseUrl, options).model;
}

/** player_common.lua: MakeCharacterPhysics(inst, 75, .5), in DST units. */
export const PLAYER_PHYSICS_RADIUS = 0.5;
/** The player's collider radius in world units; UI anchored to the player scales from this. */
export const PLAYER_COLLIDER_RADIUS = PLAYER_PHYSICS_RADIUS * WORLD_SCALE;

/** `world` receives the player's body; Physics:Teleport after moving the model places it there. */
export function createWilsonPlayerPrefab(
  assetBaseUrl: string,
  world: CANNON.World,
  options: WilsonPlayerPrefabOptions = {},
): WilsonPlayerPrefab {
  const { model, instance: entity, display } = createWilsonPlayerEntity(assetBaseUrl, options);
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
    instance: entity,
    display,
    model,
  };
}
