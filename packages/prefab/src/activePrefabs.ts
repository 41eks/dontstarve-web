import type { Object3D, Vector3 } from 'three';
import type { ComponentActionEntity } from '../../stategraphs/src/componentactions';
import type { WorkableInst } from '../../componets/src/workable';
import type { ReskinTarget } from '../../stategraphs/src/reskin_tool';
import type { HammerTarget } from '../../stategraphs/src/hammer';

export type FoundEntity = ComponentActionEntity & WorkableInst & {
  readonly model: Object3D;
  getPosition(): Vector3;
  /** The entity's skin operation, supplied by its owner; skin state stays on that entity. */
  reskinTarget?: ReskinTarget;
  /** The owner's HAMMER view; work and destruction still belong to its workable component. */
  hammerTarget?: HammerTarget;
  /** The ground item's pickup view; inventory state remains on its ItemEntity. */
  pickupTarget?: import('../../stategraphs/src/pickup').PickupTarget;
};

/** The logical world's active prefab projections, used by world/radius queries independently of mouse targeting. */
export const activePrefabs: FoundEntity[] = [];
