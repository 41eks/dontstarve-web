/** The persistent subset used by placement restoration. Models are never serialized. */
export interface PlacementSaveRecord {
  id: string;
  transform: { position: readonly [number, number, number]; rotationY: number };
  components: {
    building?: { state: 'idle' | 'closed' | 'open'; skinId?: string };
    stewer?: import('./cook_pot').CookPotSaveState;
    health?: { current: number; maximum: number };
    wall?: import('./wallSkins').WallSaveState;
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
