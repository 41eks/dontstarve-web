import { EventHandler, FRAMES, State, StateGraphInstance, TimeEvent } from './stategraph.ts';
import type { StateDefinition } from './stategraph.ts';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { SoundEmitter } from '../../prefab/src/soundEmitter';
import type { SoundEventPath } from '../../prefab/src/sound';

export type MultiplayerPortalStateName = 'idle' | 'funnyidle' | 'spawn_pre' | 'spawn_loop' | 'spawn_pst';
/** The multiplayer_portal.lua `inst.sounds` keys the ported states play. */
export type MultiplayerPortalSound = 'idle_loop' | 'jacob' | 'blink' | 'vines' | 'spawning_loop' | 'armswing' | 'shake' | 'open';

/** The multiplayer_portal.lua inst fields and methods SGmultiplayerportal.lua reads. */
export interface MultiplayerPortalStateInst {
  /** sg.mem.nofunny: set by the construction portal only. */
  readonly nofunny?: boolean;
  /** The local PlayAnimation: the portal and its `inst.fx`; a main clip's end pushes `animover` to the stategraph. */
  playAnimation(name: string): void;
  /** inst.sounds: the portal's sound paths; a key it leaves nil plays nothing. */
  readonly sounds: Readonly<Partial<Record<MultiplayerPortalSound, SoundEventPath>>>;
  readonly SoundEmitter: Pick<SoundEmitter, 'PlaySound' | 'PlayingSound' | 'KillSound'>;
}

/** The local PlaySound: `inst.sounds[sound]`, unless it is nil or the named slot `id` is still playing. */
function PlaySound(inst: MultiplayerPortalStateInst, sound: MultiplayerPortalSound, id?: string): void {
  const path = inst.sounds[sound];
  if (path !== undefined && (id === undefined || !inst.SoundEmitter.PlayingSound(id))) { inst.SoundEmitter.PlaySound(path, id); }
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
      PlaySound(sg.context, 'jacob');
      PlaySound(sg.context, 'idle_loop', 'portalidle');
    },
    events: [on('animover', sg => sg.goToState(!sg.context.nofunny && Math.random() < .3 ? 'funnyidle' : 'idle'))],
    timeline: [
      at(1, sg => PlaySound(sg.context, 'blink')),
      at(9, sg => PlaySound(sg.context, 'vines')),
      at(18, sg => PlaySound(sg.context, 'vines')),
      at(30, sg => PlaySound(sg.context, 'jacob')),
    ],
  }),
  state({
    name: 'funnyidle',
    tags: ['idle', 'canrotate'],
    onenter: sg => {
      sg.context.playAnimation('idle_eyescratch');
      PlaySound(sg.context, 'jacob');
    },
    events: [on('animover', sg => sg.goToState('idle'))],
    timeline: [
      at(1, sg => PlaySound(sg.context, 'blink')),
      at(30, sg => PlaySound(sg.context, 'jacob')),
    ],
  }),
  state({
    name: 'spawn_pre',
    tags: ['idle', 'open'],
    onenter: sg => {
      // AnimateWhilePaused(update_while_paused): the port has no paused simulation to animate through.
      sg.context.playAnimation('pre_fx');
      sg.context.SoundEmitter.KillSound('portalidle');
      PlaySound(sg.context, 'spawning_loop', 'portalactivate');
      PlaySound(sg.context, 'armswing');
      PlaySound(sg.context, 'shake');
    },
    events: [on('animover', sg => {
      sg.statemem.keepactivatesound = true;
      sg.goToState('spawn_loop');
    })],
    timeline: [at(11, sg => PlaySound(sg.context, 'blink'))],
    onexit: sg => { if (!sg.statemem.keepactivatesound) { sg.context.SoundEmitter.KillSound('portalactivate'); } },
  }),
  state({
    name: 'spawn_loop',
    tags: ['busy', 'open'],
    onenter: sg => {
      sg.context.playAnimation('fx');
      PlaySound(sg.context, 'idle_loop', 'portalidle');
    },
    events: [on('animover', sg => sg.goToState('spawn_pst'))],
    timeline: [at(55, sg => PlaySound(sg.context, 'open'))],
    onexit: sg => sg.context.SoundEmitter.KillSound('portalactivate'),
  }),
  state({
    name: 'spawn_pst',
    tags: ['busy'],
    onenter: sg => sg.context.playAnimation('pst_fx'),
    events: [on('animover', sg => {
      PlaySound(sg.context, 'blink');
      sg.goToState('idle');
    })],
    timeline: [
      at(12, sg => sg.removeStateTag('busy')),
      at(22, sg => PlaySound(sg.context, 'armswing')),
    ],
  }),
];

/** stategraphs/SGmultiplayerportal.lua, initial state `idle`. */
export function createMultiplayerPortalStateGraph(inst: MultiplayerPortalStateInst, scheduler: GameTimeScheduler): Graph {
  const sg = new StateGraphInstance(inst, states, [], scheduler);
  sg.goToState('idle');
  return sg;
}
