import * as THREE from 'three';
import type { Animation, ResolvedSprite } from './animationAssets';
import { spritePerf } from './spritePerf';
import {
  createResolvedRgbaSpriteAtlasComposer,
  type RgbaSpriteAtlasComposer,
  type RgbaSpriteAtlas,
  type RgbaSpriteAtlasFrame,
} from './rgbaSpriteAtlas';
import { registerSceneRenderPass, type SceneRenderPass } from './sceneRenderPass';
import { watchWorldMatrixChanges } from './matrixUpdates';
import { DEPTH_OFFSET_UNITS } from './animationAssets';
import { spriteRenderDepthGroup, spriteRenderLateral, spriteRenderOrderKey } from './renderOrder';

/**
 * `DEPTH_OFFSET_UNITS` depth-buffer steps of a 24-bit buffer, in clip-space depth (a step is 2^-24 of the [0, 1]
 * window range, 2^-23 of NDC): past float rounding between coplanar billboards, far below any real gap.
 */
const DEPTH_RANK_STEP = -DEPTH_OFFSET_UNITS * 2 ** -23;
import { compileSceneAsync } from './compileScene';
import {
  injectOceanShading,
  NO_OCEAN_SHADING,
  oceanShadingInstanceValues,
  type SpriteOceanShading,
} from './oceanShading';

interface Appearance {
  animation: Animation;
  frames: ResolvedSprite[][];
  resolve: (frameIndex: number) => ResolvedSprite[];
  composer?: RgbaSpriteAtlasComposer;
  pages?: RgbaSpriteAtlas[];
  locations?: { atlas: RgbaSpriteAtlas; frame: RgbaSpriteAtlasFrame }[];
}
/** One entity's retained instance. The pass draws it only while the display layer lists it as a member. */
export interface InstancedSprite {
  readonly pass: InstancedArchiveSprites;
  show(key: string, animation: Animation, resolve: () => (frameIndex: number) => ResolvedSprite[], frame: number): void;
  hide(): void;
  setOpacity(value: number): void;
  setColour(value: readonly [number, number, number]): void;
  /** AnimState:SetErosionParams's amount, independent for each entity in a shared batch. */
  setErosion(value: number): void;
  /** AnimState:SetFloatParams and SetOceanBlendParams, independent for each entity in a shared batch. */
  setOceanShading(value: SpriteOceanShading): void;
  /**
   * Drawn towards the camera after the ordinary batches, as an effect drawn after its owner on the owner's plane
   * (fire.lua's SetFinalOffset): the depth its owner's batch wrote must not hide it.
   */
  setDepthOffset(enabled: boolean): void;
  dispose(): void;
}
/** A drawn sprite as the display layer lists it: its instance and its entity's AnimState light override. */
export interface InstancedSpriteMember {
  readonly sprite: InstancedSprite | undefined;
  readonly lightOverride: number;
}
interface Entry extends InstancedSprite {
  model: THREE.Object3D;
  foot: THREE.Object3D;
  visual: THREE.Group;
  colour: THREE.Color;
  opacity: number;
  erosion: number;
  ocean: SpriteOceanShading;
  depthOffset: boolean;
  styleVersion: number;
  transformVersion: number;
  appearance?: Appearance;
  /** The last appearance with a composed atlas, drawn while a newly shown one is still being composed. */
  ready?: Appearance;
  frame: number;
  disposed: boolean;
  draw?: DrawEntry;
  spatial?: {
    frame: RgbaSpriteAtlasFrame;
    transformVersion: number;
    sphere: THREE.Sphere;
    camera: number;
    visible: boolean;
    version: number;
  };
}
interface DrawEntry {
  entry: Entry;
  member: InstancedSpriteMember;
  frame: RgbaSpriteAtlasFrame;
  page: DrawPage;
  /** The foot's world position, which `spriteRenderOrderKey` reads. */
  x: number;
  y: number;
  z: number;
  /** `spriteRenderOrderKey` of the foot. */
  key: number;
  /** `spriteRenderLateral` of the foot. */
  lateral: number;
  /** Clip-space depth towards the camera, resolving coplanar overlaps in draw order (see `rank`). */
  bias: number;
  camera: number;
}
/** One atlas page, drawn as is or towards the camera after the ordinary batches: each is its own batch. */
interface PageKey {
  readonly atlas: RgbaSpriteAtlas;
  readonly offset: boolean;
}
interface DrawPage {
  source: THREE.MeshBasicMaterial;
  members: DrawEntry[];
  entries: DrawEntry[];
  count: number;
  sortDirty: boolean;
}
interface InstanceState {
  id: number;
  transformVersion: number;
  styleVersion: number;
  frame?: RgbaSpriteAtlasFrame;
  r: number;
  g: number;
  b: number;
  opacity: number;
  light: number;
  erosion: number;
  bias: number;
  ocean?: SpriteOceanShading;
}
/** A page batch's quad and its per-instance sprite attributes. */
type BatchAttributes = {
  position: THREE.BufferAttribute;
  uv: THREE.BufferAttribute;
  spriteUv: THREE.InstancedBufferAttribute;
  spriteOpacity: THREE.InstancedBufferAttribute;
  spriteLightOverride: THREE.InstancedBufferAttribute;
  spriteErosion: THREE.InstancedBufferAttribute;
  /** DrawEntry.bias. */
  spriteDepthBias: THREE.InstancedBufferAttribute;
  /** FLOAT_PARAMS in xyz, the ocean blend in w. */
  spriteOcean: THREE.InstancedBufferAttribute;
  /** The entity's world xz, which the float bob's phase follows (MatrixW's translation). */
  spriteOceanOrigin: THREE.InstancedBufferAttribute;
};
type BatchMesh = THREE.InstancedMesh<THREE.BufferGeometry<BatchAttributes>, THREE.MeshBasicMaterial>;
interface PageBatch {
  key: PageKey;
  geometry: THREE.BufferGeometry<BatchAttributes>;
  colour: BatchMesh;
  depth: BatchMesh;
  capacity: number;
  attributes: InstanceAttributes;
  transforms: InstanceState[];
}
interface SceneBatches {
  group: THREE.Group;
  pages: Map<PageKey, PageBatch>;
  spare: PageBatch[];
  stopPass: () => void;
}

/** Track actual Float32 changes, preserving any ranges not yet consumed by WebGL. */
class InstanceAttributes {
  private readonly changed = new Map<THREE.BufferAttribute, { start: number; end: number }>();

  begin(): void {
    for (const range of this.changed.values()) {
      range.start = Infinity;
      range.end = 0;
    }
  }

  write(attribute: THREE.BufferAttribute, index: number, values: ArrayLike<number>): void {
    const offset = index * attribute.itemSize;
    let start = Infinity,
      end = 0;
    for (let i = 0; i < attribute.itemSize; i++) {
      const value = Math.fround(values[i]);
      if (attribute.array[offset + i] === value) {
        continue;
      }
      attribute.array[offset + i] = value;
      start = Math.min(start, offset + i);
      end = offset + i + 1;
    }
    if (start === Infinity) {
      return;
    }
    let range = this.changed.get(attribute);
    if (!range) {
      this.changed.set(attribute, (range = { start, end }));
    } else {
      range.start = Math.min(range.start, start);
      range.end = Math.max(range.end, end);
    }
  }

  flush(): void {
    for (const [attribute, range] of this.changed) {
      if (range.start === Infinity) {
        continue;
      }
      let start = range.start,
        end = range.end;
      for (const pending of attribute.updateRanges) {
        start = Math.min(start, pending.start);
        end = Math.max(end, pending.start + pending.count);
      }
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(start, end - start);
      attribute.needsUpdate = true;
    }
  }
}

function material(atlas: RgbaSpriteAtlas, source: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
  const result = new THREE.MeshBasicMaterial({
    map: atlas.texture,
    color: source.color,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    alphaTest: 0.01,
    toneMapped: false,
  });
  result.name = 'Instanced archive sprite colour';
  result.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `
      #include <common>
      attribute vec4 spriteUv;
      attribute float spriteOpacity;
      varying float vSpriteOpacity;
      attribute float spriteLightOverride;
      varying float vSpriteLightOverride;
      attribute float spriteErosion;
      varying float vSpriteErosion;
      attribute float spriteDepthBias;
    `,
      )
      .replace(
        '#include <project_vertex>',
        `
      #include <project_vertex>
      gl_Position.z -= spriteDepthBias * gl_Position.w;
    `,
      )
      .replace(
        '#include <uv_vertex>',
        `
      #include <uv_vertex>
      vMapUv = mix(spriteUv.xy, spriteUv.zw, uv);
      vSpriteOpacity = spriteOpacity;
      vSpriteLightOverride = spriteLightOverride;
      vSpriteErosion = spriteErosion;
    `,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `
      #include <common>
      varying float vSpriteOpacity;
      varying float vSpriteLightOverride;
      varying float vSpriteErosion;
    `,
      )
      .replace(
        '#include <color_fragment>',
        `
      #include <color_fragment>
      diffuseColor.a *= vSpriteOpacity;
      if (vSpriteErosion > 0.0) {
        float erosionNoise = fract(sin(dot(vMapUv * 1024.0, vec2(12.9898, 78.233))) * 43758.5453);
        if (erosionNoise < vSpriteErosion) discard;
      }
    `,
      );
    injectOceanShading(shader, { kind: 'attributes' });
  };
  result.customProgramCacheKey = () => 'dst-instanced-archive-sprite-v5';
  return result;
}

/** Render-only batching. Entity nodes, source geometry and alpha picking remain independently owned. */
/** Main-thread time per rendered frame spent composing atlases for appearances shown for the first time. */
const COMPOSE_BUDGET_MS = 4;

export class InstancedArchiveSprites implements SceneRenderPass {
  /** Appearances whose atlas is not composed yet, in first-use order. */
  private readonly composing = new Set<Appearance>();
  private readonly appearances = new Map<string, Appearance>();
  /** Every retained instance, for atlas invalidation, prewarming and disposal; drawing walks the display's members. */
  private readonly retained = new Set<Entry>();
  private members: ReadonlySet<InstancedSpriteMember> = new Set();
  private readonly scenes = new Map<THREE.Scene, SceneBatches>();
  private readonly draws = new Map<THREE.Scene, Map<PageKey, DrawPage>>();
  /** Scratch for `rank`. */
  private readonly ranked: DrawEntry[] = [];
  private readonly pageKeys = new WeakMap<RgbaSpriteAtlas, readonly [PageKey, PageKey]>();
  private readonly matrix = new THREE.Matrix4();
  private readonly frameMatrix = new THREE.Matrix4();
  private readonly frustumMatrix = new THREE.Matrix4();
  private readonly previousFrustumMatrix = new THREE.Matrix4();
  private readonly previousViewMatrix = new THREE.Matrix4();
  private cameraVersion = 0;
  private coordinateSystem?: THREE.Camera['coordinateSystem'];
  private readonly frustum = new THREE.Frustum();
  private readonly attributeValues = new Float32Array(4);
  private readonly oceanValues: number[] = [0, 0, 0, 0];
  private renderer?: THREE.WebGLRenderer;
  private contextLost = false;

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.invalidateAtlases();
  };
  private readonly onContextRestored = (): void => {
    this.contextLost = false;
  };

  private bindRenderer(renderer: THREE.WebGLRenderer): void {
    if (this.renderer === renderer) {
      return;
    }
    if (this.renderer) {
      this.unbindRenderer();
      this.invalidateAtlases();
    }
    this.renderer = renderer;
    this.contextLost = renderer.getContext().isContextLost();
    renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  private unbindRenderer(): void {
    this.renderer?.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer?.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.renderer = undefined;
  }

  /** Only rendering resources are invalidated; entities retain their current clip, frame, tint and component state. */
  private invalidateAtlases(): void {
    for (const batches of this.scenes.values()) {
      for (const batch of [...batches.pages.values(), ...batches.spare]) {
        this.disposeBatch(batch);
      }
      batches.pages.clear();
      batches.spare.length = 0;
    }
    for (const appearance of this.appearances.values()) {
      appearance.composer?.cancel();
      appearance.composer = undefined;
      for (const atlas of appearance.pages ?? []) {
        atlas.texture.dispose();
      }
      appearance.pages = appearance.locations = undefined;
    }
    this.composing.clear();
    this.draws.clear();
    for (const entry of this.retained) {
      entry.ready = undefined;
      if (entry.appearance) {
        this.composing.add(entry.appearance);
      }
    }
  }

  retain(
    model: THREE.Object3D,
    visual: THREE.Group,
    colour: readonly [number, number, number] = [1, 1, 1],
    opacity = 1,
    foot: THREE.Object3D = model,
  ): InstancedSprite {
    const stopPass = registerSceneRenderPass(model, this);
    const entry: Entry = {
      pass: this,
      model,
      foot,
      visual,
      colour: new THREE.Color().setRGB(...colour),
      opacity,
      erosion: 0,
      ocean: NO_OCEAN_SHADING,
      depthOffset: false,
      styleVersion: 0,
      transformVersion: 0,
      frame: 0,
      disposed: false,
      show: (key, animation, resolve, frame) => {
        let appearance = this.appearances.get(key);
        if (!appearance) {
          appearance = { animation, frames: [], resolve: resolve() };
          this.appearances.set(key, appearance);
        }
        if (!appearance.pages) {
          this.composing.add(appearance);
        }
        entry.appearance = appearance;
        entry.frame = frame;
      },
      hide: () => {
        entry.appearance = entry.ready = undefined;
      },
      setOpacity: value => {
        if (entry.opacity !== value) {
          entry.opacity = value;
          entry.styleVersion++;
        }
      },
      setColour: value => {
        if (entry.colour.r !== value[0] || entry.colour.g !== value[1] || entry.colour.b !== value[2]) {
          entry.colour.setRGB(...value);
          entry.styleVersion++;
        }
      },
      setErosion: value => {
        const amount = Math.max(0, Math.min(1, value));
        if (entry.erosion !== amount) {
          entry.erosion = amount;
          entry.styleVersion++;
        }
      },
      setOceanShading: value => {
        if (entry.ocean !== value) {
          entry.ocean = value;
          entry.styleVersion++;
        }
      },
      setDepthOffset: enabled => {
        entry.depthOffset = enabled;
      },
      dispose: () => {
        if (entry.disposed) {
          return;
        }
        // A display may still list it until its art changes; it draws nothing from now on.
        entry.disposed = true;
        entry.appearance = entry.ready = undefined;
        stopPass();
        stopMatrix();
        this.retained.delete(entry);
      },
    };
    const stopMatrix = watchWorldMatrixChanges(visual, () => {
      entry.transformVersion++;
    });
    this.retained.add(entry);
    return entry;
  }

  /** The display layer's list of drawn sprites of this pass; it adds and removes members as their art is drawn and released. */
  bindMembers(members: ReadonlySet<InstancedSpriteMember>): void {
    this.members = members;
  }

  private pageKey(atlas: RgbaSpriteAtlas, offset: boolean): PageKey {
    let keys = this.pageKeys.get(atlas);
    if (!keys) {
      this.pageKeys.set(
        atlas,
        (keys = [
          { atlas, offset: false },
          { atlas, offset: true },
        ]),
      );
    }
    return keys[offset ? 1 : 0];
  }

  /**
   * Orders one scene's drawn sprites by their foot key, an offset sprite after the others on its foot, then the
   * entity's id. Each page draws its sprites in this order. The depth batches write every page's depth before any
   * colour, so overlapping sprites on one camera plane would otherwise be decided by float noise in their depths and
   * flicker as the camera moves: each later one of an overlapping coplanar run is drawn `DEPTH_RANK_STEP` nearer.
   * A run restarts where the next sprite clears the run on screen, so the nudge stays a few depth steps.
   */
  private rank(pages: ReadonlyMap<PageKey, DrawPage>): void {
    const ranked = this.ranked;
    ranked.length = 0;
    for (const page of pages.values()) {
      for (let index = 0; index < page.count; index++) {
        ranked.push(page.members[index]);
      }
      page.entries.length = 0;
    }
    ranked.sort(
      (a, b) =>
        a.key - b.key || Number(a.entry.depthOffset) - Number(b.entry.depthOffset) || a.entry.foot.id - b.entry.foot.id,
    );
    let group = NaN,
      rank = 0,
      right = -Infinity;
    for (const draw of ranked) {
      const radius = draw.entry.spatial!.sphere.radius;
      const depthGroup = spriteRenderDepthGroup(draw.key);
      if (depthGroup !== group || draw.lateral - radius > right) {
        group = depthGroup;
        rank = 0;
        right = -Infinity;
      } else {
        rank++;
      }
      right = Math.max(right, draw.lateral + radius);
      draw.bias = rank * DEPTH_RANK_STEP;
      draw.page.entries.push(draw);
    }
    ranked.length = 0;
  }

  /** An offset batch draws after the ordinary ones, a few depth-buffer steps towards the camera. */
  private static layer(batch: PageBatch): void {
    const { offset } = batch.key;
    batch.colour.renderOrder = offset ? -0.39 : -0.4;
    batch.depth.renderOrder = offset ? -0.395 : -0.41;
    for (const material of [batch.colour.material, batch.depth.material]) {
      if (material.polygonOffset === offset) {
        continue;
      }
      material.polygonOffset = offset;
      material.polygonOffsetFactor = 0;
      material.polygonOffsetUnits = offset ? DEPTH_OFFSET_UNITS : 0;
      material.needsUpdate = true;
    }
  }

  private createBatch(scene: SceneBatches, key: PageKey, source: THREE.MeshBasicMaterial, capacity: number): PageBatch {
    const { atlas } = key;
    const geometry = new THREE.BufferGeometry<BatchAttributes>();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute(
      'spriteUv',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'spriteOpacity',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'spriteLightOverride',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'spriteErosion',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'spriteDepthBias',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'spriteOcean',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'spriteOceanOrigin',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage),
    );
    const colourMaterial = material(atlas, source),
      depthMaterial = colourMaterial.clone();
    depthMaterial.name = 'Instanced archive sprite depth';
    // Material.clone() deliberately omits callbacks.
    depthMaterial.onBeforeCompile = colourMaterial.onBeforeCompile;
    depthMaterial.customProgramCacheKey = colourMaterial.customProgramCacheKey;
    depthMaterial.transparent = false;
    depthMaterial.colorWrite = false;
    depthMaterial.depthWrite = true;
    depthMaterial.alphaTest = 0.98;
    const colour = new THREE.InstancedMesh(geometry, colourMaterial, capacity);
    const depth = new THREE.InstancedMesh(geometry, depthMaterial, capacity);
    for (const mesh of [colour, depth]) {
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorldAutoUpdate = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Only logical entity proxies participate in picking.
      mesh.raycast = () => {};
    }
    colour.name = 'ArchiveSpriteInstances:colour';
    depth.name = 'ArchiveSpriteInstances:depth';
    depth.instanceMatrix = colour.instanceMatrix;
    colour.setColorAt(0, new THREE.Color(1, 1, 1));
    colour.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    scene.group.add(depth, colour);
    const batch: PageBatch = {
      key,
      geometry,
      colour,
      depth,
      capacity,
      attributes: new InstanceAttributes(),
      transforms: [],
    };
    InstancedArchiveSprites.layer(batch);
    return batch;
  }

  private disposeBatch(batch: PageBatch): void {
    batch.colour.removeFromParent();
    batch.depth.removeFromParent();
    batch.colour.dispose();
    batch.depth.dispose();
    batch.geometry.dispose();
    batch.colour.material.dispose();
    batch.depth.material.dispose();
  }

  private recycleBatch(batches: SceneBatches, batch: PageBatch): void {
    batch.colour.count = batch.depth.count = 0;
    // A zero instance count still makes Three traverse and prepare the mesh. Park unused resources off-scene.
    batch.colour.removeFromParent();
    batch.depth.removeFromParent();
    batches.spare.push(batch);
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, _lighting: unknown, scene: THREE.Scene): void {
    spritePerf('render', `${this.members.size} members`, () =>
      this.renderPass(renderer, camera, scene, COMPOSE_BUDGET_MS),
    );
  }

  /** Spread atlas composition over frames: an appearance is drawn once its pages exist, never composed inside the draw loop. */
  private composeAtlases(renderer: THREE.WebGLRenderer, budgetMs: number, phase = 'compose'): void {
    this.bindRenderer(renderer);
    if (this.contextLost) {
      return;
    }
    if (this.composing.size === 0) {
      return;
    }
    const deadline = performance.now() + budgetMs;
    for (const appearance of this.composing) {
      const { animation, frames } = appearance;
      const pages = spritePerf(phase, `${animation.frames.length} frames`, () => {
        appearance.composer ??= createResolvedRgbaSpriteAtlasComposer(
          animation,
          index => (frames[index] ??= spritePerf('resolve', animation.name, () => appearance.resolve(index))),
          Math.min(4096, renderer.capabilities.maxTextureSize),
          renderer,
        );
        return appearance.composer.step(Math.max(0, deadline - performance.now()));
      });
      if (pages) {
        appearance.pages = pages;
        appearance.composer = undefined;
        appearance.locations = [];
        for (const atlas of pages) {
          for (const frame of atlas.frames) {
            appearance.locations[frame.frameIndex] = { atlas, frame };
          }
        }
        this.composing.delete(appearance);
      }
      if (performance.now() >= deadline) {
        break;
      }
    }
  }

  /** Composes every pending appearance now, for callers that need the next draw to be complete. */
  flush(renderer: THREE.WebGLRenderer): void {
    this.composeAtlases(renderer, Infinity, 'compose:flush');
  }

  /** The world has one scene: every entity is drawn into the batches of the scene being rendered. */
  private renderPass(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    scene: THREE.Scene,
    composeBudgetMs: number,
    composePhase?: string,
  ): void {
    this.composeAtlases(renderer, composeBudgetMs, composePhase);
    if (this.contextLost) {
      return;
    }
    this.frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (
      this.coordinateSystem !== camera.coordinateSystem ||
      !this.frustumMatrix.equals(this.previousFrustumMatrix) ||
      !camera.matrixWorldInverse.equals(this.previousViewMatrix)
    ) {
      this.previousFrustumMatrix.copy(this.frustumMatrix);
      this.coordinateSystem = camera.coordinateSystem;
      this.previousViewMatrix.copy(camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.frustumMatrix, camera.coordinateSystem);
      this.cameraVersion++;
    }
    const draws = this.draws;
    for (const pages of draws.values()) {
      for (const page of pages.values()) {
        page.count = 0;
        page.sortDirty = false;
      }
    }
    for (const member of this.members) {
      const entry = member.sprite as Entry | undefined;
      if (!entry || entry.disposed) {
        continue;
      }
      if (entry.appearance?.pages) {
        entry.ready = entry.appearance;
      }
      const appearance = entry.ready;
      if (!appearance) {
        continue;
      }
      // Whether an entity is drawn follows the tickingarea: a sleeping entity has released its entry.
      if (!entry.visual.visible) {
        continue;
      }
      const { atlas, frame } = appearance.locations![Math.min(entry.frame, appearance.locations!.length - 1)];
      // A single InstancedMesh has no per-entity frustum culling. Cull the whole
      // assembled frame before sorting or uploading instances, retaining logical
      // playback and the cached atlas while the entity is outside the camera.
      let spatial = entry.spatial;
      if (!spatial) {
        entry.spatial = spatial = {
          frame,
          transformVersion: -1,
          sphere: new THREE.Sphere(),
          camera: -1,
          visible: false,
          version: 0,
        };
      }
      if (
        spatial.transformVersion !== entry.transformVersion ||
        spatial.frame.width !== frame.width ||
        spatial.frame.height !== frame.height ||
        spatial.frame.minX !== frame.minX ||
        spatial.frame.minY !== frame.minY
      ) {
        spatial.transformVersion = entry.transformVersion;
        spatial.frame = frame;
        spatial.version++;
        spatial.sphere.center.set((frame.minX + frame.maxX) / 2, (frame.minY + frame.maxY) / 2, 0);
        spatial.sphere.radius = Math.hypot(frame.width, frame.height) / 2;
        spatial.sphere.applyMatrix4(entry.visual.matrixWorld);
        spatial.camera = -1;
      }
      if (spatial.camera !== this.cameraVersion) {
        spatial.visible = this.frustum.intersectsSphere(spatial.sphere);
        spatial.camera = this.cameraVersion;
      }
      if (!spatial.visible) {
        continue;
      }
      let pages = draws.get(scene);
      if (!pages) {
        draws.set(scene, (pages = new Map()));
      }
      const key = this.pageKey(atlas, entry.depthOffset);
      let page = pages.get(key);
      if (!page) {
        const first = appearance.frames[0][0];
        pages.set(
          key,
          (page = {
            source: first.materials[first.image.sampler ?? 0],
            members: [],
            entries: [],
            count: 0,
            sortDirty: false,
          }),
        );
      }
      const world = entry.foot.matrixWorld.elements;
      const x = world[12],
        y = world[13],
        z = world[14];
      let draw = entry.draw;
      if (!draw) {
        entry.draw = draw = { entry, member, frame, page, x, y, z, key: 0, lateral: 0, bias: 0, camera: -1 };
      }
      if (draw.camera !== this.cameraVersion || draw.x !== x || draw.y !== y || draw.z !== z) {
        draw.x = x;
        draw.y = y;
        draw.z = z;
        // The ordinary sprites' foot key, so batched and ordinary sprites follow one rule.
        const key = spriteRenderOrderKey(draw, camera.matrixWorldInverse);
        if (draw.key !== key) {
          page.sortDirty = true;
        }
        draw.key = key;
        draw.lateral = spriteRenderLateral(draw, camera.matrixWorldInverse);
        draw.camera = this.cameraVersion;
      }
      draw.member = member;
      draw.frame = frame;
      draw.page = page;
      if (page.members[page.count] !== draw) {
        page.members[page.count] = draw;
        page.sortDirty = true;
      }
      page.count++;
    }
    for (const pages of draws.values()) {
      let dirty = false;
      for (const page of pages.values()) {
        if (page.members.length !== page.count) {
          page.members.length = page.count;
          page.sortDirty = true;
        }
        dirty ||= page.sortDirty;
      }
      if (dirty) {
        this.rank(pages);
      }
    }
    // Retain the pass on the batch group so removing/hiding the last entity clears stale instances too.
    for (const [scene, pages] of draws) {
      if (!this.scenes.has(scene) && [...pages.values()].some(page => page.count > 0)) {
        // Keep the terrain's group order. Three compares groupOrder before each
        // mesh's renderOrder; a negative group would draw the forest before turf.
        const group = new THREE.Group();
        group.name = 'InstancedArchiveSprites';
        group.matrixAutoUpdate = false;
        group.matrixWorldAutoUpdate = false;
        scene.add(group);
        this.scenes.set(scene, { group, pages: new Map(), spare: [], stopPass: registerSceneRenderPass(group, this) });
      }
    }
    for (const [scene, batches] of this.scenes) {
      const visiblePages = draws.get(scene);
      for (const [key, batch] of batches.pages) {
        batch.colour.count = batch.depth.count = 0;
        if (!visiblePages?.get(key)?.count) {
          batches.pages.delete(key);
          this.recycleBatch(batches, batch);
        }
      }
      for (const [key, page] of draws.get(scene) ?? []) {
        if (!page.count) {
          continue;
        }
        const { atlas } = key;
        let batch = batches.pages.get(key);
        if (!batch || batch.capacity < page.entries.length) {
          if (batch) {
            this.recycleBatch(batches, batch);
          }
          const source = page.source,
            count = page.entries.length;
          let reusable: PageBatch | undefined;
          for (const candidate of batches.spare) {
            if (candidate.capacity >= count && (!reusable || candidate.capacity < reusable.capacity)) {
              reusable = candidate;
            }
          }
          if (reusable) {
            batches.spare.splice(batches.spare.indexOf(reusable), 1);
            batch = reusable;
            batch.key = key;
            batches.group.add(batch.depth, batch.colour);
            for (const mesh of [batch.colour, batch.depth]) {
              const material = mesh.material;
              material.map = atlas.texture;
              material.color.copy(source.color);
            }
            InstancedArchiveSprites.layer(batch);
          } else {
            batch = spritePerf('createBatch', `${count}`, () =>
              this.createBatch(batches, key, source, THREE.MathUtils.ceilPowerOfTwo(Math.max(1, count))),
            );
          }
          batches.pages.set(key, batch);
        }
        const uv = batch.geometry.getAttribute('spriteUv');
        const opacity = batch.geometry.getAttribute('spriteOpacity');
        const lightOverride = batch.geometry.getAttribute('spriteLightOverride');
        const erosion = batch.geometry.getAttribute('spriteErosion');
        const depthBias = batch.geometry.getAttribute('spriteDepthBias');
        const ocean = batch.geometry.getAttribute('spriteOcean');
        const oceanOrigin = batch.geometry.getAttribute('spriteOceanOrigin');
        const writer = batch.attributes,
          values = this.attributeValues,
          oceanValues = this.oceanValues;
        writer.begin();
        for (let index = 0; index < page.entries.length; index++) {
          const { entry, member, frame, bias } = page.entries[index];
          let previous = batch.transforms[index];
          const replaced = !previous || previous.id !== entry.model.id;
          if (!previous) {
            batch.transforms[index] = previous = {
              id: -1,
              transformVersion: -1,
              styleVersion: -1,
              r: NaN,
              g: NaN,
              b: NaN,
              opacity: NaN,
              light: NaN,
              erosion: NaN,
              bias: NaN,
            };
          }
          if (replaced || previous.transformVersion !== entry.spatial!.version) {
            this.frameMatrix.makeScale(frame.width, frame.height, 1).setPosition(frame.minX, frame.minY, 0);
            this.matrix.multiplyMatrices(entry.visual.matrixWorld, this.frameMatrix);
            writer.write(batch.colour.instanceMatrix, index, this.matrix.elements);
            const origin = entry.visual.matrixWorld.elements;
            values[0] = origin[12];
            values[1] = origin[14];
            writer.write(oceanOrigin, index, values);
            previous.transformVersion = entry.spatial!.version;
          }
          if (replaced || previous.frame !== frame) {
            values[0] = frame.u0;
            values[1] = frame.v0;
            values[2] = frame.u1;
            values[3] = frame.v1;
            writer.write(uv, index, values);
          }
          if (replaced || previous.bias !== bias) {
            values[0] = previous.bias = bias;
            writer.write(depthBias, index, values);
          }
          // The light is the display's declaration, read directly from its member.
          const light = member.lightOverride;
          if (replaced || previous.light !== light) {
            values[0] = previous.light = light;
            writer.write(lightOverride, index, values);
          }
          if (replaced || previous.styleVersion !== entry.styleVersion) {
            if (
              replaced ||
              previous.r !== entry.colour.r ||
              previous.g !== entry.colour.g ||
              previous.b !== entry.colour.b
            ) {
              values[0] = previous.r = entry.colour.r;
              values[1] = previous.g = entry.colour.g;
              values[2] = previous.b = entry.colour.b;
              writer.write(batch.colour.instanceColor!, index, values);
            }
            if (replaced || previous.opacity !== entry.opacity) {
              values[0] = previous.opacity = entry.opacity;
              writer.write(opacity, index, values);
            }
            if (replaced || previous.erosion !== entry.erosion) {
              values[0] = previous.erosion = entry.erosion;
              writer.write(erosion, index, values);
            }
            if (replaced || previous.ocean !== entry.ocean) {
              previous.ocean = entry.ocean;
              writer.write(ocean, index, oceanShadingInstanceValues(entry.ocean, oceanValues));
            }
            previous.styleVersion = entry.styleVersion;
          }
          previous.id = entry.model.id;
          previous.frame = frame;
        }
        batch.colour.count = batch.depth.count = page.entries.length;
        writer.flush();
      }
      // With no drawn pages, this anchor need not keep an otherwise inactive manager in the render-pass registry walk.
      // A visible entity anchor invokes the pass again when it wakes or comes back into view.
      batches.group.visible = batches.pages.size > 0;
    }
  }

  async prewarm(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    signal: AbortSignal | undefined,
    scene: THREE.Scene,
  ): Promise<void> {
    signal?.throwIfAborted();
    this.renderPass(renderer, camera, scene, Infinity, 'compose:prewarm');
    for (const { group, pages } of this.scenes.values()) {
      for (const batch of pages.values()) {
        renderer.initTexture(batch.key.atlas.texture);
      }
      await compileSceneAsync(renderer, group, camera);
      signal?.throwIfAborted();
    }
    // Prepare the ordinary shared-frame material variant used when an entity starts working.
    const proxies = new Set<THREE.Mesh>();
    for (const entry of this.retained) {
      const proxy = entry.visual.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
      if (proxy && !proxy.visible) {
        proxies.add(proxy);
      }
    }
    const staging = new THREE.Scene();
    staging.children = [...proxies];
    for (const proxy of proxies) {
      proxy.visible = true;
    }
    try {
      await compileSceneAsync(renderer, staging, camera);
    } finally {
      for (const proxy of proxies) {
        proxy.visible = false;
      }
    }
  }

  dispose(): void {
    this.unbindRenderer();
    for (const entry of [...this.retained]) {
      entry.dispose();
    }
    for (const batches of this.scenes.values()) {
      batches.stopPass();
      batches.group.removeFromParent();
      for (const batch of [...batches.pages.values(), ...batches.spare]) {
        this.disposeBatch(batch);
      }
    }
    this.scenes.clear();
    this.draws.clear();
    for (const appearance of this.appearances.values()) {
      appearance.composer?.cancel();
      for (const atlas of appearance.pages ?? []) {
        atlas.texture.dispose();
      }
    }
    this.appearances.clear();
    this.composing.clear();
  }
}
