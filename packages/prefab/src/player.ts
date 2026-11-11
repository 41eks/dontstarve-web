import { addComponent, removeComponent } from './components';
import { smallHash } from '@dontstarve-web/animation/animationAssets';
import { SpriteResources, SpriteState, type NamedSpriteArt, type FollowerFx, type PrefabDisplay } from '@dontstarve-web/display';
import { clockstate, createMemo, createSignal, readonlySignal, type ReadonlySignal } from '@dontstarve-web/signals';
import { BufferedAction, WilsonStateGraph, type WilsonAction, type WilsonAnimationClip, type WilsonCombat, type WilsonFishingHost, type WilsonMovementState, type WilsonOneShotState, type WilsonSleepHost, type WilsonSleepAnnounce, type WilsonDeathHost, type WilsonStateGraphHost, type WilsonStateName } from '@dontstarve-web/stategraphs';
import type * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { AxeTool } from './axe';
import { BookFxController } from './book_fx';
import { bankAnimationTiming } from './animationTimings';
import { WILSON_EMOTES, type WilsonEmote, type WilsonEmoteDefinition } from './emotes';
import type { EquipmentPresentation } from './equipmentVisual';
import type { FarmHoeTool } from './farm_hoe';
import { GroundItemAssets } from './groundItems';
import { HatEquipmentAssets } from './hats';
import type { PickaxeTool } from './pickaxe';
import type { PitchforkTool } from './pitchfork';
import { createPlayerStats, equipSamePrefab, OnMakePlayerGhost, OnRespawnFromGhost, type PlayerStats, type PlayerStatsSave, type RezSource } from './player_common';
import type { ShovelTool } from './shovel';
import type { SoundEmitter } from './soundEmitter';
import { MakeCharacterPhysics, WORLD_SCALE } from './standardcomponents';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { PhysicsState } from '../../componets/src/physicsState';
import { registerActionEntity, disposeActionEntity } from './actionEntity';
import { createPrefabEntity, PrefabInstance, prefabInstance, type EntityTask } from './prefabInstance';
import { Builder, type BuilderWorld } from '../../componets/src/builder';
import type { WilsonSoulHopHost } from '../../stategraphs/src/SGwilson';
import { STAFF_CASTINGLIGHT_ID, type StaffCastingLightInstance } from './staff_castinglight';
import type { SlipperyFeet } from '../../componets/src/slipperyfeet';
import type { ComponentUpdates } from '../../componets/src/componentUpdates';
import { SleepingBagUser } from '../../componets/src/sleepingbaguser';

/** skinprefabs.lua wortox_none: normal_skin = wortox, ghost_skin = ghost_wortox_build. */
export const PLAYER_ART_CHARACTER = 'wortox' as const;

/** player_common.lua AddComponent("builder"); the scene supplies spatial queries. */
export function bindPlayerBuilder(model: THREE.Group, world: Omit<BuilderWorld, 'researchMachineDistance'>): Builder {
  const inst = prefabInstance(model)!;
  registerActionEntity(inst);
  removeComponent(inst, 'builder');
  return addComponent(inst, 'builder', Builder, { ...world, researchMachineDistance: 4 * WORLD_SCALE });
}
export interface SymbolFollower {
  readonly node: THREE.Object3D;
  remove(): void;
}

export type WilsonCarryItem = 'torch' | 'lantern' | 'yellowstaff' | 'opalstaff' | 'greenstaff' | 'firestaff' | 'trident' | 'bugnet' | 'fishingrod' | 'hammer' | 'nightsword' | 'reskin_tool' | PickaxeTool | AxeTool | PitchforkTool | FarmHoeTool | ShovelTool;
/** player_common_extensions.lua AddOverrideBuild, named in the display declaration. */
const UNIQUE_ITEM_BUILD = 'player_actions_uniqueitem';
/**
 * The ANIM assets MakePlayerCharacter, global.lua (player_idles) and wortox.lua declare for the player, plus the emotes':
 * AnimState:PlayAnimation finds each clip of the current bank in whichever of them holds it.
 */
const PLAYER_ANIMATION_ARCHIVES: readonly string[] = [...new Set([
  'player_idles.zip', 'player_basic.zip', 'player_actions.zip', 'player_actions_axe.zip', 'player_actions_pickaxe.zip',
  'player_actions_shovel.zip', 'player_actions_eat.zip', 'player_actions_item.zip', 'player_actions_uniqueitem.zip',
  'player_actions_bugnet.zip', 'player_actions_fishing.zip', 'player_actions_till.zip', 'player_attacks.zip',
  'player_jump.zip', 'player_amulet_resurrect.zip', 'player_slurtle_armor.zip', 'player_staff.zip', 'player_strum.zip',
  'player_slip.zip', 'player_ghost_withhat.zip', 'wortox_portal.zip', ...Object.values(WILSON_EMOTES).map(definition => definition.archive),
])];
/** STRINGS.CHARACTERS.WORTOX: GetString(inst, failreason) for SGwilson's tent refusals. */
const WORTOX_SLEEP_SPEECH: Record<WilsonSleepAnnounce, string> = {
  ANNOUNCE_NODAYSLEEP: '我不要打乱规律的作息时间。',
  ANNOUNCE_NONIGHTSIESTA: '我这么有荣誉感，怎么会在夜晚小憩呢。',
  ANNOUNCE_NOSLEEPONFIRE: '莫要烧焦了我的皮草。',
  ANNOUNCE_NOHUNGERSLEEP: '灵魂过度饥饿，难以入眠。',
};

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

interface ActiveEmote {
  id: WilsonEmote;
  archive: string;
  props: boolean;
  clips: readonly string[];
  loop: boolean;
}

/**
 * The player inst: the fields player_common.lua and SGwilson keep on it, assigned in createWilsonPlayerEntity (fn).
 * Its behaviour is the module functions below, each taking the inst first.
 */
export class WilsonPlayerInstance extends PrefabInstance {
  /** player_common.lua fn: inst.entity:AddSoundEmitter(). */
  declare SoundEmitter: SoundEmitter;
  declare readonly components: PrefabInstance['components'] & {
    inventory?: import('@dontstarve-web/inventory').InventoryStore;
    sanity?: import('../../componets/src/sanity').Sanity;
    /** The input's action picker: the ghost pushes and pops its action filter on it. */
    playeractionpicker?: Pick<import('../../stategraphs/src/playeractionpicker').PlayerActionPicker, 'PushActionFilter' | 'PopActionFilter'>;
    /** player_common.lua master_postinit AddComponent("sleepingbaguser"), on game time. */
    sleepingbaguser?: SleepingBagUser;
  };
  /** inst:SetStateGraph("SGwilson"). */
  declare sg: WilsonStateGraph;
  stats!: PlayerStats;
  controllerEnabled = true;
  locomotor?: { stop(): void };
  runSpeed = 0;
  motorSpeed?: number;
  currentMotorSpeed = 0;
  wantsToMoveForward = false;
  worldHeading = 0;
  slipperyfeet?: SlipperyFeet;
  wortox?: import('./wortox').Wortox;
  /** The game-time scheduler inst:DoTaskInTime runs on. */
  scheduler?: GameTimeScheduler;
  /** player_classified isghostmode (SetGhostMode): playervision's ghost colour cube, and the ghost's save flag. */
  readonly ghostMode = createSignal(false);
  /** player_common.lua OnPlayerDeath: inst.deathcause, for the skeleton's description. */
  deathcause = 'unknown';
  /** SpawnPrefab: the scene's registry, for what the player's states and death spawn. */
  SpawnPrefab?: (prefab: string, position: THREE.Vector3) => PrefabInstance | undefined;
  /** inst.HUD, set by the front end while the player has one. */
  HUD?: {
    Show(): void; Hide(): void;
    /** HUD.controls: inventory:Hide() / Show() hide and show crafting and the inventory bar. */
    controls?: { HideCraftingAndInventory(): void; ShowCraftingAndInventory(): void };
  };
  /** bernie_active.lua / berniebigbrain.lua: the big Bernies this player leads, and the brief block after one grows. */
  bigbernies?: Set<object>;
  blockbigbernies?: EntityTask;
  /** inst:ShowHUD(show) */
  ShowHUD!: (show: boolean) => void;
  /** The player inst's combat component, read by the attack state. */
  combat?: WilsonCombat;
  /** The emote SGwilson's emote state is playing, with the art it was chosen with. */
  emote: ActiveEmote | null = null;
  /** The bank and builds the player is drawn with: SetBank / SetBuild and the skinner's ghost build. */
  artSource?: NamedSpriteArt;
  /** The archive and dynamic builds the player's display loads. */
  resources!: SpriteResources;
  /** What the player draws its equipment with; the player's OpenEquipmentView gives each equipped inst a slot of it. */
  equipmentAssets!: GroundItemAssets;
  hatAssets!: HatEquipmentAssets;
  equipmentPresentation!: EquipmentPresentation;
  /** The book reading FX the player's states spawn, on their own frame clock. */
  bookFx!: BookFxController;
  fxScheduler!: GameTimeScheduler;
  /** SGwilson's soul hop, death and fishing reach the application through these while they are bound. */
  soulHopHost?: WilsonSoulHopHost;
  deathHost?: WilsonDeathHost;
  fishingHost?: WilsonFishingHost;
  sleepHost?: WilsonSleepHost;
}

export function wilsonPlayerInstance(model: THREE.Object3D): WilsonPlayerInstance {
  const instance = prefabInstance(model);
  if (!(instance instanceof WilsonPlayerInstance)) throw new Error('Expected a Wilson player instance');
  return instance;
}

export interface WilsonPlayerPrefabOptions {
  /** The owner's authoritative sanity ratio; standalone previews default to full sanity. */
  sanityPercent?: ReadonlySignal<number>;
  stats?: PlayerStatsSave;
  scheduler?: GameTimeScheduler;
  componentUpdates?: ComponentUpdates;
}

/** player_common.lua fns.ShowHUD, assigned to inst.ShowHUD in master_postinit. */
function ShowHUD(inst: WilsonPlayerInstance, show: boolean): void {
  if (show) inst.HUD?.Show(); else inst.HUD?.Hide();
}

/** Movement input: walking or running cancels an emote. */
export function startMovement(inst: WilsonPlayerInstance, state: WilsonMovementState): void {
  if (state !== 'idle' && inst.emote !== null) cancelEmote(inst);
  inst.sg.requestMovement(state);
}

function startOneShot(inst: WilsonPlayerInstance, state: WilsonOneShotState): void {
  cancelEmote(inst);
  inst.sg.requestOneShot(state);
}

export function playEat(inst: WilsonPlayerInstance): void { startOneShot(inst, 'eat'); }
export function playPickup(inst: WilsonPlayerInstance): void { startOneShot(inst, 'pickup'); }

/** ACTIONS.DROP: doshortaction performs the drop on its frame 6; onCancel runs if the action never performs. */
export function playDrop(inst: WilsonPlayerInstance, onDrop: () => boolean, onCancel?: () => void): boolean {
  if (inst.sg.hasStateTag('busy')) return false;
  cancelEmote(inst);
  const action = new BufferedAction<WilsonAction>('DROP', onDrop);
  const stop = inst.sg.listenForEvent('actionfailed', data => {
    if ((data as { action?: unknown } | undefined)?.action === action) { stop(); onCancel?.(); }
  });
  action.addSuccessAction(stop);
  if (inst.sg.pushBufferedAction(action)) return true;
  stop();
  return false;
}

export function setCrafting(inst: WilsonPlayerInstance, crafting: boolean): void {
  if (crafting) cancelEmote(inst);
  inst.sg.requestCrafting(crafting);
}

/** Wortox's soul hop while its skill is bound; unbinding cancels a pending hop and clears the portal tint. */
export function bindSoulHop(inst: WilsonPlayerInstance, host: Omit<WilsonSoulHopHost, 'setTint'> | undefined): void {
  if (!host) {
    inst.sg.cancelAction('BLINK');
    inst.sg.cancelAction('BLINK_MAP');
    setTint(inst, 0);
  }
  inst.soulHopHost = host && { ...host, setTint: value => setTint(inst, value) };
}

/** AnimState:SetBank("ghost") + skinner ghost_skin + SetStateGraph("SGwilsonghost"); `loading` is inst.loading_ghost. */
export function makeGhost(inst: WilsonPlayerInstance, loading = false): void {
  if (inst.sg.isGhost) return;
  cancelEmote(inst);
  inst.sg.becomeGhost(loading);
}

/** player_common_extensions.lua DoActualRez: the living bank and skin, SetStateGraph("SGwilson") and the source's rebirth state. */
export function makeAlive(inst: WilsonPlayerInstance, state: 'portal_rez' | 'amulet_rebirth' = 'portal_rez'): void {
  if (!inst.sg.isGhost) return;
  inst.sg.becomeAlive(state);
}

/** Character colour and Wortox's additive portal tint are per-instance appearance declarations. */
function setMultColour(inst: WilsonPlayerInstance, r: number, g: number, b: number): void { inst.sprite.setColour([r, g, b]); }
function setTint(inst: WilsonPlayerInstance, amount: number): void { inst.sprite.setTint({ colour: [154 / 255, 23 / 255, 19 / 255], amount }); }

/** Movement input while asleep: the locomote event wakes the sleeper. */
export function wakeFromBed(inst: WilsonPlayerInstance): void { inst.sg.pushLocomote(); }

export function playEmote(inst: WilsonPlayerInstance, id: WilsonEmote): boolean {
  const definition: WilsonEmoteDefinition | undefined = WILSON_EMOTES[id];
  if (!definition || !inst.sg.canEmote()) return false;
  cancelEmote(inst);
  inst.emote = {
    id, archive: definition.archive, props: definition.props === true,
    clips: definition.variants[Math.floor(Math.random() * definition.variants.length)],
    loop: definition.loop === true,
  };
  if (!inst.sg.requestEmote(inst.emote.clips, inst.emote.loop)) {
    inst.emote = null;
    return false;
  }
  return true;
}

export function cancelEmote(inst: WilsonPlayerInstance): void {
  inst.sg.cancelEmote();
  inst.emote = null;
}

/** Follower:FollowSymbol(owner.GUID, symbol, offsetX, offsetY): a node tracking the symbol, in the player's space; `fx` is drawn there. */
export function followSymbol(inst: WilsonPlayerInstance, symbol: string, offsetX: number, offsetY: number, fx?: FollowerFx): SymbolFollower {
  return inst.sprite.followSymbol(symbol, offsetX, offsetY, fx);
}

/** One frame of the player's stategraph and its FX clock. */
export function updatePlayer(inst: WilsonPlayerInstance, dt: number): void {
  if (inst.isRemoved) return;
  const step = Math.max(0, Math.min(dt, 0.1));
  inst.fxScheduler.advance(step);
  inst.sg.update(step);
}

/** Select the clip's art (SetBank and the ghost build) and play it; returns its playback length in seconds. */
function selectAnimation(inst: WilsonPlayerInstance, clip: WilsonAnimationClip): number {
  // SetBank("ghost") with the skinner's ghost build while a ghost; the clip is in whichever declared anim holds it.
  const ghost = clip.key === 'ghost';
  const bank = ghost ? 'ghost' : 'wilson';
  const animation = bankAnimationTiming(PLAYER_ANIMATION_ARCHIVES, clip.name, smallHash(bank));
  const playbackRate = (clip.frameRate ?? animation.frameRate) / animation.frameRate * (clip.playbackRate ?? 1);
  inst.sprite.setPlaybackRate(playbackRate);
  const buildArchive = ghost ? `dynamic/ghost_${PLAYER_ART_CHARACTER}_build.zip` : `dynamic/${PLAYER_ART_CHARACTER}.zip`;
  const fallbackBuilds = [`${UNIQUE_ITEM_BUILD}.zip`, ...(inst.emote?.props ? [inst.emote.archive] : [])];
  const current = inst.artSource;
  if (!current || current.bank !== bank || current.buildArchive !== buildArchive || fallbackBuilds.join() !== current.fallbackBuilds?.join()) {
    inst.artSource = { animationArchives: PLAYER_ANIMATION_ARCHIVES, bank, buildArchive, fallbackBuilds, art: inst.resources.archives };
    inst.sprite.setArtSource(inst.artSource);
  }
  inst.AnimState.PlayAnimation(clip.name, clip.loop);
  return animation.frames / (animation.frameRate * playbackRate);
}

/** SGwilson.lua amulet_rebirth: consume the equipped red amulet. */
function consumeEquippedAmulet(inst: WilsonPlayerInstance): boolean {
  const inventory = inst.components.inventory, item = inventory?.GetEquippedItem('body');
  if (!inventory || item?.prefab !== 'amulet') return false;
  const removed = inventory.RemoveItem(item);
  if (!removed) return false;
  removed.remove();
  return true;
}

/** SGwilson.lua amulet_rebirth: the sleepers around the player go to sleep for `seconds`. */
function sleepNearby(inst: WilsonPlayerInstance, radius: number, seconds: number): void {
  for (const v of inst.TheSim.FindEntities(inst.position, radius * WORLD_SCALE)) {
    if (v !== inst) (v.components as { sleeper?: { GoToSleep(seconds: number): void } }).sleeper?.GoToSleep(seconds);
  }
}

/** SpawnPrefab("staff_castinglight") at the player with SetUp(colour, duration, delay). */
function castLight(inst: WilsonPlayerInstance, colour: readonly [number, number, number], duration: number, delay: number) {
  const light = inst.SpawnPrefab?.(STAFF_CASTINGLIGHT_ID, inst.position.clone()) as StaffCastingLightInstance | undefined;
  light?.SetUp(colour, duration, delay);
  return light;
}

/** SetSleeperSleepState / SetSleeperAwakeState: playercontroller:Enable and inventory:Hide / Show. */
function setSleeperState(inst: WilsonPlayerInstance, sleeping: boolean): void {
  // OnSleepIn / OnWakeUp's hand and active item stashing is not ported.
  inst.controllerEnabled = !sleeping;
  if (sleeping) inst.HUD?.controls?.HideCraftingAndInventory();
  else inst.HUD?.controls?.ShowCraftingAndInventory();
}

/** stategraph.lua pushes "newstate" to the inst; armorsnurtleshell's ProtectionLevels listens for it. */
function onStateChanged(inst: WilsonPlayerInstance, name: WilsonStateName): void {
  if (name !== 'emote') inst.emote = null;
  inst.PushEvent('newstate', { statename: name });
}

/** player_common.lua OnPlayerDeath: inst.deathcause. */
function OnPlayerDeath(inst: WilsonPlayerInstance, data: unknown): void {
  inst.deathcause = (data as { cause?: string } | undefined)?.cause ?? 'unknown';
}

/** OnRemoveEntity: the stategraph, the book FX and every sound stop with the player. */
function OnRemoveEntity(inst: WilsonPlayerInstance): void {
  inst.sg.dispose();
  inst.bookFx.dispose(); inst.fxScheduler.dispose();
  inst.SoundEmitter.KillAllSounds();
  disposeActionEntity(inst);
}

/** The display's art caches go with the player's display. */
function releasePlayerAssets(inst: WilsonPlayerInstance): void {
  inst.equipmentAssets.dispose(); inst.hatAssets.dispose();
  inst.resources.dispose();
}

/** SGwilson's states reach the player inst through these until the stategraph reads it directly. */
function createStateGraphHost(inst: WilsonPlayerInstance): WilsonStateGraphHost {
  const sleeper = inst.components.sleepingbaguser;
  // SGwilson.lua tent and wakeup on the player inst: its hunger, sleepingbaguser, controller, HUD and talker.
  inst.sleepHost = sleeper && {
    isDay: () => clockstate.peek().phase === 'day',
    hungerCurrent: () => inst.stats.hunger.current,
    get sleepingbag() { return sleeper.bed; },
    setSleeperState: sleeping => setSleeperState(inst, sleeping),
    // inst:Hide() / inst:Show() with the DynamicShadow, declared on the sprite for the player's display.
    setHidden: hidden => inst.sprite.setVisible(!hidden),
    say: announce => inst.components.talker?.Say(WORTOX_SLEEP_SPEECH[announce]),
  };
  return {
    get soulHop() { return inst.soulHopHost; },
    get sleep() { return inst.sleepHost; },
    get death() { return inst.deathHost; },
    get fishing() { return inst.fishingHost; },
    // SGwilson.lua amulet_rebirth on the player inst: its inventory, HUD and the sleepers around it.
    rebirth: {
      consumeEquippedAmulet: () => consumeEquippedAmulet(inst),
      hasBodyItem: () => !!inst.components.inventory?.GetEquippedItem('body'),
      showHUD: show => inst.ShowHUD(show),
      sleepNearby: (radius, seconds) => sleepNearby(inst, radius, seconds),
    },
    rez: {
      setHidden: hidden => inst.sprite.setVisible(!hidden),
      get isHidden() { return !inst.IsVisible(); },
      setMultColour: (r, g, b) => setMultColour(inst, r, g, b),
      setInvincible: invincible => { inst.components.health!.SetInvincible(invincible); },
    },
    playAnimation: clip => selectAnimation(inst, clip),
    getCombat: () => inst.combat,
    spawnFx: (prefab, symbol) => inst.bookFx.spawn(prefab, symbol),
    castLight: (colour, duration, delay) => castLight(inst, colour, duration, delay),
    setControllerEnabled: enabled => { inst.controllerEnabled = enabled; },
    stopMovement: () => inst.locomotor?.stop(),
    slip: {
      runSpeed: () => inst.runSpeed,
      setMotorSpeed: speed => { inst.motorSpeed = speed; },
      resetSlipperiness: () => inst.slipperyfeet?.SetCurrent(0),
      wantsToMoveForward: () => inst.wantsToMoveForward,
    },
    equipSamePrefab: prefab => inst.components.inventory !== undefined && equipSamePrefab(inst.components.inventory, prefab),
    onStateChanged: name => onStateChanged(inst, name),
  };
}

function createWilsonPlayerEntity(
  assetBaseUrl: string,
  options: WilsonPlayerPrefabOptions = {},
): { model: PlayerModel; instance: WilsonPlayerInstance; display: PrefabDisplay } {
  const resources = new SpriteResources(assetBaseUrl);
  const inst = new WilsonPlayerInstance(PLAYER_ART_CHARACTER, new SpriteState({ name: 'idle_loop', billboard: true }));
  const { display } = createPrefabEntity(PLAYER_ART_CHARACTER, resources.factory({
    buildArchive: `dynamic/${PLAYER_ART_CHARACTER}.zip`, animationArchive: PLAYER_ANIMATION_ARCHIVES[0],
    extraAnimationArchives: PLAYER_ANIMATION_ARCHIVES.slice(1),
  }), { name: 'idle_loop', billboard: true, instance: inst }, 'Wortox', () => {
    inst.sprite.setArtSource({ animationArchives: PLAYER_ANIMATION_ARCHIVES, bank: 'wilson',
      buildArchive: `dynamic/${PLAYER_ART_CHARACTER}.zip`, fallbackBuilds: [`${UNIQUE_ITEM_BUILD}.zip`], art: resources.archives });
    inst.sprite.setFacingRotation(0, 4);
  });
  if (options.scheduler) inst.BindScheduler(options.scheduler);
  // player_common.lua fn: inst.entity:AddSoundEmitter(); the listener is at the player.
  inst.AddSoundEmitter({ atListener: true });
  inst.stats = createPlayerStats(inst, options.stats, options.scheduler);
  inst.scheduler = options.scheduler;
  inst.ShowHUD = show => ShowHUD(inst, show);
  inst.resources = resources;
  const player = display.model;
  const stopSanity = options.componentUpdates?.register(inst.stats.sanity);
  if (stopSanity) inst.onRemove(stopSanity);
  if (options.scheduler) {
    // sleepingbaguser.lua: per-tick hunger, sanity and health in a bed; WatchWorldState("phase") wakes at the bed's phase end.
    const phase = createMemo(() => clockstate.get().phase);
    const { hunger, sanity, health } = inst.stats;
    // player_common.lua OnDespawn: the bed releases its sleeper without a state change, before the component's teardown.
    inst.onRemove(() => { inst.components.sleepingbaguser?.bed?.DoWakeUp(true); });
    addComponent(inst, 'sleepingbaguser', SleepingBagUser, {
      scheduler: options.scheduler, phase: readonlySignal(phase), hunger, sanity, health,
      goToWakeup: () => inst.sg.wakeUp(),
    });
    inst.onRemove(() => phase.dispose());
  }
  inst.minimap.SetIcon(`${PLAYER_ART_CHARACTER}.png`);
  inst.minimap.SetPriority(10);
  inst.minimap.SetCanUseCache(false);
  inst.minimap.SetDrawOverFogOfWar(true);
  // player_common.lua's common tags; upgrades.lua uses these exact upgrade type names.
  for (const tag of ['player', 'scarytoprey', 'character', 'lightningtarget', 'waterplant_upgradeuser', 'mast_upgradeuser',
    'chest_upgradeuser', 'usesvegetarianequipment', 'ghostlyelixirable', 'trader', 'debuffable', 'stageactor',
    'playermonster', 'monster', 'soulstealer', 'souleater']) inst.addTag(tag);
  player.position.set(0, 30, 0);
  registerActionEntity(inst);

  // The player's own AnimState declaration, beneath the slots its equipped items declare; the display loads the builds it names.
  inst.equipmentAssets = new GroundItemAssets();
  inst.sprite.setAnimState(inst.AnimState.json, inst.equipmentAssets);
  for (const layer of ['ARM_carry', 'LANTERN_OVERLAY', 'HAT', 'HAIR_HAT', 'HEAD_HAT', 'HEAD_HAT_NOHELM', 'HEAD_HAT_HELM']) inst.AnimState.Hide(layer);
  inst.hatAssets = new HatEquipmentAssets(assetBaseUrl);
  inst.equipmentPresentation = {
    sprite: { sprite: inst.sprite, art: inst.equipmentAssets }, assets: inst.equipmentAssets, hats: inst.hatAssets,
    lightParent: inst, sanityPercent: options.sanityPercent ?? (options.stats ? inst.stats.sanity.percent : undefined),
    soundPosition: inst.transform.position,
    followSymbol: (symbol, x, y, fx) => followSymbol(inst, symbol, x, y, fx),
  };
  inst.fxScheduler = new GameTimeScheduler();
  inst.bookFx = new BookFxController(inst, inst.fxScheduler, resources);
  inst.sg = new WilsonStateGraph(inst, createStateGraphHost(inst));

  // player_common.lua ListenForEvent("death", ex_fns.OnPlayerDeath); SGwilson's own death handler hears the same event.
  inst.ListenForEvent('death', OnPlayerDeath);
  // player_common.lua ListenForEvent("makeplayerghost" / "respawnfromghost", ex_fns.OnMakePlayerGhost / OnRespawnFromGhost).
  inst.ListenForEvent('makeplayerghost', (_inst, data) => OnMakePlayerGhost(inst, data as { skeleton?: boolean; loading?: boolean } | undefined));
  inst.ListenForEvent('respawnfromghost', (_inst, data) => OnRespawnFromGhost(inst, data as { source?: RezSource } | undefined));
  inst.onRemove(() => OnRemoveEntity(inst));
  display.onDispose(() => releasePlayerAssets(inst));
  display.update(0);
  return { model: player, instance: inst, display };
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
