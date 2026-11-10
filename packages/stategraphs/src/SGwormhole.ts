import { EventHandler, FRAMES, State, StateGraphInstance, TimeEvent } from './stategraph.ts';
import type { StateDefinition } from './stategraph.ts';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { SoundEmitter } from '../../prefab/src/soundEmitter';

export type WormholeStateName = 'idle' | 'open' | 'opening' | 'closing';
export type WormholeSound = 'dontstarve/common/teleportworm/idle' | 'dontstarve/common/teleportworm/open'
  | 'dontstarve/common/teleportworm/close';

/** What SGwormhole.lua reads from and writes to its inst. */
export interface WormholeStateInst {
  /** AnimState:PlayAnimation; a non-looping animation pushes `animover` to the stategraph when it ends. */
  playAnimation(name: string, loop?: boolean): void;
  /** SetGroundLayering (LAYER_BACKGROUND, sort order 3) when true, SetBBLayering (LAYER_WORLD, 0) when false. */
  setGroundLayering(ground: boolean): void;
  readonly SoundEmitter: Pick<SoundEmitter, 'PlaySound' | 'KillSound'>;
}

type Graph = StateGraphInstance<WormholeStateInst, WormholeStateName>;
type Definition = StateDefinition<WormholeStateInst, WormholeStateName>;

const states: Definition[] = [
  State<WormholeStateInst, WormholeStateName>({
    name: 'idle',
    tags: ['idle'],
    onenter: sg => {
      sg.context.setGroundLayering(false);
      sg.context.playAnimation('idle_loop', true);
    },
  }),
  State<WormholeStateInst, WormholeStateName>({
    name: 'open',
    tags: ['idle', 'open'],
    onenter: sg => {
      sg.context.setGroundLayering(true);
      sg.context.playAnimation('open_loop', true);
      // since we can jump right to the open state, retrigger this sound.
      sg.context.SoundEmitter.PlaySound('dontstarve/common/teleportworm/idle', 'wormhole_open');
    },
    onexit: sg => sg.context.SoundEmitter.KillSound('wormhole_open'),
  }),
  State<WormholeStateInst, WormholeStateName>({
    name: 'opening',
    tags: ['busy', 'open'],
    onenter: sg => {
      sg.context.setGroundLayering(false);
      sg.context.playAnimation('open_pre');
      sg.context.SoundEmitter.PlaySound('dontstarve/common/teleportworm/open');
    },
    timeline: [TimeEvent(10 * FRAMES, sg => sg.context.setGroundLayering(true))],
    events: [EventHandler('animover', sg => sg.goToState('open'))],
  }),
  State<WormholeStateInst, WormholeStateName>({
    name: 'closing',
    tags: ['busy'],
    onenter: sg => {
      sg.context.setGroundLayering(true);
      sg.context.playAnimation('open_pst');
      sg.context.SoundEmitter.PlaySound('dontstarve/common/teleportworm/close');
    },
    timeline: [TimeEvent(4 * FRAMES, sg => sg.context.setGroundLayering(false))],
    events: [EventHandler('animover', sg => sg.goToState('idle'))],
  }),
];

/** stategraphs/SGwormhole.lua, initial state `idle`. */
export function WormholeStateGraph(inst: WormholeStateInst, scheduler: GameTimeScheduler): Graph {
  const sg = new StateGraphInstance(inst, states, [], scheduler);
  sg.goToState('idle');
  return sg;
}
