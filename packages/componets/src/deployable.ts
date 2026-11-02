import type { Vector3 } from 'three';

/** The inst a Deployable belongs to. */
export interface DeployInst {
  readonly prefab: string;
  readonly isRemoved: boolean;
  hasTag(tag: string): boolean;
}

/** TheWorld.Map and TheWorld, as deployable.lua and the prefabs' ondeploy reach them. */
export interface DeployMap {
  /** map.lua CanPlaceTurfAtPoint. */
  canPlaceTurf(point: Vector3): boolean;
  setTile(col: number, row: number, tileId: number): void;
  /** map.lua CanDeployPlantAtPoint. */
  canDeployPlant(point: Vector3, inst: DeployInst, spacing: number): boolean;
  /** ondeploy's SpawnPrefab of the planted prefab, with the deployed item's skin. */
  deployPlant(point: Vector3, inst: DeployInst): boolean;
  /** TheWorld:PushEvent("itemplanted", { doer, pos }). */
  itemPlanted(doer: unknown, pos: Vector3): void;
}

export interface Deployer {
  readonly position: Vector3;
  PushEvent(name: string, data: unknown): void;
}

/** deployable.lua's TURF and PLANT branches. */
export class Deployable {
  readonly mode: 'TURF' | 'PLANT';
  readonly usegridplacer: boolean;
  readonly spacing: number;
  private readonly inst: DeployInst;
  private readonly ondeploy: (point: Vector3, deployer: Deployer, map: DeployMap) => void | boolean;

  constructor(inst: DeployInst, ondeploy: (point: Vector3, deployer: Deployer, map: DeployMap) => void | boolean,
    options?: { mode: 'PLANT'; spacing: number }) {
    this.inst = inst;
    this.ondeploy = ondeploy;
    this.mode = options?.mode ?? 'TURF'; this.spacing = options?.spacing ?? 2;
    this.usegridplacer = this.mode === 'TURF';
  }

  CanDeploy(point: Vector3, map: DeployMap | undefined): boolean {
    return !!map && !this.inst.isRemoved && (this.mode === 'PLANT'
      ? map.canDeployPlant(point, this.inst, this.spacing)
      : map.canPlaceTurf(point));
  }

  Deploy(point: Vector3, deployer: Deployer, map: DeployMap): boolean {
    if (!this.CanDeploy(point, map)) return false;
    const isplant = this.inst.hasTag('deployedplant');
    if (this.ondeploy(point, deployer, map) === false) return false;
    deployer.PushEvent('deployitem', { prefab: this.inst.prefab });
    if (isplant) map.itemPlanted(deployer, point);
    return true;
  }

  dispose(): void {}
}
