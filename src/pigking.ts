import { createPigKing } from '@three-roaming/prefab/pigking';

const pigKing = await createPigKing(
    `${import.meta.env.BASE_URL}dst/data/anim`,
    { floorTextureUrl: `${import.meta.env.BASE_URL}384px-GROUND_WOODFLOOR.png` },
);

export const pigKingStandee = pigKing.standee;
export const pigKingFloor = pigKing.floor;
export const pigKingBody = pigKing.body;
export const setPigKingNormal = pigKing.setNormal;
export const setupPigKingInteraction = pigKing.setupInteraction;
export const updatePigKingAnimation = pigKing.update;
