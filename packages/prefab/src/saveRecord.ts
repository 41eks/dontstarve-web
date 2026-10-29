/** The persistent subset used by placement restoration. Models are never serialized. */
export interface PlacementSaveRecord {
  id: string;
  transform: { position: readonly [number, number, number]; rotationY: number };
  components: {
    pickable?: import('./components/pickable').PickableSaveState;
    witherable?: import('../../componets/src/witherable').WitherableSave;
    growable?: import('../../componets/src/growable').GrowableSave;
    building?: { state: 'idle' | 'closed' | 'open'; skinId?: string; burnt?: true };
    stewer?: import('./cook_pot').CookPotSaveState;
    container?: { slotCount: number; slots: { slotKey: string; item: import('@dontstarve-web/inventory').InventoryStack }[] };
    health?: { current: number; maximum: number };
    wall?: import('./wallSkins').WallSaveState;
    fence?: import('./fenceSkins').FenceSaveState;
    sculptingtable?: { itemname: string };
    birdcage?: import('./birdcage').BirdcageSaveStateData;
    workable?: { workleft: number; maxwork: number };
    finiteuses?: { uses: number };
    moonbase?: import('./moonbase').MoonbaseSaveState;
    lightningrod?: import('./lightning_rod').LightningRodSaveState;
    firepit?: import('./firepit').FirePitSaveState;
  };
}

export interface PlacedEntitySaveRecord {
  prefabId: string;
  record: PlacementSaveRecord;
}

/** Removes the sprite's visual offset and flat-ground raycast rounding residue. */
export function saveGroundPosition(
  position: { x: number; y: number; z: number },
  visualOffset: number,
): [number, number, number] {
  const height = position.y - visualOffset;
  return [position.x, Math.abs(height) < 1e-6 ? 0 : height, position.z];
}

export { newItemEntityId as newEntityId } from '@dontstarve-web/inventory';
