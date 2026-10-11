import * as THREE from 'three';
import { TILE_SIZE, snapToTileCenter, type Vector2 } from './tile';
import { GROUND_TILE_DEFINITIONS, groundTileGeometry, groundTileVariant, loadGroundTileAssets,
  type GroundTileAssets, type GroundTileQuad } from './groundTiles';

// tiledefs.lua preserves these vanilla GROUND IDs in WORLD_TILES.
export const WORLD_TILES = {
  INVALID: 0, DIRT: 4, WOODFLOOR: GROUND_TILE_DEFINITIONS.WOODFLOOR.tileId,
  DECIDUOUS: GROUND_TILE_DEFINITIONS.DECIDUOUS.tileId,
  FARMING_SOIL: GROUND_TILE_DEFINITIONS.FARMING_SOIL.tileId,
} as const;

export interface TurfTileSave {
  /** Signed grid coordinates: floor(world x/z / TILE_SIZE). */
  col: number;
  row: number;
  tileId: typeof WORLD_TILES.DIRT | typeof WORLD_TILES.FARMING_SOIL;
  underTileId?: typeof WORLD_TILES.DIRT | typeof WORLD_TILES.DECIDUOUS;
}

/** Generated terrain plus sparse, authoritative TERRAFORM changes. */
export class TurfMap {
  readonly size: number;
  private readonly originalTiles = new Map<string, number>();
  private readonly dugTiles = new Map<string, TurfTileSave>();
  private dirt?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  private dirtAssets?: GroundTileAssets;
  private visual?: THREE.Group;
  private readonly layers = new Map<number, { mesh: THREE.Mesh; assets: GroundTileAssets }>();
  private readonly listeners = new Set<(world: Vector2) => void>();

  constructor(size: number, savedTiles: readonly TurfTileSave[] = []) {
    this.size = size;
    for (const tile of savedTiles) this.dugTiles.set(`${tile.col},${tile.row}`, { ...tile });
  }

  private key(world: Vector2): string {
    return `${Math.floor(world.x / TILE_SIZE)},${Math.floor(world.z / TILE_SIZE)}`;
  }

  getTileAtWorld(world: Vector2): number {
    if (!Number.isFinite(world.x) || !Number.isFinite(world.z)
      || world.x < -this.size / 2 || world.x >= this.size / 2
      || world.z < -this.size / 2 || world.z >= this.size / 2) return WORLD_TILES.INVALID;
    const key = this.key(world);
    return this.dugTiles.get(key)?.tileId ?? this.originalTiles.get(key) ?? WORLD_TILES.DECIDUOUS;
  }

  /** Registers generated set-piece terrain without overwriting saved dug tiles. */
  setOriginalTile(world: Vector2, tileId: number): void {
    this.originalTiles.set(this.key(world), tileId);
    this.rebuildGeometry();
  }

  tileCenter(world: Vector2): Vector2 { return snapToTileCenter(world); }

  canTerraform(world: Vector2): boolean {
    const tile = this.getTileAtWorld(world);
    return tile === WORLD_TILES.DECIDUOUS || tile === WORLD_TILES.WOODFLOOR || tile === WORLD_TILES.FARMING_SOIL;
  }

  canPlant(world: Vector2): boolean {
    const tile = this.getTileAtWorld(world);
    return tile === WORLD_TILES.DECIDUOUS || tile === WORLD_TILES.DIRT || tile === WORLD_TILES.FARMING_SOIL;
  }

  canPlow(world: Vector2): boolean {
    return this.canPlant(world) && this.getTileAtWorld(world) !== WORLD_TILES.FARMING_SOIL;
  }

  plow(world: Vector2): boolean {
    if (!this.canPlow(world)) return false;
    const col = Math.floor(world.x / TILE_SIZE), row = Math.floor(world.z / TILE_SIZE);
    this.dugTiles.set(`${col},${row}`, { col, row, tileId: WORLD_TILES.FARMING_SOIL,
      underTileId: this.getTileAtWorld(world) as typeof WORLD_TILES.DIRT | typeof WORLD_TILES.DECIDUOUS });
    this.rebuildGeometry();
    return true;
  }

  onDig(listener: (world: Vector2) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** terraformer.lua: SetTile(..., WORLD_TILES.DIRT); dirt cannot be dug again. */
  dig(world: Vector2): boolean {
    if (!this.canTerraform(world)) return false;
    const center = snapToTileCenter(world);
    const col = Math.floor(center.x / TILE_SIZE), row = Math.floor(center.z / TILE_SIZE);
    const key = `${col},${row}`;
    if (this.dugTiles.get(key)?.tileId === WORLD_TILES.FARMING_SOIL
      && this.dugTiles.get(key)?.underTileId !== WORLD_TILES.DIRT) this.dugTiles.delete(key);
    else this.dugTiles.set(key, { col, row, tileId: WORLD_TILES.DIRT });
    this.rebuildGeometry();
    for (const listener of this.listeners) listener(world);
    return true;
  }

  exportTiles(): TurfTileSave[] {
    return [...this.dugTiles.values()].map((tile) => ({ ...tile }));
  }

  async createDirtMesh(assetBaseUrl: string): Promise<THREE.Mesh> {
    if (this.dirt) return this.dirt;
    this.dirtAssets = await loadGroundTileAssets(assetBaseUrl, 'DIRT');
    const material = this.dirtAssets.material;
    material.transparent = false;
    this.dirt = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.dirt.name = 'DugTurf:DIRT';
    this.dirt.renderOrder = -1.5;
    this.dirt.receiveShadow = true;
    this.rebuildGeometry();
    return this.dirt;
  }

  /** tilemanager: layered atlas masks + noise, in source ground render order. */
  async createVisual(assetBaseUrl: string): Promise<THREE.Group> {
    if (this.visual) return this.visual;
    const [dirt, deciduous, woodfloor, farming] = await Promise.all([
      this.createDirtMesh(assetBaseUrl), loadGroundTileAssets(assetBaseUrl, 'DECIDUOUS'),
      loadGroundTileAssets(assetBaseUrl, 'WOODFLOOR'),
      loadGroundTileAssets(assetBaseUrl, 'FARMING_SOIL'),
    ]);
    this.visual = new THREE.Group();
    this.visual.name = 'EditableTurf';
    this.visual.add(dirt);
    for (const [name, assets] of [['DECIDUOUS', deciduous], ['WOODFLOOR', woodfloor], ['FARMING_SOIL', farming]] as const) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), assets.material);
      mesh.name = `TurfBlend:${name}`;
      mesh.renderOrder = -1 + GROUND_TILE_DEFINITIONS[name].renderOrder * 0.1;
      mesh.receiveShadow = true;
      this.visual.add(mesh);
      this.layers.set(WORLD_TILES[name], { mesh, assets });
    }
    this.rebuildGeometry();
    return this.visual;
  }

  private tileAt(col: number, row: number): number {
    const half = this.size / 2;
    if ((col + 1) * TILE_SIZE <= -half || col * TILE_SIZE >= half
      || (row + 1) * TILE_SIZE <= -half || row * TILE_SIZE >= half) return WORLD_TILES.INVALID;
    const key = `${col},${row}`;
    return this.dugTiles.get(key)?.tileId ?? this.originalTiles.get(key) ?? WORLD_TILES.DECIDUOUS;
  }

  private variantAt(col: number, row: number, tileId: number): number {
    const is = (dx: number, dz: number) => this.tileAt(col + dx, row + dz) === tileId;
    const cardinal = Number(is(-1, 0)) | Number(is(0, -1)) << 1
      | Number(is(1, 0)) << 2 | Number(is(0, 1)) << 3;
    const diagonal = Number(is(-1, -1)) | Number(is(1, -1)) << 1
      | Number(is(1, 1)) << 2 | Number(is(-1, 1)) << 3;
    return groundTileVariant(is(0, 0), cardinal, diagonal);
  }

  private rebuildGeometry(): void {
    if (!this.dirt || !this.dirtAssets) return;
    const quads = [...this.dugTiles.values()].filter(({ tileId }) => tileId === WORLD_TILES.DIRT)
      .map((tile) => ({ ...tile, variant: 1 }));
    const geometry = groundTileGeometry(quads, this.dirtAssets, this.size);
    this.dirt.geometry.dispose();
    this.dirt.geometry = geometry;
    this.dirt.visible = quads.length > 0;
    for (const [tileId, { mesh, assets }] of this.layers) {
      const candidates = new Set<string>();
      if (tileId === WORLD_TILES.DECIDUOUS) {
        // The generated deciduous plane is already full. Only dug cells need skirts.
        for (const key of this.dugTiles.keys()) candidates.add(key);
      } else if (tileId === WORLD_TILES.FARMING_SOIL) {
        for (const [key, tile] of this.dugTiles) {
          if (tile.tileId !== tileId) continue;
          const [col, row] = key.split(',').map(Number);
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) candidates.add(`${col + dx},${row + dz}`);
        }
      } else {
        for (const [key, original] of this.originalTiles) {
          if (original !== tileId) continue;
          const [col, row] = key.split(',').map(Number);
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            candidates.add(`${col + dx},${row + dz}`);
          }
        }
      }
      const edgeQuads: GroundTileQuad[] = [];
      for (const key of candidates) {
        const [col, row] = key.split(',').map(Number);
        if (this.tileAt(col, row) === WORLD_TILES.INVALID) continue;
        const variant = this.variantAt(col, row, tileId);
        if (variant !== 17) edgeQuads.push({ col, row, variant });
      }
      mesh.geometry.dispose();
      mesh.geometry = groundTileGeometry(edgeQuads, assets, this.size);
      mesh.visible = edgeQuads.length > 0;
    }
  }
}
