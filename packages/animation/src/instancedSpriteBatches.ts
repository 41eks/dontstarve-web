import * as THREE from 'three';
import { compileSceneAsync } from './compileScene';
import { InstanceAttributes } from './instanceAttributes';
import { createInstancedSpriteMaterial } from './instancedSpriteMaterial';
import { oceanShadingInstanceValues, type SpriteOceanShading } from './oceanShading';
import type { RgbaSpriteAtlas, RgbaSpriteAtlasFrame } from './rgbaSpriteAtlas';
import { registerSceneRenderPass, type SceneRenderPass } from './sceneRenderPass';
import { spritePerf } from './spritePerf';

/** One run of an atlas page's sprites in the scene's key order: the page's `segment`th, each its own batch. */
export interface SegmentKey {
  readonly atlas: RgbaSpriteAtlas;
  readonly segment: number;
}

/** What a batch reads from one drawn sprite: its entity's transform and style, and the slot's frame. */
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
}

/** One segment's sprites this frame: `entries[start, end)`, in draw order, drawn at the scene position `order`. */
export interface BatchedSegment {
  /** The source frame material whose colour the batch takes. */
  readonly source: THREE.MeshBasicMaterial;
  readonly entries: readonly BatchedSprite[];
  readonly start: number;
  readonly end: number;
  /** The foot key of its first sprite: three draws the batch where this falls among the ordinary billboards. */
  readonly order: number;
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
  /** FLOAT_PARAMS in xyz, the ocean blend in w. */
  spriteOcean: THREE.InstancedBufferAttribute;
  /** The entity's world xz, which the float bob's phase follows (MatrixW's translation). */
  spriteOceanOrigin: THREE.InstancedBufferAttribute;
};
type BatchMesh = THREE.InstancedMesh<THREE.BufferGeometry<BatchAttributes>, THREE.MeshBasicMaterial>;
interface PageBatch {
  key: SegmentKey;
  /** Its group order places the batch in the scene's key order. */
  group: THREE.Group;
  geometry: THREE.BufferGeometry<BatchAttributes>;
  colour: BatchMesh;
  capacity: number;
  attributes: InstanceAttributes;
  /** What each slot last uploaded, so only changed values are written. */
  transforms: InstanceState[];
}
interface SceneBatches {
  group: THREE.Group;
  pages: Map<SegmentKey, PageBatch>;
  spare: PageBatch[];
  stopPass: () => void;
}

function instancedAttribute(capacity: number, itemSize: number): THREE.InstancedBufferAttribute {
  return new THREE.InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize).setUsage(
    THREE.DynamicDrawUsage,
  );
}

function disposeBatch(batch: PageBatch): void {
  batch.group.removeFromParent();
  batch.colour.dispose();
  batch.geometry.dispose();
  batch.colour.material.dispose();
}

/**
 * The instanced pass's GPU side: per scene, one InstancedMesh per segment of an atlas page, reused by capacity, with
 * only changed per-instance values uploaded.
 */
export class InstancedSpriteBatches {
  private readonly scenes = new Map<THREE.Scene, SceneBatches>();
  private readonly segmentKeys = new WeakMap<RgbaSpriteAtlas, SegmentKey[]>();
  private readonly matrix = new THREE.Matrix4();
  private readonly frameMatrix = new THREE.Matrix4();
  private readonly attributeValues = new Float32Array(4);
  private readonly oceanValues: number[] = [0, 0, 0, 0];

  /** `pass` is registered on each scene's batch group, so it runs while any batch is drawn. */
  private readonly pass: SceneRenderPass;

  constructor(pass: SceneRenderPass) {
    this.pass = pass;
  }

  segmentKey(atlas: RgbaSpriteAtlas, segment: number): SegmentKey {
    let keys = this.segmentKeys.get(atlas);
    if (!keys) {
      this.segmentKeys.set(atlas, (keys = []));
    }
    for (let index = keys.length; index <= segment; index++) {
      keys.push({ atlas, segment: index });
    }
    return keys[segment];
  }

  /** Draws exactly `segments` in `scene`, parking batches whose segment is no longer drawn. */
  submit(scene: THREE.Scene, segments: ReadonlyMap<SegmentKey, BatchedSegment>): void {
    let batches = this.scenes.get(scene);
    // Retain the pass on the scene's group so removing/hiding the last entity clears stale instances too.
    if (!batches && segments.size > 0) {
      // Each batch's own group gives its group order; this one only anchors the pass and holds them.
      const group = new THREE.Group();
      group.name = 'InstancedArchiveSprites';
      group.matrixAutoUpdate = false;
      group.matrixWorldAutoUpdate = false;
      scene.add(group);
      this.scenes.set(
        scene,
        (batches = { group, pages: new Map(), spare: [], stopPass: registerSceneRenderPass(group, this.pass) }),
      );
    }
    if (!batches) {
      return;
    }
    for (const [key, batch] of batches.pages) {
      batch.colour.count = 0;
      if (!segments.has(key)) {
        batches.pages.delete(key);
        this.recycle(batches, batch);
      }
    }
    for (const [key, segment] of segments) {
      const batch = this.acquire(batches, key, segment);
      batch.group.renderOrder = segment.order;
      this.upload(batch, segment);
    }
    // With no drawn segments, this anchor need not keep an otherwise inactive manager in the render-pass registry walk.
    // A visible entity anchor invokes the pass again when it wakes or comes back into view.
    batches.group.visible = batches.pages.size > 0;
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

  /** The segment's batch, replaced by the smallest spare (or a new batch) that fits once it outgrows its capacity. */
  private acquire(batches: SceneBatches, key: SegmentKey, segment: BatchedSegment): PageBatch {
    const count = segment.end - segment.start;
    let batch = batches.pages.get(key);
    if (batch && batch.capacity >= count) {
      return batch;
    }
    if (batch) {
      this.recycle(batches, batch);
    }
    const source = segment.source;
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
      batches.group.add(batch.group);
      const material = batch.colour.material;
      material.map = key.atlas.texture;
      material.color.copy(source.color);
    } else {
      batch = spritePerf('createBatch', `${count}`, () =>
        this.create(batches, key, source, THREE.MathUtils.ceilPowerOfTwo(Math.max(1, count))),
      );
    }
    batches.pages.set(key, batch);
    return batch;
  }

  private create(scene: SceneBatches, key: SegmentKey, source: THREE.MeshBasicMaterial, capacity: number): PageBatch {
    const geometry = new THREE.BufferGeometry<BatchAttributes>();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('spriteUv', instancedAttribute(capacity, 4));
    geometry.setAttribute('spriteOpacity', instancedAttribute(capacity, 1));
    geometry.setAttribute('spriteLightOverride', instancedAttribute(capacity, 1));
    geometry.setAttribute('spriteErosion', instancedAttribute(capacity, 1));
    geometry.setAttribute('spriteOcean', instancedAttribute(capacity, 4));
    geometry.setAttribute('spriteOceanOrigin', instancedAttribute(capacity, 2));
    const colour = new THREE.InstancedMesh(geometry, createInstancedSpriteMaterial(key.atlas, source), capacity);
    colour.frustumCulled = false;
    colour.matrixAutoUpdate = false;
    colour.matrixWorldAutoUpdate = false;
    colour.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Only logical entity proxies participate in picking.
    colour.raycast = () => {};
    colour.name = 'ArchiveSpriteInstances:colour';
    colour.setColorAt(0, new THREE.Color(1, 1, 1));
    colour.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    const group = new THREE.Group();
    group.name = 'ArchiveSpriteInstances:segment';
    group.matrixAutoUpdate = false;
    group.matrixWorldAutoUpdate = false;
    group.add(colour);
    scene.group.add(group);
    return { key, group, geometry, colour, capacity, attributes: new InstanceAttributes(), transforms: [] };
  }

  private recycle(batches: SceneBatches, batch: PageBatch): void {
    batch.colour.count = 0;
    // A zero instance count still makes Three traverse and prepare the mesh. Park unused resources off-scene.
    batch.group.removeFromParent();
    batches.spare.push(batch);
  }

  /** Writes each slot's values that differ from what it last uploaded, then draws the segment's instances. */
  private upload(batch: PageBatch, segment: BatchedSegment): void {
    const { entries, start, end } = segment;
    const uv = batch.geometry.getAttribute('spriteUv');
    const opacity = batch.geometry.getAttribute('spriteOpacity');
    const lightOverride = batch.geometry.getAttribute('spriteLightOverride');
    const erosion = batch.geometry.getAttribute('spriteErosion');
    const ocean = batch.geometry.getAttribute('spriteOcean');
    const oceanOrigin = batch.geometry.getAttribute('spriteOceanOrigin');
    const writer = batch.attributes,
      values = this.attributeValues,
      oceanValues = this.oceanValues;
    writer.begin();
    for (let index = 0; index < end - start; index++) {
      const { entry, member, frame } = entries[start + index];
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
    batch.colour.count = end - start;
    writer.flush();
  }
}
