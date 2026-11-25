import * as THREE from 'three';
import { compileSceneAsync } from './compileScene';
import { InstanceAttributes } from './instanceAttributes';
import { InstancedPartMaterial } from './instancedPartMaterial';
import { isInstancedPartTable, type InstancedPartFrame, type InstancedPartTable } from './instancedPartTable';
import { createInstancedSpriteMaterial } from './instancedSpriteMaterial';
import { oceanShadingInstanceValues, type SpriteOceanShading } from './oceanShading';
import type { RgbaSpriteAtlas, RgbaSpriteAtlasFrame } from './rgbaSpriteAtlas';
import { registerSceneRenderPass, type SceneRenderPass } from './sceneRenderPass';
import { spritePerf } from './spritePerf';

/** What a batch draws from: a composed atlas page (one quad per entity) or a part table (one quad per part slot). */
export type BatchPage = RgbaSpriteAtlas | InstancedPartTable;

/** One run of a page's sprites in the scene's key order: the page's `segment`th, each its own batch. */
export interface SegmentKey {
  readonly page: BatchPage;
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
  /** A composed page's frame, or a part table's frame for a part table segment. */
  readonly frame: RgbaSpriteAtlasFrame | InstancedPartFrame;
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
  frame?: RgbaSpriteAtlasFrame | InstancedPartFrame;
  r: number;
  g: number;
  b: number;
  opacity: number;
  light: number;
  erosion: number;
  ocean?: SpriteOceanShading;
}
/**
 * A page batch's quad and its per-instance sprite attributes. A composed page's instances read their frame's UVs; a
 * part table's read the frame row (`partFrame`), and their slot from the instance id.
 */
type BatchAttributes = {
  position: THREE.BufferAttribute;
  uv: THREE.BufferAttribute;
  spriteUv?: THREE.InstancedBufferAttribute;
  partFrame?: THREE.InstancedBufferAttribute;
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
  /** Whether it draws part tables, whose geometry and material differ from a composed page's. */
  parts: boolean;
  /** Instances: entities for a composed page, entities × slots for a part table. */
  capacity: number;
  attributes: InstanceAttributes;
  /** What each entity last uploaded, so only changed values are written. */
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

/** Writes one entity's `values` to each of its `slots` instances from `first`. */
function writeSlots(
  writer: InstanceAttributes,
  attribute: THREE.BufferAttribute,
  first: number,
  slots: number,
  values: ArrayLike<number>,
): void {
  for (let slot = 0; slot < slots; slot++) {
    writer.write(attribute, first + slot, values);
  }
}

function disposeBatch(batch: PageBatch): void {
  batch.group.removeFromParent();
  batch.colour.dispose();
  batch.geometry.dispose();
  batch.colour.material.dispose();
}

/** Instances per drawn entity on `page`. */
function pageSlots(page: BatchPage): number {
  return isInstancedPartTable(page) ? page.slots : 1;
}

/**
 * The instanced pass's GPU side: per scene, one InstancedMesh per segment of a page (a composed atlas page, or a part
 * table drawn straight from its build atlases), reused by capacity, with only changed per-instance values uploaded.
 */
export class InstancedSpriteBatches {
  private readonly scenes = new Map<THREE.Scene, SceneBatches>();
  private readonly segmentKeys = new WeakMap<BatchPage, SegmentKey[]>();
  private readonly matrix = new THREE.Matrix4();
  private readonly frameMatrix = new THREE.Matrix4();
  private readonly attributeValues = new Float32Array(4);
  private readonly oceanValues: number[] = [0, 0, 0, 0];

  /** `pass` is registered on each scene's batch group, so it runs while any batch is drawn. */
  private readonly pass: SceneRenderPass;

  constructor(pass: SceneRenderPass) {
    this.pass = pass;
  }

  segmentKey(page: BatchPage, segment: number): SegmentKey {
    let keys = this.segmentKeys.get(page);
    if (!keys) {
      this.segmentKeys.set(page, (keys = []));
    }
    for (let index = keys.length; index <= segment; index++) {
      keys.push({ page, segment: index });
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

  /** Uploads every drawn page's textures and compiles its programs. */
  async compile(renderer: THREE.WebGLRenderer, camera: THREE.Camera, signal: AbortSignal | undefined): Promise<void> {
    for (const { group, pages } of this.scenes.values()) {
      for (const { key } of pages.values()) {
        renderer.initTexture(key.page.texture);
        for (const texture of isInstancedPartTable(key.page) ? key.page.textures : []) {
          renderer.initTexture(texture);
        }
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
    const parts = isInstancedPartTable(key.page);
    const count = (segment.end - segment.start) * pageSlots(key.page);
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
      if (
        candidate.parts === parts &&
        candidate.capacity >= count &&
        (!reusable || candidate.capacity < reusable.capacity)
      ) {
        reusable = candidate;
      }
    }
    if (reusable) {
      batches.spare.splice(batches.spare.indexOf(reusable), 1);
      batch = reusable;
      batch.key = key;
      // Its instances now hold another page's entities (and, for a part table, another slot layout).
      batch.transforms.length = 0;
      batches.group.add(batch.group);
      const material = batch.colour.material;
      if (material instanceof InstancedPartMaterial) {
        material.bind(key.page as InstancedPartTable);
      } else {
        material.map = key.page.texture;
      }
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
    const { page } = key;
    const parts = isInstancedPartTable(page);
    if (parts) {
      geometry.setAttribute('partFrame', instancedAttribute(capacity, 1));
    } else {
      geometry.setAttribute('spriteUv', instancedAttribute(capacity, 4));
    }
    geometry.setAttribute('spriteOpacity', instancedAttribute(capacity, 1));
    geometry.setAttribute('spriteLightOverride', instancedAttribute(capacity, 1));
    geometry.setAttribute('spriteErosion', instancedAttribute(capacity, 1));
    geometry.setAttribute('spriteOcean', instancedAttribute(capacity, 4));
    geometry.setAttribute('spriteOceanOrigin', instancedAttribute(capacity, 2));
    const material = parts ? new InstancedPartMaterial(page, source) : createInstancedSpriteMaterial(page, source);
    const colour = new THREE.InstancedMesh(geometry, material, capacity);
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
    return { key, group, geometry, colour, parts, capacity, attributes: new InstanceAttributes(), transforms: [] };
  }

  private recycle(batches: SceneBatches, batch: PageBatch): void {
    batch.colour.count = 0;
    // A zero instance count still makes Three traverse and prepare the mesh. Park unused resources off-scene.
    batch.group.removeFromParent();
    batches.spare.push(batch);
  }

  /**
   * Writes each entity's values that differ from what it last uploaded, then draws the segment's instances. A part
   * table entity's values go to each of its slots; its matrix is the entity's own, the table places each part.
   */
  private upload(batch: PageBatch, segment: BatchedSegment): void {
    const { entries, start, end } = segment;
    const slots = pageSlots(batch.key.page);
    const uv = batch.geometry.getAttribute('spriteUv');
    const partFrame = batch.geometry.getAttribute('partFrame');
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
      const first = index * slots;
      if (replaced || previous.transformVersion !== entry.spatial!.version) {
        let matrix = entry.visual.matrixWorld;
        if (!partFrame) {
          this.frameMatrix.makeScale(frame.width, frame.height, 1).setPosition(frame.minX, frame.minY, 0);
          matrix = this.matrix.multiplyMatrices(matrix, this.frameMatrix);
        }
        writeSlots(writer, batch.colour.instanceMatrix, first, slots, matrix.elements);
        const origin = entry.visual.matrixWorld.elements;
        values[0] = origin[12];
        values[1] = origin[14];
        writeSlots(writer, oceanOrigin, first, slots, values);
        previous.transformVersion = entry.spatial!.version;
      }
      if (replaced || previous.frame !== frame) {
        if (partFrame) {
          values[0] = frame.frameIndex;
          writeSlots(writer, partFrame, first, slots, values);
        } else {
          const { u0, v0, u1, v1 } = frame as RgbaSpriteAtlasFrame;
          values[0] = u0;
          values[1] = v0;
          values[2] = u1;
          values[3] = v1;
          writer.write(uv!, index, values);
        }
      }
      // The light is the display's declaration, read directly from its member.
      const light = member.lightOverride;
      if (replaced || previous.light !== light) {
        values[0] = previous.light = light;
        writeSlots(writer, lightOverride, first, slots, values);
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
          writeSlots(writer, batch.colour.instanceColor!, first, slots, values);
        }
        if (replaced || previous.opacity !== entry.opacity) {
          values[0] = previous.opacity = entry.opacity;
          writeSlots(writer, opacity, first, slots, values);
        }
        if (replaced || previous.erosion !== entry.erosion) {
          values[0] = previous.erosion = entry.erosion;
          writeSlots(writer, erosion, first, slots, values);
        }
        if (replaced || previous.ocean !== entry.ocean) {
          previous.ocean = entry.ocean;
          writeSlots(writer, ocean, first, slots, oceanShadingInstanceValues(entry.ocean, oceanValues));
        }
        previous.styleVersion = entry.styleVersion;
      }
      previous.id = entry.model.id;
      previous.frame = frame;
    }
    batch.colour.count = (end - start) * slots;
    writer.flush();
  }
}
