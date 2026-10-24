import type { Vector3 } from 'three';

export interface TurfDeployMap {
  canPlaceTurf(point: Vector3): boolean;
  setTile(col: number, row: number, tileId: number): void;
}

export interface Deployer {
  readonly position: Vector3;
  PushEvent(name: string, data: unknown): void;
}

/** deployable.lua's TURF branch. The world map is injected by the action owner. */
export class Deployable {
  readonly mode = 'TURF';
  readonly usegridplacer = true;
  private readonly inst: { prefab: string; isRemoved: boolean };
  private readonly ondeploy: (point: Vector3, deployer: Deployer, map: TurfDeployMap) => void;

  constructor(inst: { prefab: string; isRemoved: boolean },
    ondeploy: (point: Vector3, deployer: Deployer, map: TurfDeployMap) => void) {
    this.inst = inst;
    this.ondeploy = ondeploy;
  }

  CanDeploy(point: Vector3, map: TurfDeployMap): boolean {
    return !this.inst.isRemoved && map.canPlaceTurf(point);
  }

  Deploy(point: Vector3, deployer: Deployer, map: TurfDeployMap): boolean {
    if (!this.CanDeploy(point, map)) return false;
    this.ondeploy(point, deployer, map);
    deployer.PushEvent('deployitem', { prefab: this.inst.prefab });
    return true;
  }

  dispose(): void {}
}
