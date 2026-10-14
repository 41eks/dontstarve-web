import { ActionHandler, EventHandler, FRAMES, StateGraphInstance, TimeEvent, type StateDefinition } from './stategraph';
import type { BufferedAction } from './bufferedaction';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { LocoMotor } from '../../componets/src/locomotor';

export type MoleState = 'idle' | 'enter' | 'peek' | 'exit' | 'steal_pre_under' | 'steal_pre_above' | 'steal' |
  'walk_pre' | 'walk' | 'walk_pst' | 'gohome' | 'make_molehill' | 'stunned' | 'stunned_pst' | 'death' | 'hit' | 'sleep' | 'sleeping' | 'wake';
export interface MoleStateInst {
  readonly locomotor: LocoMotor;
  readonly isunder: boolean;
  last_above_time: number;
  peek_interval: number;
  getTime(): number;
  random(): number;
  setUnder(): void;
  setAbove(): void;
  stopPhysics(): void;
  playAnimation(name: string, loop?: boolean): void;
  pushAnimation(name: string, loop?: boolean): void;
  performBufferedAction(): boolean;
  clearBufferedAction(): void;
  playSound(name: string, key?: string): void;
  killSound(key: string): void;
  dropInventory(): void;
  dropDeathLoot(): void;
  setPickup(enabled: boolean): void;
  startStunnedSounds(skippre: boolean): void;
  stopStunnedSounds(): void;
  spawnMoveFx(): void;
  onAttacked(data: unknown): void;
  isDead(): boolean;
  remove(): void;
}
type SG = StateGraphInstance<MoleStateInst, MoleState>;
const sound = (frame: number, name: string, key?: string) => TimeEvent<MoleStateInst, MoleState>(frame * FRAMES, sg => sg.context.playSound(name, key));
const kill = (frame: number, key: string) => TimeEvent<MoleStateInst, MoleState>(frame * FRAMES, sg => sg.context.killSound(key));
const over = (next: MoleState, queue = false) => [EventHandler<MoleStateInst, MoleState>(queue ? 'animqueueover' : 'animover', sg => sg.goToState(next))];
const above = (sg: SG, clip: string, loop = false) => {
  const inst = sg.context; inst.stopPhysics(); inst.setAbove(); inst.killSound('move'); inst.playAnimation(clip, loop);
};
const states: StateDefinition<MoleStateInst, MoleState>[] = [
  { name: 'idle', tags: ['idle', 'canrotate'], onenter: sg => {
    const inst = sg.context; inst.stopPhysics(); inst.killSound('move');
    if (inst.isunder) { sg.addStateTag('noattack'); sg.addStateTag('noelectrocute'); }
    inst.playAnimation(inst.isunder ? 'idle_under' : 'idle', true);
  }, timeline: [TimeEvent(FRAMES, sg => { if (!sg.context.isunder) sg.context.playSound('sniff', 'sniff'); }), kill(52, 'sniff')] },
  { name: 'enter', tags: ['busy'], onenter: sg => above(sg, 'enter'), events: over('idle') },
  { name: 'peek', tags: ['busy'], onenter: sg => {
    above(sg, 'enter'); const inst = sg.context;
    inst.peek_interval = 15 + inst.random() * 10; inst.last_above_time = inst.getTime(); inst.performBufferedAction();
  }, timeline: [sound(1, 'emerge'), sound(3, 'emerge_voice')], events: over('exit') },
  { name: 'steal_pre_under', tags: ['busy'], onenter: sg => { above(sg, 'enter'); sg.context.pushAnimation('idle'); },
    timeline: [sound(1, 'emerge'), sound(3, 'emerge_voice'), sound(26, 'sniff', 'sniff'), kill(77, 'sniff')],
    events: over('steal', true), onexit: sg => sg.context.killSound('sniff') },
  { name: 'steal_pre_above', tags: ['busy'], onenter: sg => above(sg, 'idle'),
    timeline: [sound(1, 'sniff', 'sniff'), kill(52, 'sniff')], events: over('steal', true), onexit: sg => sg.context.killSound('sniff') },
  { name: 'steal', tags: ['busy', 'canrotate'], onenter: sg => { above(sg, 'action'); sg.context.pushAnimation('idle'); },
    timeline: [sound(9, 'pickup'), TimeEvent(12 * FRAMES, sg => sg.context.performBufferedAction()), sound(27, 'sniff', 'sniff'), kill(78, 'sniff')],
    events: over('exit', true), onexit: sg => sg.context.killSound('sniff') },
  { name: 'exit', tags: ['busy'], onenter: sg => above(sg, 'exit'),
    timeline: [sound(8, 'jump'), sound(26, 'retract'), sound(43, 'retract')],
    events: [EventHandler('animover', sg => { sg.context.setUnder(); sg.context.last_above_time = sg.context.getTime(); sg.goToState('idle'); })] },
  { name: 'walk_pre', tags: ['moving', 'canrotate', 'noattack', 'noelectrocute'], onenter: sg => {
    const inst = sg.context; inst.setUnder(); inst.playAnimation('walk_pre'); inst.playSound('move', 'move'); inst.locomotor.WalkForward();
  }, events: over('walk') },
  { name: 'walk', tags: ['moving', 'canrotate', 'noattack', 'noelectrocute'], onenter: sg => {
    sg.context.setUnder(); sg.context.playAnimation('walk_loop'); sg.context.locomotor.WalkForward();
  }, timeline: [0, 5, 10, 15, 20, 25].map(frame => TimeEvent(frame * FRAMES, sg => sg.context.spawnMoveFx())), events: over('walk') },
  { name: 'walk_pst', tags: ['canrotate', 'noattack', 'noelectrocute'], onenter: sg => {
    const inst = sg.context; inst.setUnder(); inst.locomotor.StopMoving(); inst.playAnimation('walk_pst'); inst.killSound('move');
  }, events: over('idle') },
  { name: 'gohome', tags: ['canrotate'], onenter: sg => {
    const inst = sg.context; inst.stopPhysics(); if (inst.isunder) { sg.addStateTag('noattack'); sg.addStateTag('noelectrocute'); }
    inst.playAnimation(inst.isunder ? 'idle_under' : 'idle'); inst.performBufferedAction();
  }, events: over('idle') },
  { name: 'make_molehill', tags: ['busy', 'noattack', 'noelectrocute'], onenter: sg => {
    const inst = sg.context; inst.stopPhysics(); inst.setUnder(); inst.playAnimation('mound');
  }, timeline: [TimeEvent(16 * FRAMES, sg => {
    sg.context.setAbove(); sg.removeStateTag('noattack'); sg.removeStateTag('noelectrocute'); sg.context.playSound('emerge');
  }), sound(30, 'emerge_voice')], events: [EventHandler('animover', sg => {
    sg.context.performBufferedAction(); sg.context.setUnder(); sg.context.last_above_time = sg.context.getTime(); sg.goToState('idle');
  })] },
  { name: 'stunned', tags: ['busy', 'noattack', 'canelectrocute', 'canwxscan'], onenter: (sg, skippre) => {
    const inst = sg.context; inst.clearBufferedAction(); inst.killSound('move'); inst.killSound('sniff'); inst.dropInventory();
    above(sg, skippre ? 'stunned_loop' : 'stunned_pre', !!skippre);
    if (!skippre) { inst.playSound('hurt'); inst.pushAnimation('stunned_loop', true); }
    inst.startStunnedSounds(!!skippre); sg.setTimeout(4 + inst.random() * 4); inst.last_above_time = inst.getTime(); inst.setPickup(true);
  }, ontimeout: sg => sg.goToState('stunned_pst'), onexit: sg => { sg.context.setPickup(false); sg.context.stopStunnedSounds(); } },
  { name: 'stunned_pst', tags: ['busy'], onenter: sg => {
    sg.context.setAbove(); sg.context.pushAnimation('stunned_pst'); sg.context.playSound('jump');
  }, timeline: [sound(15, 'retract')], events: over('idle', true) },
  { name: 'hit', tags: ['busy'], onenter: sg => { sg.context.killSound('sniff'); above(sg, 'hit'); }, events: over('idle') },
  { name: 'death', tags: ['busy'], onenter: sg => {
    sg.context.clearBufferedAction(); sg.context.killSound('sniff'); above(sg, 'death'); sg.context.playSound('death');
    sg.context.dropDeathLoot(); sg.context.dropInventory();
  }, events: [EventHandler('animover', sg => sg.context.remove())] },
  { name: 'sleep', tags: ['busy', 'sleeping'], onenter: sg => {
    const inst = sg.context; inst.locomotor.StopMoving();
    if (inst.isunder) { above(sg, 'enter'); inst.playSound('emerge'); inst.pushAnimation('sleep_pre'); }
    else inst.playAnimation('sleep_pre');
  }, timeline: [kill(1, 'sniff'), kill(1, 'stunned')], events: [...over('sleeping', true), EventHandler('onwakeup', sg => sg.goToState('wake'))] },
  { name: 'sleeping', tags: ['busy', 'sleeping'], onenter: sg => { sg.context.setAbove(); sg.context.playAnimation('sleep_loop'); },
    timeline: [sound(27, 'sleep', 'sleep'), kill(42, 'sleep')], events: [...over('sleeping'), EventHandler('onwakeup', sg => sg.goToState('wake'))] },
  { name: 'wake', tags: ['busy', 'waking'], onenter: sg => { sg.context.setAbove(); sg.context.locomotor.StopMoving(); sg.context.playAnimation('sleep_pst'); },
    timeline: [kill(1, 'sleep')], events: over('idle') },
];
/** SGmole.lua; state timers and timelines run on active game time. */
export class MoleStateGraph {
  readonly sg: SG;
  constructor(inst: MoleStateInst, scheduler: GameTimeScheduler) {
    this.sg = new StateGraphInstance(inst, states, [ActionHandler('GOHOME', 'gohome'),
      ActionHandler('STEALMOLEBAIT', () => inst.isunder ? 'steal_pre_under' : 'steal_pre_above'),
      ActionHandler('MAKEMOLEHILL', 'make_molehill'), ActionHandler('MOLEPEEK', 'peek')], scheduler);
    this.sg.listenForEvent('locomote', () => {
      if (!this.hasStateTag('idle') && !this.hasStateTag('moving')) return;
      const moving = inst.locomotor.WantsToMoveForward();
      if (moving !== this.hasStateTag('moving')) this.goToState(moving ? inst.isunder ? 'walk_pre' : 'exit' : this.hasStateTag('moving') ? 'walk_pst' : 'idle');
    });
    this.sg.listenForEvent('attacked', data => inst.onAttacked(data));
    this.sg.listenForEvent('death', () => this.goToState('death'));
    this.sg.listenForEvent('stunbomb', () => this.sg.goToState('stunned', true));
    this.sg.listenForEvent('gotosleep', () => { if (!inst.isDead()) this.goToState('sleep'); });
    this.sg.goToState('idle');
  }
  get stateName(): MoleState { return this.sg.stateName; }
  hasStateTag(tag: string): boolean { return this.sg.hasStateTag(tag); }
  goToState(state: MoleState, data?: unknown): void { this.sg.goToState(state, data); }
  startAction(action: BufferedAction): boolean { return this.sg.startAction(action); }
  pushEvent(name: string, data?: unknown): void { this.sg.pushEvent(name, data); }
  update(dt: number): void { this.sg.update(dt); }
  pause(): void { this.sg.pause(); }
  resume(): void { this.sg.resume(); }
  dispose(): void { this.sg.dispose(); }
}
