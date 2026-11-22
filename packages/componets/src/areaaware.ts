import type { Vector3 } from 'three';
import { dstUnitsToWorld } from '@dontstarve-web/animation/units';
import type { EventDataArgs } from './entityEvents';

/** The topology node AreaAware reports: the parts of TheWorld.topology.nodes[i] its listeners read. */
export interface AreaNode {
  readonly type: number;
  readonly x: number;
  readonly z: number;
  readonly tags?: readonly (string | number)[];
}

/** areaaware.lua's current_area_data; the topology's ids and polygons are not imported. */
export interface AreaData {
  readonly type: number;
  /** node.cent, as world X and Z. */
  readonly center: readonly [number, number];
  readonly tags?: readonly (string | number)[];
}

export interface AreaAwareInst {
  getPosition(): Vector3;
  PushEvent<E extends string>(event: E, ...[data]: EventDataArgs<E>): void;
}

export interface AreaAwareWorld {
  /** TheWorld.Map:FindVisualNodeAtPoint(x, y, z): the node and its index, 0 for none. */
  FindVisualNodeAtPoint(point: Vector3): { node: AreaNode | undefined; index: number };
}

/** components/areaaware.lua: pushes "changearea" when the entity moves onto another topology node. */
export class AreaAware {
  private current_area = -1;
  private current_area_data: AreaData | undefined;
  private lastpt: { x: number; z: number } = { x: -9999, z: -9999 };
  /** 4 * 4 DST units, squared in project units. */
  private updatedistsq: number;
  private readonly inst: AreaAwareInst;
  private readonly world: AreaAwareWorld;

  constructor(inst: AreaAwareInst, world: AreaAwareWorld) {
    this.inst = inst;
    this.world = world;
    this.updatedistsq = dstUnitsToWorld(4) ** 2;
  }

  UpdatePosition(point: Vector3): void {
    const { node, index } = this.world.FindVisualNodeAtPoint(point);
    if (index !== this.current_area) {
      this.current_area = index;
      this.current_area_data = node && {
        type: node.type,
        center: [node.x, node.z],
        ...(node.tags === undefined ? {} : { tags: node.tags }),
      };
      this.inst.PushEvent('changearea', this.current_area_data);
    }
  }

  OnUpdate(_dt: number): void {
    const position = this.inst.getPosition();
    const dx = position.x - this.lastpt.x,
      dz = position.z - this.lastpt.z;
    if (dx * dx + dz * dz > this.updatedistsq) {
      this.UpdatePosition(position);
      this.lastpt = { x: position.x, z: position.z };
    }
  }

  /** SetUpdateDist(dist), in DST units. */
  SetUpdateDist(dist: number): void {
    this.updatedistsq = dstUnitsToWorld(dist) ** 2;
  }

  GetCurrentArea(): AreaData | undefined {
    return this.current_area_data;
  }

  CurrentlyInTag(tag: string | number): boolean {
    return this.current_area_data?.tags?.includes(tag) ?? false;
  }
}
