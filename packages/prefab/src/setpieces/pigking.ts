import * as THREE from 'three';
import { createPigKing, type PigKingPrefab, type PigKingPrefabOptions } from '../pigking';
import { TILE_SIZE, snapToTileCenter, type Vector2 } from '../tile';
import { createTurfGround } from '../turf';

export const PIG_KING_SET_PIECE = {
  id: 'pigking',
  turfId: 'turf_woodfloor',
  noiseTexture: 'noise_woodfloor',
  tileCount: 3,
} as const;

export interface PigKingSetPieceOptions extends PigKingPrefabOptions {
  /** Mirrored DST data root, e.g. `${import.meta.env.BASE_URL}dst/data`. */
  assetBaseUrl: string;
}

export interface PigKingSetPiece {
  /** Add this group to the scene to attach both the king and its turf. */
  group: THREE.Group;
  pigKing: PigKingPrefab;
  turf: THREE.Mesh;
  /** Actual ground-contact position, independent of the billboard's bounds. */
  footPosition: THREE.Vector3;
  tiles: readonly { turfId: 'turf_woodfloor'; position: Vector2 }[];
}

/** A king on the nine woodfloor tiles surrounding the tile containing its feet. */
export async function createPigKingSetPiece(options: PigKingSetPieceOptions): Promise<PigKingSetPiece> {
  const root = options.assetBaseUrl.replace(/\/$/, '');
  const footPosition = options.position?.clone() ?? new THREE.Vector3(0, 0, 25);
  const center = snapToTileCenter(footPosition);
  const size = PIG_KING_SET_PIECE.tileCount * TILE_SIZE;
  const [pigKing, turf] = await Promise.all([
    createPigKing(`${root}/anim`, { position: footPosition, scale: options.scale }),
    createTurfGround({
      assetBaseUrl: root,
      noiseTexture: PIG_KING_SET_PIECE.noiseTexture,
      size,
    }),
  ]);
  turf.name = 'PigKingWoodfloorTurf';
  turf.position.set(center.x, footPosition.y, center.z);
  turf.userData.turfId = PIG_KING_SET_PIECE.turfId;
  const material = turf.material as THREE.MeshLambertMaterial;
  // Draw on the ground plane without a second elevated floor or z-fighting.
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  // Keep woodfloor noise aligned in world space across separate set pieces.
  const noiseTileSize = TILE_SIZE * 8;
  material.map!.offset.set((center.x - size / 2) / noiseTileSize, (-center.z - size / 2) / noiseTileSize);
  const tileCount = PIG_KING_SET_PIECE.tileCount;
  const half = Math.floor(tileCount / 2);
  const tiles: PigKingSetPiece['tiles'] = Array.from({ length: tileCount * tileCount }, (_, index) => ({
    turfId: PIG_KING_SET_PIECE.turfId,
    position: {
      x: center.x + (index % tileCount - half) * TILE_SIZE,
      z: center.z + (Math.floor(index / tileCount) - half) * TILE_SIZE,
    },
  }));
  const group = new THREE.Group();
  group.name = 'PigKingSetPiece';
  group.add(turf, pigKing.standee);
  return { group, pigKing, turf, footPosition, tiles };
}
