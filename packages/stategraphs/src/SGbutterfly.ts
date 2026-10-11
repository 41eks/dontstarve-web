import type { BufferedAction } from './bufferedaction.ts';
import { ActionHandler, EventHandler, FRAMES, State, StateGraphInstance, TimeEvent } from './stategraph.ts';
import type { StateActionHandler, StateDefinition } from './stategraph.ts';
import type { LocoMotor } from '../../componets/src/locomotor';

export type ButterflyStateName = 'moving' | 'death' | 'idle' | 'land' | 'land_idle' | 'pollinate' | 'takeoff';

/**
 * The butterfly entity as SGbutterfly.lua uses it: AnimState, Physics, locomotor, lootdropper and the
 * buffered action. Frozen and electrocute states (commonstates.lua) need combat systems that are not ported.
 */
export interface ButterflyStateInst {
  readonly locomotor: LocoMotor;
  readonly bufferedaction: BufferedAction | undefined;
  /** AnimState:PlayAnimation; non-looping animations push `animover` to the stategraph when they finish. */
  playAnimation(name: string, loop?: boolean): void;
  /** AnimState:PushAnimation, used after an animation has already completed. */
  pushAnimation(name: string, loop?: boolean): void;
  isCurrentAnimation(name: string): boolean;
  getCurrentAnimationLength(): number;
  /** Physics:Stop() */
  stopPhysics(): void;
  removePhysicsColliders(): void;
  /** ocean_util.lua LandFlyingCreature / RaiseFlyingCreature */
  landFlyingCreature(): void;
  raiseFlyingCreature(): void;
  performBufferedAction(): boolean | undefined;
  dropLoot(): void;
  remove(): void;
  random(): number;
}

type SGInstance = StateGraphInstance<ButterflyStateInst, ButterflyStateName>;

const states: StateDefinition<ButterflyStateInst, ButterflyStateName>[] = [
  State<ButterflyStateInst, ButterflyStateName>({
    name: 'moving',
    tags: ['moving', 'canrotate'],
    onenter: (sg) => {
      sg.context.locomotor.WalkForward();
      sg.context.playAnimation('flight_cycle', true);
    },
  }),
  State<ButterflyStateInst, ButterflyStateName>({
    name: 'death',
    tags: ['busy'],
    onenter: (sg) => {
      sg.context.playAnimation('death');
      sg.context.stopPhysics();
      sg.context.removePhysicsColliders();
      sg.context.dropLoot();
    },
    timeline: [TimeEvent(10 * FRAMES, (sg) => sg.context.landFlyingCreature())],
  }),
  State<ButterflyStateInst, ButterflyStateName>({
    name: 'idle',
    tags: ['idle'],
    onenter: (sg) => {
      sg.context.stopPhysics();
      if (!sg.context.isCurrentAnimation('idle_flight_loop')) sg.context.playAnimation('idle_flight_loop', true);
      sg.setTimeout(sg.context.getCurrentAnimationLength());
    },
    ontimeout: (sg) => {
      if (sg.statemem.wantstomove) sg.goToState('moving');
      else sg.goToState('idle');
    },
  }),
  State<ButterflyStateInst, ButterflyStateName>({
    name: 'land',
    tags: ['busy', 'landing'],
    onenter: (sg) => {
      sg.context.stopPhysics();
      sg.context.playAnimation('land');
      sg.context.landFlyingCreature();
    },
    events: [EventHandler('animover', (sg) => {
      const action = sg.context.bufferedaction?.action;
      if (action === 'POLLINATE') sg.goToState('pollinate');
      else if (action === 'GOHOME') sg.context.remove();
      else sg.goToState('land_idle');
    })],
    onexit: (sg) => sg.context.raiseFlyingCreature(),
  }),
  State<ButterflyStateInst, ButterflyStateName>({
    name: 'land_idle',
    tags: ['busy', 'landed'],
    onenter: (sg) => {
      sg.context.pushAnimation('idle', true);
      sg.context.landFlyingCreature();
    },
    onexit: (sg) => sg.context.raiseFlyingCreature(),
  }),
  State<ButterflyStateInst, ButterflyStateName>({
    name: 'pollinate',
    tags: ['busy', 'landed'],
    onenter: (sg) => {
      sg.context.pushAnimation('idle', true);
      sg.context.performBufferedAction();
      // GetRandomWithVariance(3, 1)
      sg.setTimeout(3 + (sg.context.random() * 2 - 1));
      sg.context.landFlyingCreature();
    },
    ontimeout: (sg) => sg.goToState('takeoff'),
    onexit: (sg) => sg.context.raiseFlyingCreature(),
  }),
  State<ButterflyStateInst, ButterflyStateName>({
    name: 'takeoff',
    tags: ['busy'],
    onenter: (sg) => {
      sg.context.stopPhysics();
      sg.context.playAnimation('take_off');
    },
    events: [EventHandler('animover', (sg) => sg.goToState('idle'))],
  }),
];

const actionHandlers: StateActionHandler<ButterflyStateInst, ButterflyStateName>[] = [
  ActionHandler('GOHOME', 'land'),
  ActionHandler('POLLINATE', (sg) => (sg.hasStateTag('landed') ? 'pollinate' : 'land')),
];

/** stategraphs/SGbutterfly.lua, initial state `takeoff`. */
export class ButterflyStateGraph {
  readonly sg: SGInstance;

  constructor(inst: ButterflyStateInst, initialState: ButterflyStateName = 'takeoff') {
    this.sg = new StateGraphInstance(inst, states, actionHandlers);
    this.sg.listenForEvent('locomote', () => {
      if (!this.sg.hasStateTag('busy')) {
        const isMoving = this.sg.hasStateTag('moving');
        const wantsToMove = inst.locomotor.WantsToMoveForward();
        if (isMoving !== wantsToMove) {
          if (wantsToMove) this.sg.statemem.wantstomove = true;
          else this.sg.goToState('idle');
        }
      }
    });
    this.sg.listenForEvent('death', () => this.sg.goToState('death'));
    this.sg.goToState(initialState);
  }

  get stateName(): ButterflyStateName { return this.sg.stateName; }
  hasStateTag(tag: string): boolean { return this.sg.hasStateTag(tag); }
  goToState(name: ButterflyStateName): void { this.sg.goToState(name); }
  pushEvent(name: string, data?: unknown): void { this.sg.pushEvent(name, data); }
  /** StateGraphInstance:StartAction */
  startAction(action: BufferedAction): boolean { return this.sg.startAction(action); }
  update(dt: number): void { this.sg.update(dt); }
}
