import * as THREE from 'three';
import { parseKtex } from '@dontstarve-web/animation/parseKtex';
import type { DstLightPhase, DstSeason } from './lightingPhase';

const LUT_PATHS: Record<DstSeason, Record<DstLightPhase, string>> = {
  autumn: {
    day: 'day05_cc.tex',
    dusk: 'dusk03_cc.tex',
    night: 'night03_cc.tex',
    full_moon: 'purple_moon_cc.tex',
  },
  winter: {
    day: 'snow_cc.tex',
    dusk: 'snowdusk_cc.tex',
    night: 'night04_cc.tex',
    full_moon: 'purple_moon_cc.tex',
  },
  spring: {
    day: 'spring_day_cc.tex',
    dusk: 'spring_dusk_cc.tex',
    // DST deliberately uses its dusk cube for spring nights.
    night: 'spring_dusk_cc.tex',
    full_moon: 'purple_moon_cc.tex',
  },
  summer: {
    day: 'summer_day_cc.tex',
    dusk: 'summer_dusk_cc.tex',
    night: 'summer_night_cc.tex',
    full_moon: 'purple_moon_cc.tex',
  },
};

// components/colourcube.lua: insanity uses the night cube during full moons.
const INSANITY_LUT_PATHS: Record<DstLightPhase, string> = {
  day: 'insane_day_cc.tex',
  dusk: 'insane_dusk_cc.tex',
  night: 'insane_night_cc.tex',
  full_moon: 'insane_night_cc.tex',
};

// playervision.lua GHOSTVISION_COLOURCUBES uses one cube for every phase.
const GHOST_LUT_PATH = 'ghost_cc.tex';

async function loadLut(root: string, path: string): Promise<THREE.DataTexture> {
  const url = `${root.replace(/\/$/, '')}/${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load DST colour cube ${url}: HTTP ${response.status}`);
  }
  const decoded = parseKtex(new Uint8Array(await response.arrayBuffer()), path);
  if (decoded.width !== decoded.height * decoded.height) {
    throw new Error(`${path}: expected a horizontally packed square colour cube`);
  }

  const texture = new THREE.DataTexture(decoded.pixels, decoded.width, decoded.height, THREE.RGBAFormat);
  // LUT values are converted explicitly by the post-process shader.
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** Every colour cube the world's lighting can blend to, loaded once and released by its owner. */
export class ColourCubeAssets {
  /** Loads the season, insanity and ghost cubes from `root` (images/colour_cubes). */
  static async load(root: string): Promise<ColourCubeAssets> {
    const paths = [
      ...new Set([
        ...Object.values(LUT_PATHS).flatMap(phases => Object.values(phases)),
        ...Object.values(INSANITY_LUT_PATHS),
        GHOST_LUT_PATH,
      ]),
    ];
    const loaded = await Promise.all(paths.map(async path => [path, await loadLut(root, path)] as const));
    return new ColourCubeAssets(new Map(loaded));
  }

  private readonly textures: ReadonlyMap<string, THREE.DataTexture>;
  /** The edge length every cube shares. */
  readonly size: number;

  private constructor(textures: ReadonlyMap<string, THREE.DataTexture>) {
    this.textures = textures;
    const sizes = new Set([...textures.values()].map(texture => texture.image.height));
    if (sizes.size !== 1) {
      throw new Error('DST colour cubes must share one dimension');
    }
    this.size = [...sizes][0];
  }

  /** The ambient cube for the season and phase, or playervision's ghost cube. */
  cube(season: DstSeason, phase: DstLightPhase, ghost: boolean): THREE.DataTexture {
    return this.require(ghost ? GHOST_LUT_PATH : LUT_PATHS[season][phase]);
  }

  insanityCube(phase: DstLightPhase): THREE.DataTexture {
    return this.require(INSANITY_LUT_PATHS[phase]);
  }

  private require(path: string): THREE.DataTexture {
    const texture = this.textures.get(path);
    if (!texture) {
      throw new Error(`DST colour cube was not loaded: ${path}`);
    }
    return texture;
  }

  dispose(): void {
    for (const texture of this.textures.values()) {
      texture.dispose();
    }
  }
}
