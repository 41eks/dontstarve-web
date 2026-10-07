import type { Object3D } from 'three';

export interface PrefabInventoryEventMap {
  ondropped: {};
  onputininventory: {};
  /** Burnable-style request for external ground extinguishing. */
  onextinguish: {};
  /** Initialize a restored or reskinned ground entity without a fresh drop. */
  onload: {};
}

declare module 'three' {
  interface Object3DEventMap extends PrefabInventoryEventMap {}
}

/** Entity-local events, like Lua's inst:ListenForEvent()/inst:PushEvent(). */
export function listenInventoryEvents(
  model: Object3D,
  handlers: Partial<Record<keyof PrefabInventoryEventMap, () => void>>,
): () => void {
  const entries = Object.entries(handlers) as [keyof PrefabInventoryEventMap, () => void][];
  for (const [event, handler] of entries) model.addEventListener(event, handler);
  return () => {
    for (const [event, handler] of entries) model.removeEventListener(event, handler);
  };
}
