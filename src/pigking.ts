import * as THREE from 'three';
import { createPigKing } from '@three-roaming/prefab/pigking';
import type { PointerContext } from '@three-roaming/prefab/worldContext';
import { initialSave } from './save/initialSave';

export const pigKings = await Promise.all(
  (initialSave.world.entities.pigking ?? []).map(async (record) => {
    const prefab = await createPigKing(
      `${import.meta.env.BASE_URL}dst/data/anim`,
      {
        floorTextureUrl: `${import.meta.env.BASE_URL}384px-GROUND_WOODFLOOR.png`,
        position: new THREE.Vector3(...record.transform.position),
      },
    );
    prefab.standee.userData.entityId = record.id;
    prefab.standee.userData.saveRecord = record;
    return { ...prefab, record };
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
