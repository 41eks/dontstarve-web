import type { Vector3 } from 'three';
import { MiniMapState } from '../../map/src/minimapState';
import { watchMiniMapEntity } from '../../map/src/minimapEntities';
import { TileTracker } from './tileManager';

/** Entity primitive configured by Lua AddMiniMapEntity(), independent of terrain
 * rendering. Position is the owner's existing ground-contact transform.
 */
export class MiniMapEntity extends MiniMapState {
  readonly position: Vector3;
  readonly tileTracker: TileTracker;
  private readonly stopWatching: () => void;
  get minimap(): MiniMapState { return this; }

  constructor(position: Vector3, tileTracker = new TileTracker(() => position)) {
    super();
    this.position = position; this.tileTracker = tileTracker;
    this.stopWatching = watchMiniMapEntity(this);
  }
  dispose(): void { this.SetEnabled(false); this.stopWatching(); }
}
