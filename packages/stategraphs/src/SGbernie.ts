import { EventHandler, State, StateGraphInstance, TimeEvent } from './stategraph.ts';
import type { StateDefinition } from './stategraph.ts';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

export type BernieStateName = 'idle' | 'idle_nodir' | 'activate' | 'deactivate';
export type BernieBigStateName = 'idle' | 'idle_nodir' | 'activate' | 'deactivate';

/** What SGbernie.lua and SGberniebig.lua read from bernie_active.lua / bernie_big.lua. */
export interface BernieStateInst {
  /** AnimState:PlayAnimation / PushAnimation: the logical clips push `animover` and `animqueueover` to the stategraph. */
  playAnimation(name: string, loop?: boolean): void;
  pushAnimation(name: string, loop?: boolean): void;
  /** AnimState:IsCurrentAnimation */
  isCurrentAnimation(name: string): boolean;
  /** AnimState:GetCurrentAnimationLength */
  getCurrentAnimationLength(): number;
  /** AnimState:SetTime on the clip just played. */
  setAnimationTime(seconds: number): void;
  /** inst.components.health:SetInvincible */
  setInvincible(invincible: boolean): void;
  GoInactive(): void;
}

type Graph<Name extends string> = StateGraphInstance<BernieStateInst, Name>;

/** idle_nodir's facing switch at .5 seconds: idle_loop continues from the time idle_loop_nodir reached. */
const switchToIdleLoop = <Name extends string>(sg: Graph<Name>) => {
  sg.context.playAnimation('idle_loop', true);
  sg.context.setAnimationTime(.5);
};

/**
 * stategraphs/SGbernie.lua, initial state `activate`. The sounds, Transform facing modes, locomotor states, taunt,
 * hit and death are not ported.
 */
const bernieStates: StateDefinition<BernieStateInst, BernieStateName>[] = [
  State<BernieStateInst, BernieStateName>({
    name: 'idle',
    tags: ['idle', 'canrotate'],
    onenter: sg => {
      if (!sg.context.isCurrentAnimation('idle_loop')) sg.context.playAnimation('idle_loop', true);
      sg.setTimeout(sg.context.getCurrentAnimationLength());
    },
    ontimeout: sg => sg.goToState('idle'),
  }),
  State<BernieStateInst, BernieStateName>({
    name: 'idle_nodir',
    tags: ['idle', 'canrotate'],
    onenter: sg => {
      sg.context.playAnimation('idle_loop_nodir');
      sg.setTimeout(sg.context.getCurrentAnimationLength());
    },
    timeline: [TimeEvent(.5, switchToIdleLoop)],
    ontimeout: sg => sg.goToState('idle'),
  }),
  State<BernieStateInst, BernieStateName>({
    name: 'activate',
    tags: ['busy', 'canrotate'],
    onenter: sg => sg.context.playAnimation('activate'),
    events: [EventHandler('animover', sg => sg.goToState('idle_nodir'))],
  }),
  State<BernieStateInst, BernieStateName>({
    name: 'deactivate',
    tags: ['busy', 'deactivating'],
    onenter: sg => sg.context.playAnimation('deactivate'),
    events: [EventHandler('animover', sg => sg.context.GoInactive())],
  }),
];

/**
 * stategraphs/SGberniebig.lua, initial state `activate`. The DynamicShadow easing, sounds, facing modes, locomotion,
 * combat, hit, death, hop and sink states are not ported.
 */
const bernieBigStates: StateDefinition<BernieStateInst, BernieBigStateName>[] = [
  State<BernieStateInst, BernieBigStateName>({
    name: 'idle',
    tags: ['idle', 'canrotate'],
    onenter: sg => sg.context.playAnimation('idle_loop', true),
  }),
  State<BernieStateInst, BernieBigStateName>({
    name: 'idle_nodir',
    tags: ['idle', 'canrotate'],
    onenter: sg => {
      sg.context.playAnimation('idle_loop_nodir');
      sg.setTimeout(.5);
    },
    ontimeout: switchToIdleLoop,
    // V2C: shouldn't happen
    events: [EventHandler('animqueueover', sg => sg.goToState('idle'))],
  }),
  State<BernieStateInst, BernieBigStateName>({
    name: 'activate',
    tags: ['busy', 'canrotate'],
    onenter: sg => sg.context.playAnimation('activate'),
    events: [EventHandler('animover', sg => sg.goToState('idle_nodir'))],
  }),
  State<BernieStateInst, BernieBigStateName>({
    name: 'deactivate',
    tags: ['busy', 'deactivating', 'noattack'],
    onenter: sg => {
      sg.context.playAnimation('deactivate');
      sg.context.pushAnimation('deactivate_pst');
      sg.context.setInvincible(true);
    },
    events: [EventHandler('animqueueover', sg => sg.context.GoInactive())],
    onexit: sg => sg.context.setInvincible(false),
  }),
];

/** SetStateGraph("SGbernie") / SetStateGraph("SGberniebig"): both start in `activate`. */
export function createBernieStateGraph(inst: BernieStateInst, big: false, scheduler: GameTimeScheduler): Graph<BernieStateName>;
export function createBernieStateGraph(inst: BernieStateInst, big: true, scheduler: GameTimeScheduler): Graph<BernieBigStateName>;
export function createBernieStateGraph(inst: BernieStateInst, big: boolean, scheduler: GameTimeScheduler) {
  const sg = new StateGraphInstance(inst, big ? bernieBigStates : bernieStates, [], scheduler);
  sg.goToState('activate');
  return sg;
}
