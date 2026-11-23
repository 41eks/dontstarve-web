import type { ArchiveSpriteCommands } from '@dontstarve-web/display';
import type { ReadonlySignal, WorldMoonState } from '@dontstarve-web/signals';
import type { AnimState } from '../../componets/src/animstate';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { MOONDIAL_CONFIG } from '../../prefab/src/generated/moondial.schema';
import type { SoundEmitter } from '../../prefab/src/soundEmitter';
import { EventHandler, FRAMES, State, StateGraphInstance, TimeEvent } from './stategraph';

type StateName = 'idle' | 'next' | 'hit' | 'placed';

export interface MoondialStateInst {
  readonly moon?: ReadonlySignal<WorldMoonState>;
  readonly animstate: AnimState;
  readonly sprite: ArchiveSpriteCommands;
  readonly SoundEmitter: SoundEmitter;
}

/**
 * A clip of the moondial bank, as generated from its anim.bin: every name these helpers can build is checked against
 * the bank when this compiles.
 */
type MoondialClip = keyof (typeof MOONDIAL_CONFIG)['clips'];

function CalcPhaseAnimName(inst: MoondialStateInst, animation: 'idle' | 'hit' | 'place'): MoondialClip {
  return `${animation}_${inst.moon?.peek().phase ?? 'new'}` as const;
}

function CalcTransitionAnimName(inst: MoondialStateInst): MoondialClip {
  const { phase, waxing } = inst.moon!.peek();
  if (phase === 'full') {
    return 'wax_to_full';
  }
  if (phase === 'new') {
    return 'wane_to_new';
  }
  return `${waxing ? 'wax' : 'wane'}_to_${phase}` as const;
}

function play(inst: MoondialStateInst, name: MoondialClip, loop = false): void {
  inst.animstate.PlayAnimation(name, loop);
  if (loop) {
    inst.sprite.start(name);
  } else {
    inst.sprite.playOnce(name);
  }
}

const idleOnAnimationEnd = EventHandler<MoondialStateInst, StateName>('animover', sg => sg.goToState('idle'));
const states = [
  State<MoondialStateInst, StateName>({
    name: 'idle',
    onenter: ({ context: inst }) => {
      play(inst, CalcPhaseAnimName(inst, 'idle'), true);
      if (inst.moon?.peek().phase === 'full') {
        inst.SoundEmitter.PlaySound('dontstarve/common/together/moondial/full_LP', 'loop');
      } else {
        inst.SoundEmitter.KillSound('loop');
      }
    },
    onexit: ({ context: inst }) => inst.SoundEmitter.KillSound('loop'),
  }),
  State<MoondialStateInst, StateName>({
    name: 'next',
    onenter: ({ context: inst }) => play(inst, CalcTransitionAnimName(inst)),
    timeline: [
      TimeEvent(4 * FRAMES, ({ context: inst }) =>
        inst.SoundEmitter.PlaySound('dontstarve/common/together/moondial/fill'),
      ),
    ],
    events: [idleOnAnimationEnd],
  }),
  State<MoondialStateInst, StateName>({
    name: 'hit',
    onenter: ({ context: inst }) => play(inst, CalcPhaseAnimName(inst, 'hit')),
    timeline: [
      TimeEvent(9 * FRAMES, ({ context: inst }) =>
        inst.SoundEmitter.PlaySound('dontstarve/common/together/moondial/water_movement'),
      ),
    ],
    events: [idleOnAnimationEnd],
  }),
  State<MoondialStateInst, StateName>({
    name: 'placed',
    onenter: ({ context: inst }) => play(inst, CalcPhaseAnimName(inst, 'place')),
    timeline: [
      TimeEvent(5 * FRAMES, ({ context: inst }) =>
        inst.SoundEmitter.PlaySound('dontstarve/common/together/moondial/craft'),
      ),
      TimeEvent(7 * FRAMES, ({ context: inst }) => {
        if ((inst.moon?.peek().phase ?? 'new') !== 'new') {
          inst.SoundEmitter.PlaySound('dontstarve/common/together/moondial/water_movement');
        }
      }),
    ],
    events: [idleOnAnimationEnd],
  }),
];

export function MoondialStateGraph(inst: MoondialStateInst, scheduler: GameTimeScheduler) {
  const sg = new StateGraphInstance(inst, states, [], scheduler);
  sg.listenForEvent('worked', () => sg.goToState('hit'));
  sg.listenForEvent('onbuilt', () => sg.goToState('placed'));
  sg.goToState('idle');
  return sg;
}
