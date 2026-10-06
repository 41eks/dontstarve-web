/** The persistent subset used by placement restoration. Models are never serialized. */
export interface PlacementSaveRecord {
  id: string;
  transform: { position: readonly [number, number, number]; rotationY: number };
  components: {
    building?: { state: 'idle' | 'closed' | 'open'; skinId?: string };
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

let fallbackSequence = 0;

export function newEntityId(): string {
  // getRandomValues is available in browsers that do not expose randomUUID,
  // including the HTTP development environment.
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return `e_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  return `e_${Date.now().toString(36)}_${++fallbackSequence}_${Math.random().toString(36).slice(2)}`;
}
