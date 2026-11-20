import { ActionHandler, EventHandler, FRAMES, StateGraphInstance, TimeEvent, type StateDefinition } from './stategraph';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { LocoMotor } from '../../componets/src/locomotor';
import type { SoundEmitter } from '../../prefab/src/soundEmitter';

export type LightFlierState = 'idle' | 'action' | 'startled' | 'go_home' | 'walk_start' | 'walk' | 'walk_stop' |
  'hit' | 'death' | 'sleep' | 'sleeping' | 'wake' | 'frozen' | 'thaw' | 'electrocute';
export interface LightFlierStateInst {
  readonly locomotor: LocoMotor;
  playAnimation(name: string, loop?: boolean): void;
  pushAnimation(name: string, loop?: boolean): void;
  stopPhysics(): void;
  performBufferedAction(): boolean;
  clearBufferedAction(): void;
  validHomeAction(): boolean;
  isDead(): boolean;
  isSleeping(): boolean;
  wakeUp(): void;
  enableBuzz(enabled: boolean): void;
  land(landed: boolean): void;
  readonly SoundEmitter: Pick<SoundEmitter, 'PlaySound' | 'KillSound'>;
  /** AnimState:OverrideSymbol("swap_frozen", "frozen", "frozen") / ClearOverrideSymbol("swap_frozen"). */
  overrideFrozen(frozen: boolean): void;
  /** inst.components.freezable: IsFrozen / IsThawing, undefined without the component. */
  readonly freezable?: { IsFrozen(): boolean; IsThawing(): boolean };
  dropDeathLoot(): void;
}
/** SGlightflier.lua Land / Liftoff: the buzz and LandFlyingCreature / RaiseFlyingCreature. */
function Land(inst: LightFlierStateInst): void { inst.enableBuzz(false); inst.land(true); }
function Liftoff(inst: LightFlierStateInst): void { inst.enableBuzz(true); inst.land(false); }
type SG = StateGraphInstance<LightFlierStateInst, LightFlierState>;
/** commonstates.lua onunfreeze: the hit state, which SGlightflier has. */
function onunfreeze(sg: SG): void { sg.goToState('hit'); }
function onthaw(sg: SG): void {
  sg.statemem.thawing = true;
  sg.goToState('thaw');
}
const over = (next: LightFlierState, queue = false) => [EventHandler<LightFlierStateInst, LightFlierState>(queue ? 'animqueueover' : 'animover', sg => sg.goToState(next))];
const states: StateDefinition<LightFlierStateInst, LightFlierState>[] = [
  { name: 'idle', tags: ['idle', 'canrotate'], onenter: sg => { sg.context.stopPhysics(); sg.context.playAnimation('walk_loop', true); } },
  { name: 'action', onenter: sg => { sg.context.stopPhysics(); sg.context.playAnimation('idle_loop', true); sg.context.performBufferedAction(); }, events: over('idle') },
  { name: 'startled', tags: ['busy'], onenter: sg => { sg.context.stopPhysics(); sg.context.playAnimation('hit'); }, events: over('idle') },
  { name: 'go_home', tags: ['busy'], onenter: sg => { sg.context.stopPhysics(); sg.context.playAnimation('sleep_pre'); },
    timeline: [TimeEvent(20 * FRAMES, sg => {
      if (sg.context.validHomeAction()) { sg.context.performBufferedAction(); }
      else { sg.context.clearBufferedAction(); sg.goToState('idle'); }
    })] },
  { name: 'walk_start', tags: ['moving', 'canrotate'], onenter: sg => { sg.context.locomotor.WalkForward(); sg.context.playAnimation('walk_pre'); }, events: over('walk') },
  { name: 'walk', tags: ['moving', 'canrotate'], onenter: sg => { sg.context.locomotor.WalkForward(); sg.context.playAnimation('walk_loop', true); } },
  { name: 'walk_stop', tags: ['canrotate'], onenter: sg => { sg.context.locomotor.StopMoving(); sg.context.pushAnimation('walk_pst'); }, events: over('idle', true) },
  { name: 'hit', tags: ['hit', 'busy'], onenter: sg => { sg.context.locomotor.StopMoving(); sg.context.playAnimation('hit_2'); },
    timeline: [TimeEvent(FRAMES, sg => sg.context.SoundEmitter.PlaySound('grotto/creatures/light_bug/hit'))], events: over('idle') },
  { name: 'death', tags: ['busy'], onenter: sg => { sg.context.locomotor.StopMoving(); sg.context.clearBufferedAction(); sg.context.playAnimation('death'); sg.context.dropDeathLoot(); },
    timeline: [TimeEvent(FRAMES, sg => {
      sg.context.SoundEmitter.KillSound('loop');
      sg.context.SoundEmitter.PlaySound('grotto/creatures/light_bug/death');
    })] },
  { name: 'sleep', tags: ['busy', 'sleeping', 'nowake'], onenter: sg => { sg.context.locomotor.StopMoving(); sg.context.playAnimation('sleep_pre'); },
    events: [EventHandler('animover', sg => sg.goToState(sg.context.isSleeping() ? 'sleeping' : 'wake'))] },
  { name: 'sleeping', tags: ['busy', 'sleeping'], onenter: sg => { sg.context.playAnimation('sleep_loop'); sg.context.enableBuzz(false); sg.context.land(true); },
    events: [EventHandler('animover', sg => sg.goToState(sg.context.isSleeping() ? 'sleeping' : 'wake'))],
    onexit: sg => { sg.context.enableBuzz(true); sg.context.land(false); } },
  { name: 'wake', tags: ['busy', 'waking', 'nosleep'], onenter: sg => { sg.context.stopPhysics(); sg.context.playAnimation('sleep_pst'); sg.context.wakeUp(); }, events: over('idle') },
  // commonstates.lua AddFrozenStates(states, Land, Liftoff).
  { name: 'frozen', tags: ['busy', 'frozen'],
    onenter: sg => {
      // onenterfrozenpre
      sg.context.locomotor.StopMoving();
      sg.context.playAnimation('frozen', true);
      sg.context.SoundEmitter.PlaySound('dontstarve/common/freezecreature');
      sg.context.overrideFrozen(true);
      Land(sg.context);
      // onenterfrozenpst: freezable and the stategraph must match.
      const freezable = sg.context.freezable;
      if (!freezable) { onunfreeze(sg); }
      else if (freezable.IsThawing()) { onthaw(sg); }
      else if (!freezable.IsFrozen()) { onunfreeze(sg); }
    },
    events: [EventHandler('unfreeze', onunfreeze), EventHandler('onthaw', onthaw)],
    onexit: sg => {
      if (!sg.statemem.thawing) { sg.context.overrideFrozen(false); }
      Liftoff(sg.context);
    } },
  { name: 'thaw', tags: ['busy', 'thawing'],
    onenter: sg => {
      sg.context.locomotor.StopMoving();
      sg.context.playAnimation('frozen_loop_pst', true);
      sg.context.SoundEmitter.PlaySound('dontstarve/common/freezethaw', 'thawing');
      sg.context.overrideFrozen(true);
      Land(sg.context);
      if (!sg.context.freezable?.IsFrozen()) { onunfreeze(sg); }
    },
    events: [EventHandler('unfreeze', onunfreeze)],
    onexit: sg => {
      sg.context.SoundEmitter.KillSound('thawing');
      sg.context.overrideFrozen(false);
      Liftoff(sg.context);
    } },
  { name: 'electrocute', tags: ['busy', 'electrocute'], onenter: sg => { sg.context.locomotor.StopMoving(); sg.context.playAnimation('shock'); }, events: over('idle') },
];

/** SGlightflier.lua, including the source 20-frame GOHOME validation/commit. */
export class LightFlierStateGraph {
  readonly sg: StateGraphInstance<LightFlierStateInst, LightFlierState>;
  constructor(inst: LightFlierStateInst, scheduler: GameTimeScheduler) {
    this.sg = new StateGraphInstance(inst, states, [ActionHandler('GOHOME', 'go_home')], scheduler);
    this.sg.listenForEvent('locomote', () => {
      if (this.hasStateTag('busy')) { return; }
      const moving = inst.locomotor.WantsToMoveForward();
      if (moving && !this.hasStateTag('moving')) { this.goToState('walk_start'); }
      else if (!moving && this.hasStateTag('moving')) { this.goToState('walk_stop'); }
    });
    this.sg.listenForEvent('startled', () => { if (!this.hasStateTag('electrocute') && !inst.isDead()) { this.goToState('startled'); } });
    this.sg.listenForEvent('attacked', () => { if (!inst.isDead() && !this.hasStateTag('frozen')) { this.goToState('hit'); } });
    this.sg.listenForEvent('death', () => this.goToState('death'));
    this.sg.listenForEvent('gotosleep', () => { if (!inst.isDead() && !this.hasStateTag('nosleep')) { this.goToState('sleep'); } });
    this.sg.listenForEvent('onwakeup', () => { if (this.hasStateTag('sleeping') && !this.hasStateTag('nowake')) { this.goToState('wake'); } });
    // CommonHandlers.OnFreeze(); onthaw and unfreeze are the frozen states' own events.
    this.sg.listenForEvent('freeze', () => { if (!inst.isDead()) { this.goToState('frozen'); } });
    this.sg.listenForEvent('electrocute', () => { if (!inst.isDead()) { this.goToState('electrocute'); } });
    this.goToState('idle');
  }
  get stateName(): LightFlierState { return this.sg.stateName; }
  hasStateTag(tag: string): boolean { return this.sg.hasStateTag(tag); }
  goToState(state: LightFlierState): void { this.sg.goToState(state); }
  pushEvent(name: string, data?: unknown): void { this.sg.pushEvent(name, data); }
  startAction(action: import('./bufferedaction').BufferedAction): boolean { return this.sg.startAction(action); }
  update(dt: number): void { this.sg.update(dt); }
  dispose(): void { this.sg.dispose(); }
}
