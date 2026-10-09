/** Synchronous, typed events. Each scene owns its emitter and subscriptions. */
export class EventEmitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(data: never) => void>>();

  on<Key extends keyof Events>(event: Key, listener: (data: Events[Key]) => void): () => void {
    let listeners = this.listeners.get(event);
    if (!listeners) this.listeners.set(event, listeners = new Set());
    listeners.add(listener as (data: never) => void);
    return () => this.off(event, listener);
  }

  off<Key extends keyof Events>(event: Key, listener: (data: Events[Key]) => void): void {
    const listeners = this.listeners.get(event);
    listeners?.delete(listener as (data: never) => void);
    if (listeners?.size === 0) this.listeners.delete(event);
  }

  emit<Key extends keyof Events>(event: Key, data: Events[Key]): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    // Added listeners wait for the next emit; removed listeners cannot run later in this emit.
    for (const listener of [...listeners]) if (listeners.has(listener)) listener(data as never);
  }
}

export default EventEmitter;
