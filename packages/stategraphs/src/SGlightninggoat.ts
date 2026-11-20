import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { EventHandler, FRAMES, StateGraphInstance, TimeEvent, type StateDefinition } from './stategraph';

/**
 * SGlightninggoat.lua and the commonstates.lua sleep states. The combat (attack, hit, death), frozen and corpse states
 * and their handlers are not ported, as the goat has no combat or freezing here.
 */
export type LightningGoatStateName = 'idle' | 'bleet' | 'walk_start' | 'walk' | 'walk_stop' | 'taunt'
  | 'discharge' | 'electrocute' | 'shocked' | 'sleep' | 'sleeping' | 'wake';

export type LightningGoatSound = 'jacobshorn' | 'chew' | 'jump' | 'taunt' | 'hoof' | 'bleet' | 'shocked_electric'
  | 'shocked_bleet' | 'sleep';

export interface LightningGoatStateInst {
  readonly locomotor: {
    StopMoving(): void;
    WalkForward(): void;
    RunForward(): void;
    WantsToMoveForward(): boolean;
  };
  readonly sleeper: { IsAsleep(): boolean; WakeUp(): void };
  /** inst.charged. */
  charged(): boolean;
  /** inst.SoundEmitter:PlaySound("dontstarve_DLC001/creatures/lightninggoat/<sound>"). */
  playSound(sound: LightningGoatSound): void;
  /** inst:DoPeriodicTask(period, fn): the returned function cancels it. */
  doPeriodicTask(period: number, fn: () => void): () => void;
  /** discharge's frame 18: AnimState:Hide("fx") and SetBuild("lightning_goat_build"). */
  clearChargedLook(): void;
  /** inst:PerformBufferedAction(). */
  performBufferedAction(): void;
  playAnimation(name: string, loop?: boolean): void;
  pushAnimation(name: string, loop?: boolean): void;
  random(): number;
}

interface LightningGoatSpec { mem: { jacobsladdersfxtask: () => void }; data: { [K in LightningGoatStateName]: unknown }; action: never }
type SG = StateGraphInstance<LightningGoatStateInst, LightningGoatStateName, LightningGoatSpec>;
type State = StateDefinition<LightningGoatStateInst, LightningGoatStateName, LightningGoatSpec>;
const Event = <E extends string>(name: E, fn: (sg: SG) => void) =>
  EventHandler<LightningGoatStateInst, LightningGoatStateName, E, LightningGoatSpec>(name, sg => fn(sg));
const Time = TimeEvent<LightningGoatStateInst, LightningGoatStateName, LightningGoatSpec>;
const goToIdle = (sg: SG) => sg.goToState('idle');
const hornIfCharged = (sg: SG) => { if (sg.context.charged()) { sg.context.playSound('jacobshorn'); } };

/** GetRandomWithVariance(baseval, randomval): evaluated once, as the source's timeline table is built at load. */
const withVariance = (base: number, variance: number) => base + (Math.random() * 2 * variance - variance);
const IDLE_CHEW_FRAMES = [withVariance(8, 3), withVariance(33, 3)];

const states: State[] = [
  {
    name: 'idle', tags: ['idle', 'canrotate'],
    onenter: sg => {
      const inst = sg.context;
      inst.locomotor.StopMoving();
      inst.playAnimation('idle_loop', true);
      sg.setTimeout(inst.random() * 4 + 2);
      hornIfCharged(sg);
      sg.statemem.jacobsladdersfxtask = inst.doPeriodicTask(44 * FRAMES, () => hornIfCharged(sg));
    },
    ontimeout: sg => sg.goToState('bleet'),
    onexit: sg => {
      sg.statemem.jacobsladdersfxtask?.();
      sg.statemem.jacobsladdersfxtask = undefined;
    },
    timeline: IDLE_CHEW_FRAMES.map(frames => Time(frames * FRAMES, sg => sg.context.playSound('chew'))),
  },
  {
    name: 'walk_start', tags: ['moving', 'canrotate'],
    onenter: sg => sg.context.playAnimation('walk_pre'),
    events: [Event('animover', sg => sg.goToState('walk'))],
  },
  {
    name: 'walk', tags: ['moving', 'canrotate'],
    onenter: sg => {
      sg.context.locomotor.WalkForward();
      sg.context.playAnimation('walk');
      sg.context.playSound('jump');
      hornIfCharged(sg);
    },
    timeline: [
      Time(2 * FRAMES, sg => sg.context.locomotor.RunForward()),
      Time(14 * FRAMES, sg => sg.context.locomotor.WalkForward()),
    ],
    events: [Event('animover', sg => sg.goToState('walk'))],
  },
  {
    name: 'walk_stop', tags: ['canrotate'],
    onenter: sg => { sg.context.locomotor.StopMoving(); sg.context.playAnimation('walk_pst', false); },
    events: [Event('animover', goToIdle)],
  },
  {
    name: 'taunt', tags: ['busy'],
    onenter: sg => {
      sg.context.locomotor.StopMoving();
      sg.context.playAnimation('taunt_pre');
      sg.context.pushAnimation('taunt');
      sg.context.pushAnimation('taunt_pst', false);
    },
    timeline: [
      Time(5 * FRAMES, sg => sg.context.playSound('taunt')),
      Time(17 * FRAMES, hornIfCharged),
      Time(27 * FRAMES, sg => sg.context.playSound('hoof')),
      Time(44 * FRAMES, hornIfCharged),
      Time(53 * FRAMES, sg => sg.context.playSound('hoof')),
      Time(71 * FRAMES, hornIfCharged),
      Time(79 * FRAMES, sg => sg.context.playSound('hoof')),
    ],
    events: [Event('animqueueover', goToIdle)],
  },
  {
    name: 'bleet', tags: ['idle'],
    onenter: sg => { sg.context.locomotor.StopMoving(); sg.context.playAnimation('bleet'); },
    timeline: [
      Time(1 * FRAMES, hornIfCharged),
      Time(10 * FRAMES, sg => sg.context.playSound('bleet')),
    ],
    events: [Event('animover', goToIdle)],
  },
  {
    name: 'discharge', tags: ['busy'],
    onenter: sg => {
      sg.context.locomotor.StopMoving();
      sg.context.playAnimation('trans');
      sg.context.playSound('shocked_electric');
    },
    timeline: [Time(18 * FRAMES, sg => sg.context.clearChargedLook())],
    events: [Event('animover', goToIdle)],
  },
  // New electrocute mechanics depend on this state name existing. Forward to old state for backward compatibility.
  { name: 'electrocute', onenter: sg => sg.goToState('shocked') },
  {
    name: 'shocked', tags: ['busy'],
    onenter: sg => {
      sg.context.locomotor.StopMoving();
      sg.context.playAnimation('shock');
      sg.context.pushAnimation('shock_pst', false);
      sg.context.playSound('shocked_electric');
      sg.context.playSound('shocked_bleet');
      sg.context.playSound('jacobshorn');
    },
    timeline: [Time(10 * FRAMES, sg => sg.context.performBufferedAction())],
    events: [Event('animqueueover', goToIdle)],
  },
  // commonstates.lua AddSleepStates. SGlightninggoat passes its first timeline as `startsleeptimeline`, a key
  // AddSleepStates does not read (it reads `starttimeline`), so the source's sleep state plays no jacobshorn.
  {
    name: 'sleep', tags: ['busy', 'sleeping'],
    onenter: sg => { sg.context.locomotor.StopMoving(); sg.context.playAnimation('sleep_pre'); },
    events: [Event('animover', sg => sg.goToState('sleeping')), Event('onwakeup', onwakeup)],
  },
  {
    name: 'sleeping', tags: ['busy', 'sleeping'],
    onenter: sg => sg.context.playAnimation('sleep_loop'),
    timeline: [Time(41 * FRAMES, sg => sg.context.playSound('sleep'))],
    events: [Event('animover', sg => sg.goToState('sleeping')), Event('onwakeup', onwakeup)],
  },
  {
    name: 'wake', tags: ['busy', 'waking'],
    onenter: sg => {
      sg.context.locomotor.StopMoving();
      sg.context.playAnimation('sleep_pst');
      if (sg.context.sleeper.IsAsleep()) { sg.context.sleeper.WakeUp(); }
    },
    events: [Event('animover', goToIdle)],
  },
];

function onwakeup(sg: SG): void {
  if (!sg.hasStateTag('nowake')) { sg.goToState('wake'); }
}

/** SGlightninggoat's StateGraph("lightninggoat", states, events, "init"): AddInitState enters idle. */
export class LightningGoatStateGraph {
  readonly sg: SG;

  constructor(inst: LightningGoatStateInst, scheduler: GameTimeScheduler) {
    this.sg = new StateGraphInstance(inst, states, [], scheduler);
    // CommonHandlers.OnLocomote(false, true): the goat only walks.
    this.sg.listenForEvent('locomote', () => {
      const moving = this.sg.hasStateTag('moving'), wants = inst.locomotor.WantsToMoveForward();
      if (moving && !wants) { this.sg.goToState('walk_stop'); }
      else if (this.sg.hasStateTag('idle') && wants) { this.sg.goToState('walk_start'); }
    });
    // CommonHandlers.OnSleep(): health and electrocute checks have nothing to stop here.
    this.sg.listenForEvent('gotosleep', () => this.sg.goToState(this.sg.hasStateTag('sleeping') ? 'sleeping' : 'sleep'));
    this.sg.goToState('idle');
  }

  get stateName(): LightningGoatStateName { return this.sg.stateName; }
  hasStateTag(tag: string): boolean { return this.sg.hasStateTag(tag); }
  pushEvent(name: string, data?: unknown): void { this.sg.pushEvent(name, data); }
  goToState(name: LightningGoatStateName): void { this.sg.goToState(name); }
  update(dt: number): void { this.sg.update(dt); }
  dispose(): void { this.sg.dispose(); }
}
