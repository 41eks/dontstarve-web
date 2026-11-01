import type { Vector3 } from 'three';

/** TheWorld.Map's farm soil: CanTillSoilAtPoint, then CollapseSoilAtPoint and the new farm_soil. */
export interface FarmTillerMap {
  canTill(point: Vector3): boolean;
  till(point: Vector3): boolean;
}

/** components/farmtiller.lua; the map is the running world's. */
export class FarmTiller {
  /** TheWorld.Map, bound while the tool is held in a world. */
  map: FarmTillerMap | undefined;

  CanTillSoilAtPoint(pt: Vector3): boolean { return this.map?.canTill(pt) ?? false; }

  /** Till: collapse the soil near the point and spawn farm_soil there; the doer hears "tilling". */
  Till(pt: Vector3, doer?: { PushEvent?(name: string, data?: unknown): void }): boolean {
    if (!this.map?.canTill(pt) || !this.map.till(pt)) return false;
    doer?.PushEvent?.('tilling');
    return true;
  }

  dispose(): void { this.map = undefined; }
}
