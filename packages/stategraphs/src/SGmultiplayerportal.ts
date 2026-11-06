import { EventHandler, FRAMES, State, StateGraphInstance, TimeEvent } from './stategraph.ts';
import type { StateDefinition } from './stategraph.ts';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

export type MultiplayerPortalStateName = 'idle' | 'funnyidle' | 'spawn_pre' | 'spawn_loop' | 'spawn_pst';
/** The multiplayer_portal.lua `inst.sounds` keys the ported states play. */
export type MultiplayerPortalSound = 'idle_loop' | 'jacob' | 'blink' | 'vines' | 'spawning_loop' | 'armswing' | 'shake' | 'open';

/** The multiplayer_portal.lua inst fields and methods SGmultiplayerportal.lua reads. */
export interface MultiplayerPortalStateInst {
  /** sg.mem.nofunny: set by the construction portal only. */
  readonly nofunny?: boolean;
  /** The local PlayAnimation: the portal and its `inst.fx`; a main clip's end pushes `animover` to the stategraph. */
  playAnimation(name: string): void;
  /** The local PlaySound: `inst.sounds[sound]`, unless it is nil or the named slot `id` is still playing. */
  playSound(sound: MultiplayerPortalSound, id?: string): void;
  /** SoundEmitter:KillSound. */
  killSound(id: string): void;
}

type Graph = StateGraphInstance<MultiplayerPortalStateInst, MultiplayerPortalStateName>;
const state = State<MultiplayerPortalStateInst, MultiplayerPortalStateName>;
const at = (frames: number, fn: (sg: Graph) => void) => TimeEvent<MultiplayerPortalStateInst, MultiplayerPortalStateName>(frames * FRAMES, fn);
const on = EventHandler<MultiplayerPortalStateInst, MultiplayerPortalStateName>;

// The construction states (placeconstruction, constructed, constructionphase2-4) belong to the unported construction portal.
const states: StateDefinition<MultiplayerPortalStateInst, MultiplayerPortalStateName>[] = [
  state({
    name: 'idle',
    tags: ['idle'],
    onenter: sg => {
      sg.context.playAnimation('idle_loop');
      sg.context.playSound('jacob');
      sg.context.playSound('idle_loop', 'portalidle');
    },
    events: [on('animover', sg => sg.goToState(!sg.context.nofunny && Math.random() < .3 ? 'funnyidle' : 'idle'))],
    timeline: [
      at(1, sg => sg.context.playSound('blink')),
      at(9, sg => sg.context.playSound('vines')),
      at(18, sg => sg.context.playSound('vines')),
      at(30, sg => sg.context.playSound('jacob')),
    ],
  }),
  state({
    name: 'funnyidle',
    tags: ['idle', 'canrotate'],
    onenter: sg => {
      sg.context.playAnimation('idle_eyescratch');
      sg.context.playSound('jacob');
    },
    events: [on('animover', sg => sg.goToState('idle'))],
    timeline: [
      at(1, sg => sg.context.playSound('blink')),
      at(30, sg => sg.context.playSound('jacob')),
    ],
  }),
  state({
    name: 'spawn_pre',
    tags: ['idle', 'open'],
    onenter: sg => {
      // AnimateWhilePaused(update_while_paused): the port has no paused simulation to animate through.
      sg.context.playAnimation('pre_fx');
      sg.context.killSound('portalidle');
      sg.context.playSound('spawning_loop', 'portalactivate');
      sg.context.playSound('armswing');
      sg.context.playSound('shake');
    },
    events: [on('animover', sg => {
      sg.statemem.keepactivatesound = true;
      sg.goToState('spawn_loop');
    })],
    timeline: [at(11, sg => sg.context.playSound('blink'))],
    onexit: sg => { if (!sg.statemem.keepactivatesound) sg.context.killSound('portalactivate'); },
  }),
  state({
    name: 'spawn_loop',
    tags: ['busy', 'open'],
    onenter: sg => {
      sg.context.playAnimation('fx');
      sg.context.playSound('idle_loop', 'portalidle');
    },
    events: [on('animover', sg => sg.goToState('spawn_pst'))],
    timeline: [at(55, sg => sg.context.playSound('open'))],
    onexit: sg => sg.context.killSound('portalactivate'),
  }),
  state({
    name: 'spawn_pst',
    tags: ['busy'],
    onenter: sg => sg.context.playAnimation('pst_fx'),
    events: [on('animover', sg => {
      sg.context.playSound('blink');
      sg.goToState('idle');
    })],
    timeline: [
      at(12, sg => sg.removeStateTag('busy')),
      at(22, sg => sg.context.playSound('armswing')),
    ],
  }),
];

/** stategraphs/SGmultiplayerportal.lua, initial state `idle`. */
export function createMultiplayerPortalStateGraph(inst: MultiplayerPortalStateInst, scheduler: GameTimeScheduler): Graph {
  const sg = new StateGraphInstance(inst, states, [], scheduler);
  sg.goToState('idle');
  return sg;
}
