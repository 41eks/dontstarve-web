import * as THREE from 'three';
import { compileSceneAsync } from './compileScene';
import { InstanceAttributes } from './instanceAttributes';
import { createInstancedSpriteMaterials, layerInstancedSpriteMeshes } from './instancedSpriteMaterial';
import { oceanShadingInstanceValues, type SpriteOceanShading } from './oceanShading';
import type { RgbaSpriteAtlas, RgbaSpriteAtlasFrame } from './rgbaSpriteAtlas';
import { registerSceneRenderPass, type SceneRenderPass } from './sceneRenderPass';
import { spritePerf } from './spritePerf';

/** One atlas page, drawn as is or towards the camera after the ordinary batches: each is its own batch. */
export interface PageKey {
  readonly atlas: RgbaSpriteAtlas;
  readonly offset: boolean;
}

/** What a batch reads from one drawn sprite: its entity's transform and style, and the slot's frame and bias. */
export interface BatchedSprite {
  readonly entry: {
    readonly model: { readonly id: number };
    readonly visual: { readonly matrixWorld: THREE.Matrix4 };
    /** Its version changes whenever the instance matrix must be rewritten. */
    readonly spatial?: { readonly version: number };
    readonly styleVersion: number;
    readonly colour: THREE.Color;
    readonly opacity: number;
    readonly erosion: number;
    readonly ocean: SpriteOceanShading;
  };
  /** The display's AnimState light override. */
  readonly member: { readonly lightOverride: number };
  readonly frame: RgbaSpriteAtlasFrame;
  readonly bias: number;
}

/** One page's sprites this frame: `entries` in draw order once `count` is non-zero. */
export interface BatchedPage {
  /** The source frame material whose colour the batch takes. */
  readonly source: THREE.MeshBasicMaterial;
  readonly count: number;
  readonly entries: readonly BatchedSprite[];
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
  /** BatchedSprite.bias. */
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
  /** What each slot last uploaded, so only changed values are written. */
  transforms: InstanceState[];
}
interface SceneBatches {
  group: THREE.Group;
  pages: Map<PageKey, PageBatch>;
  spare: PageBatch[];
  stopPass: () => void;
}

function instancedAttribute(capacity: number, itemSize: number): THREE.InstancedBufferAttribute {
  return new THREE.InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize).setUsage(
    THREE.DynamicDrawUsage,
  );
}

function layer(batch: PageBatch): void {
  layerInstancedSpriteMeshes(batch.colour, batch.depth, batch.key.offset);
}

function disposeBatch(batch: PageBatch): void {
  batch.colour.removeFromParent();
  batch.depth.removeFromParent();
  batch.colour.dispose();
  batch.depth.dispose();
  batch.geometry.dispose();
  batch.colour.material.dispose();
  batch.depth.material.dispose();
}

/**
 * The instanced pass's GPU side: per scene, one depth-prepass and one colour InstancedMesh per atlas page, reused by
 * capacity, with only changed per-instance values uploaded.
 */
export class InstancedSpriteBatches {
  private readonly scenes = new Map<THREE.Scene, SceneBatches>();
  private readonly pageKeys = new WeakMap<RgbaSpriteAtlas, readonly [PageKey, PageKey]>();
  private readonly matrix = new THREE.Matrix4();
  private readonly frameMatrix = new THREE.Matrix4();
  private readonly attributeValues = new Float32Array(4);
  private readonly oceanValues: number[] = [0, 0, 0, 0];

  /** `pass` is registered on each scene's batch group, so it runs while any batch is drawn. */
  private readonly pass: SceneRenderPass;

  constructor(pass: SceneRenderPass) {
    this.pass = pass;
  }

  pageKey(atlas: RgbaSpriteAtlas, offset: boolean): PageKey {
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

  /** Draws exactly `draws`' non-empty pages in each scene, parking batches whose page is no longer drawn. */
  submit(draws: ReadonlyMap<THREE.Scene, ReadonlyMap<PageKey, BatchedPage>>): void {
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
        this.scenes.set(scene, {
          group,
          pages: new Map(),
          spare: [],
          stopPass: registerSceneRenderPass(group, this.pass),
        });
      }
    }
    for (const [scene, batches] of this.scenes) {
      const visiblePages = draws.get(scene);
      for (const [key, batch] of batches.pages) {
        batch.colour.count = batch.depth.count = 0;
        if (!visiblePages?.get(key)?.count) {
          batches.pages.delete(key);
          this.recycle(batches, batch);
        }
      }
      for (const [key, page] of visiblePages ?? []) {
        if (!page.count) {
          continue;
        }
        this.upload(this.acquire(batches, key, page), page.entries);
      }
      // With no drawn pages, this anchor need not keep an otherwise inactive manager in the render-pass registry walk.
      // A visible entity anchor invokes the pass again when it wakes or comes back into view.
      batches.group.visible = batches.pages.size > 0;
    }
  }

  /** Uploads every drawn page's texture and compiles its programs. */
  async compile(renderer: THREE.WebGLRenderer, camera: THREE.Camera, signal: AbortSignal | undefined): Promise<void> {
    for (const { group, pages } of this.scenes.values()) {
      for (const batch of pages.values()) {
        renderer.initTexture(batch.key.atlas.texture);
      }
      await compileSceneAsync(renderer, group, camera);
      signal?.throwIfAborted();
    }
  }

  /** Releases every batch, keeping each scene's group for the batches drawn after the atlases are recomposed. */
  invalidate(): void {
    for (const batches of this.scenes.values()) {
      for (const batch of [...batches.pages.values(), ...batches.spare]) {
        disposeBatch(batch);
      }
      batches.pages.clear();
      batches.spare.length = 0;
    }
  }

  dispose(): void {
    for (const batches of this.scenes.values()) {
      batches.stopPass();
      batches.group.removeFromParent();
      for (const batch of [...batches.pages.values(), ...batches.spare]) {
        disposeBatch(batch);
      }
    }
    this.scenes.clear();
  }

  /** The page's batch, replaced by the smallest spare (or a new batch) that fits once it outgrows its capacity. */
  private acquire(batches: SceneBatches, key: PageKey, page: BatchedPage): PageBatch {
    let batch = batches.pages.get(key);
    if (batch && batch.capacity >= page.entries.length) {
      return batch;
    }
    if (batch) {
      this.recycle(batches, batch);
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
        material.map = key.atlas.texture;
        material.color.copy(source.color);
      }
      layer(batch);
    } else {
      batch = spritePerf('createBatch', `${count}`, () =>
        this.create(batches, key, source, THREE.MathUtils.ceilPowerOfTwo(Math.max(1, count))),
      );
    }
    batches.pages.set(key, batch);
    return batch;
  }

  private create(scene: SceneBatches, key: PageKey, source: THREE.MeshBasicMaterial, capacity: number): PageBatch {
    const geometry = new THREE.BufferGeometry<BatchAttributes>();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('spriteUv', instancedAttribute(capacity, 4));
    geometry.setAttribute('spriteOpacity', instancedAttribute(capacity, 1));
    geometry.setAttribute('spriteLightOverride', instancedAttribute(capacity, 1));
    geometry.setAttribute('spriteErosion', instancedAttribute(capacity, 1));
    geometry.setAttribute('spriteDepthBias', instancedAttribute(capacity, 1));
    geometry.setAttribute('spriteOcean', instancedAttribute(capacity, 4));
    geometry.setAttribute('spriteOceanOrigin', instancedAttribute(capacity, 2));
    const materials = createInstancedSpriteMaterials(key.atlas, source);
    const colour = new THREE.InstancedMesh(geometry, materials.colour, capacity);
    const depth = new THREE.InstancedMesh(geometry, materials.depth, capacity);
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
    layer(batch);
    return batch;
  }

  private recycle(batches: SceneBatches, batch: PageBatch): void {
    batch.colour.count = batch.depth.count = 0;
    // A zero instance count still makes Three traverse and prepare the mesh. Park unused resources off-scene.
    batch.colour.removeFromParent();
    batch.depth.removeFromParent();
    batches.spare.push(batch);
  }

  /** Writes each slot's values that differ from what it last uploaded, then draws `entries.length` instances. */
  private upload(batch: PageBatch, entries: readonly BatchedSprite[]): void {
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
    for (let index = 0; index < entries.length; index++) {
      const { entry, member, frame, bias } = entries[index];
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
    batch.colour.count = batch.depth.count = entries.length;
    writer.flush();
  }
}
