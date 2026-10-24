import { EventHandler, FRAMES, State, StateGraphInstance, TimeEvent } from './stategraph.ts';
import type { StateDefinition } from './stategraph.ts';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

export type PigKingStateName = 'idle' | 'cointoss' | 'happy' | 'unimpressed' | 'sleep' | 'wake';

/**
 * The pig king as SGpigking.lua uses it. The minigame states (intro..intro4) are not ported:
 * they need pig_token, the elite pigs and the minigame component.
 */
export interface PigKingStateInst {
  /** inst.sg.mem */
  readonly mem: { sleeping: boolean; endhappytask?: () => void };
  happy: boolean;
  readonly trader: { Enable(): void; Disable(): void };
  /** AnimState:PlayAnimation; a non-looping animation pushes `animover` to the stategraph when its queue ends. */
  playAnimation(name: string, loop?: boolean): void;
  pushAnimation(name: string, loop?: boolean): void;
  playSound(path: 'dontstarve/pig/PigKingThrowGold' | 'dontstarve/pig/PigKingHappy' | 'dontstarve/pig/PigKingReject'): void;
  /** inst:DoTaskInTime, cancelled with the king. */
  doTaskInTime(seconds: number, fn: () => void): () => void;
}

type PigKingGraph = StateGraphInstance<PigKingStateInst, PigKingStateName>;

const goIdleOnAnimOver = EventHandler<PigKingStateInst, PigKingStateName>('animover', sg => sg.goToState('idle'));

const states: StateDefinition<PigKingStateInst, PigKingStateName>[] = [
  State<PigKingStateInst, PigKingStateName>({
    name: 'idle',
    tags: ['idle'],
    onenter: sg => {
      if (sg.context.mem.sleeping) sg.goToState('sleep');
      else sg.context.playAnimation('idle', true);
    },
  }),
  State<PigKingStateInst, PigKingStateName>({
    name: 'cointoss',
    onenter: sg => {
      const inst = sg.context;
      inst.playAnimation('cointoss');
      inst.happy = true;
      inst.mem.endhappytask?.();
      const cancel = inst.mem.endhappytask = inst.doTaskInTime(5, () => {
        if (inst.mem.endhappytask === cancel) inst.mem.endhappytask = undefined;
        inst.happy = false;
      });
    },
    timeline: [TimeEvent(17 * FRAMES, sg => sg.context.playSound('dontstarve/pig/PigKingThrowGold'))],
    events: [EventHandler('animover', sg => sg.goToState('happy'))],
  }),
  State<PigKingStateInst, PigKingStateName>({
    name: 'happy',
    onenter: sg => sg.context.playAnimation('happy'),
    timeline: [TimeEvent(6 * FRAMES, sg => sg.context.playSound('dontstarve/pig/PigKingHappy'))],
    events: [goIdleOnAnimOver],
  }),
  State<PigKingStateInst, PigKingStateName>({
    name: 'unimpressed',
    onenter: sg => {
      const inst = sg.context;
      inst.playAnimation('unimpressed');
      inst.playSound('dontstarve/pig/PigKingReject');
      inst.happy = false;
      inst.mem.endhappytask?.();
      inst.mem.endhappytask = undefined;
    },
    events: [goIdleOnAnimOver],
  }),
  State<PigKingStateInst, PigKingStateName>({
    name: 'sleep',
    tags: ['sleeping'],
    onenter: sg => {
      sg.context.trader.Disable();
      sg.context.playAnimation('sleep_pre');
      sg.context.pushAnimation('sleep_loop', true);
    },
    onexit: sg => sg.context.trader.Enable(),
  }),
  State<PigKingStateInst, PigKingStateName>({
    name: 'wake',
    onenter: sg => sg.context.playAnimation('sleep_pst'),
    events: [goIdleOnAnimOver],
  }),
];

/** stategraphs/SGpigking.lua, initial state `idle`. */
export class PigKingStateGraph {
  readonly sg: PigKingGraph;

  constructor(inst: PigKingStateInst, scheduler?: GameTimeScheduler) {
    this.sg = new StateGraphInstance(inst, states, [], scheduler);
    this.sg.goToState('idle');
  }

  get stateName(): PigKingStateName { return this.sg.stateName; }
  hasStateTag(tag: string): boolean { return this.sg.hasStateTag(tag); }
  goToState(name: PigKingStateName): void { this.sg.goToState(name); }
  pushEvent(name: string, data?: unknown): void { this.sg.pushEvent(name, data); }
  update(dt: number): void { this.sg.update(dt); }
  dispose(): void { this.sg.dispose(); }
}
