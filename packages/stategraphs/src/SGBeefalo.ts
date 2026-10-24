import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { EventHandler, StateGraphInstance, type StateDefinition } from './stategraph';

/** SGBeefalo.lua and commonstates.lua: states used by the passive wild adult. */
export type BeefaloStateName = 'idle' | 'graze' | 'graze_empty' | 'shake' | 'bellow'
  | 'walk_start' | 'walk' | 'walk_stop' | 'sleep' | 'sleeping' | 'wake'
  | 'shaved' | 'hair_growth' | 'hair_growth_pop' | 'alert' | 'actual_alert';

export interface BeefaloStateInst {
  readonly locomotor: {
    StopMoving(): void;
    WalkForward(): void;
    WantsToMoveForward(): boolean;
  };
  readonly sleeper: { IsAsleep(): boolean; WakeUp(): void };
  readonly hunger?: { GetPercent(): number };
  hairGrowthPending(): boolean;
  growHair(): void;
  playAnimation(name: string, loop?: boolean): void;
  pushAnimation(name: string, loop?: boolean): void;
  getCurrentAnimationLength(): number;
  isCurrentAnimation(name: string): boolean;
  random(): number;
}

type SG = StateGraphInstance<BeefaloStateInst, BeefaloStateName>;
const goToIdle = (sg: SG) => sg.goToState('idle');
const onAnimOver = [EventHandler<BeefaloStateInst, BeefaloStateName>('animover', goToIdle)];

const states: StateDefinition<BeefaloStateInst, BeefaloStateName>[] = [
  {
    name: 'alert', tags: ['idle', 'canrotate', 'alert'],
    // ShouldBeg is false for a wild adult with zero domestication.
    onenter: sg => sg.goToState('actual_alert'),
  },
  {
    name: 'actual_alert', tags: ['idle', 'canrotate', 'alert'],
    onenter: sg => {
      sg.context.locomotor.StopMoving();
      if (!sg.context.isCurrentAnimation('alert_idle')) {
        sg.context.playAnimation('alert_pre');
        sg.context.pushAnimation('alert_idle', true);
      }
      sg.setTimeout(2 + 2 * sg.context.random());
    },
    ontimeout: sg => sg.goToState('actual_alert'),
  },
  {
    name: 'idle', tags: ['idle', 'canrotate'],
    onenter: (sg, pushanim) => {
      const inst = sg.context;
      inst.locomotor.StopMoving();
      if (inst.hairGrowthPending()) { sg.goToState('hair_growth'); return; }
      if (pushanim) inst.pushAnimation('idle_loop', true);
      else inst.playAnimation('idle_loop', true);
      sg.setTimeout(1 + inst.random());
    },
    ontimeout: sg => {
      const rand = sg.context.random();
      // Wild beefalo.lua initializes hunger to zero. No saddle, Carrat or mood branch is active here.
      if ((sg.context.hunger?.GetPercent() ?? 0) > 0) {
        sg.goToState(rand < .75 ? 'graze' : rand < .90 ? 'shake' : 'bellow');
      } else sg.goToState(rand < .5 ? 'graze_empty' : rand < .75 ? 'shake' : 'bellow');
    },
  },
  {
    name: 'graze', tags: ['canrotate'],
    onenter: sg => {
      sg.context.locomotor.StopMoving();
      sg.context.playAnimation('graze_loop', true);
      sg.setTimeout(1 + sg.context.random() * 5);
    },
    ontimeout: goToIdle,
  },
  {
    name: 'graze_empty', tags: ['canrotate'],
    onenter: sg => {
      sg.context.locomotor.StopMoving();
      sg.context.playAnimation('graze2_pre');
      sg.context.pushAnimation('graze2_loop');
      sg.setTimeout(1 + sg.context.random() * 5);
    },
    ontimeout: sg => {
      sg.context.playAnimation('graze2_pst');
      sg.goToState('idle', true);
    },
  },
  ...(['shake', 'bellow'] as const).map(name => ({
    name, tags: name === 'shake' ? ['idle', 'canrotate'] : ['canrotate'],
    onenter: (sg: SG) => { sg.context.locomotor.StopMoving(); sg.context.playAnimation(name); },
    events: onAnimOver,
  })),
  {
    name: 'walk_start', tags: ['moving', 'canrotate'],
    onenter: sg => { sg.context.locomotor.WalkForward(); sg.context.playAnimation('walk_pre'); },
    events: [EventHandler('animover', sg => sg.goToState('walk'))],
  },
  {
    name: 'walk', tags: ['moving', 'canrotate'],
    onenter: sg => {
      sg.context.locomotor.WalkForward();
      sg.context.playAnimation('walk_loop', true);
      sg.setTimeout(sg.context.getCurrentAnimationLength());
    },
    ontimeout: sg => sg.goToState('walk'),
  },
  {
    name: 'walk_stop', tags: ['canrotate'],
    onenter: sg => { sg.context.locomotor.StopMoving(); sg.context.playAnimation('walk_pst'); },
    events: [EventHandler('animqueueover', goToIdle)],
  },
  {
    name: 'sleep', tags: ['busy', 'sleeping', 'nowake'],
    onenter: sg => { sg.context.locomotor.StopMoving(); sg.context.playAnimation('sleep_pre'); },
    events: [EventHandler('animover', sg => {
      sg.statemem.continuesleeping = true;
      sg.goToState(sg.context.sleeper.IsAsleep() ? 'sleeping' : 'wake');
    })],
    onexit: sg => {
      if (!sg.statemem.continuesleeping && sg.context.sleeper.IsAsleep()) sg.context.sleeper.WakeUp();
    },
  },
  {
    name: 'sleeping', tags: ['busy', 'sleeping'],
    onenter: sg => sg.context.playAnimation('sleep_loop'),
    events: [EventHandler('animover', sg => {
      sg.statemem.continuesleeping = true;
      sg.goToState('sleeping');
    })],
    onexit: sg => {
      if (!sg.statemem.continuesleeping && sg.context.sleeper.IsAsleep()) sg.context.sleeper.WakeUp();
    },
  },
  {
    name: 'wake', tags: ['busy', 'waking', 'nosleep'],
    onenter: sg => {
      sg.context.locomotor.StopMoving();
      sg.context.playAnimation('sleep_pst');
      if (sg.context.sleeper.IsAsleep()) sg.context.sleeper.WakeUp();
    },
    events: [EventHandler('animover', sg => sg.goToState(sg.context.sleeper.IsAsleep() ? 'sleep' : 'idle'))],
  },
  {
    name: 'shaved', tags: ['busy', 'sleeping'],
    onenter: sg => sg.context.playAnimation('shave'),
    events: [EventHandler('animover', sg => sg.goToState(sg.context.sleeper.IsAsleep() ? 'sleeping' : 'wake'))],
  },
  {
    name: 'hair_growth', tags: ['busy'],
    onenter: sg => { sg.context.locomotor.StopMoving(); sg.context.playAnimation('hair_growth_pre'); },
    events: [EventHandler('animover', sg => sg.goToState('hair_growth_pop'))],
  },
  {
    name: 'hair_growth_pop', tags: ['busy'],
    onenter: sg => {
      sg.context.locomotor.StopMoving();
      sg.context.playAnimation('hair_growth');
      sg.context.growHair();
    },
    events: onAnimOver,
  },
];

export class BeefaloStateGraph {
  readonly sg: SG;
  private exiting = false;

  constructor(inst: BeefaloStateInst, scheduler: GameTimeScheduler) {
    // Avoid re-entering the old state from sleeper:WakeUp during a state's onexit.
    const guarded = states.map(state => ({ ...state, onexit: state.onexit && ((sg: SG, next: BeefaloStateName) => {
      this.exiting = true;
      try { state.onexit!(sg, next); } finally { this.exiting = false; }
    }) }));
    this.sg = new StateGraphInstance(inst, guarded, [], scheduler);
    this.sg.listenForEvent('locomote', () => {
      const moving = this.sg.hasStateTag('moving'), wants = inst.locomotor.WantsToMoveForward();
      if (moving && !wants) this.sg.goToState('walk_stop');
      else if (this.sg.hasStateTag('idle') && wants) this.sg.goToState('walk_start');
    });
    this.sg.listenForEvent('gotosleep', () => {
      if (!this.sg.hasAnyStateTag('nosleep', 'sleeping')) this.sg.goToState('sleep');
    });
    this.sg.listenForEvent('onwakeup', () => {
      if (!this.exiting && this.sg.hasStateTag('sleeping') && !this.sg.hasStateTag('nowake')) {
        this.sg.statemem.continuesleeping = true;
        this.sg.goToState('wake');
      }
    });
    this.sg.goToState('idle');
  }

  get stateName(): BeefaloStateName { return this.sg.stateName; }
  hasStateTag(tag: string): boolean { return this.sg.hasStateTag(tag); }
  hasState(name: string): boolean { return states.some(state => state.name === name); }
  pushEvent(name: string, data?: unknown): void { this.sg.pushEvent(name, data); }
  goToState(name: BeefaloStateName): void { this.sg.goToState(name); }
  update(dt: number): void { this.sg.update(dt); }
  dispose(): void { this.sg.dispose(); }
}
