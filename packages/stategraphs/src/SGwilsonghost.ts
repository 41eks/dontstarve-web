import { ActionHandler as DefineActionHandler, EventHandler, FRAMES, State as DefineState, TimeEvent } from './stategraph.ts';
import type { StateActionHandler } from './stategraph.ts';
import type { StateDefinition } from './stategraph.ts';
import type { WilsonAnimationClip, WilsonStateGraph, WilsonStateMem, WilsonStateName } from './SGwilson.ts';

const State = DefineState<WilsonStateGraph, WilsonStateName>;
/** ghost.zip's clips are selected by name from the `ghost` bank. */
const ghostClip = (name: string, loop = false): WilsonAnimationClip => ({ key: 'ghost', name, ...loop ? { loop } : {} });
const GHOST_HOWL = 'dontstarve/ghost/ghost_howl';
type GhostInstance = Parameters<NonNullable<StateDefinition<WilsonStateGraph, WilsonStateName, WilsonStateMem>['onenter']>>[0];

/** SGwilsonghost idle/run: `if not inst.AnimState:IsCurrentAnimation("idle") then PlayAnimation("idle", true)`. */
function playGhostIdle(inst: GhostInstance): void {
  const current = inst.context.currentClip;
  if (current?.key !== 'ghost' || current.name !== 'idle') inst.context.playClips([ghostClip('idle', true)]);
}
const GHOST_HAUNT = 'dontstarve/ghost/ghost_haunt';

/** SGwilsonghost.lua actionhandlers: only HAUNT is ported (jumpin, remoteresurrect, migrate and climb need their actions). */
export const ghostActionHandlers: StateActionHandler<WilsonStateGraph, WilsonStateName, import('./bufferedaction.ts').BufferedAction, WilsonStateMem>[] = [
  DefineActionHandler<WilsonStateGraph, WilsonStateName>('HAUNT', 'haunt_pre'),
];

/**
 * SGwilsonghost.lua: the ghost's idle, run, appear, haunt_pre, haunt and hit states. The dissipate, talk, remoteresurrect,
 * migrate and rewindtime states and every action but HAUNT are not ported, so every other buffered action is refused. `walk` is the browser's slower movement request and plays the same idle loop.
 */
export const ghostStates: StateDefinition<WilsonStateGraph, WilsonStateName, WilsonStateMem>[] = [
  State({
    name: 'idle',
    tags: ['idle', 'canrotate'],
    onenter: inst => {
      inst.context.entity.locomotor?.stop();
      inst.context.clearBufferedAction();
      playGhostIdle(inst);
      // The movement the browser requested during the state before it resumes, as the living idle does.
      const movement = inst.context.requestedMovement;
      if (movement === 'walk' || movement === 'run') inst.goToState(movement);
    },
  }),
  ...(['walk', 'run'] as const).map(name => State({
    name,
    tags: ['moving', 'running', 'canrotate', 'autopredict'],
    // `if not inst.AnimState:IsCurrentAnimation("idle") then PlayAnimation("idle", true)`
    onenter: inst => playGhostIdle(inst),
  })),
  State({
    // A freshly dead player appears with a howl; a ghost loaded from a save (`loading_ghost`) goes straight to idle.
    name: 'appear',
    tags: ['nopredict'],
    onenter: inst => {
      if (inst.context.loadingGhost) { inst.goToState('idle'); return; }
      inst.context.playClips([ghostClip('appear')]);
      inst.context.entity.SoundEmitter.PlaySound(GHOST_HOWL);
    },
    events: [
      EventHandler('animover', inst => { if (inst.context.animationDone) inst.goToState('idle'); }),
    ],
  }),
  State({
    name: 'haunt_pre',
    tags: ['doing', 'busy'],
    onenter: inst => {
      inst.context.entity.locomotor?.stop();
      inst.context.playClips([ghostClip('dissipate')]);
      inst.context.entity.SoundEmitter.PlaySound(GHOST_HAUNT);
    },
    timeline: [TimeEvent(15 * FRAMES, inst => { inst.context.performBufferedAction(); })],
    events: [
      EventHandler('animover', inst => { if (inst.context.animationDone) inst.goToState('haunt'); }),
    ],
  }),
  State({
    name: 'haunt',
    tags: ['doing', 'busy', 'nopredict'],
    onenter: inst => {
      inst.context.entity.locomotor?.stop();
      inst.context.playClips([ghostClip('appear')]);
    },
    events: [
      // Hidden if resurrecting.
      EventHandler('animover', inst => { if (inst.context.animationDone && inst.context.entity.IsVisible()) inst.goToState('idle'); }),
    ],
  }),
  State({
    name: 'hit',
    tags: ['busy', 'pausepredict'],
    onenter: inst => {
      inst.context.entity.SoundEmitter.PlaySound(GHOST_HOWL);
      inst.context.playClips([ghostClip('hit')]);
      inst.context.clearBufferedAction();
      inst.context.entity.locomotor?.stop();
    },
    timeline: [TimeEvent(3 * FRAMES, inst => { inst.removeStateTag('busy'); inst.removeStateTag('pausepredict'); })],
    events: [
      EventHandler('animover', inst => { if (inst.context.animationDone) inst.goToState('idle'); }),
    ],
  }),
];
