import type { Vector3 } from 'three';
import { MiniMapState } from '../../map/src/minimapState';
import { watchMiniMapEntity } from '../../map/src/minimapEntities';
import { TileTracker } from './tileManager';

/** Entity primitive configured by Lua AddMiniMapEntity(), independent of terrain
 * rendering. Position is the owner's existing ground-contact transform.
 */
export class MiniMapEntity extends MiniMapState {
  private readonly getPosition: () => Vector3;
  get position(): Vector3 { return this.getPosition(); }
  readonly tileTracker: TileTracker;
  private readonly stopWatching: () => void;
  get minimap(): MiniMapState { return this; }

  constructor(position: Vector3 | (() => Vector3), tileTracker?: TileTracker) {
    super();
    this.getPosition = typeof position === 'function' ? position : () => position;
    this.tileTracker = tileTracker ?? new TileTracker(this.getPosition);
    this.stopWatching = watchMiniMapEntity(this);
  }
  dispose(): void { this.SetEnabled(false); this.stopWatching(); }
}
