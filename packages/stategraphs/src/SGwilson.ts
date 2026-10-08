import { BufferedAction } from './bufferedaction.ts';
import { ActionHandler, EventHandler, FRAMES, State as DefineState, StateGraphInstance, TimeEvent } from './stategraph.ts';
import type { StateDefinition } from './stategraph.ts';

export type WilsonMovementState = 'idle' | 'walk' | 'run' | 'jump';
export type WilsonOneShotState = 'eat' | 'item_in' | 'item_out' | 'pickup';
export type WilsonStateName = WilsonMovementState | WilsonOneShotState | 'build' | 'emote'
  | 'mine_start' | 'mine' | 'hammer_start' | 'hammer'
  | 'bugnet_start' | 'bugnet' | 'terraform' | 'castspell' | 'veryquickcastspell'
  | 'quickeat' | 'doshortaction' | 'till_start' | 'till' | 'dig_start' | 'dig';
export type WilsonAction = 'MINE' | 'HAMMER' | 'NET' | 'TERRAFORM' | 'CASTSPELL' | 'RESKIN' | 'EAT' | 'PLANT' | 'TILL' | 'DIG';
export type WilsonAnimationKey = WilsonMovementState | WilsonOneShotState | 'build' | 'emote'
  | 'pickaxe_pre' | 'pickaxe_loop' | 'pickaxe_pst' | 'bugnet_pre' | 'bugnet'
  | 'shovel_pre' | 'shovel_loop' | 'shovel_pst' | 'staff_pre' | 'staff' | 'atk_pre' | 'atk'
  | 'quick_eat_pre' | 'quick_eat' | 'quick_drink_pre' | 'quick_drink' | 'pickup_pst' | 'till_pre' | 'till_loop' | 'till_pst';

export const WILSON_ACTION_TIMES = {
  mine: 7 * FRAMES, net: 10 * FRAMES, terraform: 25 * FRAMES,
  castSound: 13 * FRAMES, cast: 53 * FRAMES, reskin: 9 * FRAMES,
  quickEat: 12 * FRAMES, plant: 6 * FRAMES,
  till: 11 * FRAMES,
  dig: 15 * FRAMES,
} as const;

export interface WilsonAnimationClip {
  key: WilsonAnimationKey;
  name: string;
  loop?: boolean;
  playbackRate?: number;
  frameRate?: number;
}

export interface WilsonStateGraphHost {
  /** Select the art and return its effective playback duration in seconds. */
  playAnimation(clip: WilsonAnimationClip): number;
  playSound(cue: 'mine' | 'hammer' | 'cast' | 'reskin' | 'eat' | 'sip' | 'dig' | 'tillEmerge'): void;
  setCasting(casting: boolean): void;
  onStateChanged(name: WilsonStateName): void;
}

type WilsonInstance = StateGraphInstance<WilsonStateGraph, WilsonStateName>;
const State = DefineState<WilsonStateGraph, WilsonStateName>;
const clip = (key: WilsonAnimationKey, name: string = key): WilsonAnimationClip => ({ key, name });

/**
 * Implemented SGwilson.lua states, kept as explicit State tables in source order.
 * Component/animation APIs are provided by WilsonStateGraph's browser adapter.
 * Mounted, character-specific, prediction, held-action repetition and pocket-rummage
 * branches require components not yet ported here; see docs/dst-stategraphs.md.
 */
const states: StateDefinition<WilsonStateGraph, WilsonStateName>[] = [
  State({
    name: 'idle',
    tags: ['idle', 'canrotate'],
    onenter: (inst, pushanim) => inst.context.enterIdle(pushanim === true),
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
    onenter: (inst) => inst.context.playQuickEatClips(),
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
      inst.context.playClips([clip('pickup'), clip('pickup_pst')]);
      inst.setTimeout(10 * FRAMES);
    },
    timeline: [
      TimeEvent(6 * FRAMES, (inst) => {
        inst.removeStateTag('busy');
        inst.context.performBufferedAction();
      }),
    ],
    ontimeout: (inst) => inst.goToState('idle', true),
    onexit: (inst) => inst.context.clearBufferedAction(),
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
      inst.context.host.setCasting(true);
    },
    timeline: [
      TimeEvent(13 * FRAMES, (inst) => inst.context.host.playSound('cast')),
      TimeEvent(53 * FRAMES, (inst) => inst.context.performBufferedAction()),
      TimeEvent(69 * FRAMES, (inst) => inst.removeStateTag('busy')),
    ],
    events: [
      EventHandler('animqueueover', (inst) => {
        if (inst.context.animationDone) inst.goToState('idle');
      }),
    ],
    onexit: (inst) => inst.context.host.setCasting(false),
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
    name: 'emote',
    tags: ['busy', 'pausepredict'],
    onenter: (inst) => inst.context.playEmoteClips(),
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
    tags: ['jumping'],
    onenter: (inst) => inst.context.playClips([{ ...clip('jump'), loop: true }]),
  }),
  State({
    name: 'build',
    tags: ['crafting'],
    onenter: (inst) => inst.context.playClips([{ ...clip('build', 'build_loop'), loop: true }]),
  }),
  State({
    name: 'pickup',
    onenter: (inst) => inst.context.playClips([{ ...clip('pickup'), playbackRate: .5 }]),
    events: [
      EventHandler('animover', (inst) => {
        if (inst.context.animationDone) inst.context.finish();
      }),
    ],
  }),
];

const actionHandlers = [
  ActionHandler('MINE', 'mine_start'), ActionHandler('HAMMER', 'hammer_start'),
  ActionHandler('NET', 'bugnet_start'), ActionHandler('TERRAFORM', 'terraform'),
  ActionHandler('CASTSPELL', 'castspell'), ActionHandler('RESKIN', 'veryquickcastspell'),
  ActionHandler('EAT', 'quickeat'), ActionHandler('PLANT', 'doshortaction'),
  ActionHandler('TILL', 'till_start'),
  ActionHandler('DIG', 'dig_start'),
] as const;

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
  private cancelAnimation: (() => void) | undefined;
  private animationCompleted = false;

  constructor(host: WilsonStateGraphHost) {
    this.host = host;
    this.sg = new StateGraphInstance(this, [...states, ...applicationStates]);
    this.sg.listenForEvent('newstate', () => this.host.onStateChanged(this.sg.stateName));
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
  isPerformingAction(action: WilsonAction): boolean { return this.activeAction === action; }

  enterIdle(pushanim: boolean): void {
    this.clearBufferedAction();
    this.activeAction = null;
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

  start(state: WilsonMovementState): void {
    if (state !== 'idle' && this.stateName === 'emote') this.cancelEmote();
    if (state === this.movementState) return;
    this.movementState = state;
    if (!this.crafting && !this.isOneShot && this.stateName !== 'emote') this.sg.goToState(state);
  }

  setCrafting(crafting: boolean): void {
    if (crafting === this.crafting) return;
    this.crafting = crafting;
    if (crafting && (this.activeAction !== null || this.stateName === 'emote')) this.finish();
    else if (!this.isOneShot) this.sg.goToState(crafting ? 'build' : this.movementState);
  }

  playOneShot(state: WilsonOneShotState): void {
    this.clearBufferedAction();
    this.activeAction = null;
    this.sg.goToState(state);
  }

  canStartAction(action: WilsonAction): boolean {
    return !this.isOneShot && !this.crafting
      && (!this.isJumping || action === 'NET' || action === 'CASTSPELL');
  }

  pushBufferedAction(action: BufferedAction<WilsonAction>, foodDrink = false): boolean {
    if (!this.canStartAction(action.action) || !action.isValid()) return false;
    const handler = actionHandlers.find((entry) => entry.action === action.action);
    if (!handler) return false;
    this.clearBufferedAction();
    this.bufferedAction = action;
    this.activeAction = action.action;
    this.foodDrink = action.action === 'EAT' && foodDrink;
    this.sg.goToState(handler.state);
    return true;
  }

  performBufferedAction(): void {
    const action = this.bufferedAction;
    if (!action) return;
    this.pushEvent('performaction', { action });
    // A notification listener may cancel or replace the action before execution.
    if (this.bufferedAction !== action) return;
    this.bufferedAction = null;
    if (!action.do()) this.pushEvent('actionfailed', { action });
  }

  /** SGwilson quickeat chooses drink clips for fooddrink-tagged inventory food. */
  playQuickEatClips(): void {
    this.playClips(this.foodDrink
      ? [clip('quick_drink_pre'), clip('quick_drink')]
      : [clip('quick_eat_pre'), clip('quick_eat')]);
  }

  clearBufferedAction(): void {
    const action = this.bufferedAction;
    this.bufferedAction = null;
    if (action) this.pushEvent('actionfailed', { action });
  }

  cancelAction(action?: WilsonAction): void {
    if (this.activeAction !== null && (!action || this.activeAction === action)) this.finish();
  }

  finish(pushanim = false): void {
    this.clearBufferedAction();
    this.activeAction = null;
    // Lua's GoToState("idle", true) preserves the current animation queue.
    // Ordinary completion resumes the browser's requested movement/crafting state.
    this.sg.goToState(pushanim ? 'idle' : this.crafting ? 'build' : this.movementState, pushanim);
  }

  canEmote(): boolean { return !this.isOneShot && !this.crafting && !this.isJumping; }
  playEmote(names: readonly string[], loop: boolean): boolean {
    if (!this.canEmote() || !names.length) return false;
    this.emoteClips = names.map((name, index) => ({
      key: 'emote', name, loop: loop && index === names.length - 1,
    }));
    this.sg.goToState('emote');
    return true;
  }
  playEmoteClips(): void { this.playClips(this.emoteClips); }
  cancelEmote(): void { if (this.stateName === 'emote') this.finish(); }
}
