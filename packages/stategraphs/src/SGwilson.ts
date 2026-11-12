import type { EventData } from '../../componets/src/entityEvents';
import { AnimationPlayback } from '@dontstarve-web/animation/animationPlayback';
import type { BufferedActionObject } from './bufferedaction.ts';
import type { PlayerAction } from './actionfns.ts';
import { ActionHandler as DefineActionHandler, EventHandler, FRAMES, State as DefineState, StateGraphInstance, TimeEvent } from './stategraph.ts';
import type { StateActionHandler, StateDefinition } from './stategraph.ts';
import { wortoxStates } from './SGwortox.ts';
import type { Vector3 } from 'three';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { InstanceAnimState } from '../../prefab/src/instanceAnimState';
import type { InventoryStore } from '../../inventory/src';
import type { SoundEmitter } from '../../prefab/src/soundEmitter';
import type { SoundEventPath } from '../../prefab/src/sound';
import { WORLD_SCALE } from '../../prefab/src/tile';
import { clockstate } from '@dontstarve-web/signals';
import { GetString } from '../../componets/src/stringutil';
import { ghostActionHandlers, ghostStates } from './SGwilsonghost.ts';

export type WilsonMovementState = 'idle' | 'walk' | 'run' | 'jump';
export type WilsonOneShotState = 'eat' | 'item_in' | 'item_out' | 'item_hat' | 'pickup';
export type WilsonStateName = WilsonMovementState | WilsonOneShotState | 'build' | 'emote' | 'talk'
  | 'mine_start' | 'mine' | 'chop_start' | 'chop' | 'hammer_start' | 'hammer'
  | 'bugnet_start' | 'bugnet' | 'terraform' | 'castspell' | 'veryquickcastspell'
  | 'quickeat' | 'migrate' | 'doshortaction' | 'dolongaction' | 'till_start' | 'till' | 'dig_start' | 'dig' | 'catchonfire'
  | 'book' | 'book2' | 'attack' | 'give' | 'toolbroke' | 'shave' | 'tent' | 'wakeup' | 'play_flute' | 'play_strum'
  | 'slip' | 'slip_pst' | 'slip_fall' | 'slip_fall_loop' | 'slip_fall_pst'
  | 'fishing_pre' | 'fishing' | 'fishing_pst' | 'fishing_nibble' | 'fishing_strain' | 'catchfish' | 'loserod'
  | 'shell_enter' | 'shell_idle' | 'shell_hit' | 'death'
  /** SGwilsonghost.lua states; `idle`, `walk` and `run` are shared names in a separate state table. */
  | 'appear' | 'hit' | 'haunt_pre' | 'haunt'
  /** SGwilson.lua portal_rez: the player stepping out of the multiplayer portal after a haunt resurrection. */
  | 'portal_rez' | 'portal_jumpin_pre' | 'portal_jumpin' | 'portal_jumpout'
  /** SGwilson.lua amulet_rebirth: the player rising from a red amulet after a haunt resurrection. */
  | 'amulet_rebirth';
export type WilsonAction = 'LOOKAT' | 'BLINK' | 'BLINK_MAP' | 'ATTACK' | 'MINE' | 'CHOP' | 'HAMMER' | 'NET' | 'TERRAFORM' | 'CASTSPELL' | 'EAT' | 'PLANT' | 'PLANTSOIL' | 'TILL' | 'DIG' | 'HARVEST' | 'PICK' | 'PICKUP' | 'LIGHT' | 'READ' | 'GIVE' | 'FEED' | 'REPAIR' | 'SHAVE' | 'STORE' | 'TAKEITEM' | 'DROP' | 'ADDFUEL' | 'ADDWETFUEL' | 'SLEEPIN' | 'PLAY' | 'DEPLOY' | 'DEPLOY_TILEARRIVE' | 'FERTILIZE' | 'BATHBOMB' | 'FISH' | 'HAUNT' | 'MIGRATE' | 'TURNON' | 'TURNOFF' | 'RUMMAGE';
export type WilsonAnimationKey = 'dial_loop' | 'wortox_portal' | WilsonMovementState | WilsonOneShotState | 'build' | 'emote'
  | 'pickaxe_pre' | 'pickaxe_loop' | 'pickaxe_pst' | 'chop_pre' | 'chop_loop' | 'bugnet_pre' | 'bugnet'
  | 'shovel_pre' | 'shovel_loop' | 'shovel_pst' | 'staff_pre' | 'staff' | 'atk_pre' | 'atk'
  | 'quick_eat_pre' | 'quick_eat' | 'quick_drink_pre' | 'quick_drink' | 'pickup_pst' | 'till_pre' | 'till_loop' | 'till_pst'
  | 'build_pre' | 'build_loop' | 'build_pst' | 'light_fire' | 'light_fire_pst'
  | 'action_uniqueitem_pre' | 'book' | 'punch' | 'toolpunch' | 'give' | 'give_pst' | 'hit' | 'wakeup' | 'flute' | 'strum_pre' | 'strum'
  | 'slip_pre' | 'slip_loop' | 'slip_pst' | 'slip_fall_pre' | 'slip_fall_idle' | 'slip_fall_pst'
  /** player_actions_fishing.zip: the fishing states' clips are selected by name. */
  | 'fishing'
  /** player_slurtle_armor.zip: armorsnurtleshell's hiding clips. */
  | 'hideshell' | 'hideshell_idle' | 'hitshell'
  /** player_actions.zip: SGwilson death's `death` clip. */
  | 'death'
  /** ghost.zip (bank `ghost`): SGwilsonghost's clips are selected by name. */
  | 'ghost'
  /** player_amulet_resurrect.zip: amulet_rebirth's clip. */
  | 'amulet_rebirth';

/** SGwilson.lua portal_rez colourtweener duration. */
const PORTAL_REZ_TWEEN_TIME = 14 * FRAMES;

export const WILSON_ACTION_TIMES = {
  mine: 7 * FRAMES, net: 10 * FRAMES, terraform: 25 * FRAMES,
  castSound: 13 * FRAMES, cast: 53 * FRAMES, reskin: 9 * FRAMES,
  quickEat: 12 * FRAMES, plant: 6 * FRAMES,
  till: 11 * FRAMES,
  dig: 15 * FRAMES,
  light: 13 * FRAMES,
} as const;

export interface WilsonAnimationClip {
  key: WilsonAnimationKey;
  name: string;
  loop?: boolean;
  /** AnimState:SetDeltaTimeMultiplier for this clip. */
  playbackRate?: number;
}

/** A spawned FX inst owned by a state until it is detached or removed. */
export interface WilsonFx {
  isValid(): boolean;
  remove(): void;
  /** entity:SetParent(nil) at the current world position and rotation. */
  detach(): void;
  pushEvent(name: 'fail_fx'): void;
}

// TUNING.CALORIES_MED
const CALORIES_MED = 25;

/** The talker strings SGwilson.lua's tent state says through GetString(inst, failreason). */
export type WilsonSleepAnnounce = 'ANNOUNCE_NODAYSLEEP' | 'ANNOUNCE_NONIGHTSIESTA' | 'ANNOUNCE_NOSLEEPONFIRE' | 'ANNOUNCE_NOHUNGERSLEEP';


/** What SGwilson.lua's death state reaches: DropAllItemsForDeath and the controller. */
export interface WilsonDeathHost {
  /** inventory:DropEverything(true) */
  dropEverything(): void;
  /** TheWorld.Map:IsPassableAtPoint at the player's feet: only then does the death leave a skeleton. */
  isPassableAtPoint(): boolean;
}

/** What SGwilson.lua's fishing states reach: the equipped rod's component. */
export interface WilsonFishingHost {
  /** equippedTool.components.fishingrod:WaitForFish() */
  waitForFish(): void;
  /** equippedTool.components.fishingrod:Collect() */
  collect(): void;
  /** fishingrod:Release() then equippedTool:Remove() */
  loseRod(): void;
}

export interface PortalJumpData { dest: Vector3; from_map: boolean }

export interface WilsonSoulHopHost {
  tryToPortalHop(): boolean;
  facePoint(position: Vector3): void;
  teleport(position: Vector3): void;
  resetMinimapOffset?(): void;
  snapCamera?(): void;
  setPhysicsEnabled(enabled: boolean): void;
  setTint(value: number): void;
  spawnFx(prefab: 'wortox_portal_jumpin_fx' | 'wortox_portal_jumpout_fx'): void;
}

/**
 * The player entity SGwilson's states act on, as `inst` in the source: its SoundEmitter, AnimState, components and the
 * entity functions they call, the movement facts the slip states read, and what the application binds for soul hops,
 * death, fishing, sleeping and book FX.
 */
export interface WilsonStateInst {
  readonly SoundEmitter: Pick<SoundEmitter, 'PlaySound' | 'KillSound' | 'PlayingSound' | 'SetVolume'>;
  readonly AnimState: Pick<InstanceAnimState, 'PlayAnimation' | 'GetCurrentAnimationLength' | 'SetDeltaTimeMultiplier'
    | 'OverrideSymbol' | 'OverrideItemSkinSymbol' | 'ClearOverrideSymbol' | 'Show' | 'Hide' | 'SetMultColour'>;
  readonly position: ReadonlyVector3;
  readonly TheSim: { FindEntities(position: ReadonlyVector3, radius: number): readonly { readonly components: object }[] };
  readonly prefab: string;
  hasTag(tag: string): boolean;
  readonly components: {
    readonly health?: { SetInvincible(invincible: boolean): void };
    readonly hunger?: { readonly current: number };
    readonly talker?: { Say(script: string): void };
    /** sleepingbaguser.lua: inst.sleepingbag is the bed the sleeper lies in. */
    readonly sleepingbaguser?: { readonly bed?: { DoWakeUp(nostatechange?: boolean): void } };
    readonly inventory?: Pick<InventoryStore, 'GetEquippedItem' | 'RemoveItem' | 'FindItem' | 'EquipFromInventory'>;
  };
  PushEvent(name: string, data?: unknown): void;
  /** inst:Hide() / inst:Show() / inst.entity:IsVisible(). */
  Hide(): void;
  Show(): void;
  IsVisible(): boolean;
  ShowHUD(show: boolean): void;
  /** inst.HUD.controls: inventory:Hide() / Show() hide and show crafting and the inventory bar. */
  readonly HUD?: { readonly controls?: { HideCraftingAndInventory(): void; ShowCraftingAndInventory(): void } };
  SpawnPrefab?(prefab: string, position: Vector3): { remove(): void; SetUp?(colour: readonly [number, number, number], duration: number, delay: number): void } | undefined;
  /** inst.components.playercontroller:Enable. */
  controllerEnabled: boolean;
  /** inst.components.locomotor:Stop(). */
  readonly locomotor?: { stop(): void };
  /** inst.components.locomotor:GetRunSpeed(), in DST units. */
  readonly runSpeed: number;
  /** Physics:SetMotorVel(speed, 0, 0) along the current heading, in DST units; undefined releases the motor. */
  motorSpeed?: number;
  /** inst.components.locomotor:WantsToMoveForward(). */
  readonly wantsToMoveForward: boolean;
  readonly slipperyfeet?: { SetCurrent(value: number): void };
  /** inst.components.combat: the attack state's cooldown. */
  readonly combat?: WilsonCombat;
  readonly soulHopHost?: WilsonSoulHopHost;
  readonly deathHost?: WilsonDeathHost;
  readonly fishingHost?: WilsonFishingHost;
  /** SpawnPrefab parented to the player, optionally Follower:FollowSymbol on a player symbol. */
  readonly bookFx?: { spawn(prefab: string, followSymbol?: string): WilsonFx };
}

export interface WilsonBrokenTool { readonly prefab: string; readonly nobrokentoolfx?: boolean }

export interface WilsonCombat {
  readonly min_attack_period: number;
  InCooldown(): boolean;
  StartAttack(): void;
  CancelAttack(): void;
}

type WilsonInstance = StateGraphInstance<WilsonStateGraph, WilsonStateName>;
const State = DefineState<WilsonStateGraph, WilsonStateName>;
const ActionHandler = DefineActionHandler<WilsonStateGraph, WilsonStateName, PlayerAction>;
/**
 * SGwilson.lua DoHurtSound: dontstarve/characters/<soundsname or prefab>/hurt. The sound catalog has Wilson's hurt
 * event only, so every player sounds Wilson's.
 */
function DoHurtSound(entity: WilsonStateInst): void {
  entity.SoundEmitter.PlaySound('dontstarve/characters/wilson/hurt');
}

/**
 * SGwilson.lua SetSleeperSleepState / SetSleeperAwakeState: the player controller and the inventory bar. The grue,
 * talker IgnoreAll, firebug, map controls, OnSleepIn and popups are not ported.
 */
function SetSleeperSleepState(entity: WilsonStateInst): void {
  entity.controllerEnabled = false;
  entity.HUD?.controls?.HideCraftingAndInventory();
}
function SetSleeperAwakeState(entity: WilsonStateInst): void {
  entity.controllerEnabled = true;
  entity.HUD?.controls?.ShowCraftingAndInventory();
}

/** SGwilson.lua amulet_rebirth: the equipped body amulet is removed from the inventory and destroyed. */
function ConsumeEquippedAmulet(entity: WilsonStateInst): boolean {
  const inventory = entity.components.inventory;
  let item = inventory?.GetEquippedItem('body');
  // conventions-allow prefab-id-branch: SGwilson.lua amulet_rebirth itself tests item.prefab == "amulet".
  if (!inventory || item?.prefab !== 'amulet') return false;
  item = inventory.RemoveItem(item);
  if (!item) return false;
  item.remove();
  return true;
}

/** SGwilson.lua amulet_rebirth: every other entity with a sleeper within `radius` goes to sleep for `seconds`. */
function SleepNearby(entity: WilsonStateInst, radius: number, seconds: number): void {
  for (const v of entity.TheSim.FindEntities(entity.position, radius * WORLD_SCALE)) {
    if (v !== entity) (v.components as { sleeper?: { GoToSleep(seconds: number): void } }).sleeper?.GoToSleep(seconds);
  }
}

/** SpawnPrefab("staff_castinglight") at the player, then stafflight:SetUp(colour, duration, delay). */
function SpawnCastingLight(entity: WilsonStateInst, colour: readonly [number, number, number], duration: number, delay: number) {
  const light = entity.SpawnPrefab?.('staff_castinglight', entity.position.clone());
  light?.SetUp?.(colour, duration, delay);
  return light;
}

/** SGwilson.lua toolbroke onexit: equip another equippable of the broken tool's prefab from the inventory. */
function EquipSameTool(entity: WilsonStateInst, toolname: string): void {
  const inventory = entity.components.inventory;
  const sameTool = inventory?.FindItem(item => item.prefab === toolname && item.components.equippable !== undefined);
  if (sameTool) inventory!.EquipFromInventory(sameTool);
}

/** SGwilson.lua: dontstarve/wilson/hit, then DoHurtSound. */
function playHitSounds(entity: WilsonStateInst): void {
  entity.SoundEmitter.PlaySound('dontstarve/wilson/hit');
  DoHurtSound(entity);
}

const clip = (key: WilsonAnimationKey, name: string = key): WilsonAnimationClip => ({ key, name });

/** SGwilson.lua idle onenter (ClearBufferedAction), then the movement or crafting the browser requested during the action. */
function onEnterIdle(inst: WilsonInstance, pushanim: boolean): void {
  const graph = inst.context;
  graph.releaseAction();
  // Lua's idle state stays while a pushed post-animation is still playing.
  if (!pushanim && (graph.isCrafting || graph.requestedMovement !== 'idle')) {
    inst.goToState(graph.isCrafting ? 'build' : graph.requestedMovement);
    return;
  }
  const idle = { ...clip('idle', 'idle_loop'), loop: true };
  if (pushanim) graph.pushClips([idle]); else graph.playClips([idle]);
}

/** SGwilson.lua GetUnequipState: item_hat off a non-hand slot, item_in otherwise (the wereplayer, slip and tool_slip branches are not ported). */
function GetUnequipState(data: EventData<'unequip'>): 'item_hat' | 'item_in' {
  return data.eslot === 'HANDS' ? 'item_in' : 'item_hat';
}
const fishingClip = (name: string): WilsonAnimationClip => clip('fishing', name);

/**
 * Implemented SGwilson.lua states, kept as explicit State tables in source order.
 * Component/animation APIs are provided by WilsonStateGraph's browser adapter.
 * Mounted, character-specific, prediction, held-action repetition and pocket-rummage
 * branches require components not yet ported here; see docs/dst-stategraphs.md.
 */
const states: StateDefinition<WilsonStateGraph, WilsonStateName>[] = [
  State({
    // SGwilson.lua shave: the beard component (or shaveable) vets the target before the sound and clips start.
    name: 'shave',
    tags: ['doing', 'busy', 'shaving', 'nodangle'],
    onenter: (inst) => {
      inst.context.entity.locomotor?.stop();
      const action = inst.context.getBufferedAction();
      const shavee = action?.target, shaver = action?.invobject?.components.shaver;
      const verdict = shaver && shavee ? shavee.components.beard?.ShouldTryToShave(undefined) : undefined;
      if (!verdict?.ok) {
        inst.context.failBufferedAction(verdict?.reason);
        inst.goToState('idle');
        return;
      }
      inst.context.entity.SoundEmitter.PlaySound('dontstarve/wilson/shave_LP', 'shave');
      inst.context.playClips([clip('build_pre'), { ...clip('build_loop'), loop: true }]);
      inst.statemem.action = action;
      inst.setTimeout(1);
    },
    timeline: [TimeEvent(4 * FRAMES, inst => inst.removeStateTag('busy'))],
    ontimeout: (inst) => {
      inst.context.performBufferedAction();
      inst.context.playClips([clip('build_pst')]);
      inst.goToState('idle', true);
    },
    onexit: (inst) => {
      inst.context.entity.SoundEmitter.KillSound('shave');
      if (inst.context.getBufferedAction() === inst.statemem.action) inst.context.clearBufferedAction();
    },
  }),
  State({
    // SGwilson.lua tent: the bed vets the sleeper, then the player hides inside and is woken by movement.
    name: 'tent',
    tags: ['tent', 'busy', 'silentmorph'],
    onenter: (inst) => {
      const { entity } = inst.context;
      entity.locomotor?.stop();
      const target = inst.context.getBufferedAction()?.target;
      if (!target) {
        inst.context.clearBufferedAction();
        inst.goToState('idle');
        return;
      }
      // Caves and IsNearDanger are not ported.
      const siesta = target.hasTag('siestahut');
      const failreason: WilsonSleepAnnounce | undefined =
        siesta !== (clockstate.peek().phase === 'day') ? (siesta ? 'ANNOUNCE_NONIGHTSIESTA' : 'ANNOUNCE_NODAYSLEEP')
          : target.components?.burnable?.IsBurning() ? 'ANNOUNCE_NOSLEEPONFIRE'
            // You can still sleep if your hunger will bottom out, but not absolutely.
            : (entity.components.hunger?.current ?? 0) < CALORIES_MED ? 'ANNOUNCE_NOHUNGERSLEEP' : undefined;
      if (failreason) {
        inst.context.clearBufferedAction();
        inst.goToState('idle');
        const script = GetString(entity, failreason);
        if (script !== undefined) entity.components.talker?.Say(script);
        return;
      }
      inst.context.playClips([clip('pickup')]);
      inst.setTimeout(6 * FRAMES);
      SetSleeperSleepState(entity);
    },
    ontimeout: (inst) => {
      const tent = inst.context.getBufferedAction()?.target;
      if (!tent || !tent.components.sleepingbag || !tent.hasTag('tent') || tent.hasTag('hassleeper')
        || tent.hasTag('siestahut') !== (clockstate.peek().phase === 'day') || tent.components.burnable?.IsBurning()) {
        // Edge cases, don't bother with fail dialogue.
        inst.context.clearBufferedAction();
        inst.context.playClips([clip('pickup_pst')]);
        inst.goToState('idle', true);
        return;
      }
      inst.context.performBufferedAction();
      inst.context.entity.Hide();
      inst.addStateTag('sleeping');
      inst.removeStateTag('busy');
    },
    events: [
      // Movement while asleep wakes the sleeper first (Lua: the locomote handler's bedroll/tent branch).
      EventHandler('locomote', (inst) => {
        if (inst.hasStateTag('sleeping')) inst.context.entity.components.sleepingbaguser?.bed?.DoWakeUp();
      }),
    ],
    onexit: (inst) => {
      const { entity } = inst.context, sleepingbag = entity.components.sleepingbaguser?.bed;
      entity.Show();
      if (sleepingbag) {
        // Interrupted while "sleeping".
        sleepingbag.DoWakeUp(true);
        SetSleeperAwakeState(entity);
      } else if (!inst.statemem.iswaking) {
        // Interrupted before "sleeping", or woken through the wakeup state.
        SetSleeperAwakeState(entity);
      }
    },
  }),
  State({
    name: 'wakeup',
    tags: ['busy', 'waking', 'nomorph', 'nodangle'],
    onenter: (inst) => {
      inst.context.entity.controllerEnabled = false;
      inst.context.playClips([clip('wakeup')]);
    },
    events: [
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
    onexit: (inst) => SetSleeperAwakeState(inst.context.entity),
  }),
  State({
    name: 'toolbroke',
    tags: ['busy', 'pausepredict'],
    onenter: (inst, tool) => {
      inst.context.entity.locomotor?.stop();
      inst.context.playClips([clip('hit')]);
      inst.context.entity.SoundEmitter.PlaySound('dontstarve/wilson/use_break');
      inst.context.entity.AnimState.Hide('ARM_carry');
      inst.context.entity.AnimState.Show('ARM_normal');
      const broken = tool as WilsonBrokenTool | undefined;
      if (!broken?.nobrokentoolfx) inst.context.entity.bookFx?.spawn('brokentool');
      inst.statemem.toolname = broken?.prefab;
      inst.setTimeout(10 * FRAMES);
    },
    ontimeout: inst => inst.goToState('idle', true),
    onexit: inst => {
      const toolname = inst.statemem.toolname as string | undefined;
      if (toolname !== undefined) EquipSameTool(inst.context.entity, toolname);
    },
  }),
  State({
    name: 'give', tags: ['giving'],
    onenter: inst => {
      inst.context.entity.locomotor?.stop();
      inst.context.playClips([clip('give'), clip('give_pst')]);
    },
    timeline: [TimeEvent(13 * FRAMES, inst => inst.context.performBufferedAction())],
    events: [EventHandler('animqueueover', inst => {
      if (inst.context.animationDone) inst.goToState('idle');
    })],
  }),
  State({
    name: 'catchonfire',
    tags: ['igniting'],
    onenter: (inst) => {
      inst.context.entity.locomotor?.stop();
      inst.context.playClips([clip('light_fire'), clip('light_fire_pst')]);
    },
    timeline: [TimeEvent(13 * FRAMES, inst => inst.context.performBufferedAction())],
    events: [EventHandler('animqueueover', inst => {
      if (inst.context.animationDone) inst.goToState('idle');
    })],
  }),
  // SGwilson.lua "Slipping states". Footsteps (PlayFootstep) and analog-stick polling are not ported;
  // held movement keys push "locomote" each frame while slipping instead.
  State({
    name: 'slip',
    tags: ['busy', 'nopredict', 'nomorph', 'jumping', 'overridelocomote'],
    onenter: (inst, speed) => {
      inst.context.entity.locomotor?.stop();
      inst.context.clearBufferedAction();
      inst.context.entity.slipperyfeet?.SetCurrent(0);
      inst.context.playClips([clip('slip_pre'), clip('slip_loop')]);
      inst.context.entity.SoundEmitter.PlaySound('dontstarve/movement/iceslab_slipping');
      inst.statemem.speed = typeof speed === 'number' ? speed : inst.context.entity.runSpeed;
      inst.context.entity.motorSpeed = inst.statemem.speed as number * 0.6;
    },
    timeline: [
      TimeEvent(6 * FRAMES, inst => inst.context.entity.motorSpeed = inst.statemem.speed as number * 0.3),
      TimeEvent(10 * FRAMES, inst => inst.context.entity.SoundEmitter.PlaySound('dontstarve/movement/iceslab_slipping')),
      TimeEvent(12 * FRAMES, inst => inst.context.entity.motorSpeed = inst.statemem.speed as number * 0.25),
      TimeEvent(18 * FRAMES, inst => {
        inst.context.entity.motorSpeed = inst.statemem.speed as number * 0.2;
        inst.statemem.checkfall = true;
      }),
      TimeEvent(20 * FRAMES, inst => inst.context.entity.SoundEmitter.PlaySound('dontstarve/movement/iceslab_slipping', undefined, .5)),
    ],
    events: [
      EventHandler('locomote', inst => {
        if (inst.context.entity.wantsToMoveForward && inst.statemem.checkfall) {
          inst.statemem.slipping = true;
          inst.goToState('slip_fall', inst.statemem.speed as number * 0.25);
        }
      }),
      EventHandler('animqueueover', inst => {
        if (!inst.context.animationDone) return;
        inst.statemem.slipping = true;
        inst.goToState('slip_pst', inst.statemem.speed);
      }),
    ],
    onexit: inst => {
      if (inst.statemem.slipping) return;
      inst.context.entity.motorSpeed = undefined;
      inst.context.entity.locomotor?.stop();
    },
  }),
  State({
    name: 'slip_pst',
    tags: ['busy', 'nopredict', 'nomorph', 'jumping'],
    onenter: (inst, speed) => {
      inst.context.playClips([clip('slip_pst')]);
      inst.statemem.speed = typeof speed === 'number' ? speed : inst.context.entity.runSpeed;
      inst.context.entity.motorSpeed = inst.statemem.speed as number * 0.15;
    },
    timeline: [TimeEvent(2 * FRAMES, inst => inst.context.entity.motorSpeed = inst.statemem.speed as number * 0.1)],
    events: [EventHandler('animover', inst => { if (inst.context.animationDone) inst.goToState('idle'); })],
    onexit: inst => {
      inst.context.entity.motorSpeed = undefined;
      inst.context.entity.locomotor?.stop();
    },
  }),
  State({
    name: 'slip_fall',
    tags: ['busy', 'nopredict', 'nomorph', 'jumping'],
    onenter: (inst, speed) => {
      inst.context.entity.locomotor?.stop();
      inst.context.clearBufferedAction();
      inst.context.entity.slipperyfeet?.SetCurrent(0);
      inst.context.playClips([clip('slip_fall_pre')]);
      inst.context.entity.SoundEmitter.PlaySound('dontstarve/movement/slip_fall_whoop');
      if (typeof speed === 'number') {
        inst.statemem.speed = speed;
        inst.context.entity.motorSpeed = speed * 0.8;
      }
    },
    timeline: [
      TimeEvent(10 * FRAMES, inst => inst.context.entity.SoundEmitter.PlaySound('dontstarve/movement/slip_fall_thud')),
      // The source holds frame 13's speed for two frames on purpose.
      ...([[11, .64], [13, .32], [14, .16], [15, .08], [16, .04], [17, 0]] as const).map(([frame, factor]) =>
        TimeEvent<WilsonStateGraph, WilsonStateName>(frame * FRAMES, inst => {
          if (frame === 11) DoHurtSound(inst.context.entity);
          if (typeof inst.statemem.speed === 'number') inst.context.entity.motorSpeed = inst.statemem.speed * factor;
        })),
    ],
    events: [EventHandler('animover', inst => { if (inst.context.animationDone) inst.goToState('slip_fall_loop'); })],
    onexit: inst => {
      if (typeof inst.statemem.speed !== 'number') return;
      inst.context.entity.motorSpeed = undefined;
      inst.context.entity.locomotor?.stop();
    },
  }),
  State({
    name: 'slip_fall_loop',
    tags: ['busy', 'nomorph', 'overridelocomote'],
    onenter: inst => {
      inst.context.entity.locomotor?.stop();
      inst.context.clearBufferedAction();
      inst.context.entity.slipperyfeet?.SetCurrent(0);
      inst.context.playClips([clip('slip_fall_idle')]);
    },
    events: [
      EventHandler('locomote', inst => { if (inst.context.entity.wantsToMoveForward) inst.goToState('slip_fall_pst'); }),
      EventHandler('animover', inst => { if (inst.context.animationDone) inst.goToState('slip_fall_pst'); }),
    ],
  }),
  State({
    name: 'slip_fall_pst',
    tags: ['busy', 'nomorph'],
    onenter: inst => inst.context.playClips([clip('slip_fall_pst')]),
    timeline: [TimeEvent(12 * FRAMES, inst => inst.goToState('idle', true))],
  }),
  State({
    // SGwilson.lua talk; the character's talk_LP has no sound mapping yet.
    name: 'talk',
    tags: ['idle', 'talking'],
    onenter: (inst, noanim) => {
      if (noanim !== true) inst.context.playClips([{ ...clip('dial_loop'), loop: true }]);
      inst.setTimeout(1.5 + Math.random() * .5);
    },
    ontimeout: inst => inst.goToState('idle'),
    events: [EventHandler('donetalking', inst => inst.goToState('idle'))],
  }),
  State({
    name: 'idle',
    tags: ['idle', 'canrotate'],
    onenter: (inst, pushanim) => onEnterIdle(inst, pushanim === true),
  }),
  State({
    name: 'mine_start',
    tags: ['premine', 'working'],
    onenter: (inst) => inst.context.playClips([clip('pickaxe_pre')]),
    events: [
      EventHandler('unequip', (inst) => inst.goToState('idle')),
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.goToState('mine');
      }),
    ],
  }),
  State({
    name: 'mine',
    tags: ['premine', 'mining', 'working'],
    onenter: (inst) => inst.context.playClips([clip('pickaxe_loop')]),
    timeline: [
      TimeEvent(7 * FRAMES, (inst) => {
        // commonstates.lua PlayMiningFX: its ice and moon glass sounds are not in the sound catalog, and mining_fx is not ported.
        inst.context.entity.SoundEmitter.PlaySound('dontstarve/wilson/use_pick_rock');
        inst.context.performBufferedAction();
      }),
      TimeEvent(9 * FRAMES, (inst) => inst.removeStateTag('premine')),
      // Source frame 14: held-action repetition needs playercontroller/workable.
    ],
    events: [
      EventHandler('unequip', (inst) => inst.goToState('idle')),
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) {
          inst.context.playClips([clip('pickaxe_pst')]);
          inst.goToState('idle', true);
        }
      }),
    ],
  }),
  State({
    name: 'chop_start',
    tags: ['prechop', 'working'],
    onenter: (inst) => inst.context.playClips([clip('chop_pre')]),
    events: [
      EventHandler('unequip', (inst) => inst.goToState('idle')),
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.goToState('chop');
      }),
    ],
  }),
  State({
    name: 'chop',
    tags: ['prechop', 'chopping', 'working'],
    onenter: (inst) => inst.context.playClips([clip('chop_loop')]),
    timeline: [
      TimeEvent(2 * FRAMES, (inst) => inst.context.performBufferedAction()),
      TimeEvent(9 * FRAMES, (inst) => inst.removeStateTag('prechop')),
      // Source frame 14: held-action repetition needs playercontroller/workable.
      TimeEvent(16 * FRAMES, (inst) => inst.removeStateTag('chopping')),
    ],
    events: [
      EventHandler('unequip', (inst) => inst.goToState('idle')),
      // There is no chop_pst animation.
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
  }),
  State({
    name: 'hammer_start',
    tags: ['prehammer', 'working'],
    onenter: (inst) => inst.context.playClips([clip('pickaxe_pre')]),
    events: [
      EventHandler('unequip', (inst) => inst.goToState('idle')),
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.goToState('hammer');
      }),
    ],
  }),
  State({
    name: 'hammer',
    tags: ['prehammer', 'hammering', 'working'],
    onenter: (inst) => inst.context.playClips([clip('pickaxe_loop')]),
    timeline: [
      TimeEvent(7 * FRAMES, (inst) => {
        // The hammer's hit_skin_sound is not ported.
        inst.context.entity.SoundEmitter.PlaySound('dontstarve/wilson/hit');
        inst.context.performBufferedAction();
      }),
      TimeEvent(9 * FRAMES, (inst) => inst.removeStateTag('prehammer')),
      // Source frame 14: held-action repetition needs playercontroller/workable.
    ],
    events: [
      EventHandler('unequip', (inst) => inst.goToState('idle')),
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) {
          inst.context.playClips([clip('pickaxe_pst')]);
          inst.goToState('idle', true);
        }
      }),
    ],
  }),
  State({
    name: 'terraform',
    tags: ['busy'],
    onenter: (inst) => inst.context.playClips([clip('shovel_pre'), clip('shovel_loop')]),
    timeline: [
      TimeEvent(25 * FRAMES, (inst) => {
        const revision = inst.stateRevision;
        inst.context.performBufferedAction();
        if (inst.stateRevision !== revision) return;
        inst.removeStateTag('busy');
        inst.context.entity.SoundEmitter.PlaySound('dontstarve/wilson/dig');
      }),
    ],
    events: [
      EventHandler('unequip', (inst) => inst.goToState('idle')),
      EventHandler('animqueueover', (inst) => {
        if (inst.context.animationDone) {
          inst.context.playClips([clip('shovel_pst')]);
          inst.goToState('idle', true);
        }
      }),
    ],
  }),
  State({
    name: 'dig_start',
    tags: ['predig', 'working'],
    onenter: (inst) => inst.context.playClips([clip('shovel_pre')]),
    events: [
      EventHandler('unequip', (inst) => inst.goToState('idle')),
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.goToState('dig');
      }),
    ],
  }),
  State({
    name: 'dig',
    tags: ['predig', 'digging', 'working'],
    onenter: (inst) => inst.context.playClips([clip('shovel_loop')]),
    timeline: [
      TimeEvent(15 * FRAMES, (inst) => {
        inst.removeStateTag('predig');
        inst.context.entity.SoundEmitter.PlaySound('dontstarve/wilson/dig');
        inst.context.performBufferedAction();
      }),
      // Source frame 35: held-action repetition needs playercontroller/workable.
    ],
    events: [
      EventHandler('unequip', (inst) => inst.goToState('idle')),
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) {
          inst.context.playClips([clip('shovel_pst')]);
          inst.goToState('idle', true);
        }
      }),
    ],
  }),
  State({
    name: 'bugnet_start',
    tags: ['prenet', 'working', 'autopredict'],
    onenter: (inst) => inst.context.playClips([clip('bugnet_pre')]),
    events: [
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.goToState('bugnet');
      }),
    ],
  }),
  State({
    name: 'bugnet',
    tags: ['prenet', 'netting', 'working', 'autopredict'],
    onenter: (inst) => inst.context.playClips([clip('bugnet')]),
    timeline: [
      TimeEvent(10 * FRAMES, (inst) => {
        const revision = inst.stateRevision;
        inst.context.performBufferedAction();
        if (inst.stateRevision !== revision) return;
        inst.removeStateTag('prenet');
        inst.context.entity.SoundEmitter.PlaySound('dontstarve/wilson/dig');
      }),
    ],
    events: [
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
  }),
  State({
    // Visual-only playEat() adapter; inventory food uses quickeat.
    name: 'eat',
    tags: ['busy', 'nodangle', 'keep_pocket_rummage'],
    onenter: (inst) => inst.context.playClips([clip('eat')]),
    events: [
      EventHandler('animqueueover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
  }),
  State({
    name: 'quickeat',
    tags: ['busy', 'keep_pocket_rummage'],
    // SGwilson.lua quickeat: the drink clips for fooddrink-tagged food.
    onenter: (inst) => inst.context.playClips(inst.context.isDrinking
      ? [clip('quick_drink_pre'), clip('quick_drink')] : [clip('quick_eat_pre'), clip('quick_eat')]),
    timeline: [
      // DoEatSound(inst): the eating handle, unless one is already playing.
      TimeEvent(10 * FRAMES, (inst) => { if (!inst.context.entity.SoundEmitter.PlayingSound('eating')) inst.context.entity.SoundEmitter.PlaySound(inst.context.isDrinking ? 'dontstarve/wilson/sip' : 'dontstarve/wilson/eat', 'eating'); }),
      TimeEvent(12 * FRAMES, (inst) => {
        const revision = inst.stateRevision;
        inst.context.performBufferedAction();
        if (inst.stateRevision === revision) inst.removeStateTag('busy');
      }),
    ],
    events: [
      EventHandler('animqueueover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
  }),
  State({
    name: 'doshortaction',
    tags: ['doing', 'busy', 'keepchannelcasting', 'keep_pocket_rummage'],
    onenter: (inst) => {
      inst.context.entity.locomotor?.stop();
      inst.context.playClips([clip('pickup'), clip('pickup_pst')]);
      inst.statemem.action = inst.context.getBufferedAction();
      inst.setTimeout(10 * FRAMES);
    },
    timeline: [
      TimeEvent(6 * FRAMES, (inst) => {
        inst.removeStateTag('busy');
        inst.context.performBufferedAction();
      }),
    ],
    ontimeout: (inst) => inst.goToState('idle', true),
    onexit: (inst) => {
      if (inst.context.getBufferedAction() === inst.statemem.action) inst.context.clearBufferedAction();
    },
  }),
  // SGwilson.lua migrate: the heavy_item_hat branch belongs to unported heavy lifting.
  State({
    name: 'migrate',
    tags: ['doing', 'busy'],
    onenter: (inst) => {
      inst.context.entity.locomotor?.stop();
      inst.context.playClips([clip('pickup')]);
      inst.statemem.action = inst.context.getBufferedAction();
    },
    events: [
      EventHandler('animqueueover', (inst) => {
        if (inst.context.animationDone && !inst.context.performBufferedAction()) {
          inst.context.playClips([clip('pickup_pst')]);
          inst.goToState('idle', true);
        }
      }),
    ],
    onexit: (inst) => {
      if (inst.context.getBufferedAction() === inst.statemem.action) inst.context.clearBufferedAction();
    },
  }),
  State({
    name: 'shell_enter',
    tags: ['hiding', 'notalking', 'shell', 'nomorph', 'busy', 'nopredict'],
    onenter: inst => {
      inst.context.entity.locomotor?.stop();
      inst.context.playClips([clip('hideshell')]);
      inst.setTimeout(23 * FRAMES);
    },
    timeline: [TimeEvent(6 * FRAMES, inst => inst.context.entity.SoundEmitter.PlaySound('dontstarve/movement/foley/hideshell'))],
    events: [
      // The default unequip handler is ignored while busy.
      EventHandler('unequip', (inst, data) => inst.goToState(GetUnequipState(data))),
    ],
    ontimeout: inst => inst.goToState('shell_idle'),
  }),
  State({
    name: 'shell_idle',
    tags: ['hiding', 'notalking', 'shell', 'nomorph', 'idle'],
    onenter: inst => {
      inst.context.entity.locomotor?.stop();
      inst.context.pushClips([clip('hideshell_idle')]);
    },
  }),
  State({
    name: 'shell_hit',
    tags: ['hiding', 'shell', 'nomorph', 'busy', 'pausepredict'],
    onenter: inst => {
      inst.context.entity.locomotor?.stop();
      inst.context.clearBufferedAction();
      inst.context.playClips([clip('hitshell')]);
      inst.context.entity.SoundEmitter.PlaySound('dontstarve/wilson/hit');
      inst.setTimeout(3 * FRAMES);
    },
    events: [
      EventHandler('unequip', inst => { inst.statemem.unequipped = true; }),
    ],
    ontimeout: inst => inst.goToState(inst.statemem.unequipped ? 'idle' : 'shell_idle'),
  }),
  State({
    // SGwilson.lua hit: player_actions' 21-frame `hit` stuns for min(21, 6) frames.
    name: 'hit',
    tags: ['busy', 'pausepredict', 'keepchannelcasting'],
    onenter: inst => {
      inst.context.entity.locomotor?.stop();
      inst.context.clearBufferedAction();
      inst.context.playClips([clip('hit')]);
      playHitSounds(inst.context.entity);
      inst.setTimeout(6 * FRAMES);
    },
    ontimeout: inst => {
      inst.removeStateTag('keepchannelcasting');
      inst.goToState('idle', true);
    },
    events: [EventHandler('animover', inst => { if (inst.context.animationDone) inst.goToState('idle'); })],
  }),
  State({
    // SGwilson.lua portal_rez: the player appears black inside the portal, then tweens back to full colour.
    name: 'portal_rez',
    tags: ['busy', 'nopredict', 'silentmorph'],
    onenter: inst => {
      inst.context.entity.controllerEnabled = false;
      inst.context.playClips([{ ...clip('idle', 'idle_loop'), loop: true }]);
      inst.context.entity.AnimState.SetMultColour(0, 0, 0, 1);
      inst.context.entity.Hide();
      inst.statemem.tweenElapsed = undefined;
    },
    onupdate: (inst, dt) => {
      // components/colourtweener.lua StartTween({ 1, 1, 1, 1 }, 14 * FRAMES): a linear blend from black.
      if (inst.statemem.tweenElapsed === undefined) return;
      const elapsed = Math.min((inst.statemem.tweenElapsed as number) + dt, PORTAL_REZ_TWEEN_TIME);
      inst.statemem.tweenElapsed = elapsed;
      const level = elapsed / PORTAL_REZ_TWEEN_TIME;
      inst.context.entity.AnimState.SetMultColour(level, level, level, 1);
      if (elapsed >= PORTAL_REZ_TWEEN_TIME) {
        inst.statemem.istweencomplete = true;
        inst.goToState('idle');
      }
    },
    timeline: [
      TimeEvent(12 * FRAMES, inst => { inst.context.entity.Show(); }),
      TimeEvent(72 * FRAMES, inst => { inst.statemem.tweenElapsed = 0; }),
    ],
    onexit: inst => {
      // In case of interruptions
      inst.context.entity.Show();
      inst.context.entity.controllerEnabled = true;
      inst.context.entity.components.health?.SetInvincible(false);
      if (!inst.statemem.istweencomplete) inst.context.entity.AnimState.SetMultColour(1, 1, 1, 1);
    },
  }),
  State({
    // SGwilson.lua amulet_rebirth: the resurrecting amulet is consumed while its light and sounds play.
    name: 'amulet_rebirth',
    tags: ['busy', 'nopredict', 'silentmorph'],
    onenter: inst => {
      inst.context.entity.controllerEnabled = false;
      inst.context.playClips([clip('amulet_rebirth')]);
      inst.context.entity.AnimState.OverrideSymbol('FX', 'player_amulet_resurrect', 'FX');
      inst.context.entity.components.health?.SetInvincible(true);
      inst.context.entity.ShowHUD(false);
      inst.statemem.usedamulet = ConsumeEquippedAmulet(inst.context.entity);
    },
    timeline: [
      TimeEvent(0, inst => {
        SpawnCastingLight(inst.context.entity, [150 / 255, 46 / 255, 46 / 255], 1.7, 1);
        inst.context.entity.SoundEmitter.PlaySound('dontstarve/common/rebirth_amulet_raise');
      }),
      TimeEvent(60 * FRAMES, inst => { inst.context.entity.SoundEmitter.PlaySound('dontstarve/common/rebirth_amulet_poof'); }),
      TimeEvent(80 * FRAMES, inst => { SleepNearby(inst.context.entity, 10, 20); }),
    ],
    events: [
      EventHandler('animover', inst => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
    onexit: inst => {
      if (inst.statemem.usedamulet && !!!inst.context.entity.components.inventory?.GetEquippedItem('body')) inst.context.entity.AnimState.ClearOverrideSymbol('swap_body');
      inst.context.entity.ShowHUD(true);
      inst.context.entity.controllerEnabled = true;
      inst.context.entity.components.health?.SetInvincible(false);
      inst.context.entity.AnimState.ClearOverrideSymbol('FX');
    },
  }),
  State({
    // SGwilson.lua death, the unmounted Wilson branch (no vinesave, backup body, revivable corpse or hosted death).
    // animover hands the player to player_common's OnMakePlayerGhost (ghostenabled); the revivable corpse and playerdied branches are not ported.
    name: 'death',
    tags: ['busy', 'dead', 'pausepredict', 'nomorph'],
    onenter: inst => {
      inst.context.entity.locomotor?.stop();
      inst.context.releaseAction();
      inst.context.entity.SoundEmitter.PlaySound('dontstarve/wilson/death');
      inst.context.entity.SoundEmitter.PlaySound('dontstarve/characters/maxwell/death_voice');
      inst.context.entity.deathHost?.dropEverything();
      inst.context.playClips([clip('death')]);
      // playercontroller:Enable(false)
      inst.context.entity.controllerEnabled = false;
    },
    events: [
      EventHandler('animover', inst => {
        if (!inst.context.animationDone) return;
        // if we are not on valid ground then don't drop a skeleton
        inst.context.entity.PushEvent('makeplayerghost', { skeleton: inst.context.entity.deathHost?.isPassableAtPoint() ?? false });
      }),
    ],
  }),
  State({
    name: 'item_in',
    tags: ['idle', 'nodangle', 'keepchannelcasting'],
    onenter: (inst) => inst.context.playClips([clip('item_in')]),
    events: [
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
  }),
  State({
    name: 'item_hat',
    tags: ['idle', 'keepchannelcasting'],
    onenter: (inst) => {
      inst.context.entity.locomotor?.stop();
      inst.context.playClips([clip('item_hat')]);
    },
    events: [
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
  }),
  State({
    name: 'item_out',
    tags: ['idle', 'nodangle', 'keepchannelcasting'],
    onenter: (inst) => inst.context.playClips([clip('item_out')]),
    events: [
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
  }),
  State({
    name: 'castspell',
    tags: ['doing', 'busy', 'canrotate'],
    onenter: (inst) => {
      inst.context.playClips([clip('staff_pre'), clip('staff')]);
      inst.context.entity.controllerEnabled = false;
      inst.context.entity.locomotor?.stop();
      inst.statemem.castsound = inst.context.getBufferedAction()?.invobject?.castsound ?? 'dontstarve/wilson/use_gemstaff';
      inst.statemem.stafflight = SpawnCastingLight(inst.context.entity, inst.context.getBufferedAction()?.invobject?.fxcolour ?? [1, 1, 1], 1.9, .33);
    },
    timeline: [
      TimeEvent(13 * FRAMES, (inst) => inst.context.entity.SoundEmitter.PlaySound(inst.statemem.castsound as SoundEventPath)),
      TimeEvent(53 * FRAMES, (inst) => {
        inst.statemem.stafflight = undefined; // Can't be cancelled anymore
        inst.context.performBufferedAction();
      }),
      TimeEvent(69 * FRAMES, (inst) => {
        inst.removeStateTag('busy');
        inst.context.entity.controllerEnabled = true;
      }),
    ],
    events: [
      EventHandler('animqueueover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
    onexit: (inst) => {
      inst.context.entity.controllerEnabled = true;
      (inst.statemem.stafflight as { remove(): void } | undefined)?.remove();
    },
  }),
  State({
    name: 'veryquickcastspell',
    tags: ['doing', 'busy', 'canrotate'],
    onenter: (inst) => {
      inst.context.playClips([clip('atk_pre'), clip('atk')]);
      inst.context.entity.SoundEmitter.PlaySound('dontstarve/wilson/attack_weapon');
    },
    timeline: [
      TimeEvent(9 * FRAMES, (inst) => {
        const revision = inst.stateRevision;
        inst.context.performBufferedAction();
        if (inst.stateRevision === revision) inst.removeStateTag('busy');
      }),
    ],
    events: [
      EventHandler('animqueueover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
  }),
  State({
    // SGwilson.lua attack: the unmounted toolpunch / weapon / light-nopunch / punch branches.
    name: 'attack',
    tags: ['attack', 'notalking', 'abouttoattack', 'autopredict'],
    onenter: (inst) => {
      const combat = inst.context.entity.combat;
      if (!combat || combat.InCooldown()) {
        inst.removeStateTag('abouttoattack');
        inst.context.clearBufferedAction();
        inst.goToState('idle', true);
        return;
      }
      const action = inst.context.getBufferedAction();
      const equip = action?.invobject;
      combat.StartAttack();
      inst.context.entity.locomotor?.stop();
      let cooldown = combat.min_attack_period;
      if (equip?.hasTag('toolpunch')) {
        inst.context.playClips([clip('toolpunch')]);
        inst.context.entity.SoundEmitter.PlaySound('dontstarve/wilson/attack_whoosh');
        cooldown = Math.max(cooldown, 13 * FRAMES);
      } else if (equip?.hasTag('weapon') && !equip.hasTag('punch')) {
        inst.context.playClips([clip('atk_pre'), clip('atk')]);
        const projectiledelay = equip.projectiledelay ?? 0;
        if (projectiledelay > 0) {
          // Projectiles stay hidden for their first frames, so the swing starts early to keep the animation in sync.
          inst.statemem.projectiledelay = 8 * FRAMES - projectiledelay;
          if ((inst.statemem.projectiledelay as number) > FRAMES) {
            inst.statemem.projectilesound = equip.hasTag('firestaff') ? 'dontstarve/wilson/attack_firestaff' : 'dontstarve/wilson/attack_weapon';
          } else if ((inst.statemem.projectiledelay as number) <= 0) inst.statemem.projectiledelay = undefined;
        }
        if (inst.statemem.projectilesound === undefined) {
          inst.context.entity.SoundEmitter.PlaySound(equip.hasTag('shadow') ? 'dontstarve/wilson/attack_nightsword'
            : equip.hasTag('firestaff') ? 'dontstarve/wilson/attack_firestaff' : 'dontstarve/wilson/attack_weapon');
        }
        cooldown = Math.max(cooldown, 13 * FRAMES);
      } else if (equip?.hasTag('light') || equip?.hasTag('nopunch')) {
        inst.context.playClips([clip('atk_pre'), clip('atk')]);
        inst.context.entity.SoundEmitter.PlaySound('dontstarve/wilson/attack_weapon');
        cooldown = Math.max(cooldown, 13 * FRAMES);
      } else {
        inst.context.playClips([clip('punch')]);
        inst.context.entity.SoundEmitter.PlaySound('dontstarve/wilson/attack_whoosh');
        cooldown = Math.max(cooldown, 24 * FRAMES);
      }
      inst.setTimeout(cooldown);
      inst.statemem.attacktarget = action?.target;
    },
    onupdate: (inst, dt) => {
      const delay = inst.statemem.projectiledelay as number | undefined;
      if (delay === undefined || delay <= 0) return;
      inst.statemem.projectiledelay = delay - dt;
      if (delay - dt <= FRAMES) {
        if (inst.statemem.projectilesound !== undefined) {
          inst.context.entity.SoundEmitter.PlaySound(inst.statemem.projectilesound as SoundEventPath);
          inst.statemem.projectilesound = undefined;
        }
        if (delay - dt <= 0) {
          inst.context.performBufferedAction();
          inst.removeStateTag('abouttoattack');
        }
      }
    },
    timeline: [
      TimeEvent(8 * FRAMES, (inst) => {
        if (inst.statemem.projectiledelay !== undefined) return;
        inst.context.performBufferedAction();
        inst.removeStateTag('abouttoattack');
      }),
    ],
    ontimeout: (inst) => {
      inst.removeStateTag('attack');
      inst.addStateTag('idle');
    },
    events: [
      EventHandler('equip', (inst) => inst.goToState('idle')),
      EventHandler('unequip', (inst) => inst.goToState('idle')),
      EventHandler('animqueueover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
    onexit: (inst) => {
      if (inst.hasStateTag('abouttoattack')) inst.context.entity.combat?.CancelAttack();
    },
  }),
  State({
    name: 'emote',
    tags: ['busy', 'pausepredict'],
    onenter: (inst) => {
      // An accepted emote can interrupt working states that have no busy tag.
      inst.context.releaseAction();
      inst.context.playClips(inst.context.emoteClips);
    },
    timeline: [
      TimeEvent(.5, (inst) => {
        inst.removeStateTag('busy');
        inst.removeStateTag('pausepredict');
      }),
    ],
    events: [
      EventHandler('animqueueover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
  }),
  State({
    name: 'till_start',
    tags: ['doing', 'busy'],
    onenter: (inst) => inst.context.playClips([clip('till_pre')]),
    events: [
      EventHandler('unequip', (inst) => inst.goToState('idle')),
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.goToState('till');
      }),
    ],
  }),
  State({
    name: 'till',
    tags: ['doing', 'busy', 'tilling'],
    onenter: (inst) => inst.context.playClips([clip('till_loop')]),
    timeline: [
      TimeEvent(4 * FRAMES, (inst) => inst.context.entity.SoundEmitter.PlaySound('dontstarve/wilson/dig')),
      TimeEvent(11 * FRAMES, (inst) => inst.context.performBufferedAction()),
      TimeEvent(12 * FRAMES, (inst) => inst.context.entity.SoundEmitter.PlaySound('dontstarve_DLC001/creatures/mole/emerge')),
      TimeEvent(22 * FRAMES, (inst) => inst.removeStateTag('busy')),
    ],
    events: [
      EventHandler('unequip', (inst) => inst.goToState('idle')),
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) {
          inst.context.playClips([clip('till_pst')]);
          inst.goToState('idle', true);
        }
      }),
    ],
  }),
  State({
    name: 'dolongaction',
    tags: ['doing', 'busy', 'nodangle', 'keep_pocket_rummage'],
    onenter: (inst) => {
      inst.setTimeout(1);
      inst.context.entity.locomotor?.stop();
      inst.context.entity.SoundEmitter.PlaySound('dontstarve/wilson/make_trap', 'make');
      inst.context.playClips([clip('build_pre'), { ...clip('build_loop'), loop: true }]);
      inst.statemem.action = inst.context.getBufferedAction();
      // SGwilson.lua dolongaction: the target learns that a long action started on it.
      inst.context.getBufferedAction()?.target?.PushEvent?.('startlongaction', inst);
    },
    timeline: [TimeEvent(4 * FRAMES, (inst) => inst.removeStateTag('busy'))],
    ontimeout: (inst) => {
      inst.context.entity.SoundEmitter.KillSound('make');
      inst.context.playClips([clip('build_pst')]);
      inst.removeStateTag('busy');
      inst.context.performBufferedAction();
    },
    events: [EventHandler('animqueueover', (inst) => {
      if (inst.context.animationDone) inst.goToState('idle');
    })],
    onexit: (inst) => {
      inst.context.entity.SoundEmitter.KillSound('make');
      if (inst.context.getBufferedAction() === inst.statemem.action) inst.context.clearBufferedAction();
    },
  }),
  State({
    // Unmounted book branch: spellbook/aoetargeting, repeatcast and shadowmagic need unported components.
    name: 'book',
    tags: ['doing', 'busy'],
    onenter: (inst) => {
      inst.context.entity.locomotor?.stop();
      inst.context.playClips([clip('action_uniqueitem_pre')]);
      inst.statemem.book_fx = inst.context.entity.bookFx?.spawn('book_fx');
    },
    events: [
      EventHandler('animover', (inst) => {
        if (!inst.context.animationDone) return;
        inst.statemem.not_interrupted = true;
        inst.goToState('book2', { book_fx: inst.statemem.book_fx });
      }),
    ],
    onexit: (inst) => {
      const fx = inst.statemem.book_fx as WilsonFx | undefined;
      if (!inst.statemem.not_interrupted && fx?.isValid()) fx.remove();
    },
  }),
  State({
    name: 'book2',
    tags: ['doing', 'busy'],
    onenter: (inst, data) => {
      inst.context.playClips([clip('book')]);
      inst.statemem.book_fx = (data as { book_fx?: WilsonFx } | undefined)?.book_fx;
      const book = inst.context.getBufferedAction()?.invobject;
      if (book) {
        if (book.def?.fx_over_prefab) inst.statemem.fx_over = inst.context.entity.bookFx?.spawn(book.def.fx_over_prefab, 'swap_book_fx_over');
        if (book.def?.fx_under_prefab) inst.statemem.fx_under = inst.context.entity.bookFx?.spawn(book.def.fx_under_prefab, 'swap_book_fx_under');
        const layer = book.def?.layer_sound;
        if (layer) {
          // Track the one-shot by name so an interrupted read can lower it.
          const frame = layer.frame ?? 0;
          if (frame > 0) {
            inst.statemem.soundtask = inst.schedule(frame * FRAMES, () => {
              inst.statemem.soundtask = undefined;
              inst.context.entity.SoundEmitter.PlaySound(layer.sound, 'book_layer_sound');
            });
          } else inst.context.entity.SoundEmitter.PlaySound(layer.sound, 'book_layer_sound');
        }
        const prefix = book.swap_prefix ?? 'book';
        const skinBuild = book.GetSkinBuild?.();
        if (skinBuild) {
          inst.context.entity.AnimState.OverrideItemSkinSymbol('book_open', skinBuild, 'book_open', book.id ?? '', book.swap_build ?? 'player_actions_uniqueitem', `${prefix}_open`);
          inst.context.entity.AnimState.OverrideItemSkinSymbol('book_closed', skinBuild, 'book_closed', book.id ?? '', book.swap_build ?? 'player_actions_uniqueitem', `${prefix}_closed`);
          inst.statemem.symbolsoverridden = true;
        } else if (book.swap_build) {
          inst.context.entity.AnimState.OverrideSymbol('book_open', book.swap_build, `${prefix}_open`);
          inst.context.entity.AnimState.OverrideSymbol('book_closed', book.swap_build, `${prefix}_closed`);
          inst.statemem.symbolsoverridden = true;
        }
      }
      inst.statemem.castsound = book?.castsound ?? 'dontstarve/common/book_spell';
    },
    timeline: [
      // Without repeatcast, source frame 13 defers fn19 and frame 44 defers fn50.
      TimeEvent(19 * FRAMES, (inst) => inst.context.entity.SoundEmitter.PlaySound('dontstarve/common/use_book_light')),
      TimeEvent(50 * FRAMES, (inst) => {
        const fx = inst.statemem.book_fx as WilsonFx | undefined;
        const bookFx = fx?.isValid() ? fx : undefined;
        bookFx?.detach();
        inst.statemem.book_fx = undefined; // Don't cancel anymore
        inst.context.entity.SoundEmitter.PlaySound(inst.statemem.castsound as SoundEventPath);
        inst.removeStateTag('busy');
        if (!inst.context.performBufferedAction()) bookFx?.pushEvent('fail_fx');
      }),
      TimeEvent(51 * FRAMES, (inst) => inst.context.entity.SoundEmitter.PlaySound('dontstarve/common/use_book_close')),
      TimeEvent(52 * FRAMES, (inst) => inst.removeStateTag('busy')),
    ],
    events: [
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
    onexit: (inst) => {
      if (inst.statemem.symbolsoverridden) {
        inst.context.entity.AnimState.OverrideSymbol('book_open', 'player_actions_uniqueitem', 'book_open');
        inst.context.entity.AnimState.OverrideSymbol('book_closed', 'player_actions_uniqueitem', 'book_closed');
      }
      for (const key of ['book_fx', 'fx_over', 'fx_under']) {
        const fx = inst.statemem[key] as WilsonFx | undefined;
        if (fx?.isValid()) fx.remove();
      }
      const soundtask = inst.statemem.soundtask as (() => void) | undefined;
      if (soundtask) soundtask();
      else if (inst.context.entity.SoundEmitter.PlayingSound('book_layer_sound')) inst.context.entity.SoundEmitter.SetVolume('book_layer_sound', .5);
    },
  }),
  State({
    // SGwilson.lua play_strum: the trident's cast, with its swap symbol taken from the plain build.
    name: 'play_strum',
    tags: ['doing', 'busy', 'playing', 'canrotate'],
    onenter: (inst) => {
      inst.context.entity.locomotor?.stop();
      inst.context.playClips([clip('strum_pre'), clip('strum')]);
      inst.context.entity.AnimState.OverrideSymbol('swap_trident', 'swap_trident', 'swap_trident');
    },
    timeline: [
      TimeEvent(23 * FRAMES, (inst) => inst.context.entity.SoundEmitter.PlaySound('hookline_2/characters/trident_attack')),
      TimeEvent(28 * FRAMES, (inst) => {
        if (!inst.context.performBufferedAction()) inst.statemem.action_failed = true;
      }),
      TimeEvent(32 * FRAMES, (inst) => { if (inst.statemem.action_failed) inst.removeStateTag('busy'); }),
      TimeEvent(41 * FRAMES, (inst) => { if (!inst.statemem.action_failed) inst.removeStateTag('busy'); }),
    ],
    events: [EventHandler('animqueueover', (inst) => { if (inst.context.animationDone) inst.goToState('idle'); })],
    onexit: (inst) => inst.context.entity.AnimState.ClearOverrideSymbol('swap_trident'),
  }),
  State({
    // Unmounted branch with the stock pan flute build; instrument asset/sound overrides belong to unported instruments.
    name: 'play_flute',
    tags: ['doing', 'busy', 'playing'],
    onenter: (inst) => {
      inst.context.entity.locomotor?.stop();
      inst.context.playClips([clip('action_uniqueitem_pre'), clip('flute')]);
      const flute = inst.context.getBufferedAction()?.invobject, skinBuild = flute?.GetSkinBuild?.();
      if (flute && skinBuild) inst.context.entity.AnimState.OverrideItemSkinSymbol('pan_flute01', skinBuild, 'pan_flute01', flute.id ?? '', 'pan_flute', 'pan_flute01');
      else inst.context.entity.AnimState.OverrideSymbol('pan_flute01', 'pan_flute', 'pan_flute01');
    },
    timeline: [
      TimeEvent(30 * FRAMES, (inst) => {
        if (inst.context.performBufferedAction()) inst.context.entity.SoundEmitter.PlaySound('dontstarve/wilson/flute_LP', 'flute');
        else inst.statemem.action_failed = true;
      }),
      TimeEvent(36 * FRAMES, (inst) => { if (inst.statemem.action_failed) inst.removeStateTag('busy'); }),
      TimeEvent(52 * FRAMES, (inst) => { if (!inst.statemem.action_failed) inst.removeStateTag('busy'); }),
      TimeEvent(85 * FRAMES, (inst) => { if (!inst.statemem.action_failed) inst.context.entity.SoundEmitter.KillSound('flute'); }),
    ],
    events: [EventHandler('animqueueover', (inst) => { if (inst.context.animationDone) inst.goToState('idle'); })],
    onexit: (inst) => {
      inst.context.entity.SoundEmitter.KillSound('flute');
      inst.context.entity.AnimState.ClearOverrideSymbol('pan_flute01');
    },
  }),
  // SGwilson.lua fishing_pre … loserod; fishing is a prefish/fishing state, not busy, until the fish is landed.
  State({
    name: 'fishing_pre',
    tags: ['prefish', 'fishing'],
    onenter: (inst) => {
      inst.context.entity.locomotor?.stop();
      inst.context.playClips([fishingClip('fishing_pre'), fishingClip('fishing_cast')]);
    },
    timeline: [
      TimeEvent(13 * FRAMES, (inst) => inst.context.entity.SoundEmitter.PlaySound('dontstarve/common/fishingpole_cast')),
      TimeEvent(15 * FRAMES, (inst) => { inst.context.performBufferedAction(); }),
    ],
    events: [
      EventHandler('animqueueover', (inst) => {
        if (!inst.context.animationDone) return;
        inst.context.entity.SoundEmitter.PlaySound('dontstarve/common/fishingpole_baitsplash');
        inst.goToState('fishing');
      }),
    ],
  }),
  State({
    name: 'fishing',
    tags: ['fishing'],
    onenter: (inst, pushanim) => {
      const idle = { ...fishingClip('fishing_idle'), loop: true };
      inst.context.playClips(typeof pushanim === 'string' ? [fishingClip(pushanim), idle] : [idle]);
      inst.context.entity.fishingHost?.waitForFish();
    },
    events: [EventHandler('fishingnibble', (inst) => inst.goToState('fishing_nibble'))],
  }),
  State({
    name: 'fishing_pst',
    onenter: (inst) => {
      inst.context.entity.locomotor?.stop();
      inst.context.playClips([fishingClip('fishing_pst')]);
    },
    events: [EventHandler('animover', (inst) => { if (inst.context.animationDone) inst.goToState('idle'); })],
  }),
  State({
    name: 'fishing_nibble',
    tags: ['fishing', 'nibble'],
    onenter: (inst) => {
      inst.context.playClips([fishingClip('bite_light_pre'), { ...fishingClip('bite_light_loop'), loop: true }]);
      inst.setTimeout(1 + Math.random());
      inst.context.entity.SoundEmitter.PlaySound('dontstarve/common/fishingpole_fishinwater', 'splash');
    },
    ontimeout: (inst) => inst.goToState('fishing', 'bite_light_pst'),
    events: [EventHandler('fishingstrain', (inst) => inst.goToState('fishing_strain'))],
    onexit: (inst) => inst.context.entity.SoundEmitter.KillSound('splash'),
  }),
  State({
    name: 'fishing_strain',
    tags: ['fishing'],
    onenter: (inst) => {
      inst.context.playClips([fishingClip('bite_heavy_pre'), { ...fishingClip('bite_heavy_loop'), loop: true }]);
      inst.context.entity.SoundEmitter.PlaySound('dontstarve/common/fishingpole_fishinwater', 'splash');
    },
    events: [
      EventHandler('fishingcatch', (inst, data) => inst.goToState('catchfish', data.build)),
      EventHandler('fishingloserod', (inst) => inst.goToState('loserod')),
    ],
    onexit: (inst) => inst.context.entity.SoundEmitter.KillSound('splash'),
  }),
  State({
    name: 'catchfish',
    tags: ['fishing', 'catchfish', 'busy'],
    onenter: (inst, build) => {
      inst.context.playClips([fishingClip('fish_catch')]);
      inst.context.entity.AnimState.OverrideSymbol('fish01', build as string, 'fish01');
    },
    timeline: [
      TimeEvent(8 * FRAMES, (inst) => inst.context.entity.SoundEmitter.PlaySound('dontstarve/common/fishingpole_fishcaught')),
      TimeEvent(10 * FRAMES, (inst) => inst.removeStateTag('fishing')),
      TimeEvent(23 * FRAMES, (inst) => inst.context.entity.SoundEmitter.PlaySound('dontstarve/common/fishingpole_fishland')),
      TimeEvent(24 * FRAMES, (inst) => {
        // The state owns the rest of the animation even if the last use removes the rod.
        inst.context.releaseAction();
        inst.context.entity.fishingHost?.collect();
      }),
    ],
    events: [EventHandler('animover', (inst) => { if (inst.context.animationDone) inst.goToState('idle'); })],
    onexit: (inst) => inst.context.entity.AnimState.ClearOverrideSymbol('fish01'),
  }),
  State({
    name: 'loserod',
    tags: ['busy', 'nopredict'],
    onenter: (inst) => {
      inst.context.releaseAction();
      inst.context.entity.fishingHost?.loseRod();
      inst.context.playClips([fishingClip('fish_nocatch')]);
    },
    timeline: [TimeEvent(4 * FRAMES, (inst) => inst.context.entity.SoundEmitter.PlaySound('dontstarve/common/fishingpole_lostrod'))],
    events: [EventHandler('animover', (inst) => { if (inst.context.animationDone) inst.goToState('idle'); })],
  }),
];

/** Browser movement/visual adapters; Lua's locomotion states are not ported here. */
const applicationStates: StateDefinition<WilsonStateGraph, WilsonStateName>[] = [
  State({
    name: 'walk',
    tags: ['moving', 'running'],
    onenter: (inst) => inst.context.playClips([{ ...clip('walk', 'run_loop'), loop: true, playbackRate: 16 / 30 }]),
  }),
  State({
    name: 'run',
    tags: ['moving', 'running'],
    onenter: (inst) => inst.context.playClips([{ ...clip('run', 'run_loop'), loop: true }]),
  }),
  State({
    name: 'jump',
    tags: ['jumping', 'busy'],
    onenter: (inst) => inst.context.playClips([{ ...clip('jump'), loop: true }]),
  }),
  State({
    name: 'build',
    tags: ['crafting', 'busy'],
    onenter: (inst) => inst.context.playClips([{ ...clip('build', 'build_loop'), loop: true }]),
  }),
  State({
    name: 'pickup',
    tags: ['busy'],
    onenter: (inst) => inst.context.playClips([{ ...clip('pickup'), playbackRate: .5 }]),
    events: [
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.context.finish();
      }),
    ],
  }),
];

/** SGwilson.lua action handlers for the supported, unmounted player/tool branches. */
const actionHandlers: StateActionHandler<WilsonStateGraph, WilsonStateName, PlayerAction>[] = [
  ActionHandler('BLINK', (inst, action) => !action.invobject && inst.context.entity.soulHopHost ? 'portal_jumpin_pre' : null),
  ActionHandler('BLINK_MAP', (inst, action) => !action.invobject && inst.context.entity.soulHopHost ? 'portal_jumpin_pre' : null),
  // Ranged, blowdart and mounted destinations need unported states.
  ActionHandler('ATTACK', (inst, action) =>
    inst.hasStateTag('attack') && action.target === inst.statemem.attacktarget ? null : 'attack'),
  ActionHandler('MINE', (inst) => {
    if (inst.hasStateTag('premine')) return null;
    return inst.hasStateTag('mining') ? 'mine' : 'mine_start';
  }),
  ActionHandler('CHOP', (inst) => {
    if (inst.hasStateTag('prechop')) return null;
    return inst.hasStateTag('chopping') ? 'chop' : 'chop_start';
  }),
  ActionHandler('HAMMER', (inst) => {
    if (inst.hasStateTag('prehammer')) return null;
    return inst.hasStateTag('hammering') ? 'hammer' : 'hammer_start';
  }),
  ActionHandler('DIG', (inst) => {
    if (inst.hasStateTag('predig')) return null;
    return inst.hasStateTag('digging') ? 'dig' : 'dig_start';
  }),
  ActionHandler('NET', (inst, action) => {
    // The source nabbag branch requires an unported state.
    if (action.invobject?.hasTag('nabbag')) return null;
    if (!action.invobject?.hasTag('NET_tool')) return 'doshortaction';
    if (inst.hasStateTag('prenet')) return null;
    return inst.hasStateTag('netting') ? 'bugnet' : 'bugnet_start';
  }),
  ActionHandler('PLANT', 'doshortaction'),
  ActionHandler('PLANTSOIL', 'dolongaction'),
  ActionHandler('FERTILIZE', 'doshortaction'),
  ActionHandler('BATHBOMB', 'doshortaction'),
  ActionHandler('DEPLOY', 'doshortaction'),
  ActionHandler('DEPLOY_TILEARRIVE', 'doshortaction'),
  ActionHandler('PICKUP', 'doshortaction'),
  ActionHandler('MIGRATE', 'migrate'),
  ActionHandler('HARVEST', 'dolongaction'),
  ActionHandler('STORE', 'doshortaction'),
  ActionHandler('ADDFUEL', 'doshortaction'),
  ActionHandler('ADDWETFUEL', 'doshortaction'),
  // SGwilson.lua DROP: heavylifting_drop and the floater branch belong to unported mechanics.
  ActionHandler('DROP', 'doshortaction'),
  // SGwilson.lua TAKEITEM: the inventoryitemholder_take and target.takeitem branches belong to unported holders.
  ActionHandler('TAKEITEM', 'dolongaction'),
  ActionHandler('REPAIR', (_inst, action) => action.target?.hasTag('repairshortaction') ? 'doshortaction' : 'dolongaction'),
  ActionHandler('FEED', (_inst, action) => action.invobject?.hasTag('quickfeed')
    ? action.target?.hasTag('INLIMBO') ? 'doshortaction' : 'give' : 'dolongaction'),
  ActionHandler('TURNOFF', 'give'),
  ActionHandler('TURNON', 'give'),
  // SGwilson.lua RUMMAGE: the pocket rummage branches (invobject, mount) are not ported.
  ActionHandler('RUMMAGE', 'doshortaction'),
  ActionHandler('GIVE', (_inst, action) => action.target?.hasTag('give_dolongaction') ? 'dolongaction' : 'give'),
  ActionHandler('PICK', (_inst, action) => {
    // SGwilson.lua:1043-1077 — jostle/skill/riding branches remain unported.
    if (action.target?.hasTag('jostlepick')) return null;
    if (action.target?.hasTag('noquickpick')) return 'dolongaction';
    const pickable = action.target?.components.pickable;
    return pickable?.quickpick ? 'doshortaction' : 'dolongaction';
  }),
  ActionHandler('LIGHT', 'catchonfire'),
  ActionHandler('SHAVE', 'shave'),
  // The bedroll branch (action.invobject) is not ported; tents go to the tent state.
  ActionHandler('SLEEPIN', (_inst, action) => action.invobject ? null : 'tent'),
  ActionHandler('TERRAFORM', 'terraform'),
  ActionHandler('FISH', 'fishing_pre'),
  ActionHandler('EAT', (inst, action) => {
    if (inst.hasStateTag('busy')) return null;
    const obj = action.target ?? action.invobject;
    if (!obj?.components.edible) return null;
    // eater:PrefersToEat, the soul branch, the slow/meat "eat" state and floating remain unported: only quickeat is connected.
    return 'quickeat';
  }),
  ActionHandler('CASTSPELL', (_inst, action) => {
    const tool = action.invobject;
    // These source destinations need states/assets not yet implemented.
    if (tool?.hasTag('gnarwail_horn')
      || tool?.hasTag('cointosscast') || tool?.hasTag('crushitemcast')
      || tool?.hasTag('quickcast')) return null;
    if (tool?.hasTag('guitar')) return 'play_strum';
    if (tool?.hasTag('veryquickcast')) return 'veryquickcastspell';
    if (tool?.hasTag('mermbuffcast')) return null;
    return 'castspell';
  }),
  ActionHandler('TILL', 'till_start'),
  // simplebook (cookbook_open) and aspiring_bookworm (book_peruse) readers are not ported.
  ActionHandler('READ', 'book'),
  // Only the flute branch of SGwilson's PLAY handler is ported.
  ActionHandler('PLAY', (_inst, action) => action.invobject?.hasTag('flute') ? 'play_flute' : null),
];

export class WilsonStateGraph {
  /** The entity the states act on, as `inst` in the source. */
  readonly entity: WilsonStateInst;
  private sg: WilsonInstance;
  private ghost = false;
  private loadingGhostFlag = false;
  private bufferedAction: PlayerAction<WilsonAction> | null = null;
  private movementState: WilsonMovementState = 'idle';
  private crafting = false;
  private readonly playback: AnimationPlayback<WilsonAnimationClip>;
  private clipStartedAt = 0;
  private preparedEmote: readonly WilsonAnimationClip[] = [];
  private foodDrink = false;
  private activeAction: WilsonAction | null = null;
  private activeBufferedAction: PlayerAction<WilsonAction> | undefined;
  private activeInvobject: BufferedActionObject | undefined;

  constructor(entity: WilsonStateInst) {
    this.entity = entity;
    this.sg = this.createGraph();
    this.playback = new AnimationPlayback<WilsonAnimationClip>(clip => {
      this.clipStartedAt = this.sg.elapsedTime;
      if (this.stateName === 'idle' && clip.key === 'idle' && (this.crafting || this.movementState !== 'idle')) {
        this.sg.goToState(this.crafting ? 'build' : this.movementState);
        return 0;
      }
      // AnimState:SetDeltaTimeMultiplier and PlayAnimation; the clip's length at that rate schedules animover.
      const rate = clip.playbackRate ?? 1, { AnimState } = this.entity;
      AnimState.SetDeltaTimeMultiplier(rate);
      AnimState.PlayAnimation(clip.name, clip.loop);
      return AnimState.GetCurrentAnimationLength() / rate;
    }, (seconds, complete) => this.sg.schedule(seconds, complete));
    this.playback.on('animover', () => this.pushEvent('animover'));
    this.playback.on('animqueueover', () => this.pushEvent('animqueueover'));
    this.sg.goToState('idle');
  }

  private createGraph(): WilsonInstance {
    this.sg = new StateGraphInstance(this, [...states, ...wortoxStates, ...applicationStates], actionHandlers);
    // stategraph.lua pushes "newstate" to the inst on every GoToState.
    this.sg.onNewState(() => this.entity.PushEvent('newstate', { statename: this.sg.stateName }));
    // SGwilson.lua EventHandler("toolbroke"): ignored during nointerrupt states.
    this.sg.listenForEvent('toolbroke', data => {
      if (this.sg.hasStateTag('nointerrupt')) return;
      this.releaseAction();
      this.sg.goToState('toolbroke', data.tool);
    });
    // SGwilson.lua EventHandler("equip"): item_out for a hand item, item_hat otherwise, from an idle or channeling state.
    // The heavy lifting, catch_equip and wereplayer branches belong to unported components.
    this.sg.listenForEvent('equip', data => {
      if (this.sg.handlesEvent('equip') || this.sg.hasStateTag('acting') || this.ghost) return;
      if (this.sg.hasAnyStateTag('idle', 'channeling')) {
        this.sg.goToState(data.eslot === 'HANDS' ? 'item_out' : 'item_hat');
      }
    });
    // SGwilson.lua EventHandler("unequip") + GetUnequipState: item_hat off a non-hand slot, item_in otherwise.
    this.sg.listenForEvent('unequip', data => {
      if (this.sg.handlesEvent('unequip') || this.sg.hasStateTag('acting') || this.ghost) return;
      if (this.sg.hasAnyStateTag('idle', 'channeling')) {
        this.sg.goToState(GetUnequipState(data));
      }
    });
    // SGwilson.lua EventHandler("death"): every state yields except one that has already died.
    this.sg.listenForEvent('death', () => {
      if (this.sg.hasStateTag('dead')) return;
      this.sg.goToState('death');
    });
    // SGwilson.lua EventHandler("attacked") for the ported states; electric, parry, pinned and stunlock branches need
    // unported components. A living stategraph is never in a dead state while its health is above zero.
    this.sg.listenForEvent('attacked', () => {
      if (this.sg.hasStateTag('dead')) return;
      if (this.sg.hasStateTag('sleeping')) {
        playHitSounds(this.entity);
        const bag = this.entity.components.sleepingbaguser?.bed;
        if (bag) bag.DoWakeUp();
        else { this.sg.statemem.iswaking = true; this.sg.goToState('wakeup'); }
      } else if (this.sg.hasStateTag('nointerrupt')) playHitSounds(this.entity);
      else if (this.sg.hasStateTag('shell')) this.sg.goToState('shell_hit');
      else this.sg.goToState('hit');
    });
    // SGwilson.lua EventHandler("blocked"): armor soaked the hit.
    this.sg.listenForEvent('blocked', () => {
      if (this.sg.hasStateTag('shell')) this.sg.goToState('shell_hit');
    });
    // SGwilson.lua EventHandler("locomote"): an idle-tagged shell state yields to movement.
    this.sg.listenForEvent('locomote', () => {
      if ((this.sg.hasStateTag('shell') || this.sg.hasStateTag('talking')) && !this.sg.hasStateTag('busy')) this.finish();
    });
    // SGwilson.lua EventHandler("ontalk"): the acting, closeinspect and mime branches are not ported.
    this.sg.listenForEvent('ontalk', data => {
      if (this.sg.hasStateTag('idle') && !this.sg.hasStateTag('notalking')) this.sg.goToState('talk', data.noanim);
    });
    // SGwilson.lua EventHandler("fishingcancel")
    this.sg.listenForEvent('fishingcancel', () => {
      if (this.sg.hasStateTag('fishing') && !this.sg.hasStateTag('busy')) this.sg.goToState('fishing_pst');
    });
    // SGwilson.lua EventHandler("feetslipped")
    this.sg.listenForEvent('feetslipped', () => {
      if (this.sg.hasStateTag('running') && !this.sg.hasStateTag('noslip')) this.sg.goToState('slip');
    });
    return this.sg;
  }

  get stateName(): WilsonStateName { return this.sg.stateName; }
  get animationClip(): WilsonAnimationClip { return this.playback.current!; }
  get animationTime(): number { return Math.max(0, this.sg.elapsedTime - this.clipStartedAt); }
  get isOneShot(): boolean { return !['idle', 'walk', 'run', 'jump', 'build', 'emote'].includes(this.stateName); }
  get isCrafting(): boolean { return this.crafting; }
  /** inst:HasTag("playerghost"): SGwilsonghost replaced SGwilson. */
  get isGhost(): boolean { return this.ghost; }
  /** inst.loading_ghost: true only while OnMakePlayerGhost enters the ghost's first state for a ghost loaded from a save. */
  get loadingGhost(): boolean { return this.loadingGhostFlag; }
  get isJumping(): boolean { return this.movementState === 'jump'; }
  /** The movement the browser requested, which idle resumes once an action ends. */
  get requestedMovement(): WilsonMovementState { return this.movementState; }
  /** The clips requestEmote prepared, which the emote state plays. */
  get emoteClips(): readonly WilsonAnimationClip[] { return this.preparedEmote; }
  /** The clip AnimState is playing, if any. */
  get currentClip(): WilsonAnimationClip | undefined { return this.playback.current; }
  get isDrinking(): boolean { return this.foodDrink && this.stateName === 'quickeat'; }
  hasStateTag(tag: string): boolean { return this.sg.hasStateTag(tag); }
  /** inst.sg:AddStateTag */
  addStateTag(tag: string): void { this.sg.addStateTag(tag); }
  /** inst.sg:GoToState from an item's use callback (armorsnurtleshell onuse). */
  goToState(name: WilsonStateName): void { this.sg.goToState(name); }
  hasAnyStateTag(...tags: string[]): boolean { return this.sg.hasAnyStateTag(...tags); }
  /** Browser input is held off while the slip states own the motor. */
  get isDead(): boolean { return this.sg.hasStateTag('dead'); }
  get isSlipping(): boolean { return this.stateName.startsWith('slip'); }
  listenForEvent<E extends string>(name: E, fn: (data: EventData<E>) => void): () => void { return this.sg.listenForEvent(name, fn); }
  onNewState(fn: (data: { name: WilsonStateName }) => void): () => void { return this.sg.onNewState(fn); }
  isListeningForEvent(name: string): boolean { return this.sg.isListeningForEvent(name); }
  pushEvent(name: string, data?: unknown): void {
    this.sg.pushEvent(name, data);
    // Browser equipment replacement cancels all owned actions, including states
    // without a Lua-local unequip handler (castspell/veryquickcastspell/bugnet).
    if (name === 'unequip' && !this.isSoulHopping) this.cancelAction();
  }
  update(dt: number): void { this.sg.update(dt); }

  /** The entity is removed: no pending animation or buffered action may outlive it. */
  dispose(): void {
    this.playback.stop();
    this.releaseAction();
    this.sg.dispose();
  }

  get animationDone(): boolean { return this.playback.done; }

  /** Browser action ownership is separate from Lua's state tags. */
  isPerformingAction(action: WilsonAction, invobjectPrefab?: string): boolean {
    return this.activeAction === action
      && (invobjectPrefab === undefined || this.activeInvobject?.prefab === invobjectPrefab);
  }
  isActionActive(action: PlayerAction<WilsonAction>): boolean { return this.activeBufferedAction === action; }
  get isSoulHopping(): boolean { return this.isPerformingAction('BLINK') || this.isPerformingAction('BLINK_MAP'); }

  /** A state that outlives the action's equipment (loserod, catchfish) stops being cancelled by `unequip`. */
  releaseAction(): void {
    this.clearBufferedAction();
    this.activeAction = null;
    this.activeBufferedAction = undefined;
    this.activeInvobject = undefined;
  }

  /** AnimState owns the clip queue and publishes completion events to this graph. */
  pushClips(clips: readonly WilsonAnimationClip[]): void { this.playback.push(clips); }
  playClips(clips: readonly WilsonAnimationClip[]): void { this.playback.play(clips); }

  /**
   * inst:SetStateGraph("SGwilsonghost") from OnMakePlayerGhost. The stategraph is replaced, so pending actions, emotes and
   * crafting end; `loading` (inst.loading_ghost) skips the appear animation.
   */
  becomeGhost(loading = false): void {
    if (this.ghost) return;
    this.ghost = true;
    this.playback.stop();
    this.releaseAction();
    this.crafting = false;
    this.movementState = 'idle';
    this.sg.dispose();
    this.sg = new StateGraphInstance(this, ghostStates, ghostActionHandlers);
    // stategraph.lua pushes "newstate" to the inst on every GoToState.
    this.sg.onNewState(() => this.entity.PushEvent('newstate', { statename: this.sg.stateName }));
    // SGwilsonghost.lua EventHandler("attacked"): a ghost is never dead, so it always flinches.
    this.sg.listenForEvent('attacked', () => this.sg.goToState('hit'));
    this.loadingGhostFlag = loading;
    try { this.sg.goToState('appear'); } finally { this.loadingGhostFlag = false; }
  }

  /**
   * inst:SetStateGraph("SGwilson") from DoActualRez, then GoToState(`state`): the ghost's graph is replaced by a fresh
   * SGwilson one, so pending actions end and the movement request starts over.
   */
  becomeAlive(state: WilsonStateName): void {
    if (!this.ghost) return;
    this.ghost = false;
    this.playback.stop();
    this.releaseAction();
    this.crafting = false;
    this.movementState = 'idle';
    this.sg.dispose();
    this.createGraph();
    this.sg.goToState(state);
  }

  /** Record requested movement; resume it when the current action finishes. */
  requestMovement(state: WilsonMovementState): void {
    // The ghost floats: it has no jump.
    if (this.ghost && state === 'jump') return;
    if (state !== 'idle' && this.stateName === 'emote') this.cancelEmote();
    if (state === this.movementState) return;
    this.movementState = state;
    if (!this.crafting && !this.isOneShot && this.stateName !== 'emote') this.sg.goToState(state);
  }

  /** Update the persistent browser crafting request and reconcile the state. */
  requestCrafting(crafting: boolean): void {
    if (this.ghost) return;
    if (crafting && this.isSoulHopping) return;
    if (crafting === this.crafting) return;
    this.crafting = crafting;
    if (crafting && (this.activeAction !== null || this.stateName === 'emote')) this.finish();
    else if (!this.isOneShot) this.sg.goToState(crafting ? 'build' : this.movementState);
  }

  /** Request a visual state, interrupting any buffered action. */
  requestOneShot(state: WilsonOneShotState): void {
    if (this.isDead || this.ghost || this.isSoulHopping) return;
    this.releaseAction();
    this.sg.goToState(state);
  }

  /**
   * EntityScript:PushBufferedAction. The same action, target and invobject already buffered outside idle
   * keeps running and the new one is dropped (false: its callback never runs); otherwise the old one fails,
   * TestForStart validates the new one and sg:StartAction enters its handler's destination state.
   */
  pushBufferedAction(action: PlayerAction<WilsonAction>): boolean {
    const current = this.bufferedAction;
    if (current && current.action === action.action && current.target === action.target
      && current.invobject === action.invobject && !this.hasStateTag('idle')) return false;
    // Browser input admission mirrors PlayerController:IsBusy(). The generic
    // stategraph resolves the action's source destination without this UI guard.
    if (this.hasStateTag('busy') || !action.isValid()) return false;
    const destination = this.sg.getActionState(action);
    if (destination === null) return false;
    this.clearBufferedAction();
    this.bufferedAction = action;
    this.activeAction = action.action;
    this.activeBufferedAction = action;
    this.activeInvobject = action.invobject;
    // SGwilson quickeat onenter: the food's own "fooddrink" tag picks the drink clips.
    this.foodDrink = action.action === 'EAT' && !!(action.target ?? action.invobject)?.hasTag('fooddrink');
    this.sg.goToState(destination);
    return true;
  }

  /** BLINK / BLINK_MAP commit after the pre-animation. Map jumps intentionally skip soul accounting. */
  beginPortalJump(position: Vector3, fromMap = false): boolean {
    if (this.stateName !== 'portal_jumpin_pre' || !this.entity.soulHopHost
      || (!fromMap && !this.entity.soulHopHost.tryToPortalHop())) return false;
    this.sg.goToState('portal_jumpin', { dest: position, from_map: fromMap } satisfies PortalJumpData);
    return true;
  }

  getBufferedAction(): PlayerAction<WilsonAction> | null { return this.bufferedAction; }

  /** EntityScript:PerformBufferedAction; false when nothing ran or the action failed. */
  performBufferedAction(): boolean {
    const action = this.bufferedAction;
    if (!action) return false;
    this.pushEvent('performaction', { action });
    // A notification listener may cancel or replace the action before execution.
    if (this.bufferedAction !== action) return false;
    this.bufferedAction = null;
    if (action.do()) return true;
    this.pushEvent('actionfailed', { action });
    return false;
  }

  clearBufferedAction(): void {
    const action = this.bufferedAction;
    this.bufferedAction = null;
    if (action) this.pushEvent('actionfailed', { action });
  }

  /** inst:PushEvent("actionfailed", { action, reason }) then ClearBufferedAction, without the second event. */
  failBufferedAction(reason?: string): void {
    const action = this.bufferedAction;
    this.bufferedAction = null;
    if (action) this.pushEvent('actionfailed', { action, reason });
  }

  cancelAction(action?: WilsonAction): void {
    if (this.activeAction !== null && (!action || this.activeAction === action)) this.finish();
  }

  finish(pushanim = false): void {
    // The dead never resume movement or crafting.
    if (this.isDead) return;
    this.releaseAction();
    // Lua's GoToState("idle", true) preserves the current animation queue.
    // Ordinary completion resumes the browser's requested movement/crafting state.
    this.sg.goToState(pushanim ? 'idle' : this.crafting ? 'build' : this.movementState, pushanim);
  }

  canEmote(): boolean {
    // SGwilson.lua's emote event, for the supported unmounted player branch.
    return !this.ghost && !this.sg.hasAnyStateTag('busy', 'nopredict', 'sleeping', 'floating');
  }
  /** Validate the request, prepare its clips, then enter the emote state. */
  requestEmote(names: readonly string[], loop: boolean): boolean {
    if (!this.canEmote() || !names.length) return false;
    this.preparedEmote = names.map((name, index) => ({
      key: 'emote', name, loop: loop && index === names.length - 1,
    }));
    this.sg.goToState('emote');
    return true;
  }
  cancelEmote(): void { if (this.stateName === 'emote') this.finish(); }

  /** Sleepers are in tent/waking states; movement input wakes them through the locomote event. */
  get isSleeping(): boolean { return this.sg.hasAnyStateTag('tent', 'waking'); }
  /** inst.sg:GoToState("wakeup") from sleepingbaguser:DoWakeUp. */
  wakeUp(): void {
    this.releaseAction();
    this.sg.goToState('wakeup');
  }
  /** The locomote event for a sleeper. */
  pushLocomote(): void { this.sg.pushEvent('locomote'); }
}
