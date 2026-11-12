import type { EventData } from '../../componets/src/entityEvents';
import type { BufferedAction } from './bufferedaction.ts';
import { ComponentTimer } from '../../componets/src/timer.ts';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

/** DST constants.lua: one source animation frame is 1/30 second. */
export const FRAMES = 1 / 30;

/**
 * What a graph declares besides its context and state names: the fields its states keep in statemem, the data
 * GoToState(name, data) hands each state that takes some, and the buffered actions its ActionHandlers read.
 */
export interface StateGraphSpec {
  readonly mem: object;
  readonly data: object;
  readonly action: BufferedAction;
}
/** A graph that declares nothing: any statemem field, any state data and any buffered action. */
export interface DefaultStateGraphSpec {
  readonly mem: Record<string, unknown>;
  readonly data: {};
  readonly action: BufferedAction;
}

/** The data state `N` is entered with: what the graph declares for it, else whatever GoToState passes. */
export type StateData<Spec extends StateGraphSpec, N extends string> = N extends keyof Spec['data'] ? Spec['data'][N] : unknown;
/** GoToState's data argument: required for a state the graph declares data for, unless that data may be nil. */
type StateDataArgs<Spec extends StateGraphSpec, N extends string> = N extends keyof Spec['data']
  ? undefined extends Spec['data'][N] ? [data?: Spec['data'][N]] : [data: Spec['data'][N]]
  : [data?: unknown];

export interface TimelineEvent<Context, Name extends string, Spec extends StateGraphSpec = DefaultStateGraphSpec> {
  time: number;
  fn: (inst: StateGraphInstance<Context, Name, Spec>) => void;
}

export interface StateEvent<Context, Name extends string, Spec extends StateGraphSpec = DefaultStateGraphSpec> {
  name: string;
  /** Method-typed, as each handler reads the data its event's pusher sends. */
  fn: { call(inst: StateGraphInstance<Context, Name, Spec>, data: unknown): void }['call'];
}

/**
 * A state named `N`. `onenter` reads the data the graph declares for `N`; it is method-typed so the graph can keep
 * its states in one list, while GoToState checks the data each state is entered with.
 */
export interface StateDefinition<Context, Name extends string, Spec extends StateGraphSpec = DefaultStateGraphSpec,
  N extends Name = Name> {
  name: N;
  tags?: readonly string[];
  onenter?: { call(inst: StateGraphInstance<Context, Name, Spec>, data: StateData<Spec, N>): void }['call'];
  onupdate?: (inst: StateGraphInstance<Context, Name, Spec>, dt: number) => void;
  timeline?: readonly TimelineEvent<Context, Name, Spec>[];
  ontimeout?: (inst: StateGraphInstance<Context, Name, Spec>) => void;
  events?: readonly StateEvent<Context, Name, Spec>[];
  onexit?: (inst: StateGraphInstance<Context, Name, Spec>, nextState: Name) => void;
}

/** State({ name, ... }): with `N` inferred from the name, its onenter reads the data the graph declares for it. */
export function State<Context, Name extends string, Spec extends StateGraphSpec = DefaultStateGraphSpec, N extends Name = Name>(
  definition: StateDefinition<Context, Name, Spec, N>,
): StateDefinition<Context, Name, Spec, N> {
  return definition;
}

export function TimeEvent<Context, Name extends string, Spec extends StateGraphSpec = DefaultStateGraphSpec>(
  time: number, fn: TimelineEvent<Context, Name, Spec>['fn'],
): TimelineEvent<Context, Name, Spec> {
  if (!Number.isFinite(time) || time < 0) throw new Error('Invalid timeline time');
  return { time, fn };
}

/** A listenForEvent listener as the stategraph keeps it; method-typed, as each reads its own event's data. */
type StoredEventListener = { call(data: unknown): void }['call'];

/** EventHandler(name, fn): `data` is what the event's pusher sends (EntityEventData). */
export function EventHandler<Context, Name extends string, E extends string = string,
  Spec extends StateGraphSpec = DefaultStateGraphSpec>(
  name: E, fn: (inst: StateGraphInstance<Context, Name, Spec>, data: EventData<E>) => void,
): StateEvent<Context, Name, Spec> {
  return { name, fn };
}

/** ActionHandler(action, deststate, condition), over the buffered actions the graph declares it is pushed. */
export interface StateActionHandler<Context, Name extends string, Spec extends StateGraphSpec = DefaultStateGraphSpec> {
  action: string;
  deststate: (inst: StateGraphInstance<Context, Name, Spec>, action: Spec['action']) => Name | null | undefined;
  condition?: (inst: StateGraphInstance<Context, Name, Spec>) => boolean;
}

/** scripts/stategraph.lua: string destinations are constant destination functions. */
export function ActionHandler<Context, Name extends string, Spec extends StateGraphSpec = DefaultStateGraphSpec>(
  action: string, state: Name | StateActionHandler<Context, Name, Spec>['deststate'],
  condition?: StateActionHandler<Context, Name, Spec>['condition'],
): StateActionHandler<Context, Name, Spec> {
  return { action, deststate: typeof state === 'string' ? () => state : state, condition };
}

/** A state as the graph keeps it: GoToState has already checked the data its onenter is handed. */
type StoredState<Context, Name extends string, Spec extends StateGraphSpec> = Omit<StateDefinition<Context, Name, Spec>, 'onenter'> & {
  onenter?: { call(inst: StateGraphInstance<Context, Name, Spec>, data: unknown): void }['call'];
};

/** State-local timelines and tags, mirroring scripts/stategraph.lua. */
export class StateGraphInstance<Context, Name extends string, Spec extends StateGraphSpec = DefaultStateGraphSpec> {
  private readonly states = new Map<Name, StoredState<Context, Name, Spec>>();
  private readonly actionHandlers = new Map<string, StateActionHandler<Context, Name, Spec>>();
  /** The stategraph's own EventHandlers (stategraph.lua sg.events), beside the current state's. */
  private readonly listeners = new Map<string, Set<StoredEventListener>>();
  /** What follows GoToState, which stategraph.lua reports as the inst's "newstate" event rather than to a handler. */
  private readonly newStateListeners = new Set<(data: { name: Name }) => void>();
  private current!: StoredState<Context, Name, Spec>;
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
  private pausedAt: number | undefined;
  private readonly cancelScheduled = new Set<() => void>();
  /** stategraph.lua statemem: reset on every GoToState, holding the fields the graph's states declare. */
  statemem: Partial<Spec['mem']> = {};
  timeInState = 0;
  readonly context: Context;

  constructor(
    context: Context, states: readonly StateDefinition<Context, Name, Spec>[],
    actionHandlers: readonly StateActionHandler<Context, Name, Spec>[] = [],
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
  /** stategraph.lua HandleEvents: a state's own handler takes the event instead of the stategraph's. */
  handlesEvent(name: string): boolean { return this.current.events?.some(event => event.name === name) ?? false; }
  /** StateGraphInstance:IsListeningForEvent: the current state or the stategraph has a handler, so inst:PushEvent forwards it. */
  isListeningForEvent(name: string): boolean { return this.handlesEvent(name) || this.listeners.has(name); }
  /** GoToState's inst:PushEvent("newstate"), for what follows the stategraph's states; no EventHandler takes it. */
  onNewState(fn: (data: { name: Name }) => void): () => void {
    this.newStateListeners.add(fn);
    return () => { this.newStateListeners.delete(fn); };
  }
  get elapsedTime(): number { return this.clock; }
  get stateRevision(): number { return this.revision; }
  /** Scheduler-backed graphs publish only setup, cancellation and expiry, never per-frame countdowns. */
  get timeoutSnapshot() { return this.timeoutTimer?.snapshot; }
  get timelineSnapshot() { return this.timelineTimer?.snapshot; }
  hasStateTag(tag: string): boolean { return this.tags.has(tag); }
  /** StateGraphInstance:HasState: the graph defines a state of this name. */
  hasState(name: string): boolean {
    for (const state of this.states.keys()) if (state === name) return true;
    return false;
  }
  addStateTag(tag: string): void { this.tags.add(tag); }
  removeStateTag(tag: string): void { this.tags.delete(tag); }
  hasAnyStateTag(...tags: readonly string[]): boolean { return tags.some(tag => this.hasStateTag(tag)); }

  getActionState(action: Spec['action']): Name | null {
    const handler = this.actionHandlers.get(action.action);
    if (!handler || (handler.condition && !handler.condition(this))) return null;
    const destination = handler.deststate(this, action);
    return destination != null && this.states.has(destination) ? destination : null;
  }

  startAction(action: Spec['action']): boolean {
    const destination = this.getActionState(action);
    if (destination === null) return false;
    // stategraph.lua StartAction: sg:GoToState(state) with no data.
    this.enterState(destination, undefined);
    return true;
  }

  goToState<N extends Name>(name: N, ...[data]: StateDataArgs<Spec, N>): void {
    this.enterState(name, data);
  }

  private enterState(name: Name, data: unknown): void {
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
    // A state entered while the graph is stopped starts its time when the graph resumes.
    this.enteredAt = this.pausedAt ?? this.scheduler?.now ?? this.clock;
    this.timelineIndex = 0;
    this.timeout = null;
    this.tags = new Set(state.tags);
    const revision = this.revision;
    state.onenter?.(this, data);
    if (revision !== this.revision) return;
    this.armTimeline();
    for (const listener of [...this.newStateListeners]) listener({ name });
  }

  private armTimeline(): void {
    const event = this.current.timeline?.[this.timelineIndex];
    if (!event || !this.scheduler) return;
    this.timelineTimer!.start(Math.max(0, this.enteredAt + event.time - (this.pausedAt ?? this.scheduler.now)));
    if (this.pausedAt !== undefined) this.timelineTimer!.pause();
  }

  private syncSchedulerTime(): void {
    this.clock = this.scheduler!.now;
    this.timeInState = this.clock - this.enteredAt;
  }

  setTimeout(duration: number): void {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid state timeout');
    if (this.timeoutTimer) {
      this.timeoutTimer.start(duration);
      if (this.pausedAt !== undefined) this.timeoutTimer.pause();
    } else this.timeout = this.timeInState + duration;
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

  listenForEvent<E extends string>(name: E, fn: (data: EventData<E>) => void): () => void {
    if (name === 'newstate') throw new Error('newstate is not a stategraph event; use onNewState');
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
    if (this.pausedAt !== undefined) return;
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

  /** The engine suspends stategraph time while an inst is removed from the scene. */
  pause(): void {
    if (this.pausedAt !== undefined || this.disposed) return;
    this.pausedAt = this.scheduler?.now ?? this.clock;
    this.timeoutTimer?.pause(); this.timelineTimer?.pause();
  }
  resume(): void {
    if (this.pausedAt === undefined || this.disposed) return;
    if (this.scheduler) {
      this.enteredAt += this.scheduler.now - this.pausedAt;
      for (const timer of [this.timeoutTimer, this.timelineTimer]) if (timer?.snapshot.peek().status === 'paused') timer.start(timer.remainingSeconds!);
    }
    this.pausedAt = undefined;
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
