import * as THREE from 'three';
import { loadKtexDataTexture } from '@dontstarve-web/animation/textureLoader';
import { prewarmTextures, yieldLoadingFrame } from '@dontstarve-web/animation/prewarmScene';
import { parseImageAtlasXml, type ImageAtlasElement } from '@dontstarve-web/animation/imageAtlas';

/** The art a ground render layer names (MapLayerManager:CreateRenderLayer): tile atlas, its XML and noise. */
export interface GroundTileArt {
  readonly name: string;
  readonly texture: string;
  readonly atlas: string;
  readonly noise: string;
}

export interface GroundTileAssets {
  readonly material: THREE.MeshLambertMaterial;
  readonly elements: ReadonlyMap<string, ImageAtlasElement>;
  readonly atlas: THREE.Texture;
}

export interface GroundTileQuad {
  col: number;
  row: number;
  variant: number;
}

export async function fetchGroundAsset(root: string, path: string): Promise<Response> {
  const response = await fetch(`${root.replace(/\/$/, '')}/${path}`);
  if (!response.ok) {
    throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  }
  return response;
}

/** A ground or weather texture; its pixels leave the CPU once uploaded (`loadKtexDataTexture`). */
export async function loadGroundTexture(root: string, path: string, repeat: boolean): Promise<THREE.DataTexture> {
  const result = await loadKtexDataTexture(`${root.replace(/\/$/, '')}/${path}`, repeat ? 'repeat' : 'clamp');
  result.name = path;
  result.colorSpace = THREE.SRGBColorSpace;
  result.flipY = false;
  result.wrapS = result.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  result.magFilter = THREE.LinearFilter;
  // Tile atlas XML excludes the gutter. Avoid mip bleeding into adjacent masks.
  result.minFilter = repeat ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  result.generateMipmaps = repeat;
  return result;
}

/** Decode only the next few ground textures, starting more once their CPU pixels have been uploaded. */
export function createGroundTextureLoader(
  renderer: THREE.WebGLRenderer,
  active: () => boolean,
): typeof loadGroundTexture {
  type Request = {
    load(): Promise<THREE.DataTexture>;
    resolve(texture: THREE.DataTexture): void;
    reject(error: unknown): void;
  };
  const pending: Request[] = [];
  let running = false;
  const canUpload = () => active() && !renderer.getContext().isContextLost();
  const drain = async () => {
    while (pending.length) {
      const batch = pending.splice(0, 4);
      const results = await Promise.allSettled(batch.map(request => request.load()));
      const textures = results.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []));
      let uploadError: unknown;
      if (canUpload()) {
        try {
          await prewarmTextures(renderer, textures);
        } catch (error) {
          if (canUpload()) {
            uploadError = error;
          }
        }
      }
      for (const [index, result] of results.entries()) {
        const request = batch[index];
        if (result.status === 'rejected') {
          request.reject(result.reason);
        } else if (uploadError !== undefined) {
          result.value.dispose();
          request.reject(uploadError);
        } else {
          request.resolve(result.value);
        }
      }
      if (pending.length && active()) {
        await yieldLoadingFrame();
      }
    }
    running = false;
  };
  return (root, path, repeat) =>
    new Promise((resolve, reject) => {
      pending.push({ load: () => loadGroundTexture(root, path, repeat), resolve, reject });
      if (!running) {
        running = true;
        queueMicrotask(() => void drain());
      }
    });
}

/** How a ground render layer combines its atlas with its noise. */
export type GroundTileShading = 'ground' | 'creep';

const ATLAS_SHADING: Readonly<Record<GroundTileShading, string>> = {
  // ground.ksh: atlas RGBA multiplied by world-space noise and then lighting.
  ground: 'diffuseColor *= texture2D(dstGroundTileAtlas, vGroundTileUv);',
  // creep.ksh: the noise colour, faded in by the atlas alpha times 16, at the atlas alpha; bare texels are discarded.
  creep: `
      float dstCreepAlpha = texture2D(dstGroundTileAtlas, vGroundTileUv).a;
      if (dstCreepAlpha <= 0.0) discard;
      diffuseColor.rgb *= clamp(dstCreepAlpha * 16.0, 0.0, 1.0);
      diffuseColor.a = dstCreepAlpha;`,
};

/** A ground render layer: its atlas and world-space noise, shaded as `shading` names, then lit. */
export async function loadGroundTileAssets(
  root: string,
  art: GroundTileArt,
  loadTexture = loadGroundTexture,
  shading: GroundTileShading = 'ground',
): Promise<GroundTileAssets> {
  const [noise, atlas, xml] = await Promise.all([
    loadTexture(root, art.noise, true),
    loadTexture(root, art.texture, false),
    fetchGroundAsset(root, art.atlas).then(response => response.text()),
  ]);
  const elements = parseImageAtlasXml(xml, art.atlas).elements;
  const material = new THREE.MeshLambertMaterial({
    name: `DST ground:${art.name}`,
    map: noise,
    side: THREE.DoubleSide,
    depthWrite: false,
    transparent: true,
    alphaTest: shading === 'ground' ? 0.105 : 0,
  });
  material.forceSinglePass = true;
  if (shading === 'creep') {
    // creep.ksh writes the full noise colour wherever the atlas alpha exceeds 1/16 and is blended premultiplied
    // (ONE, ONE_MINUS_SRC_ALPHA): the web strands add at full brightness over the ground, which keeps 1 - alpha.
    // Straight alpha blending would scale them by web.tex's low alpha (at most 168/255) and leave them faint.
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
  }
  // Wins depth ties against the coplanar falloff top edge; the falloff prepass still occludes ground behind a cliff.
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  // This atlas is injected by onBeforeCompile rather than a built-in material map.
  material.userData.prewarmTextures = [atlas];
  material.onBeforeCompile = shader => {
    shader.uniforms.dstGroundTileAtlas = { value: atlas };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `
      #include <common>
      attribute vec2 groundTileUv;
      varying vec2 vGroundTileUv;
    `,
      )
      .replace(
        '#include <uv_vertex>',
        `
      #include <uv_vertex>
      vGroundTileUv = groundTileUv;
    `,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `
      #include <common>
      uniform sampler2D dstGroundTileAtlas;
      varying vec2 vGroundTileUv;
    `,
      )
      .replace(
        '#include <map_fragment>',
        `
      #include <map_fragment>
      ${ATLAS_SHADING[shading]}
    `,
      );
  };
  material.customProgramCacheKey = () =>
    shading === 'ground' ? 'dst-ground-atlas-noise-v1' : 'dst-creep-atlas-noise-v1';
  material.addEventListener('dispose', () => {
    noise.dispose();
    atlas.dispose();
  });
  return { material, elements, atlas };
}

/** Quads of one terrain layer. UVs come from the real XML, noise from world XZ (eight tiles per noise repeat). */
export function groundTileGeometry(
  quads: readonly GroundTileQuad[],
  assets: GroundTileAssets,
  size: number,
  tileSize: number,
): THREE.BufferGeometry {
  const positions = new Float32Array(quads.length * 12),
    normals = new Float32Array(quads.length * 12);
  const noiseUvs = new Float32Array(quads.length * 8),
    tileUvs = new Float32Array(quads.length * 8);
  const indices = quads.length * 4 > 65536 ? new Uint32Array(quads.length * 6) : new Uint16Array(quads.length * 6);
  const cells = Array.from({ length: 49 }, (_, variant) => assets.elements.get(String(variant).padStart(2, '0')));
  let vertices = 0,
    indexCount = 0;
  const half = size / 2;
  for (const { col, row, variant } of quads) {
    const cell = cells[variant];
    if (!cell) {
      throw new Error(`Ground tile variant ${variant} is unavailable`);
    }
    const originX = col * tileSize,
      originZ = row * tileSize;
    const x0 = Math.max(-half, originX),
      x1 = Math.min(half, originX + tileSize);
    const z0 = Math.max(-half, originZ),
      z1 = Math.min(half, originZ + tileSize);
    if (x1 <= x0 || z1 <= z0) {
      continue;
    }
    const offset = vertices;
    for (let corner = 0; corner < 4; corner++, vertices++) {
      const x = corner < 2 ? x0 : x1,
        z = corner % 2 === 0 ? z0 : z1;
      const p = vertices * 3,
        uv = vertices * 2;
      positions[p] = x;
      positions[p + 2] = z;
      // Every ground quad is horizontal with the same upward winding.
      normals[p + 1] = 1;
      noiseUvs[uv] = x / (tileSize * 8);
      noiseUvs[uv + 1] = -z / (tileSize * 8);
      // parseKtex's rows are top-down; invert XML's bottom-up V coordinates.
      tileUvs[uv] = THREE.MathUtils.lerp(cell.u1, cell.u2, (x - originX) / tileSize);
      tileUvs[uv + 1] = THREE.MathUtils.lerp(1 - cell.v2, 1 - cell.v1, (z - originZ) / tileSize);
    }
    indices[indexCount++] = offset;
    indices[indexCount++] = offset + 1;
    indices[indexCount++] = offset + 2;
    indices[indexCount++] = offset + 2;
    indices[indexCount++] = offset + 1;
    indices[indexCount++] = offset + 3;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, vertices * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals.subarray(0, vertices * 3), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(noiseUvs.subarray(0, vertices * 2), 2));
  geometry.setAttribute('groundTileUv', new THREE.BufferAttribute(tileUvs.subarray(0, vertices * 2), 2));
  geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, indexCount), 1));
  if (vertices) {
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return geometry;
}

/** ground_overlay.ksh: the overlay texture's RGB are three cover masks, blended by `blend` (one channel per cover step).
 * The overlay follows the terrain layer atlas's mask alpha, coastal skirts included.
 * Materials share the overlay texture and the caller's `blend` uniform; disposing one releases neither.
 */
export function groundOverlayMaterial(
  texture: THREE.Texture,
  blend: { value: THREE.Vector3 },
  atlas: THREE.Texture,
): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    map: texture,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.forceSinglePass = true;
  material.userData.prewarmTextures = [atlas];
  material.onBeforeCompile = shader => {
    shader.uniforms.dstSnowBlend = blend;
    shader.uniforms.dstSnowGroundAtlas = { value: atlas };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `
      #include <common>
      attribute vec2 groundTileUv;
      varying vec2 vSnowGroundTileUv;
    `,
      )
      .replace(
        '#include <uv_vertex>',
        `
      #include <uv_vertex>
      vSnowGroundTileUv = groundTileUv;
    `,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `
      #include <common>
      uniform vec3 dstSnowBlend;
      uniform sampler2D dstSnowGroundAtlas; varying vec2 vSnowGroundTileUv;
    `,
      )
      .replace(
        '#include <map_fragment>',
        `
      float terrainAlpha = texture2D(dstSnowGroundAtlas, vSnowGroundTileUv).a;
      if (terrainAlpha < 0.105) discard;
      vec3 snowLayers = texture2D(map, vMapUv).rgb * dstSnowBlend;
      float firstAlpha = snowLayers.b;
      float secondaryAlpha = (1.0 - firstAlpha) * snowLayers.g;
      float thirdAlpha = (1.0 - firstAlpha - secondaryAlpha) * snowLayers.r;
      diffuseColor.a *= (firstAlpha + secondaryAlpha + thirdAlpha) * terrainAlpha;
    `,
      );
  };
  material.customProgramCacheKey = () => 'dst-snow-ground-overlay-atlas-v1';
  return material;
}

/** weather.lua cover (0..3) as ground_overlay.ksh's per-mask blend. */
export function groundOverlayBlend(cover: number, target: THREE.Vector3): THREE.Vector3 {
  return target.set(
    THREE.MathUtils.clamp(cover, 0, 1),
    THREE.MathUtils.clamp(cover - 1, 0, 1),
    THREE.MathUtils.clamp(cover - 2, 0, 1),
  );
}
