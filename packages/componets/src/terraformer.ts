import type { Vector3 } from 'three';

/** TheWorld.Map's terraforming: CanTerraformAtPoint and the SetTile / HandleDugGround of the dug tile. */
export interface TerraformerMap {
  canTerraform(point: Pick<Vector3, 'x' | 'z'>): boolean;
  dig(point: Pick<Vector3, 'x' | 'z'>): boolean;
}

interface TerraformerInst { PushEvent(name: string, data?: unknown): void }

/** components/terraformer.lua for the non-plow tools ported here; the map is the running world's. */
export class Terraformer {
  /** TheWorld.Map, bound while the tool is held in a world. */
  map: TerraformerMap | undefined;
  private readonly inst: TerraformerInst;
  constructor(inst: TerraformerInst) { this.inst = inst; }

  CanTerraformAtPoint(pt: Pick<Vector3, 'x' | 'z'>): boolean { return this.map?.canTerraform(pt) ?? false; }

  /** Terraform: the tile at the point becomes the ground underneath, then onterraform reaches the tool and the doer. */
  Terraform(pt: Pick<Vector3, 'x' | 'z'>, doer?: { PushEvent?(name: string, data?: unknown): void }): boolean {
    if (!this.map?.canTerraform(pt) || !this.map.dig(pt)) return false;
    this.inst.PushEvent('onterraform');
    doer?.PushEvent?.('onterraform');
    return true;
  }

  dispose(): void { this.map = undefined; }
}
