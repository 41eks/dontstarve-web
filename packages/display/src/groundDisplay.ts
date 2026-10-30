import * as THREE from 'three';
import { createEffect, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import { groundOverlayBlend, groundOverlayMaterial, groundTileGeometry, loadGroundTexture, loadGroundTileAssets,
  type GroundTileArt, type GroundTileAssets, type GroundTileQuad } from './groundAssets';

/** Inclusive-exclusive signed cells. */
export interface GroundCellBounds { minCol: number; minRow: number; maxCol: number; maxRow: number }

/** One render layer the world declares: MapLayerManager:CreateRenderLayer plus Map:AddRenderLayer. */
export interface GroundLayerDeclaration {
  readonly tileId: number;
  readonly art: GroundTileArt;
  /** three.js renderOrder of the layer, in source layer order. */
  readonly renderOrder: number;
}

/** The world's tile map as the ground display reads it. It owns tiles and layer declarations, never meshes or art. */
export interface GroundTerrain {
  readonly size: number;
  readonly tileSize: number;
  cellRange(): { min: number; max: number };
  groundLayers(): readonly GroundLayerDeclaration[];
  /** Edge-mask quads of every declared layer whose cell lies within `bounds`. */
  groundLayerQuads(bounds: GroundCellBounds): ReadonlyMap<number, readonly GroundTileQuad[]>;
  /** ground_overlay.ksh coverage within `bounds`: full land cells plus land skirts into ocean cells, per declared layer. */
  landOverlayQuads(bounds: GroundCellBounds): ReadonlyMap<number, readonly GroundTileQuad[]>;
  onTerrainChanged(listener: (bounds?: GroundCellBounds) => void): () => void;
}

/** A ground overlay (weather.lua's snow): ground_overlay.ksh with `texture`, covering land at `cover` (0..3). */
export interface GroundOverlayDeclaration {
  readonly texture: string;
  readonly cover: ReadonlySignal<number>;
  /** three.js renderOrder of the overlay; it draws above every ground layer. */
  readonly renderOrder: number;
}

/** Where overlay owners declare their overlays; the declaring owner does no IO. */
export interface GroundOverlayHost {
  declareOverlay(key: string, declaration: GroundOverlayDeclaration | undefined): void;
}

/** Geometry is grouped for culling and edits only; layers keep their source order across chunks. */
const CHUNK_CELLS = 32;
/** Keeps an overlay's per-layer meshes in source layer order, as the groups of one mesh were drawn. */
const OVERLAY_LAYER_STEP = 1e-4;

interface Layer { readonly declaration: GroundLayerDeclaration; assets?: GroundTileAssets; loading?: Promise<void> }
interface Overlay {
  readonly declaration: GroundOverlayDeclaration;
  readonly blend: { value: THREE.Vector3 };
  readonly materials: Map<number, THREE.MeshLambertMaterial>;
  texture?: THREE.Texture;
  visible: boolean;
  stop?: () => void;
}
interface Chunk extends GroundCellBounds { readonly meshes: THREE.Mesh[]; readonly overlays: Map<string, THREE.Mesh[]> }

const releaseMeshes = (meshes: THREE.Mesh[]) => { for (const mesh of meshes.splice(0)) { mesh.removeFromParent(); mesh.geometry.dispose(); } };

/** Draws the world's declared ground layers and ground overlays. A terrain change rebuilds only the chunks it reaches;
 * a newly declared layer or overlay loads its art here and then draws wherever its tiles are.
 */
export class GroundDisplay implements GroundOverlayHost {
  readonly root = new THREE.Group();
  private readonly terrain: GroundTerrain;
  private readonly assetBaseUrl: string;
  private readonly layers = new Map<number, Layer>();
  private readonly overlays = new Map<string, Overlay>();
  private readonly chunks: Chunk[] = [];
  private readonly stopTerrain: () => void;
  private disposed = false;

  constructor(terrain: GroundTerrain, assetBaseUrl: string) {
    this.terrain = terrain;
    this.assetBaseUrl = assetBaseUrl;
    this.root.name = 'GroundLayers';
    const { min, max } = terrain.cellRange();
    for (let row = min; row < max; row += CHUNK_CELLS) for (let col = min; col < max; col += CHUNK_CELLS) {
      this.chunks.push({ minCol: col, minRow: row, maxCol: Math.min(max, col + CHUNK_CELLS), maxRow: Math.min(max, row + CHUNK_CELLS),
        meshes: [], overlays: new Map() });
    }
    this.stopTerrain = terrain.onTerrainChanged(bounds => {
      this.declare(true);
      // Variants read the eight neighbours, so an edit reaches one cell beyond its bounds.
      this.rebuild(bounds && { minCol: bounds.minCol - 1, minRow: bounds.minRow - 1, maxCol: bounds.maxCol + 1, maxRow: bounds.maxRow + 1 });
    });
  }

  /** Loads every declared layer's art and draws the whole map. */
  async prepare(): Promise<void> {
    await Promise.all(this.declare(false));
    if (!this.disposed) this.rebuild();
  }

  /** Adds, replaces or (with `undefined`) withdraws an overlay. Its texture loads here; it draws once loaded. */
  declareOverlay(key: string, declaration: GroundOverlayDeclaration | undefined): void {
    if (this.disposed || this.overlays.get(key)?.declaration === declaration) return;
    this.withdrawOverlay(key);
    if (!declaration) return;
    const overlay: Overlay = { declaration, blend: { value: new THREE.Vector3() }, materials: new Map(), visible: false };
    this.overlays.set(key, overlay);
    const cover = watchSignal(declaration.cover, stop => { overlay.stop = stop; });
    createEffect(() => {
      const value = cover.get();
      groundOverlayBlend(value, overlay.blend.value);
      overlay.visible = value > 0;
      for (const chunk of this.chunks) for (const mesh of chunk.overlays.get(key) ?? []) mesh.visible = overlay.visible;
    });
    void loadGroundTexture(this.assetBaseUrl, declaration.texture, true).then(texture => {
      if (this.overlays.get(key) !== overlay) { texture.dispose(); return; }
      // ground_overlay.ksh uses RGB as three masks, not as visible colours.
      texture.colorSpace = THREE.NoColorSpace;
      overlay.texture = texture;
      for (const chunk of this.chunks) this.buildOverlay(chunk, key, overlay, this.terrain.landOverlayQuads(chunk));
    }).catch((error: unknown) => {
      if (this.overlays.get(key) === overlay) console.error(`Unable to load ground overlay ${declaration.texture}`, error);
    });
  }

  private withdrawOverlay(key: string): void {
    const overlay = this.overlays.get(key);
    if (!overlay) return;
    this.overlays.delete(key);
    overlay.stop?.();
    for (const chunk of this.chunks) { releaseMeshes(chunk.overlays.get(key) ?? []); chunk.overlays.delete(key); }
    for (const material of overlay.materials.values()) material.dispose();
    overlay.texture?.dispose();
  }

  /** Starts loading the art of newly declared layers; `redraw` draws each one when it arrives. */
  private declare(redraw: boolean): Promise<void>[] {
    const pending: Promise<void>[] = [];
    for (const declaration of this.terrain.groundLayers()) {
      let layer = this.layers.get(declaration.tileId);
      if (!layer) this.layers.set(declaration.tileId, layer = { declaration });
      if (layer.assets) continue;
      layer.loading ??= loadGroundTileAssets(this.assetBaseUrl, declaration.art).then(assets => {
        if (this.disposed) { assets.material.dispose(); return; }
        layer.assets = assets;
        // A layer joining later draws wherever its tiles already are.
        if (redraw) this.rebuild();
      }).finally(() => { layer.loading = undefined; });
      pending.push(layer.loading);
    }
    return pending;
  }

  private rebuild(bounds?: GroundCellBounds): void {
    if (this.disposed) return;
    for (const chunk of this.chunks) {
      if (bounds && (chunk.maxCol <= bounds.minCol || chunk.minCol >= bounds.maxCol
        || chunk.maxRow <= bounds.minRow || chunk.minRow >= bounds.maxRow)) continue;
      this.build(chunk);
    }
  }

  private build(chunk: Chunk): void {
    releaseMeshes(chunk.meshes);
    for (const [tileId, layerQuads] of this.terrain.groundLayerQuads(chunk)) {
      const layer = this.layers.get(tileId);
      if (!layer?.assets || !layerQuads.length) continue;
      const mesh = this.mesh(layerQuads, layer.assets, layer.assets.material, `TurfBlend:${layer.declaration.art.name}`, layer.declaration.renderOrder);
      chunk.meshes.push(mesh);
    }
    let coverage: ReadonlyMap<number, readonly GroundTileQuad[]> | undefined;
    for (const [key, overlay] of this.overlays) {
      if (overlay.texture) this.buildOverlay(chunk, key, overlay, coverage ??= this.terrain.landOverlayQuads(chunk));
    }
  }

  /** ground_overlay.ksh samples each layer's atlas alpha, coastal skirts included, with world-space noise UVs. */
  private buildOverlay(chunk: Chunk, key: string, overlay: Overlay, coverage: ReadonlyMap<number, readonly GroundTileQuad[]>): void {
    const meshes = chunk.overlays.get(key) ?? [];
    chunk.overlays.set(key, meshes);
    releaseMeshes(meshes);
    const ordered = [...this.layers.values()].sort((a, b) => a.declaration.renderOrder - b.declaration.renderOrder);
    ordered.forEach(({ declaration, assets }, rank) => {
      const quads = coverage.get(declaration.tileId);
      if (!assets || !quads?.length) return;
      let material = overlay.materials.get(declaration.tileId);
      if (!material) overlay.materials.set(declaration.tileId, material = groundOverlayMaterial(overlay.texture!, overlay.blend, assets.atlas));
      const mesh = this.mesh(quads, assets, material, `GroundOverlay:${key}`, overlay.declaration.renderOrder + rank * OVERLAY_LAYER_STEP);
      mesh.receiveShadow = false;
      mesh.visible = overlay.visible;
      meshes.push(mesh);
    });
  }

  private mesh(quads: readonly GroundTileQuad[], assets: GroundTileAssets, material: THREE.Material, name: string, renderOrder: number): THREE.Mesh {
    const mesh = new THREE.Mesh(groundTileGeometry(quads, assets, this.terrain.size, this.terrain.tileSize), material);
    mesh.name = name;
    mesh.renderOrder = renderOrder;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    return mesh;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const key of [...this.overlays.keys()]) this.withdrawOverlay(key);
    this.disposed = true;
    this.stopTerrain();
    this.root.removeFromParent();
    for (const chunk of this.chunks) releaseMeshes(chunk.meshes);
    for (const { assets } of this.layers.values()) assets?.material.dispose();
    this.layers.clear();
  }
}
