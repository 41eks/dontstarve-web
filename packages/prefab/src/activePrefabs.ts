import type { Object3D, Vector3 } from 'three';
import type { ComponentActionEntity } from '../../stategraphs/src/componentactions';
import type { WorkableInst } from '../../componets/src/workable';

export type FoundEntity = ComponentActionEntity & WorkableInst & { readonly model: Object3D; getPosition(): Vector3 };

/** The logical world's active prefab projections, shared by radius queries and pointer picking. */
export const activePrefabs: FoundEntity[] = [];
