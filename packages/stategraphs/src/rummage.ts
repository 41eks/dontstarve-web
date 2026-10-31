import type * as THREE from 'three';
import type { BufferedActionObject } from './bufferedaction.ts';

/** What actions.lua RUMMAGE reads from the target's container component. */
export interface RummageContainer {
  canbeopened: boolean;
  CanOpen(): boolean;
  IsOpenedBy(doer: object): boolean;
  Open(doer?: object): void;
  Close(doer?: object): void;
}

export interface RummageTarget extends BufferedActionObject {
  readonly isRemoved: boolean;
  readonly components: { container?: RummageContainer };
  getPosition(): THREE.Vector3;
}

/** actions.lua RUMMAGE.fn for a scene container: close it if the doer has it open, otherwise open it. */
export function performRummageAction(target: RummageTarget, doer: object): boolean {
  const container = target.components.container;
  const events = doer as { PushEvent?(name: string, data?: unknown): void };
  if (target.isRemoved || !container) return false;
  if (container.IsOpenedBy(doer)) {
    container.Close(doer);
    events.PushEvent?.('closecontainer', { container: target });
    return true;
  }
  if (!container.CanOpen() || !container.canbeopened) return false;
  events.PushEvent?.('opencontainer', { container: target });
  container.Open(doer);
  return true;
}
