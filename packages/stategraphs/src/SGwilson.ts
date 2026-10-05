import { BufferedAction } from './bufferedaction.ts';
import { ActionHandler, EventHandler, FRAMES, State, StateGraphInstance, TimeEvent } from './stategraph.ts';
import type { StateDefinition } from './stategraph.ts';

export type WilsonMovementState = 'idle' | 'walk' | 'run' | 'jump';
export type WilsonOneShotState = 'eat' | 'item_in' | 'item_out' | 'pickup';
export type WilsonStateName = WilsonMovementState | WilsonOneShotState | 'build' | 'emote'
  | 'mine_start' | 'mine' | 'mine_pst' | 'hammer_start' | 'hammer' | 'hammer_pst'
  | 'bugnet_start' | 'bugnet' | 'terraform' | 'terraform_pst' | 'castspell' | 'veryquickcastspell';
export type WilsonAction = 'MINE' | 'HAMMER' | 'NET' | 'TERRAFORM' | 'CASTSPELL' | 'RESKIN';
export type WilsonAnimationKey = WilsonMovementState | WilsonOneShotState | 'build' | 'emote'
  | 'pickaxe_pre' | 'pickaxe_loop' | 'pickaxe_pst' | 'bugnet_pre' | 'bugnet'
  | 'shovel_pre' | 'shovel_loop' | 'shovel_pst' | 'staff_pre' | 'staff' | 'atk_pre' | 'atk';

export const WILSON_ACTION_TIMES = {
  mine: 7 * FRAMES, net: 10 * FRAMES, terraform: 25 * FRAMES,
  castSound: 13 * FRAMES, cast: 53 * FRAMES, reskin: 9 * FRAMES,
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
  playSound(cue: 'mine' | 'hammer' | 'cast' | 'reskin'): void;
  setCasting(casting: boolean): void;
  onStateChanged(name: WilsonStateName): void;
}

type WilsonInstance = StateGraphInstance<WilsonStateGraph, WilsonStateName>;
const finish = (inst: WilsonInstance) => inst.context.finish();
const perform = (inst: WilsonInstance) => inst.context.performBufferedAction();
const clip = (key: WilsonAnimationKey, name: string = key): WilsonAnimationClip => ({ key, name });

/** Ported action states/timelines from SGwilson.lua, for the implemented player actions. */
function createStates(): StateDefinition<WilsonStateGraph, WilsonStateName>[] {
  const animationEvents = (next?: WilsonStateName, event = 'animover') => [
    EventHandler<WilsonStateGraph, WilsonStateName>(event, (inst) => {
      if (next) inst.goToState(next); else finish(inst);
    }),
  ];
  const makeState = (
    name: WilsonStateName, clips: readonly WilsonAnimationClip[], tags: readonly string[] = [],
    extra: Omit<StateDefinition<WilsonStateGraph, WilsonStateName>, 'name' | 'tags'> = {},
  ): StateDefinition<WilsonStateGraph, WilsonStateName> => State({
    name, tags,
    onenter: (inst) => { inst.context.enter(name, clips); extra.onenter?.(inst); },
    onexit: extra.onexit,
    ontimeout: (inst) => inst.context.animationOver(),
    timeline: extra.timeline,
    events: [...extra.events ?? [], EventHandler('unequip', (inst) => {
      if (inst.hasStateTag('action')) inst.context.cancelAction();
    })],
  });
  const states: StateDefinition<WilsonStateGraph, WilsonStateName>[] = [
    makeState('idle', [{ ...clip('idle', 'idle_loop'), loop: true }], ['idle']),
    makeState('walk', [{ ...clip('walk', 'run_loop'), loop: true, frameRate: 16 }], ['moving']),
    makeState('run', [{ ...clip('run', 'run_loop'), loop: true }], ['moving']),
    makeState('jump', [{ ...clip('jump'), loop: true }], ['jumping']),
    makeState('build', [{ ...clip('build', 'build_loop'), loop: true }], ['crafting']),
    makeState('emote', [], ['emoting'], {
      onenter: (inst) => inst.context.playEmoteClips(), events: animationEvents(undefined, 'animqueueover'),
    }),
  ];
  for (const name of ['eat', 'item_in', 'item_out', 'pickup'] as const) {
    states.push(makeState(name, [{ ...clip(name), playbackRate: name === 'pickup' ? 0.5 : 1 }],
      ['oneshot'], { events: animationEvents() }));
  }
  for (const action of ['mine', 'hammer'] as const) {
    const tags = ['oneshot', 'action', 'working', 'mining', ...(action === 'hammer' ? ['hammering'] : [])];
    states.push(
      makeState(`${action}_start`, [clip('pickaxe_pre')], [...tags, `pre${action}`], {
        events: animationEvents(action),
      }),
      makeState(action, [clip('pickaxe_loop')], [...tags, `pre${action}`], {
        timeline: [
          TimeEvent(WILSON_ACTION_TIMES.mine, (inst: WilsonInstance) => {
            inst.context.host.playSound(action);
            perform(inst);
          }),
          TimeEvent(9 * FRAMES, (inst: WilsonInstance) => inst.removeStateTag(`pre${action}`)),
        ],
        events: animationEvents(`${action}_pst`),
      }),
      makeState(`${action}_pst`, [clip('pickaxe_pst')], tags, { events: animationEvents() }),
    );
  }
  states.push(
    makeState('bugnet_start', [clip('bugnet_pre')], ['oneshot', 'action', 'working', 'netting', 'prenet'], {
      events: animationEvents('bugnet'),
    }),
    makeState('bugnet', [clip('bugnet')], ['oneshot', 'action', 'working', 'netting', 'prenet'], {
      timeline: [TimeEvent(WILSON_ACTION_TIMES.net, (inst: WilsonInstance) => {
        const revision = inst.stateRevision;
        perform(inst);
        if (inst.stateRevision === revision) inst.removeStateTag('prenet');
      })], events: animationEvents(),
    }),
    // TERRAFORM's clock spans shovel_pre + shovel_loop, unlike DIG's loop-local clock.
    makeState('terraform', [clip('shovel_pre'), clip('shovel_loop')], ['oneshot', 'action', 'digging', 'busy'], {
      timeline: [TimeEvent(WILSON_ACTION_TIMES.terraform, (inst: WilsonInstance) => {
        const revision = inst.stateRevision;
        perform(inst);
        if (inst.stateRevision === revision) inst.removeStateTag('busy');
      })],
      events: animationEvents('terraform_pst', 'animqueueover'),
    }),
    makeState('terraform_pst', [clip('shovel_pst')], ['oneshot', 'action', 'digging'], {
      events: animationEvents(),
    }),
    makeState('castspell', [clip('staff_pre'), clip('staff')], ['oneshot', 'action', 'casting', 'busy', 'canrotate'], {
      onenter: (inst) => inst.context.host.setCasting(true),
      onexit: (inst) => inst.context.host.setCasting(false),
      timeline: [
        TimeEvent(WILSON_ACTION_TIMES.castSound, (inst: WilsonInstance) => inst.context.host.playSound('cast')),
        TimeEvent(WILSON_ACTION_TIMES.cast, perform),
        TimeEvent(69 * FRAMES, (inst: WilsonInstance) => inst.removeStateTag('busy')),
      ], events: animationEvents(undefined, 'animqueueover'),
    }),
    makeState('veryquickcastspell', [clip('atk_pre'), clip('atk')], ['oneshot', 'action', 'reskinning', 'busy', 'canrotate'], {
      onenter: (inst) => inst.context.host.playSound('reskin'),
      timeline: [TimeEvent(WILSON_ACTION_TIMES.reskin, (inst: WilsonInstance) => {
        const revision = inst.stateRevision;
        perform(inst);
        if (inst.stateRevision === revision) inst.removeStateTag('busy');
      })], events: animationEvents(undefined, 'animqueueover'),
    }),
  );
  return states;
}

const actionHandlers = [
  ActionHandler('MINE', 'mine_start'), ActionHandler('HAMMER', 'hammer_start'),
  ActionHandler('NET', 'bugnet_start'), ActionHandler('TERRAFORM', 'terraform'),
  ActionHandler('CASTSPELL', 'castspell'), ActionHandler('RESKIN', 'veryquickcastspell'),
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

  constructor(host: WilsonStateGraphHost) {
    this.host = host;
    this.sg = new StateGraphInstance(this, createStates());
    this.sg.goToState('idle');
  }

  get stateName(): WilsonStateName { return this.sg.stateName; }
  get animationClip(): WilsonAnimationClip { return this.clips[this.clipIndex]; }
  get animationTime(): number { return Math.max(0, this.sg.timeInState - this.clipStartedAt); }
  get isOneShot(): boolean { return this.hasStateTag('oneshot'); }
  get isCrafting(): boolean { return this.crafting; }
  get isJumping(): boolean { return this.movementState === 'jump'; }
  hasStateTag(tag: string): boolean { return this.sg.hasStateTag(tag); }
  listenForEvent(name: string, fn: (data: unknown) => void): () => void { return this.sg.listenForEvent(name, fn); }
  pushEvent(name: string, data?: unknown): void { this.sg.pushEvent(name, data); }
  update(dt: number): void { this.sg.update(dt); }

  enter(name: WilsonStateName, clips: readonly WilsonAnimationClip[]): void {
    this.host.onStateChanged(name);
    if (clips.length) this.playClips(clips);
  }

  private playClips(clips: readonly WilsonAnimationClip[]): void {
    this.clips = clips;
    this.clipIndex = 0;
    this.selectClip();
  }

  private selectClip(): void {
    this.clipStartedAt = this.sg.timeInState;
    this.sg.setTimeout(this.host.playAnimation(this.animationClip));
  }

  animationOver(): void {
    const revision = this.sg.stateRevision;
    this.pushEvent('animover');
    if (this.sg.stateRevision !== revision) return;
    if (this.clipIndex + 1 < this.clips.length) {
      this.clipIndex++;
      this.selectClip();
    } else if (this.animationClip.loop) {
      this.selectClip();
    } else {
      this.pushEvent('animqueueover');
    }
  }

  start(state: WilsonMovementState): void {
    if (state !== 'idle' && this.hasStateTag('emoting')) this.cancelEmote();
    if (state === this.movementState) return;
    this.movementState = state;
    if (!this.crafting && !this.isOneShot && !this.hasStateTag('emoting')) this.sg.goToState(state);
  }

  setCrafting(crafting: boolean): void {
    if (crafting === this.crafting) return;
    this.crafting = crafting;
    if (crafting && (this.hasStateTag('action') || this.hasStateTag('emoting'))) this.finish();
    else if (!this.isOneShot) this.sg.goToState(crafting ? 'build' : this.movementState);
  }

  playOneShot(state: WilsonOneShotState): void {
    this.clearBufferedAction();
    this.sg.goToState(state);
  }

  canStartAction(action: WilsonAction): boolean {
    return !this.isOneShot && !this.crafting
      && (!this.isJumping || action === 'NET' || action === 'CASTSPELL');
  }

  pushBufferedAction(action: BufferedAction<WilsonAction>): boolean {
    if (!this.canStartAction(action.action) || !action.isValid()) return false;
    const handler = actionHandlers.find((entry) => entry.action === action.action);
    if (!handler) return false;
    this.clearBufferedAction();
    this.bufferedAction = action;
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

  private clearBufferedAction(): void {
    const action = this.bufferedAction;
    this.bufferedAction = null;
    if (action) this.pushEvent('actionfailed', { action });
  }

  cancelAction(tag?: string): void {
    if (this.hasStateTag('action') && (!tag || this.hasStateTag(tag))) this.finish();
  }

  finish(): void {
    this.clearBufferedAction();
    this.sg.goToState(this.crafting ? 'build' : this.movementState);
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
  cancelEmote(): void { if (this.hasStateTag('emoting')) this.finish(); }
}
