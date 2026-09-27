import * as THREE from 'three';
import { parseKtex } from '@three-roaming/animation/parseKtex';
import { TILE_SIZE } from './tile';

export interface TurfGroundOptions {
    /** Mirrored DST data root, e.g. `${import.meta.env.BASE_URL}dst/data`. */
    assetBaseUrl: string;
    /**
     * Ground noise texture under `levels/textures`, e.g. `Ground_noise_deciduous`.
     * `shaders/ground.ksh` tiles it over world space and multiplies it onto the
     * seam texture, so it carries the turf's own colour.
     */
    noiseTexture: string;
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
    const path = `${root}/levels/textures/${options.noiseTexture}.tex`;
    const tex = await fetchBytes(path);
    const decoded = parseKtex(new Uint8Array(tex), `${options.noiseTexture}.tex`);

    const texture = new THREE.DataTexture(decoded.pixels, decoded.width, decoded.height, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;

    const size = options.size ?? 1000;
    const tileSize = options.tileSize ?? TILE_SIZE * TILES_PER_NOISE_TEXTURE;
    texture.repeat.set(size / tileSize, size / tileSize);
    texture.needsUpdate = true;

    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide }),
    );
    ground.name = 'TurfGround';
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    return ground;
}
