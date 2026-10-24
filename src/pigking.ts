import * as THREE from 'three';
import { createPigKingSetPiece } from '@dontstarve-web/prefab/setpieces/pigking';
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
