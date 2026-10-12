import { BufferedAction } from './bufferedaction.ts';
import type { BufferedActionObject } from './bufferedaction.ts';
import { ActionHandler as DefineActionHandler, EventHandler, FRAMES, State as DefineState, StateGraphInstance, TimeEvent } from './stategraph.ts';
import type { StateActionHandler, StateDefinition } from './stategraph.ts';

export type WilsonMovementState = 'idle' | 'walk' | 'run' | 'jump';
export type WilsonOneShotState = 'eat' | 'item_in' | 'item_out' | 'pickup';
export type WilsonStateName = WilsonMovementState | WilsonOneShotState | 'build' | 'emote'
  | 'mine_start' | 'mine' | 'chop_start' | 'chop' | 'hammer_start' | 'hammer'
  | 'bugnet_start' | 'bugnet' | 'terraform' | 'castspell' | 'veryquickcastspell'
  | 'quickeat' | 'doshortaction' | 'dolongaction' | 'till_start' | 'till' | 'dig_start' | 'dig' | 'catchonfire'
  | 'book' | 'book2' | 'attack' | 'give' | 'toolbroke' | 'shave' | 'tent' | 'wakeup' | 'play_flute';
export type WilsonAction = 'ATTACK' | 'MINE' | 'CHOP' | 'HAMMER' | 'NET' | 'TERRAFORM' | 'CASTSPELL' | 'EAT' | 'PLANT' | 'TILL' | 'DIG' | 'HARVEST' | 'PICK' | 'PICKUP' | 'LIGHT' | 'READ' | 'GIVE' | 'REPAIR' | 'SHAVE' | 'STORE' | 'TAKEITEM' | 'DROP' | 'ADDFUEL' | 'ADDWETFUEL' | 'SLEEPIN' | 'PLAY';
export type WilsonAnimationKey = WilsonMovementState | WilsonOneShotState | 'build' | 'emote'
  | 'pickaxe_pre' | 'pickaxe_loop' | 'pickaxe_pst' | 'chop_pre' | 'chop_loop' | 'bugnet_pre' | 'bugnet'
  | 'shovel_pre' | 'shovel_loop' | 'shovel_pst' | 'staff_pre' | 'staff' | 'atk_pre' | 'atk'
  | 'quick_eat_pre' | 'quick_eat' | 'quick_drink_pre' | 'quick_drink' | 'pickup_pst' | 'till_pre' | 'till_loop' | 'till_pst'
  | 'build_pre' | 'build_loop' | 'build_pst' | 'light_fire' | 'light_fire_pst'
  | 'action_uniqueitem_pre' | 'book' | 'punch' | 'toolpunch' | 'give' | 'give_pst' | 'hit' | 'wakeup' | 'flute';

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
  playbackRate?: number;
  frameRate?: number;
}

/** A spawned FX inst owned by a state until it is detached or removed. */
export interface WilsonFx {
  isValid(): boolean;
  remove(): void;
  /** entity:SetParent(nil) at the current world position and rotation. */
  detach(): void;
  pushEvent(name: 'fail_fx'): void;
}

/** What SGwilson.lua's tent and wakeup states reach through the sleeper's components and the HUD. */
export interface WilsonSleepHost {
  /** SetSleeperSleepState / SetSleeperAwakeState: player controller, inventory and speech while asleep. */
  setSleeperState(sleeping: boolean): void;
  /** inst:Hide() / inst:Show() with the dynamic shadow. */
  setHidden(hidden: boolean): void;
  /** The tent state's refusal reason (too bright, burning, too hungry), or undefined when the bed is allowed. */
  failReason(bed: BufferedActionObject): string | undefined;
  announce(reason: string): void;
  /** The ontimeout checks: the bag is still a free tent for the current phase and is not burning. */
  canCommit(bed: BufferedActionObject): boolean;
  /** inst.sleepingbag ~= nil */
  readonly hasBed: boolean;
  /** inst.sleepingbag.components.sleepingbag:DoWakeUp(nostatechange) */
  wakeBed(nostatechange: boolean): void;
}

export interface WilsonStateGraphHost {
  sleep?: WilsonSleepHost;
  /** Select the art and return its effective playback duration in seconds. */
  playAnimation(clip: WilsonAnimationClip): number;
  playSound(cue: 'mine' | 'hammer' | 'cast' | 'reskin' | 'eat' | 'sip' | 'dig' | 'tillEmerge' | 'make'
    | 'bookLight' | 'bookClose' | 'attack' | 'useBreak' | 'shave', event?: string): void;
  /** The player's combat component: attack cooldown for the attack state. */
  getCombat?(): WilsonCombat | undefined;
  stopSound?(cue: 'make' | 'shave'): void;
  /** SoundEmitter's named handle: KillSound then PlaySound, PlayingSound and SetVolume. */
  playNamedSound?(name: 'book_layer_sound' | 'flute', event: string): void;
  /** SoundEmitter:KillSound(name). */
  stopNamedSound?(name: 'book_layer_sound' | 'flute'): void;
  isPlayingNamedSound?(name: 'book_layer_sound'): boolean;
  setNamedSoundVolume?(name: 'book_layer_sound', volume: number): void;
  /** SpawnPrefab parented to the player, optionally Follower:FollowSymbol on a player symbol. */
  spawnFx?(prefab: string, followSymbol?: string): WilsonFx;
  /** player_common.lua OnItemRanOut/toolbroke exit: equip another item of this prefab from the inventory. */
  equipSamePrefab?(prefab: string): boolean;
  overrideSymbol?(symbol: string, build: string, sourceSymbol: string): void;
  /** AnimState:ClearOverrideSymbol. */
  clearOverrideSymbol?(symbol: string): void;
  overrideItemSkinSymbol?(symbol: string, skinBuild: string, skinSymbol: string, build: string, sourceSymbol: string): void;
  setCasting(casting: boolean, colour?: readonly [number, number, number]): void;
  setControllerEnabled?(enabled: boolean): void;
  stopMovement?(): void;
  onStateChanged(name: WilsonStateName): void;
}

/** The SHAVE target: beard.lua ShouldTryToShave gates the state. */
export interface ShaveTarget {
  readonly components?: { beard?: { ShouldTryToShave(doer: unknown): { ok: true } | { ok: false; reason?: string } } };
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
const ActionHandler = DefineActionHandler<WilsonStateGraph, WilsonStateName>;
const clip = (key: WilsonAnimationKey, name: string = key): WilsonAnimationClip => ({ key, name });

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
      const { host } = inst.context;
      host.stopMovement?.();
      const action = inst.context.getBufferedAction();
      const shavee = action?.target as ShaveTarget | undefined;
      const shaver = (action?.invobject as { components?: { shaver?: unknown } } | undefined)?.components?.shaver;
      const verdict = shaver && shavee ? shavee.components?.beard?.ShouldTryToShave(undefined) : undefined;
      if (!verdict?.ok) {
        inst.context.failBufferedAction(verdict?.reason);
        inst.goToState('idle');
        return;
      }
      host.playSound('shave');
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
      inst.context.host.stopSound?.('shave');
      if (inst.context.getBufferedAction() === inst.statemem.action) inst.context.clearBufferedAction();
    },
  }),
  State({
    // SGwilson.lua tent: the bed vets the sleeper, then the player hides inside and is woken by movement.
    name: 'tent',
    tags: ['tent', 'busy', 'silentmorph'],
    onenter: (inst) => {
      const { host } = inst.context, sleep = host.sleep;
      host.stopMovement?.();
      const action = inst.context.getBufferedAction();
      const reason = action?.target && sleep?.failReason(action.target);
      if (!action?.target || !sleep || reason) {
        inst.context.clearBufferedAction();
        inst.goToState('idle');
        if (reason) sleep?.announce(reason);
        return;
      }
      inst.context.playClips([clip('pickup')]);
      inst.setTimeout(6 * FRAMES);
      sleep.setSleeperState(true);
    },
    ontimeout: (inst) => {
      const { host } = inst.context, sleep = host.sleep!;
      const action = inst.context.getBufferedAction();
      if (!action?.target || !sleep.canCommit(action.target)) {
        // Edge cases: no failure dialogue.
        inst.context.clearBufferedAction();
        inst.context.playClips([clip('pickup_pst')]);
        inst.goToState('idle', true);
        return;
      }
      inst.context.performBufferedAction();
      sleep.setHidden(true);
      inst.addStateTag('sleeping');
      inst.removeStateTag('busy');
    },
    events: [
      // Movement while asleep wakes the sleeper first (Lua: the locomote handler's bedroll/tent branch).
      EventHandler('locomote', (inst) => {
        const sleep = inst.context.host.sleep;
        if (sleep?.hasBed && inst.hasStateTag('sleeping')) sleep.wakeBed(false);
      }),
    ],
    onexit: (inst) => {
      const sleep = inst.context.host.sleep!;
      sleep.setHidden(false);
      if (sleep.hasBed) {
        // Interrupted while "sleeping".
        sleep.wakeBed(true);
        sleep.setSleeperState(false);
      } else if (!inst.statemem.iswaking) {
        // Interrupted before "sleeping", or woken through the wakeup state.
        sleep.setSleeperState(false);
      }
    },
  }),
  State({
    name: 'wakeup',
    tags: ['busy', 'waking', 'nomorph', 'nodangle'],
    onenter: (inst) => {
      inst.context.host.setControllerEnabled?.(false);
      inst.context.playClips([clip('wakeup')]);
    },
    events: [
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
    onexit: (inst) => inst.context.host.sleep?.setSleeperState(false),
  }),
  State({
    name: 'toolbroke',
    tags: ['busy', 'pausepredict'],
    onenter: (inst, tool) => {
      const { host } = inst.context;
      host.stopMovement?.();
      inst.context.playClips([clip('hit')]);
      host.playSound('useBreak');
      const broken = tool as WilsonBrokenTool | undefined;
      if (!broken?.nobrokentoolfx) host.spawnFx?.('brokentool');
      inst.statemem.toolname = broken?.prefab;
      inst.setTimeout(10 * FRAMES);
    },
    ontimeout: inst => inst.goToState('idle', true),
    onexit: inst => {
      const toolname = inst.statemem.toolname as string | undefined;
      if (toolname !== undefined) inst.context.host.equipSamePrefab?.(toolname);
    },
  }),
  State({
    name: 'give', tags: ['giving'],
    onenter: inst => {
      inst.context.host.stopMovement?.();
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
      inst.context.host.stopMovement?.();
      inst.context.playClips([clip('light_fire'), clip('light_fire_pst')]);
    },
    timeline: [TimeEvent(13 * FRAMES, inst => inst.context.performBufferedAction())],
    events: [EventHandler('animqueueover', inst => {
      if (inst.context.animationDone) inst.goToState('idle');
    })],
  }),
  State({
    name: 'idle',
    tags: ['idle', 'canrotate'],
    onenter: (inst, pushanim) => inst.context.onEnterIdle(pushanim === true),
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
        inst.context.host.playSound('mine');
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
        inst.context.host.playSound('hammer');
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
        inst.context.host.playSound('dig');
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
        inst.context.host.playSound('dig');
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
        inst.context.host.playSound('dig');
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
    onenter: (inst) => inst.context.onEnterQuickEat(),
    timeline: [
      TimeEvent(10 * FRAMES, (inst) => inst.context.host.playSound(inst.context.isDrinking ? 'sip' : 'eat')),
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
      inst.context.host.stopMovement?.();
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
      inst.context.host.setControllerEnabled?.(false);
      inst.context.host.stopMovement?.();
      inst.statemem.committed = false;
      inst.statemem.castsound = inst.context.getBufferedAction()?.invobject?.castsound ?? 'dontstarve/wilson/use_gemstaff';
      inst.context.host.setCasting(true, inst.context.getBufferedAction()?.invobject?.fxcolour ?? [1, 1, 1]);
    },
    timeline: [
      TimeEvent(13 * FRAMES, (inst) => inst.context.host.playSound('cast', inst.statemem.castsound as string)),
      TimeEvent(53 * FRAMES, (inst) => {
        inst.statemem.committed = true; // Lua releases cancellation ownership before PerformBufferedAction.
        inst.context.performBufferedAction();
      }),
      TimeEvent(69 * FRAMES, (inst) => {
        inst.removeStateTag('busy');
        inst.context.host.setControllerEnabled?.(true);
      }),
    ],
    events: [
      EventHandler('animqueueover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
    onexit: (inst) => {
      inst.context.host.setControllerEnabled?.(true);
      if (!inst.statemem.committed) inst.context.host.setCasting(false);
    },
  }),
  State({
    name: 'veryquickcastspell',
    tags: ['doing', 'busy', 'canrotate'],
    onenter: (inst) => {
      inst.context.playClips([clip('atk_pre'), clip('atk')]);
      inst.context.host.playSound('reskin');
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
      const combat = inst.context.host.getCombat?.();
      if (!combat || combat.InCooldown()) {
        inst.removeStateTag('abouttoattack');
        inst.context.clearBufferedAction();
        inst.goToState('idle', true);
        return;
      }
      const action = inst.context.getBufferedAction();
      const equip = action?.invobject;
      combat.StartAttack();
      inst.context.host.stopMovement?.();
      let cooldown = combat.min_attack_period;
      if (equip?.hasTag('toolpunch')) {
        inst.context.playClips([clip('toolpunch')]);
        inst.context.host.playSound('attack', 'dontstarve/wilson/attack_whoosh');
        cooldown = Math.max(cooldown, 13 * FRAMES);
      } else if (equip?.hasTag('weapon') && !equip.hasTag('punch')) {
        inst.context.playClips([clip('atk_pre'), clip('atk')]);
        inst.context.host.playSound('attack', equip.hasTag('shadow') ? 'dontstarve/wilson/attack_nightsword' : 'dontstarve/wilson/attack_weapon');
        cooldown = Math.max(cooldown, 13 * FRAMES);
      } else if (equip?.hasTag('light') || equip?.hasTag('nopunch')) {
        inst.context.playClips([clip('atk_pre'), clip('atk')]);
        inst.context.host.playSound('attack', 'dontstarve/wilson/attack_weapon');
        cooldown = Math.max(cooldown, 13 * FRAMES);
      } else {
        inst.context.playClips([clip('punch')]);
        inst.context.host.playSound('attack', 'dontstarve/wilson/attack_whoosh');
        cooldown = Math.max(cooldown, 24 * FRAMES);
      }
      inst.setTimeout(cooldown);
      inst.statemem.attacktarget = action?.target;
    },
    timeline: [
      TimeEvent(8 * FRAMES, (inst) => {
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
      if (inst.hasStateTag('abouttoattack')) inst.context.host.getCombat?.()?.CancelAttack();
    },
  }),
  State({
    name: 'emote',
    tags: ['busy', 'pausepredict'],
    onenter: (inst) => inst.context.onEnterEmote(),
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
      TimeEvent(4 * FRAMES, (inst) => inst.context.host.playSound('dig')),
      TimeEvent(11 * FRAMES, (inst) => inst.context.performBufferedAction()),
      TimeEvent(12 * FRAMES, (inst) => inst.context.host.playSound('tillEmerge')),
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
      inst.context.host.stopMovement?.();
      inst.context.host.playSound('make');
      inst.context.playClips([clip('build_pre'), { ...clip('build_loop'), loop: true }]);
      inst.statemem.action = inst.context.getBufferedAction();
    },
    timeline: [TimeEvent(4 * FRAMES, (inst) => inst.removeStateTag('busy'))],
    ontimeout: (inst) => {
      inst.context.host.stopSound?.('make');
      inst.context.playClips([clip('build_pst')]);
      inst.removeStateTag('busy');
      inst.context.performBufferedAction();
    },
    events: [EventHandler('animqueueover', (inst) => {
      if (inst.context.animationDone) inst.goToState('idle');
    })],
    onexit: (inst) => {
      inst.context.host.stopSound?.('make');
      if (inst.context.getBufferedAction() === inst.statemem.action) inst.context.clearBufferedAction();
    },
  }),
  State({
    // Unmounted book branch: spellbook/aoetargeting, repeatcast and shadowmagic need unported components.
    name: 'book',
    tags: ['doing', 'busy'],
    onenter: (inst) => {
      inst.context.host.stopMovement?.();
      inst.context.playClips([clip('action_uniqueitem_pre')]);
      inst.statemem.book_fx = inst.context.host.spawnFx?.('book_fx');
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
      const { host } = inst.context;
      inst.context.playClips([clip('book')]);
      inst.statemem.book_fx = (data as { book_fx?: WilsonFx } | undefined)?.book_fx;
      const book = inst.context.getBufferedAction()?.invobject;
      if (book) {
        if (book.def?.fx_over_prefab) inst.statemem.fx_over = host.spawnFx?.(book.def.fx_over_prefab, 'swap_book_fx_over');
        if (book.def?.fx_under_prefab) inst.statemem.fx_under = host.spawnFx?.(book.def.fx_under_prefab, 'swap_book_fx_under');
        const layer = book.def?.layer_sound;
        if (layer) {
          // Track the one-shot by name so an interrupted read can lower it.
          const frame = layer.frame ?? 0;
          if (frame > 0) {
            inst.statemem.soundtask = inst.schedule(frame * FRAMES, () => {
              inst.statemem.soundtask = undefined;
              host.playNamedSound?.('book_layer_sound', layer.sound);
            });
          } else host.playNamedSound?.('book_layer_sound', layer.sound);
        }
        const prefix = book.swap_prefix ?? 'book';
        if (book.skinBuild) {
          host.overrideItemSkinSymbol?.('book_open', book.skinBuild, 'book_open', book.swap_build ?? 'player_actions_uniqueitem', `${prefix}_open`);
          host.overrideItemSkinSymbol?.('book_closed', book.skinBuild, 'book_closed', book.swap_build ?? 'player_actions_uniqueitem', `${prefix}_closed`);
          inst.statemem.symbolsoverridden = true;
        } else if (book.swap_build) {
          host.overrideSymbol?.('book_open', book.swap_build, `${prefix}_open`);
          host.overrideSymbol?.('book_closed', book.swap_build, `${prefix}_closed`);
          inst.statemem.symbolsoverridden = true;
        }
      }
      inst.statemem.castsound = book?.castsound ?? 'dontstarve/common/book_spell';
    },
    timeline: [
      // Without repeatcast, source frame 13 defers fn19 and frame 44 defers fn50.
      TimeEvent(19 * FRAMES, (inst) => inst.context.host.playSound('bookLight')),
      TimeEvent(50 * FRAMES, (inst) => {
        const fx = inst.statemem.book_fx as WilsonFx | undefined;
        const bookFx = fx?.isValid() ? fx : undefined;
        bookFx?.detach();
        inst.statemem.book_fx = undefined; // Don't cancel anymore
        inst.context.host.playSound('cast', inst.statemem.castsound as string);
        inst.removeStateTag('busy');
        if (!inst.context.performBufferedAction()) bookFx?.pushEvent('fail_fx');
      }),
      TimeEvent(51 * FRAMES, (inst) => inst.context.host.playSound('bookClose')),
      TimeEvent(52 * FRAMES, (inst) => inst.removeStateTag('busy')),
    ],
    events: [
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
    onexit: (inst) => {
      const { host } = inst.context;
      if (inst.statemem.symbolsoverridden) {
        host.overrideSymbol?.('book_open', 'player_actions_uniqueitem', 'book_open');
        host.overrideSymbol?.('book_closed', 'player_actions_uniqueitem', 'book_closed');
      }
      for (const key of ['book_fx', 'fx_over', 'fx_under']) {
        const fx = inst.statemem[key] as WilsonFx | undefined;
        if (fx?.isValid()) fx.remove();
      }
      const soundtask = inst.statemem.soundtask as (() => void) | undefined;
      if (soundtask) soundtask();
      else if (host.isPlayingNamedSound?.('book_layer_sound')) host.setNamedSoundVolume?.('book_layer_sound', .5);
    },
  }),
  State({
    // Unmounted branch with the stock pan flute build; instrument asset/sound overrides belong to unported instruments.
    name: 'play_flute',
    tags: ['doing', 'busy', 'playing'],
    onenter: (inst) => {
      const { host } = inst.context;
      host.stopMovement?.();
      inst.context.playClips([clip('action_uniqueitem_pre'), clip('flute')]);
      const skinBuild = inst.context.getBufferedAction()?.invobject?.skinBuild;
      if (skinBuild) host.overrideItemSkinSymbol?.('pan_flute01', skinBuild, 'pan_flute01', 'pan_flute', 'pan_flute01');
      else host.overrideSymbol?.('pan_flute01', 'pan_flute', 'pan_flute01');
    },
    timeline: [
      TimeEvent(30 * FRAMES, (inst) => {
        if (inst.context.performBufferedAction()) inst.context.host.playNamedSound?.('flute', 'dontstarve/wilson/flute_LP');
        else inst.statemem.action_failed = true;
      }),
      TimeEvent(36 * FRAMES, (inst) => { if (inst.statemem.action_failed) inst.removeStateTag('busy'); }),
      TimeEvent(52 * FRAMES, (inst) => { if (!inst.statemem.action_failed) inst.removeStateTag('busy'); }),
      TimeEvent(85 * FRAMES, (inst) => { if (!inst.statemem.action_failed) inst.context.host.stopNamedSound?.('flute'); }),
    ],
    events: [EventHandler('animqueueover', (inst) => { if (inst.context.animationDone) inst.goToState('idle'); })],
    onexit: (inst) => {
      inst.context.host.stopNamedSound?.('flute');
      inst.context.host.clearOverrideSymbol?.('pan_flute01');
    },
  }),
];

/** Browser movement/visual adapters; Lua's locomotion states are not ported here. */
const applicationStates: StateDefinition<WilsonStateGraph, WilsonStateName>[] = [
  State({
    name: 'walk',
    tags: ['moving'],
    onenter: (inst) => inst.context.playClips([{ ...clip('walk', 'run_loop'), loop: true, frameRate: 16 }]),
  }),
  State({
    name: 'run',
    tags: ['moving'],
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
const actionHandlers: StateActionHandler<WilsonStateGraph, WilsonStateName>[] = [
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
  ActionHandler('PICKUP', 'doshortaction'),
  ActionHandler('HARVEST', 'dolongaction'),
  ActionHandler('STORE', 'doshortaction'),
  ActionHandler('ADDFUEL', 'doshortaction'),
  ActionHandler('ADDWETFUEL', 'doshortaction'),
  // SGwilson.lua DROP: heavylifting_drop and the floater branch belong to unported mechanics.
  ActionHandler('DROP', 'doshortaction'),
  // SGwilson.lua TAKEITEM: the inventoryitemholder_take and target.takeitem branches belong to unported holders.
  ActionHandler('TAKEITEM', 'dolongaction'),
  ActionHandler('REPAIR', (_inst, action) => action.target?.hasTag('repairshortaction') ? 'doshortaction' : 'dolongaction'),
  ActionHandler('GIVE', (_inst, action) => action.target?.hasTag('give_dolongaction') ? 'dolongaction' : 'give'),
  ActionHandler('PICK', (_inst, action) => {
    // SGwilson.lua:1043-1077 — jostle/skill/riding branches remain unported.
    if (action.target?.hasTag('jostlepick')) return null;
    if (action.target?.hasTag('noquickpick')) return 'dolongaction';
    return action.target?.quickpick ? 'doshortaction' : 'dolongaction';
  }),
  ActionHandler('LIGHT', 'catchonfire'),
  ActionHandler('SHAVE', 'shave'),
  // The bedroll branch (action.invobject) is not ported; tents go to the tent state.
  ActionHandler('SLEEPIN', (_inst, action) => action.invobject ? null : 'tent'),
  ActionHandler('TERRAFORM', 'terraform'),
  ActionHandler('EAT', (inst) => {
    if (inst.hasStateTag('busy')) return null;
    // FoodActionController validates edible food; only quickeat is connected.
    // Source food preference, slow/meat eating and floating branches remain unported.
    return 'quickeat';
  }),
  ActionHandler('CASTSPELL', (_inst, action) => {
    const tool = action.invobject;
    // These source destinations need states/assets not yet implemented.
    if (tool?.hasTag('gnarwail_horn') || tool?.hasTag('guitar')
      || tool?.hasTag('cointosscast') || tool?.hasTag('crushitemcast')
      || tool?.hasTag('quickcast')) return null;
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
  readonly host: WilsonStateGraphHost;
  private readonly sg: WilsonInstance;
  private bufferedAction: BufferedAction<WilsonAction> | null = null;
  private movementState: WilsonMovementState = 'idle';
  private crafting = false;
  private clips: readonly WilsonAnimationClip[] = [];
  private clipIndex = 0;
  private clipStartedAt = 0;
  private emoteClips: readonly WilsonAnimationClip[] = [];
  private foodDrink = false;
  private activeAction: WilsonAction | null = null;
  private activeBufferedAction: BufferedAction<WilsonAction> | undefined;
  private activeInvobject: BufferedActionObject | undefined;
  private cancelAnimation: (() => void) | undefined;
  private animationCompleted = false;

  constructor(host: WilsonStateGraphHost) {
    this.host = host;
    this.sg = new StateGraphInstance(this, [...states, ...applicationStates], actionHandlers);
    this.sg.listenForEvent('newstate', () => this.host.onStateChanged(this.sg.stateName));
    // SGwilson.lua EventHandler("toolbroke"): ignored during nointerrupt states.
    this.sg.listenForEvent('toolbroke', data => {
      if (this.sg.hasStateTag('nointerrupt')) return;
      this.clearBufferedAction();
      this.activeAction = null;
      this.activeBufferedAction = undefined;
      this.activeInvobject = undefined;
      this.sg.goToState('toolbroke', (data as { tool?: WilsonBrokenTool } | undefined)?.tool);
    });
    this.sg.goToState('idle');
  }

  get stateName(): WilsonStateName { return this.sg.stateName; }
  get animationClip(): WilsonAnimationClip { return this.clips[this.clipIndex]; }
  get animationTime(): number { return Math.max(0, this.sg.elapsedTime - this.clipStartedAt); }
  get isOneShot(): boolean { return !['idle', 'walk', 'run', 'jump', 'build', 'emote'].includes(this.stateName); }
  get isCrafting(): boolean { return this.crafting; }
  get isJumping(): boolean { return this.movementState === 'jump'; }
  get isDrinking(): boolean { return this.foodDrink && this.stateName === 'quickeat'; }
  hasStateTag(tag: string): boolean { return this.sg.hasStateTag(tag); }
  listenForEvent(name: string, fn: (data: unknown) => void): () => void { return this.sg.listenForEvent(name, fn); }
  pushEvent(name: string, data?: unknown): void {
    this.sg.pushEvent(name, data);
    // Browser equipment replacement cancels all owned actions, including states
    // without a Lua-local unequip handler (castspell/veryquickcastspell/bugnet).
    if (name === 'unequip') this.cancelAction();
  }
  update(dt: number): void { this.sg.update(dt); }

  get animationDone(): boolean { return this.animationCompleted; }

  /** Browser action ownership is separate from Lua's state tags. */
  isPerformingAction(action: WilsonAction, invobjectPrefab?: string): boolean {
    return this.activeAction === action
      && (invobjectPrefab === undefined || this.activeInvobject?.prefab === invobjectPrefab);
  }
  isActionActive(action: BufferedAction<WilsonAction>): boolean { return this.activeBufferedAction === action; }

  /** Called by idle.onenter after the state has already been entered. */
  onEnterIdle(pushanim: boolean): void {
    this.clearBufferedAction();
    this.activeAction = null;
    this.activeBufferedAction = undefined;
    this.activeInvobject = undefined;
    // Resume movement/crafting requested by browser input during an action.
    // Keep Lua's idle state while a pushed post-animation is still playing.
    if (!pushanim && (this.crafting || this.movementState !== 'idle')) {
      this.sg.goToState(this.crafting ? 'build' : this.movementState);
      return;
    }
    const idle = { ...clip('idle', 'idle_loop'), loop: true };
    if (pushanim) {
      this.clips = [...this.clips, idle];
    } else {
      this.playClips([idle]);
    }
  }

  playClips(clips: readonly WilsonAnimationClip[]): void {
    this.clips = clips;
    this.clipIndex = 0;
    this.selectClip();
  }

  private selectClip(): void {
    this.cancelAnimation?.();
    this.animationCompleted = false;
    this.clipStartedAt = this.sg.elapsedTime;
    this.cancelAnimation = this.sg.schedule(this.host.playAnimation(this.animationClip), () => this.animationOver());
  }

  animationOver(): void {
    this.animationCompleted = true;
    const revision = this.sg.stateRevision;
    this.pushEvent('animover');
    if (this.sg.stateRevision !== revision) return;
    if (this.clipIndex + 1 < this.clips.length) {
      this.clipIndex++;
      if (this.stateName === 'idle' && this.animationClip.key === 'idle'
        && (this.crafting || this.movementState !== 'idle')) {
        this.sg.goToState(this.crafting ? 'build' : this.movementState);
      } else this.selectClip();
    } else if (this.animationClip.loop) {
      this.selectClip();
    } else {
      this.pushEvent('animqueueover');
    }
  }

  /** Record requested movement; resume it when the current action finishes. */
  requestMovement(state: WilsonMovementState): void {
    if (state !== 'idle' && this.stateName === 'emote') this.cancelEmote();
    if (state === this.movementState) return;
    this.movementState = state;
    if (!this.crafting && !this.isOneShot && this.stateName !== 'emote') this.sg.goToState(state);
  }

  /** Update the persistent browser crafting request and reconcile the state. */
  requestCrafting(crafting: boolean): void {
    if (crafting === this.crafting) return;
    this.crafting = crafting;
    if (crafting && (this.activeAction !== null || this.stateName === 'emote')) this.finish();
    else if (!this.isOneShot) this.sg.goToState(crafting ? 'build' : this.movementState);
  }

  /** Request a visual state, interrupting any buffered action. */
  requestOneShot(state: WilsonOneShotState): void {
    this.clearBufferedAction();
    this.activeAction = null;
    this.activeBufferedAction = undefined;
    this.activeInvobject = undefined;
    this.sg.goToState(state);
  }

  pushBufferedAction(action: BufferedAction<WilsonAction>, foodDrink = false): boolean {
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
    this.foodDrink = action.action === 'EAT' && foodDrink;
    this.sg.goToState(destination);
    return true;
  }

  getBufferedAction(): BufferedAction<WilsonAction> | null { return this.bufferedAction; }

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

  /** SGwilson quickeat chooses drink clips for fooddrink-tagged inventory food. */
  onEnterQuickEat(): void {
    this.playClips(this.foodDrink
      ? [clip('quick_drink_pre'), clip('quick_drink')]
      : [clip('quick_eat_pre'), clip('quick_eat')]);
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
    this.clearBufferedAction();
    this.activeAction = null;
    this.activeBufferedAction = undefined;
    this.activeInvobject = undefined;
    // Lua's GoToState("idle", true) preserves the current animation queue.
    // Ordinary completion resumes the browser's requested movement/crafting state.
    this.sg.goToState(pushanim ? 'idle' : this.crafting ? 'build' : this.movementState, pushanim);
  }

  canEmote(): boolean {
    // SGwilson.lua's emote event, for the supported unmounted player branch.
    return !this.sg.hasAnyStateTag('busy', 'nopredict', 'sleeping', 'floating');
  }
  /** Validate the request, prepare its clips, then enter the emote state. */
  requestEmote(names: readonly string[], loop: boolean): boolean {
    if (!this.canEmote() || !names.length) return false;
    this.emoteClips = names.map((name, index) => ({
      key: 'emote', name, loop: loop && index === names.length - 1,
    }));
    this.sg.goToState('emote');
    return true;
  }
  /** Called only by emote.onenter to play the prepared animation queue. */
  onEnterEmote(): void {
    // An accepted emote can interrupt working states that have no busy tag.
    this.clearBufferedAction();
    this.activeAction = null;
    this.activeBufferedAction = undefined;
    this.activeInvobject = undefined;
    this.playClips(this.emoteClips);
  }
  cancelEmote(): void { if (this.stateName === 'emote') this.finish(); }

  /** Sleepers are in tent/waking states; movement input wakes them through the locomote event. */
  get isSleeping(): boolean { return this.sg.hasAnyStateTag('tent', 'waking'); }
  /** inst.sg:GoToState("wakeup") from sleepingbaguser:DoWakeUp. */
  wakeUp(): void {
    this.clearBufferedAction();
    this.activeAction = null;
    this.activeBufferedAction = undefined;
    this.activeInvobject = undefined;
    this.sg.goToState('wakeup');
  }
  /** The locomote event for a sleeper. */
  pushLocomote(): void { this.sg.pushEvent('locomote'); }
}
