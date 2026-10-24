import * as THREE from 'three';
import { createPigKing } from '@dontstarve-web/prefab/pigking';
import { initialSave } from './save/initialSave';

export const pigKings = await Promise.all(
  (initialSave.world.entities.pigking ?? []).map(async (record) => {
    const feet = new THREE.Vector3(...record.transform.position);
    const prefab = await createPigKing(`${import.meta.env.BASE_URL}dst/data/anim`, { position: feet });
    prefab.standee.userData.entityId = record.id;
    prefab.standee.userData.saveRecord = record;
    return { ...prefab, feet, record };
  }),
);
