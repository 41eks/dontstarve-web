import type { Vector3 } from 'three';

export interface TurfDeployMap {
  canPlaceTurf(point: Vector3): boolean;
  setTile(col: number, row: number, tileId: number): void;
}

export interface Deployer {
  readonly position: Vector3;
  PushEvent(name: string, data: unknown): void;
}
export interface PlantDeployMap {
  canDeployPlant(point: Vector3, inst: { prefab: string; isRemoved: boolean }, spacing: number): boolean;
  deployPlant(point: Vector3, inst: { prefab: string; isRemoved: boolean }): boolean;
}

/** deployable.lua's TURF and PLANT branches. The world map is injected by the action owner. */
export class Deployable<Map = TurfDeployMap> {
  readonly mode: 'TURF' | 'PLANT';
  readonly usegridplacer: boolean;
  readonly spacing: number;
  private readonly inst: { prefab: string; isRemoved: boolean };
  private readonly ondeploy: (point: Vector3, deployer: Deployer, map: Map) => void | boolean;

  constructor(inst: { prefab: string; isRemoved: boolean },
    ondeploy: (point: Vector3, deployer: Deployer, map: Map) => void | boolean,
    options?: { mode: 'PLANT'; spacing: number }) {
    this.inst = inst;
    this.ondeploy = ondeploy;
    this.mode = options?.mode ?? 'TURF'; this.spacing = options?.spacing ?? 2;
    this.usegridplacer = this.mode === 'TURF';
  }

  CanDeploy(point: Vector3, map: Map): boolean {
    return !this.inst.isRemoved && (this.mode === 'PLANT'
      ? (map as PlantDeployMap).canDeployPlant(point, this.inst, this.spacing)
      : (map as TurfDeployMap).canPlaceTurf(point));
  }

  Deploy(point: Vector3, deployer: Deployer, map: Map): boolean {
    if (!this.CanDeploy(point, map)) return false;
    if (this.ondeploy(point, deployer, map) === false) return false;
    deployer.PushEvent('deployitem', { prefab: this.inst.prefab });
    return true;
  }

  dispose(): void {}
}
