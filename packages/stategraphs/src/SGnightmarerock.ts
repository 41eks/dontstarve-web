import { EventHandler, State, StateGraphInstance } from './stategraph.ts';
import type { StateDefinition } from './stategraph.ts';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

export type NightmareRockStateName = 'idle' | 'raise' | 'lower' | 'conceal' | 'concealed' | 'reveal';
export type NightmareRockSound = 'dontstarve/sanity/shadowrock_up' | 'dontstarve/sanity/shadowrock_down'
  | 'dontstarve/sanity/shadowrock_conseal' | 'dontstarve/sanity/shadowrock_reveal';

/** The nightmarerock.lua inst fields and methods SGnightmarerock.lua reads. */
export interface NightmareRockStateInst {
  readonly active: boolean;
  readonly conceal: boolean;
  readonly conceal_queued: boolean;
  /** AnimState:PlayAnimation; a non-looping animation pushes `animover` to the stategraph when it ends. */
  playAnimation(name: string): void;
  playSound(path: NightmareRockSound): void;
  /** SpawnPrefab("sanity_raise" | "sanity_lower") at the rock. */
  spawnFx(prefab: 'sanity_raise' | 'sanity_lower'): void;
  OnActiveStateChanged(): void;
  OnConcealStateChanged(): void;
  Hide(): void;
  Show(): void;
}

type Graph = StateGraphInstance<NightmareRockStateInst, NightmareRockStateName>;
const concealedOrQueued = (inst: NightmareRockStateInst) => inst.conceal || inst.conceal_queued;

const states: StateDefinition<NightmareRockStateInst, NightmareRockStateName>[] = [
  State<NightmareRockStateInst, NightmareRockStateName>({
    name: 'idle',
    tags: ['idle'],
    onenter: sg => sg.context.playAnimation(sg.context.active ? 'idle_active' : 'idle_inactive'),
  }),
  State<NightmareRockStateInst, NightmareRockStateName>({
    name: 'raise',
    tags: ['idle', 'busy'],
    onenter: sg => {
      const inst = sg.context;
      inst.OnActiveStateChanged();
      inst.playAnimation('raise');
      inst.playSound('dontstarve/sanity/shadowrock_up');
      inst.spawnFx('sanity_raise');
    },
    events: [EventHandler('animover', sg => {
      if (concealedOrQueued(sg.context)) sg.goToState('conceal', true);
      else sg.goToState('idle');
    })],
  }),
  State<NightmareRockStateInst, NightmareRockStateName>({
    name: 'lower',
    tags: ['idle', 'busy'],
    onenter: sg => {
      const inst = sg.context;
      inst.OnActiveStateChanged();
      inst.playAnimation('lower');
      inst.playSound('dontstarve/sanity/shadowrock_down');
      inst.spawnFx('sanity_lower');
    },
    events: [EventHandler('animover', sg => sg.goToState(concealedOrQueued(sg.context) ? 'conceal' : 'idle'))],
  }),
  State<NightmareRockStateInst, NightmareRockStateName>({
    name: 'conceal',
    tags: ['hidden', 'busy'],
    onenter: (sg, fromRaise) => {
      const inst = sg.context;
      inst.OnConcealStateChanged();
      if (fromRaise) {
        inst.playAnimation('lower_to_conceal');
        inst.playSound('dontstarve/sanity/shadowrock_down');
        inst.spawnFx('sanity_lower');
      } else {
        inst.playAnimation('conceal');
        inst.playSound('dontstarve/sanity/shadowrock_conseal');
      }
    },
    events: [EventHandler('animover', sg => sg.goToState(sg.context.conceal_queued ? 'concealed' : 'reveal'))],
  }),
  State<NightmareRockStateInst, NightmareRockStateName>({
    name: 'concealed',
    tags: ['hidden', 'idle'],
    onenter: sg => sg.context.Hide(),
    onexit: sg => sg.context.Show(),
  }),
  State<NightmareRockStateInst, NightmareRockStateName>({
    name: 'reveal',
    tags: ['busy'],
    onenter: sg => {
      sg.context.OnConcealStateChanged();
      sg.context.playAnimation('reveal');
      sg.context.playSound('dontstarve/sanity/shadowrock_reveal');
    },
    events: [EventHandler('animover', sg => sg.goToState(sg.context.conceal_queued ? 'conceal' : 'idle'))],
  }),
];

/** stategraphs/SGnightmarerock.lua, initial state `idle`. */
export class NightmareRockStateGraph {
  readonly sg: Graph;

  constructor(inst: NightmareRockStateInst, scheduler?: GameTimeScheduler) {
    this.sg = new StateGraphInstance(inst, states, [], scheduler);
    this.sg.goToState('idle');
  }

  get stateName(): NightmareRockStateName { return this.sg.stateName; }
  hasStateTag(tag: string): boolean { return this.sg.hasStateTag(tag); }
  goToState(name: NightmareRockStateName, data?: unknown): void { this.sg.goToState(name, data); }
  pushEvent(name: string, data?: unknown): void { this.sg.pushEvent(name, data); }
  update(dt: number): void { this.sg.update(dt); }
  dispose(): void { this.sg.dispose(); }
}
