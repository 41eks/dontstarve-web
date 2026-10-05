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
  onenter?: (inst: StateGraphInstance<Context, Name>) => void;
  onexit?: (inst: StateGraphInstance<Context, Name>) => void;
  ontimeout?: (inst: StateGraphInstance<Context, Name>) => void;
  timeline?: readonly TimelineEvent<Context, Name>[];
  events?: readonly StateEvent<Context, Name>[];
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

export function ActionHandler<Action extends string, Name extends string>(action: Action, state: Name) {
  return { action, state };
}

/** State-local timelines and tags, mirroring scripts/stategraph.lua. */
export class StateGraphInstance<Context, Name extends string> {
  private readonly states = new Map<Name, StateDefinition<Context, Name>>();
  private readonly listeners = new Map<string, Set<(data: unknown) => void>>();
  private current!: StateDefinition<Context, Name>;
  private tags = new Set<string>();
  private timelineIndex = 0;
  private timeout: number | null = null;
  private revision = 0;
  timeInState = 0;
  readonly context: Context;

  constructor(context: Context, states: readonly StateDefinition<Context, Name>[]) {
    this.context = context;
    for (const state of states) {
      if (this.states.has(state.name)) throw new Error(`Duplicate state ${state.name}`);
      this.states.set(state.name, {
        ...state, timeline: [...state.timeline ?? []].sort((a, b) => a.time - b.time),
      });
    }
  }

  get stateName(): Name { return this.current.name; }
  get stateRevision(): number { return this.revision; }
  hasStateTag(tag: string): boolean { return this.tags.has(tag); }
  addStateTag(tag: string): void { this.tags.add(tag); }
  removeStateTag(tag: string): void { this.tags.delete(tag); }

  goToState(name: Name): void {
    const state = this.states.get(name);
    if (!state) throw new Error(`Unknown state ${name}`);
    this.current?.onexit?.(this);
    this.current = state;
    this.revision++;
    this.timeInState = 0;
    this.timelineIndex = 0;
    this.timeout = null;
    this.tags = new Set(state.tags);
    state.onenter?.(this);
    this.notify('newstate', { name });
  }

  setTimeout(duration: number): void {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid state timeout');
    this.timeout = this.timeInState + duration;
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
    const revision = this.revision;
    this.notify(name, data);
    // A listener can interrupt the state; its old handler must not run afterward.
    if (revision !== this.revision) return;
    this.current.events?.find((event) => event.name === name)?.fn(this, data);
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid stategraph timestep');
    let remaining = dt;
    // Consume overshoot in the next state/clip, as the Lua runner does.
    for (let count = 0; count < 10000; count++) {
      const event = this.current.timeline?.[this.timelineIndex];
      const deadline = Math.min(event?.time ?? Infinity, this.timeout ?? Infinity);
      const distance = Math.max(0, deadline - this.timeInState);
      if (distance > remaining + 1e-8) {
        this.timeInState += remaining;
        return;
      }
      this.timeInState = Math.max(this.timeInState, deadline);
      remaining = Math.max(0, remaining - distance);
      if (event && event.time === deadline) {
        this.timelineIndex++;
        event.fn(this);
      } else {
        this.timeout = null;
        this.current.ontimeout?.(this);
      }
    }
    throw new Error('Stategraph did not advance time');
  }
}
