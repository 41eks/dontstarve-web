import type { EntityEventData } from '../../componets/src/entityEvents';
import { addComponent, removeComponent } from './components';
import { SpriteResources, SpriteState, type FollowerFx, type PrefabDisplay } from '@dontstarve-web/display';
import { clockstate, createMemo, createSignal, readonlySignal, type ReadonlySignal } from '@dontstarve-web/signals';
import { BufferedAction, WilsonStateGraph, type WilsonAction, type WilsonFishingHost, type WilsonMovementState, type WilsonOneShotState, type WilsonDeathHost } from '@dontstarve-web/stategraphs';
import type * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { type EquipmentKind, type InventoryStore } from '@dontstarve-web/inventory';
import type { AxeTool } from './axe';
import { BookFxController } from './book_fx';
import { EMOTES, type EmoteName, type EmoteDefinition } from './emotes';
import type { EquipmentPresentation } from './equipmentVisual';
import type { FarmHoeTool } from './farm_hoe';
import { GroundItemAssets } from './groundItems';
import { HatEquipmentAssets } from './hats';
import type { PickaxeTool } from './pickaxe';
import type { PitchforkTool } from './pitchfork';
import { OnMakePlayerGhost, OnRespawnFromGhost, PlayerBuild } from './player_common_extensions';
import type { ShovelTool } from './shovel';
import type { SoundEmitter } from './soundEmitter';
import { MakeCharacterPhysics, WORLD_SCALE } from './standardcomponents';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { PhysicsState } from '../../componets/src/physicsState';
import { registerActionEntity, disposeActionEntity } from './actionEntity';
import { createArchiveEntity, PrefabInstance, prefabInstance, type EntityTask } from './prefabInstance';
import { Builder, type BuilderWorld } from '../../componets/src/builder';
import type { WilsonSoulHopHost } from '../../stategraphs/src/SGwilson';
import type { PlayerAction } from '../../stategraphs/src/actionfns';
import { SlipperyFeet } from '../../componets/src/slipperyfeet';
import type { ComponentUpdates } from '../../componets/src/componentUpdates';
import { SleepingBagUser } from '../../componets/src/sleepingbaguser';
import { Health } from '../../componets/src/health';
import { Hunger } from '../../componets/src/hunger';
import { Sanity, type SanityMode } from '../../componets/src/sanity';
import { Eater } from '../../componets/src/eater';

/** tuning.lua WILSON_HEALTH / WILSON_HUNGER / WILSON_SANITY, the player_common.lua defaults. Older saves may omit all stats. */
export const WILSON_HEALTH = 150;
export const WILSON_HUNGER = 150;
export const WILSON_SANITY = 200;
export interface PlayerStats {
  readonly health: Health;
  readonly hunger: Hunger;
  readonly sanity: Sanity;
}
export interface PlayerStatsSave { health?: number; hunger?: number; sanity?: number; penalty?: number; sanitySane?: boolean; sanityMode?: SanityMode }

/** player_common.lua: assemble the player's authoritative stats and eater components. */
export function createPlayerStats(inst: PrefabInstance, saved: PlayerStatsSave = {}, scheduler?: GameTimeScheduler): PlayerStats {
  const health = addComponent(inst, 'health', Health, WILSON_HEALTH);
  health.nofadeout = true;
  health.OnLoad({ health: saved.health ?? WILSON_HEALTH, penalty: saved.penalty ?? 0 });
  const hunger = addComponent(inst, 'hunger', Hunger, WILSON_HUNGER, scheduler);
  hunger.SetRate(75 / 480);
  hunger.SetKillRate(WILSON_HEALTH / 120);
  hunger.OnLoad({ hunger: saved.hunger ?? 105 });
  const sanity = addComponent(inst, 'sanity', Sanity, WILSON_SANITY);
  sanity.OnLoad({ current: saved.sanity ?? 35, sane: saved.sanitySane, mode: saved.sanityMode });
  const eater = addComponent(inst, 'eater', Eater);
  inst.onRemove(() => { eater.dispose(); health.dispose(); hunger.dispose(); sanity.dispose(); });
  return { health, hunger, sanity };
}

/**
 * player_common.lua OnItemRanOut and the SGwilson.lua toolbroke exit:
 * equip another equippable of the same prefab found in the inventory.
 */
export function equipSamePrefab(
  inventory: Pick<InventoryStore, 'GetEquippedItem' | 'FindItem' | 'EquipFromInventory'>,
  prefab: string,
  equipslot?: EquipmentKind,
): boolean {
  if (equipslot !== undefined && inventory.GetEquippedItem(equipslot)) { return false; }
  const same = inventory.FindItem(item => item.prefab === prefab
    && item.components.equippable !== undefined
    && (equipslot === undefined || item.components.equippable.equipslot === equipslot));
  return same !== null && inventory.EquipFromInventory(same);
}

const EQUIPMENT_KINDS: readonly EquipmentKind[] = ['hand', 'body', 'head'];
const isEquipmentKind = (value: unknown): value is EquipmentKind => EQUIPMENT_KINDS.some(kind => kind === value);

/** player_common.lua OnItemRanOut, for the itemranout data the owner forwards. */
export function OnItemRanOut(inventory: Parameters<typeof equipSamePrefab>[0], data: unknown): void {
  if (typeof data !== 'object' || data === null || !('prefab' in data) || !('equipslot' in data)) { return; }
  const { prefab, equipslot } = data;
  if (typeof prefab === 'string' && isEquipmentKind(equipslot)) { equipSamePrefab(inventory, prefab, equipslot); }
}

/** player_common.lua AddComponent("builder"); the scene supplies spatial queries. */
export function bindPlayerBuilder(model: THREE.Group, world: Omit<BuilderWorld, 'researchMachineDistance'>): Builder {
  const inst = playerInst(model);
  registerActionEntity(inst);
  removeComponent(inst, 'builder');
  return addComponent(inst, 'builder', Builder, { ...world, researchMachineDistance: 4 * WORLD_SCALE });
}

/** player_common.lua AddComponent("slipperyfeet"): frozen ponds are its slipperyfeettarget entities. */
export function AddSlipperyFeet(inst: PlayerInstance): void {
  if (inst.slipperyfeet || !inst.scheduler) { return; }
  inst.slipperyfeet = new SlipperyFeet(inst, {
    scheduler: inst.scheduler,
    findSlipperyEntities: (position, radius) => inst.TheSim.FindEntities(position, radius, ['slipperyfeettarget']),
  });
}

/** inst:RemoveComponent("slipperyfeet") */
export function RemoveSlipperyFeet(inst: PlayerInstance): void {
  inst.slipperyfeet?.dispose();
  delete inst.slipperyfeet;
}

export interface SymbolFollower {
  readonly node: THREE.Object3D;
  remove(): void;
}

export type PlayerCarryItem = 'torch' | 'lantern' | 'yellowstaff' | 'opalstaff' | 'greenstaff' | 'firestaff' | 'telestaff' | 'orangestaff' | 'icestaff' | 'trident' | 'bugnet' | 'fishingrod' | 'hammer' | 'nightsword' | 'reskin_tool' | PickaxeTool | AxeTool | PitchforkTool | FarmHoeTool | ShovelTool;

/**
 * The ANIM assets MakePlayerCharacter and global.lua (player_idles) declare for every player, plus the emotes':
 * AnimState:PlayAnimation finds each clip of the current bank in whichever of them, or of the character's assets, holds it.
 */
const PLAYER_ANIMATION_ARCHIVES: readonly string[] = [
  'player_idles.zip', 'player_basic.zip', 'player_actions.zip', 'player_actions_axe.zip', 'player_actions_pickaxe.zip',
  'player_actions_shovel.zip', 'player_actions_eat.zip', 'player_actions_item.zip', 'player_actions_uniqueitem.zip',
  'player_actions_bugnet.zip', 'player_actions_fishing.zip', 'player_actions_till.zip', 'player_attacks.zip',
  'player_jump.zip', 'player_amulet_resurrect.zip', 'player_slurtle_armor.zip', 'player_staff.zip', 'player_strum.zip',
  'player_slip.zip', 'player_ghost_withhat.zip', ...Object.values(EMOTES).map(definition => definition.archive),
];
export type PlayerBody = CANNON.Body & { canJump: boolean };

export interface PlayerPrefab {
  /** inst.Physics: player_common.lua MakeCharacterPhysics(inst, 75, .5), swapped for ghost physics on death. */
  physics: PhysicsState;
  /** The bound body the movement and stategraphs drive. */
  body: PlayerBody;
  readonly instance: PlayerInstance;
  readonly display: PrefabDisplay;
  model: PlayerModel;
}

export type PlayerModel = THREE.Group;

interface ActiveEmote {
  id: EmoteName;
  clips: readonly string[];
  loop: boolean;
}

/**
 * The player inst: the fields player_common.lua and SGwilson keep on it, assigned in MakePlayerCharacter's fn.
 * Its behaviour is the module functions below, each taking the inst first.
 */
export class PlayerInstance extends PrefabInstance {
  /** player_common.lua fn: inst.entity:AddSoundEmitter(). */
  declare SoundEmitter: SoundEmitter;
  declare readonly components: PrefabInstance['components'] & {
    inventory?: InventoryStore;
    sanity?: Sanity;
    /** The input's action picker: the ghost pushes and pops its action filter on it. */
    playeractionpicker?: Pick<import('../../stategraphs/src/playeractionpicker').PlayerActionPicker, 'PushActionFilter' | 'PopActionFilter'>;
    /** player_common.lua master_postinit AddComponent("sleepingbaguser"), on game time. */
    sleepingbaguser?: SleepingBagUser;
    /** player_common.lua AddComponent("combat"), bound by the scene with its weapon lookup. */
    combat?: import('../../componets/src/combat').Combat;
    /** reader.lua, which ACTIONS.READ reaches on the doer; bound by the scene with the books' world services. */
    reader?: import('../../componets/src/reader').Reader<PlayerInstance, import('./books').BookWorld>;
  };
  /** TheWorld.Map, as ACTIONS.DEPLOY reaches it through the doer while the scene binds one. */
  Map?: import('../../componets/src/deployable').DeployMap;
  /** equippable:Equip(owner): each equipped inst draws on its own slot of the player's sprite. */
  OpenEquipmentView?: import('@dontstarve-web/signals').EquipmentOwner['OpenEquipmentView'];
  /** wortox.lua: CanSoulhop / CanBlinkTo / CanBlinkFromWithMap on the inst, read by ACTIONS.BLINK and BLINK_MAP. */
  CanSoulhop?: () => boolean;
  CanBlinkTo?: (position: THREE.Vector3) => boolean;
  CanBlinkFromWithMap?: (position: THREE.Vector3) => boolean;
  /** PlayerController:GetMapActions sets these while it asks for the map's actions. */
  checkingmapactions?: boolean;
  checkingmapactions_pos?: THREE.Vector3;
  /** wortox.lua inst._freesoulhop_counter */
  get _freesoulhop_counter(): number | undefined { return this.wortox?.freeHops.peek(); }
  /** inst:SetStateGraph("SGwilson"). */
  declare sg: WilsonStateGraph;
  stats!: PlayerStats;
  controllerEnabled = true;
  locomotor?: { stop(): void };
  runSpeed = 0;
  motorSpeed?: number;
  currentMotorSpeed = 0;
  /** Physics:GetMotorSpeed, as slipperyfeet and the surfaces' slippery rates read it. */
  // conventions-allow instance-method: the engine's Physics:GetMotorSpeed, not a Lua local function
  getMotorSpeed(): number { return this.currentMotorSpeed; }
  wantsToMoveForward = false;
  worldHeading = 0;
  slipperyfeet?: SlipperyFeet;
  /** wortox.lua master_postinit: the portal hop counters behind inst.TryToPortalHop / FinishPortalHop. */
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
  /** inst:ScreenFade(isfadein, time) / inst:SnapCamera(), bound by the front end while it shows this player. */
  ScreenFade?: (isfadein: boolean, time: number) => void;
  SnapCamera?: () => void;
  /** inst:ShowHUD(show) */
  ShowHUD!: (show: boolean) => void;
  /** The emote SGwilson's emote state is playing, with the art it was chosen with. */
  emote: ActiveEmote | null = null;
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
}

/** The player inst once the application has given it its inventory, as it is whenever it acts. */
export type PlayerWithInventory = PlayerInstance & { readonly components: { readonly inventory: InventoryStore } };
export function hasPlayerInventory(inst: PlayerInstance): inst is PlayerWithInventory {
  return inst.components.inventory !== undefined;
}

export function playerInst(model: THREE.Object3D): PlayerInstance {
  const instance = prefabInstance(model);
  if (!(instance instanceof PlayerInstance)) { throw new Error('Expected a player instance'); }
  return instance;
}

export interface PlayerPrefabOptions {
  /** The owner's authoritative sanity ratio; standalone previews default to full sanity. */
  sanityPercent?: ReadonlySignal<number>;
  stats?: PlayerStatsSave;
  scheduler?: GameTimeScheduler;
  componentUpdates?: ComponentUpdates;
}

/**
 * locomotor.lua GetSpeedMultiplier for the player: the product of its equipped items' walkspeedmult. External speed
 * multipliers, the rider's saddle and mightiness are not ported.
 */
export function GetSpeedMultiplier(inst: PlayerInstance): number {
  const inventory = inst.components.inventory;
  if (!inventory) { return 1; }
  let mult = 1;
  for (const kind of ['hand', 'body', 'head'] as const) {
    mult *= inventory.GetEquippedItem(kind)?.components.equippable?.GetWalkSpeedMult() ?? 1;
  }
  return mult;
}

/** player_common.lua fns.ShowHUD, assigned to inst.ShowHUD in master_postinit. */
export function ShowHUD(inst: PlayerInstance, show: boolean): void {
  if (show) { inst.HUD?.Show(); } else { inst.HUD?.Hide(); }
}

/** Movement input: walking or running cancels an emote. */
export function startMovement(inst: PlayerInstance, state: WilsonMovementState): void {
  if (state !== 'idle' && inst.emote !== null) { cancelEmote(inst); }
  inst.sg.requestMovement(state);
}

function startOneShot(inst: PlayerInstance, state: WilsonOneShotState): void {
  cancelEmote(inst);
  inst.sg.requestOneShot(state);
}

export function playEat(inst: PlayerInstance): void { startOneShot(inst, 'eat'); }
export function playPickup(inst: PlayerInstance): void { startOneShot(inst, 'pickup'); }

/** ACTIONS.DROP: doshortaction performs the drop on its frame 6; onCancel runs if the action never performs. */
export function playDrop(inst: PlayerInstance, onDrop: () => boolean, onCancel?: () => void): boolean {
  if (inst.sg.hasStateTag('busy')) { return false; }
  cancelEmote(inst);
  const action: PlayerAction<WilsonAction> = new BufferedAction('DROP', onDrop);
  const stop = inst.sg.listenForEvent('actionfailed', data => {
    if (data.action === action) { stop(); onCancel?.(); }
  });
  action.addSuccessAction(stop);
  if (inst.sg.pushBufferedAction(action)) { return true; }
  stop();
  return false;
}

export function setCrafting(inst: PlayerInstance, crafting: boolean): void {
  if (crafting) { cancelEmote(inst); }
  inst.sg.requestCrafting(crafting);
}

/** Wortox's soul hop while its skill is bound; unbinding cancels a pending hop and clears the portal tint. */
export function bindSoulHop(inst: PlayerInstance, host: Omit<WilsonSoulHopHost, 'setTint'> | undefined): void {
  if (!host) {
    inst.sg.cancelAction('BLINK');
    inst.sg.cancelAction('BLINK_MAP');
    setTint(inst, 0);
  }
  inst.soulHopHost = host && { ...host, setTint: value => setTint(inst, value) };
}

/** Wortox's additive portal tint is a per-instance appearance declaration. */
function setTint(inst: PlayerInstance, amount: number): void { inst.sprite.setTint({ colour: [154 / 255, 23 / 255, 19 / 255], amount }); }

/** Movement input while asleep: the locomote event wakes the sleeper. */
export function wakeFromBed(inst: PlayerInstance): void { inst.sg.pushLocomote(); }

export function playEmote(inst: PlayerInstance, id: EmoteName): boolean {
  const definition: EmoteDefinition | undefined = EMOTES[id];
  if (!definition || !inst.sg.canEmote()) { return false; }
  cancelEmote(inst);
  inst.emote = {
    id,
    clips: definition.variants[Math.floor(Math.random() * definition.variants.length)],
    loop: definition.loop === true,
  };
  if (!inst.sg.requestEmote(inst.emote.clips, inst.emote.loop)) {
    inst.emote = null;
    return false;
  }
  return true;
}

export function cancelEmote(inst: PlayerInstance): void {
  inst.sg.cancelEmote();
  inst.emote = null;
}

/** Follower:FollowSymbol(owner.GUID, symbol, offsetX, offsetY): a node tracking the symbol, in the player's space; `fx` is drawn there. */
export function followSymbol(inst: PlayerInstance, symbol: string, offsetX: number, offsetY: number, fx?: FollowerFx): SymbolFollower {
  return inst.sprite.followSymbol(symbol, offsetX, offsetY, fx);
}

/** One frame of the player's stategraph and its FX clock. */
export function updatePlayer(inst: PlayerInstance, dt: number): void {
  if (inst.isRemoved) { return; }
  const step = Math.max(0, Math.min(dt, 0.1));
  inst.fxScheduler.advance(step);
  inst.sg.update(step);
}

/** player_common.lua OnPlayerDeath: inst.deathcause. */
function OnPlayerDeath(inst: PlayerInstance, data: EntityEventData['death']): void {
  inst.deathcause = data?.cause ?? 'unknown';
}

/** OnRemoveEntity: the stategraph, the book FX and every sound stop with the player. */
function OnRemoveEntity(inst: PlayerInstance): void {
  inst.sg.dispose();
  inst.bookFx.dispose(); inst.fxScheduler.dispose();
  inst.SoundEmitter.KillAllSounds();
  disposeActionEntity(inst);
}

/** The display's art caches go with the player's display. */
function releasePlayerAssets(inst: PlayerInstance): void {
  inst.equipmentAssets.dispose(); inst.hatAssets.dispose();
  inst.resources.dispose();
}

/** The emote ends with any state but emote's own. */
function OnNewState(inst: PlayerInstance, data: EntityEventData['newstate']): void {
  if (data.statename !== 'emote') { inst.emote = null; }
}

/** player_common.lua: MakeCharacterPhysics(inst, 75, .5), in DST units. */
export const PLAYER_PHYSICS_RADIUS = 0.5;
/** The player's collider radius in world units; UI anchored to the player scales from this. */
export const PLAYER_COLLIDER_RADIUS = PLAYER_PHYSICS_RADIUS * WORLD_SCALE;

export type PlayerPostInit = (inst: PlayerInstance) => void;
/** The prefab MakePlayerCharacter returns: `world` receives the player's body; Physics:Teleport after moving the model places it there. */
export type PlayerPrefabFn = (assetBaseUrl: string, world: CANNON.World, options?: PlayerPrefabOptions) => PlayerPrefab;

/**
 * player_common.lua MakePlayerCharacter(name, customprefabs, customassets, common_postinit, master_postinit): the fn every
 * character shares, with the character's ANIM assets, and its postinits run where player_common runs them.
 */
export function MakePlayerCharacter(
  name: string,
  customassets: readonly string[],
  common_postinit?: PlayerPostInit,
  master_postinit?: PlayerPostInit,
): PlayerPrefabFn {
  const animationArchives = [...new Set([...PLAYER_ANIMATION_ARCHIVES, ...customassets])];
  return (assetBaseUrl, world, options = {}) => {
    const resources = new SpriteResources(assetBaseUrl);
    const inst = new PlayerInstance(name, new SpriteState({ name: 'idle_loop', billboard: true }));
    // The shared archive of the wilson bank across the character's ANIM assets; the body is dressed per entity (its
    // AnimState, override builds and followers), so its display draws its own frames.
    const { display } = createArchiveEntity(name, resources.archive({ animationArchive: animationArchives[0],
      extraAnimationArchives: animationArchives.slice(1), buildArchives: [PlayerBuild(inst)], bank: 'wilson' },
    // SGwilson's SetMultColour tints only this player.
    { colour: [1, 1, 1] }),
    { name: 'idle_loop', billboard: true, instance: inst }, name, () => {
      // SetBank("wilson"), SetBuild(name) from the prefab's ANIM assets.
      inst.AnimState.DeclareAnimationAssets(animationArchives, resources.archives);
      inst.AnimState.SetBank('wilson');
      inst.AnimState.SetBuild(PlayerBuild(inst));
      // player_common_extensions.lua SetupOverrideBuilds, for the ported states' item and emote prop symbols.
      for (const build of ['player_actions_uniqueitem', 'player_emote_extra']) { inst.AnimState.AddOverrideBuild(build); }
      // inst.Transform:SetFourFaced()
      inst.sprite.setFacingRotation(0, 4);
    });
    if (options.scheduler) { inst.BindScheduler(options.scheduler); }
    // inst.entity:AddSoundEmitter(); the listener is at the player.
    inst.AddSoundEmitter({ atListener: true });
    MakeCharacterPhysics(inst, 75, PLAYER_PHYSICS_RADIUS);
    inst.minimap.SetIcon(`${name}.png`);
    inst.minimap.SetPriority(10);
    inst.minimap.SetCanUseCache(false);
    inst.minimap.SetDrawOverFogOfWar(true);
    // upgrades.lua uses these exact upgrade type names.
    for (const tag of ['player', 'scarytoprey', 'character', 'lightningtarget', 'waterplant_upgradeuser', 'mast_upgradeuser',
      'chest_upgradeuser', 'usesvegetarianequipment', 'ghostlyelixirable']) { inst.addTag(tag); }
    inst.setPosition(0, 30, 0);

    // The player's own AnimState declaration, beneath the slots its equipped items declare; the display loads the builds it names.
    inst.equipmentAssets = new GroundItemAssets();
    inst.sprite.setAnimState(inst.AnimState.json, inst.equipmentAssets);
    for (const layer of ['ARM_carry', 'LANTERN_OVERLAY', 'HAT', 'HAIR_HAT', 'HEAD_HAT', 'HEAD_HAT_NOHELM', 'HEAD_HAT_HELM']) { inst.AnimState.Hide(layer); }
    inst.hatAssets = new HatEquipmentAssets(assetBaseUrl);

    common_postinit?.(inst);

    for (const tag of ['trader', 'debuffable', 'stageactor']) { inst.addTag(tag); }
    inst.stats = createPlayerStats(inst, options.stats, options.scheduler);
    inst.scheduler = options.scheduler;
    inst.ShowHUD = show => ShowHUD(inst, show);
    inst.resources = resources;
    const stopSanity = options.componentUpdates?.register(inst.stats.sanity);
    if (stopSanity) { inst.onRemove(stopSanity); }
    if (options.scheduler) {
      // sleepingbaguser.lua: per-tick hunger, sanity and health in a bed; WatchWorldState("phase") wakes at the bed's phase end.
      const phase = createMemo(() => clockstate.get().phase);
      const { hunger, sanity, health } = inst.stats;
      // OnDespawn: the bed releases its sleeper without a state change, before the component's teardown.
      inst.onRemove(() => { inst.components.sleepingbaguser?.bed?.DoWakeUp(true); });
      addComponent(inst, 'sleepingbaguser', SleepingBagUser, {
        scheduler: options.scheduler, phase: readonlySignal(phase), hunger, sanity, health,
        goToWakeup: () => inst.sg.wakeUp(),
      });
      inst.onRemove(() => phase.dispose());
    }
    registerActionEntity(inst);
    inst.equipmentPresentation = {
      sprite: { sprite: inst.sprite, art: inst.equipmentAssets }, assets: inst.equipmentAssets, hats: inst.hatAssets,
      lightParent: inst, sanityPercent: options.sanityPercent ?? (options.stats ? inst.stats.sanity.percent : undefined),
      soundPosition: inst.transform.position,
      followSymbol: (symbol, x, y, fx) => followSymbol(inst, symbol, x, y, fx),
    };
    inst.fxScheduler = new GameTimeScheduler();
    inst.bookFx = new BookFxController(inst, inst.fxScheduler, resources);

    // ListenForEvent("death", ex_fns.OnPlayerDeath); SGwilson's own death handler hears the same event.
    inst.ListenForEvent('death', OnPlayerDeath);
    // ListenForEvent("itemranout", fns.OnItemRanOut)
    inst.ListenForEvent('itemranout', (_inst, data) => { if (inst.components.inventory) { OnItemRanOut(inst.components.inventory, data); } });
    // ListenForEvent("makeplayerghost" / "respawnfromghost", ex_fns.OnMakePlayerGhost / OnRespawnFromGhost).
    inst.ListenForEvent('makeplayerghost', (_inst, data) => OnMakePlayerGhost(inst, data));
    inst.ListenForEvent('respawnfromghost', (_inst, data) => OnRespawnFromGhost(inst, data));
    inst.onRemove(() => OnRemoveEntity(inst));

    inst.SetStateGraph(inst => new WilsonStateGraph(inst));
    inst.ListenForEvent('newstate', OnNewState);

    master_postinit?.(inst);

    display.onDispose(() => releasePlayerAssets(inst));
    display.update(0);

    inst.bindPhysics(world);
    const body = inst.physicsBody as PlayerBody;
    body.canJump = false;
    const onCollide = () => { body.canJump = true; };
    body.addEventListener('collide', onCollide);
    inst.onRemove(() => body.removeEventListener('collide', onCollide));
    return { physics: inst.physics, body, instance: inst, display, model: display.model };
  };
}
