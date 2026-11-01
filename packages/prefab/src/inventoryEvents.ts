export interface PrefabInventoryEventMap {
  ondropped: {};
  onputininventory: {};
  /** Burnable-style request for external ground extinguishing. */
  onextinguish: {};
  /** Initialize a restored or reskinned ground entity without a fresh drop. */
  onload: {};
}

/** The entity whose own events are listened to, like Lua's inst:ListenForEvent(). */
export interface InventoryEventSource {
  ListenForEvent(name: string, listener: (data: unknown) => void): () => void;
}

/** Entity-local events, like Lua's inst:ListenForEvent()/inst:PushEvent(). */
export function listenInventoryEvents(
  inst: InventoryEventSource,
  handlers: Partial<Record<keyof PrefabInventoryEventMap, () => void>>,
): () => void {
  const stops = (Object.entries(handlers) as [keyof PrefabInventoryEventMap, () => void][])
    .map(([event, handler]) => inst.ListenForEvent(event, () => handler()));
  return () => { for (const stop of stops.splice(0)) stop(); };
}
