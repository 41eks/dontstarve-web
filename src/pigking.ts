import * as THREE from 'three';
import { createPigKingSetPiece } from '@three-roaming/prefab/setpieces/pigking';
import type { PointerContext } from '@three-roaming/prefab/worldContext';
import { initialSave } from './save/initialSave';

export const pigKings = await Promise.all(
  (initialSave.world.entities.pigking ?? []).map(async (record) => {
    const setPiece = await createPigKingSetPiece({
      assetBaseUrl: `${import.meta.env.BASE_URL}dst/data`,
      position: new THREE.Vector3(...record.transform.position),
    });
    const prefab = setPiece.pigKing;
    prefab.standee.userData.entityId = record.id;
    prefab.standee.userData.saveRecord = record;
    return { ...prefab, setPiece, record };
  }),
);

export const setPigKingNormal = (quaternion: THREE.Quaternion) => {
  pigKings.forEach((pigKing) => pigKing.setNormal(quaternion));
};
export const setupPigKingInteraction = (context: PointerContext) => {
  pigKings.forEach((pigKing) => pigKing.setupInteraction(context));
};
export const updatePigKingAnimation = (dt: number) => {
  pigKings.forEach((pigKing) => pigKing.update(dt));
};
