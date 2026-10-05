import * as THREE from 'three';
import { parseKtex } from '@dontstarve-web/animation/parseKtex';
import { TILE_SIZE } from './tile';
import { loadGroundTileAssets, type GroundTileName } from './groundTiles';

export interface TurfGroundOptions {
    /** Mirrored DST data root, e.g. `${import.meta.env.BASE_URL}dst/data`. */
    assetBaseUrl: string;
    /**
     * Ground noise texture under `levels/textures`, e.g. `Ground_noise_deciduous`.
     * `shaders/ground.ksh` tiles it over world space and multiplies it onto the
     * seam texture, so it carries the turf's own colour.
     */
    noiseTexture: string;
    /** Apply the source full-tile atlas colour, matching adjoining edge masks. */
    tileAtlas?: GroundTileName;
    /** Ground edge length in world units. */
    size?: number;
    /** World units covered by one texture tile; defaults to eight map tiles. */
    tileSize?: number;
}

async function fetchBytes(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load ${url}: HTTP ${response.status}`);
    return response.arrayBuffer();
}

/**
 * `levels/tiles/<name>.tex` packs one tile variant into 128px of its 1024px
 * atlas, and the ground noise texture is 1024px too, so one noise tile spans
 * eight map tiles.
 */
const TILES_PER_NOISE_TEXTURE = 8;

/**
 * Fills the ground with a DST turf, e.g. the deciduous forest floor. The turf
 * colour lives in the ground noise texture; `levels/tiles/<name>.tex` next to it
 * only holds the seam pieces the terrain shader blends between tile types.
 */
export async function createTurfGround(options: TurfGroundOptions): Promise<THREE.Mesh> {
    const root = options.assetBaseUrl.replace(/\/$/, '');
    const tileAssets = options.tileAtlas ? await loadGroundTileAssets(root, options.tileAtlas) : undefined;
    let texture: THREE.Texture;
    if (tileAssets) {
        texture = tileAssets.material.map!;
    } else {
        const path = `${root}/levels/textures/${options.noiseTexture}.tex`;
        const tex = await fetchBytes(path);
        const decoded = parseKtex(new Uint8Array(tex), `${options.noiseTexture}.tex`);
        texture = new THREE.DataTexture(decoded.pixels, decoded.width, decoded.height, THREE.RGBAFormat);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.generateMipmaps = true;
    }

    const size = options.size ?? 1000;
    const tileSize = options.tileSize ?? TILE_SIZE * TILES_PER_NOISE_TEXTURE;
    texture.repeat.set(size / tileSize, size / tileSize);
    texture.needsUpdate = true;

    const geometry = new THREE.PlaneGeometry(size, size);
    let material: THREE.MeshLambertMaterial;
    if (tileAssets) {
        material = tileAssets.material;
        material.transparent = false;
        texture.offset.set(-size / 2 / tileSize, -size / 2 / tileSize);
        const cell = tileAssets.elements.get('01')!;
        geometry.setAttribute('groundTileUv', new THREE.Float32BufferAttribute([
            cell.u1, 1 - cell.v2, cell.u2, 1 - cell.v2,
            cell.u1, 1 - cell.v1, cell.u2, 1 - cell.v1,
        ], 2));
    } else {
        material = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide, depthWrite: false });
    }

    const ground = new THREE.Mesh(
        geometry,
        // DST billboard artwork can extend below its ground-contact origin.
        // Paint the terrain first without clipping those pixels with its depth.
        material,
    );
    ground.name = 'TurfGround';
    ground.renderOrder = -2;
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    return ground;
}
