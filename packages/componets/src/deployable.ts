import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
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
  /** SpawnPrefab(prefab, skin) followed by Transform:SetPosition; undefined when the world can no longer spawn. */
  SpawnPrefab(prefab: string, position: Vector3, skinId?: string): DeploySpawned | undefined;
  /** dock_kit.lua's CLIENT_CanDeployDockKit, reaching Map:CanDeployDockAtPoint. */
  canDeployDock(point: Vector3): boolean;
  /** dock_kit.lua on_deploy: TheWorld.components.dockmanager:CreateDockAtPoint and ResolveDockSafetyAtPoint. */
  createDock(point: Vector3): void;
  /** farm_plow.lua can_plow_tile. */
  canDeployPlow(point: Vector3): boolean;
  /** farm_plow.lua item_ondeploy; the item is `inst`. */
  deployPlow(point: Vector3, inst: DeployInst): boolean;
  /** Map:IsPassableAtPoint and IsOceanTileAtPoint, for actions.lua ExtraDeployDist. */
  isPassableAtPoint(point: ReadonlyVector3): boolean;
  isOceanTileAtPoint(point: Vector3): boolean;
  /** TheWorld:PushEvent("itemplanted", { doer, pos }). */
  itemPlanted(doer: unknown, pos: Vector3): void;
}

/** What the prefabs' ondeploy reach on the inst they spawn. */
export interface DeploySpawned {
  readonly components: { pickable?: { OnTransplant(): void } };
  PushEvent(name: string, data?: unknown): void;
}

/** MakePlacer(name, bank, build, anim): the art of `${prefab}_placer`, by name; the placer's display loads it. */
export interface DeployPlacerArt {
  readonly bank: string;
  readonly build: string;
  readonly animation: string;
  readonly animationArchive?: string;
}

export interface Deployer {
  readonly position: ReadonlyVector3;
  PushEvent(name: string, data: unknown): void;
}

/** deployable.lua's TURF, PLANT and CUSTOM branches. */
export class Deployable {
  readonly mode: 'TURF' | 'PLANT' | 'CUSTOM';
  readonly usegridplacer: boolean;
  readonly spacing: number;
  readonly placer?: DeployPlacerArt;
  private readonly inst: DeployInst;
  /** inst._custom_candeploy_fn. */
  private readonly candeploy?: (point: Vector3, map: DeployMap) => boolean;
  private readonly ondeploy: (point: Vector3, deployer: Deployer, map: DeployMap) => void | boolean;

  constructor(inst: DeployInst, ondeploy: (point: Vector3, deployer: Deployer, map: DeployMap) => void | boolean,
    options?: { mode: 'PLANT'; spacing: number; placer: DeployPlacerArt }
      | { mode: 'CUSTOM'; spacing: number; usegridplacer: boolean; candeploy(point: Vector3, map: DeployMap): boolean }) {
    this.inst = inst;
    this.ondeploy = ondeploy;
    this.mode = options?.mode ?? 'TURF'; this.spacing = options?.spacing ?? 2;
    this.usegridplacer = options?.mode === 'CUSTOM' ? options.usegridplacer : this.mode === 'TURF';
    if (options?.mode === 'CUSTOM') this.candeploy = options.candeploy;
    if (options?.mode === 'PLANT') this.placer = options.placer;
  }

  CanDeploy(point: Vector3, map: DeployMap | undefined): boolean {
    if (!map || this.inst.isRemoved) return false;
    if (this.candeploy) return this.candeploy(point, map);
    return this.mode === 'PLANT' ? map.canDeployPlant(point, this.inst, this.spacing) : map.canPlaceTurf(point);
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
