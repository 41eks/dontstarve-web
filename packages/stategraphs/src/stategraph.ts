import type { BufferedAction } from './bufferedaction.ts';
import { ComponentTimer } from '../../componets/src/timer.ts';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

/** DST constants.lua: one source animation frame is 1/30 second. */
export const FRAMES = 1 / 30;

export interface TimelineEvent<Context, Name extends string> {
  time: number;
  fn: (inst: StateGraphInstance<Context, Name>) => void;
}

export interface StateEvent<Context, Name extends string> {
  name: string;
  fn: (inst: StateGraphInstance<Context, Name>, data: unknown) => void;
}

export interface StateDefinition<Context, Name extends string> {
  name: Name;
  tags?: readonly string[];
  onenter?: (inst: StateGraphInstance<Context, Name>, data: unknown) => void;
  onupdate?: (inst: StateGraphInstance<Context, Name>, dt: number) => void;
  timeline?: readonly TimelineEvent<Context, Name>[];
  ontimeout?: (inst: StateGraphInstance<Context, Name>) => void;
  events?: readonly StateEvent<Context, Name>[];
  onexit?: (inst: StateGraphInstance<Context, Name>, nextState: Name) => void;
}

export function State<Context, Name extends string>(definition: StateDefinition<Context, Name>) {
  return definition;
}

export function TimeEvent<Context, Name extends string>(
  time: number, fn: TimelineEvent<Context, Name>['fn'],
): TimelineEvent<Context, Name> {
  if (!Number.isFinite(time) || time < 0) throw new Error('Invalid timeline time');
  return { time, fn };
}

export function EventHandler<Context, Name extends string>(
  name: string, fn: StateEvent<Context, Name>['fn'],
): StateEvent<Context, Name> {
  return { name, fn };
}

export interface StateActionHandler<Context, Name extends string> {
  action: string;
  deststate: (inst: StateGraphInstance<Context, Name>, action: BufferedAction) => Name | null | undefined;
  condition?: (inst: StateGraphInstance<Context, Name>) => boolean;
}

/** scripts/stategraph.lua: string destinations are constant destination functions. */
export function ActionHandler<Context, Name extends string>(
  action: string, state: Name | StateActionHandler<Context, Name>['deststate'],
  condition?: StateActionHandler<Context, Name>['condition'],
): StateActionHandler<Context, Name> {
  return { action, deststate: typeof state === 'string' ? () => state : state, condition };
}

/** State-local timelines and tags, mirroring scripts/stategraph.lua. */
export class StateGraphInstance<Context, Name extends string> {
  private readonly states = new Map<Name, StateDefinition<Context, Name>>();
  private readonly actionHandlers = new Map<string, StateActionHandler<Context, Name>>();
  private readonly listeners = new Map<string, Set<(data: unknown) => void>>();
  private current!: StateDefinition<Context, Name>;
  private tags = new Set<string>();
  private timelineIndex = 0;
  private timeout: number | null = null;
  private revision = 0;
  private clock = 0;
  private readonly scheduled = new Set<{ time: number; fn: () => void }>();
  private readonly scheduler?: GameTimeScheduler;
  private readonly timeoutTimer?: ComponentTimer;
  private readonly timelineTimer?: ComponentTimer;
  private enteredAt = 0;
  private disposed = false;
  private readonly cancelScheduled = new Set<() => void>();
  statemem: Record<string, unknown> = {};
  timeInState = 0;
  readonly context: Context;

  constructor(
    context: Context, states: readonly StateDefinition<Context, Name>[],
    actionHandlers: readonly StateActionHandler<Context, Name>[] = [],
    scheduler?: GameTimeScheduler,
  ) {
    this.context = context;
    this.scheduler = scheduler;
    if (scheduler) {
      this.timeoutTimer = new ComponentTimer(scheduler, () => {
        this.syncSchedulerTime();
        this.current.ontimeout?.(this);
      });
      this.timelineTimer = new ComponentTimer(scheduler, () => {
        this.syncSchedulerTime();
        const revision = this.revision;
        this.current.timeline?.[this.timelineIndex++]?.fn(this);
        if (revision === this.revision) this.armTimeline();
      });
    }
    for (const state of states) {
      if (this.states.has(state.name)) throw new Error(`Duplicate state ${state.name}`);
      this.states.set(state.name, {
        ...state, timeline: [...state.timeline ?? []].sort((a, b) => a.time - b.time),
      });
    }
    for (const handler of actionHandlers) {
      if (this.actionHandlers.has(handler.action)) throw new Error(`Duplicate action handler ${handler.action}`);
      this.actionHandlers.set(handler.action, handler);
    }
  }

  get stateName(): Name { return this.current.name; }
  get elapsedTime(): number { return this.clock; }
  get stateRevision(): number { return this.revision; }
  /** Scheduler-backed graphs publish only setup, cancellation and expiry, never per-frame countdowns. */
  get timeoutSnapshot() { return this.timeoutTimer?.snapshot; }
  get timelineSnapshot() { return this.timelineTimer?.snapshot; }
  hasStateTag(tag: string): boolean { return this.tags.has(tag); }
  addStateTag(tag: string): void { this.tags.add(tag); }
  removeStateTag(tag: string): void { this.tags.delete(tag); }
  hasAnyStateTag(...tags: readonly string[]): boolean { return tags.some(tag => this.hasStateTag(tag)); }

  getActionState(action: BufferedAction): Name | null {
    const handler = this.actionHandlers.get(action.action);
    if (!handler || (handler.condition && !handler.condition(this))) return null;
    const destination = handler.deststate(this, action);
    return destination != null && this.states.has(destination) ? destination : null;
  }

  startAction(action: BufferedAction): boolean {
    const destination = this.getActionState(action);
    if (destination === null) return false;
    this.goToState(destination);
    return true;
  }

  goToState(name: Name, data?: unknown): void {
    if (this.disposed) return;
    const state = this.states.get(name);
    if (!state) throw new Error(`Unknown state ${name}`);
    this.current?.onexit?.(this, name);
    this.timeoutTimer?.stop();
    this.timelineTimer?.stop();
    this.statemem = {};
    this.current = state;
    this.revision++;
    this.timeInState = 0;
    this.enteredAt = this.scheduler?.now ?? this.clock;
    this.timelineIndex = 0;
    this.timeout = null;
    this.tags = new Set(state.tags);
    const revision = this.revision;
    state.onenter?.(this, data);
    if (revision !== this.revision) return;
    this.armTimeline();
    this.notify('newstate', { name });
  }

  private armTimeline(): void {
    const event = this.current.timeline?.[this.timelineIndex];
    if (event && this.scheduler) this.timelineTimer!.start(Math.max(0, this.enteredAt + event.time - this.scheduler.now));
  }

  private syncSchedulerTime(): void {
    this.clock = this.scheduler!.now;
    this.timeInState = this.clock - this.enteredAt;
  }

  setTimeout(duration: number): void {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid state timeout');
    if (this.timeoutTimer) this.timeoutTimer.start(duration);
    else this.timeout = this.timeInState + duration;
  }

  /** Engine timers (e.g. animation completion) survive state transitions.
   * They are independent of the state's SetTimeout/ontimeout lifecycle.
   */
  schedule(duration: number, fn: () => void): () => void {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid scheduled duration');
    if (this.scheduler) {
      const cancelTask = this.scheduler.schedule(duration, () => {
        this.cancelScheduled.delete(cancel);
        fn();
      });
      const cancel = () => { cancelTask(); this.cancelScheduled.delete(cancel); };
      this.cancelScheduled.add(cancel);
      return cancel;
    }
    const task = { time: this.clock + duration, fn };
    this.scheduled.add(task);
    return () => { this.scheduled.delete(task); };
  }

  listenForEvent(name: string, fn: (data: unknown) => void): () => void {
    let listeners = this.listeners.get(name);
    if (!listeners) this.listeners.set(name, listeners = new Set());
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
      if (!listeners.size) this.listeners.delete(name);
    };
  }

  private notify(name: string, data?: unknown): void {
    for (const listener of [...this.listeners.get(name) ?? []]) listener(data);
  }

  pushEvent(name: string, data?: unknown): void {
    if (this.disposed) return;
    const revision = this.revision;
    this.notify(name, data);
    // A listener can interrupt the state; its old handler must not run afterward.
    if (revision !== this.revision) return;
    this.current.events?.find((event) => event.name === name)?.fn(this, data);
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid stategraph timestep');
    if (this.disposed) return;
    if (this.scheduler) {
      this.syncSchedulerTime();
      this.current.onupdate?.(this, dt);
      return;
    }
    let remaining = dt;
    let updateDt = 0;
    // Consume overshoot in a new state, retaining independent engine timers.
    for (let count = 0; count < 10000; count++) {
      const revision = this.revision;
      const event = this.current.timeline?.[this.timelineIndex];
      let scheduled: { time: number; fn: () => void } | undefined;
      for (const task of this.scheduled) {
        if (!scheduled || task.time < scheduled.time) scheduled = task;
      }
      const taskTime = scheduled ? this.timeInState + scheduled.time - this.clock : Infinity;
      const deadline = Math.min(event?.time ?? Infinity, this.timeout ?? Infinity, taskTime);
      const distance = Math.max(0, deadline - this.timeInState);
      if (distance > remaining + 1e-8) {
        this.timeInState += remaining;
        this.clock += remaining;
        this.current.onupdate?.(this, updateDt + remaining);
        return;
      }
      this.timeInState += distance;
      this.clock += distance;
      updateDt += distance;
      remaining = Math.max(0, remaining - distance);
      // Lua UpdateState handles a due timeout before timeline callbacks.
      if (this.timeout !== null && this.timeout === deadline) {
        this.timeout = null;
        this.current.ontimeout?.(this);
      } else if (event && event.time === deadline) {
        this.timelineIndex++;
        event.fn(this);
      } else if (scheduled) {
        this.scheduled.delete(scheduled);
        scheduled.fn();
      }
      if (revision !== this.revision) updateDt = 0;
    }
    throw new Error('Stategraph did not advance time');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.timeoutTimer?.stop();
    this.timelineTimer?.stop();
    for (const cancel of this.cancelScheduled) cancel();
    this.scheduled.clear();
    this.listeners.clear();
  }
}
