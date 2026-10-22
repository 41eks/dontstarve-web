import * as THREE from 'three';
import type { Animation, ResolvedSprite } from './animationAssets';
import { spritePerf } from './spritePerf';
import { createResolvedRgbaSpriteAtlasComposer, type RgbaSpriteAtlasComposer, type RgbaSpriteAtlas, type RgbaSpriteAtlasFrame } from './rgbaSpriteAtlas';
import { registerSceneRenderPass, type SceneRenderPass } from './sceneRenderPass';
import { getLightOverride } from './lightOverride';
import { getSpriteErosion } from './spriteErosion';

interface Appearance {
  animation: Animation;
  frames: ResolvedSprite[][];
  resolve: (frameIndex: number) => ResolvedSprite[];
  composer?: RgbaSpriteAtlasComposer;
  pages?: RgbaSpriteAtlas[];
  locations?: { atlas: RgbaSpriteAtlas; frame: RgbaSpriteAtlasFrame }[];
}
interface Entry {
  model: THREE.Object3D;
  foot: THREE.Object3D;
  visual: THREE.Group;
  colour: THREE.Color;
  opacity: number;
  appearance?: Appearance;
  /** The last appearance with a composed atlas, drawn while a newly shown one is still being composed. */
  ready?: Appearance;
  frame: number;
  stopPass: () => void;
  draw?: DrawEntry;
  spatial?: { frame: RgbaSpriteAtlasFrame; world: THREE.Matrix4; sphere: THREE.Sphere; camera: number; visible: boolean };
}
interface DrawEntry { entry: Entry; frame: RgbaSpriteAtlasFrame; depth: number; x: number; y: number; z: number; lightOverride: number; camera: number }
interface DrawPage {
  source: THREE.MeshBasicMaterial;
  members: DrawEntry[];
  entries: DrawEntry[];
  count: number;
  sortDirty: boolean;
}
interface HierarchyState { generation: number; scene?: THREE.Scene; visible: boolean; lightOverride?: number }
interface InstanceState {
  id: number;
  world: THREE.Matrix4;
  frame?: RgbaSpriteAtlasFrame;
  r: number; g: number; b: number;
  opacity: number; light: number; erosion: number;
}
interface PageBatch {
  atlas: RgbaSpriteAtlas;
  geometry: THREE.BufferGeometry;
  colour: THREE.InstancedMesh;
  depth: THREE.InstancedMesh;
  capacity: number;
  attributes: InstanceAttributes;
  transforms: InstanceState[];
}
interface SceneBatches { group: THREE.Group; pages: Map<RgbaSpriteAtlas, PageBatch>; spare: PageBatch[]; stopPass: () => void }

/** Track actual Float32 changes, preserving any ranges not yet consumed by WebGL. */
class InstanceAttributes {
  private readonly changed = new Map<THREE.BufferAttribute, { start: number; end: number }>();

  begin(): void { for (const range of this.changed.values()) { range.start = Infinity; range.end = 0; } }

  write(attribute: THREE.BufferAttribute, index: number, values: ArrayLike<number>): void {
    const offset = index * attribute.itemSize;
    let start = Infinity, end = 0;
    for (let i = 0; i < attribute.itemSize; i++) {
      const value = Math.fround(values[i]);
      if (attribute.array[offset + i] === value) continue;
      attribute.array[offset + i] = value;
      start = Math.min(start, offset + i); end = offset + i + 1;
    }
    if (start === Infinity) return;
    let range = this.changed.get(attribute);
    if (!range) this.changed.set(attribute, range = { start, end });
    else { range.start = Math.min(range.start, start); range.end = Math.max(range.end, end); }
  }

  flush(): void {
    for (const [attribute, range] of this.changed) {
      if (range.start === Infinity) continue;
      let start = range.start, end = range.end;
      for (const pending of attribute.updateRanges) {
        start = Math.min(start, pending.start); end = Math.max(end, pending.start + pending.count);
      }
      attribute.clearUpdateRanges(); attribute.addUpdateRange(start, end - start);
      attribute.needsUpdate = true;
    }
  }
}

function material(atlas: RgbaSpriteAtlas, source: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
  const result = new THREE.MeshBasicMaterial({ map: atlas.texture, color: source.color,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, alphaTest: .01, toneMapped: false });
  result.name = 'Instanced archive sprite colour';
  result.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      attribute vec4 spriteUv;
      attribute float spriteOpacity;
      varying float vSpriteOpacity;
      attribute float spriteLightOverride;
      varying float vSpriteLightOverride;
      attribute float spriteErosion;
      varying float vSpriteErosion;
    `).replace('#include <uv_vertex>', `
      #include <uv_vertex>
      vMapUv = mix(spriteUv.xy, spriteUv.zw, uv);
      vSpriteOpacity = spriteOpacity;
      vSpriteLightOverride = spriteLightOverride;
      vSpriteErosion = spriteErosion;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      varying float vSpriteOpacity;
      #define DST_INSTANCED_LIGHT_OVERRIDE
      varying float vSpriteLightOverride;
      varying float vSpriteErosion;
    `).replace('#include <color_fragment>', `
      #include <color_fragment>
      diffuseColor.a *= vSpriteOpacity;
      if (vSpriteErosion > 0.0) {
        float erosionNoise = fract(sin(dot(vMapUv * 1024.0, vec2(12.9898, 78.233))) * 43758.5453);
        if (erosionNoise < vSpriteErosion) discard;
      }
    `);
  };
  result.customProgramCacheKey = () => 'dst-instanced-archive-sprite-v3';
  return result;
}

/** Render-only batching. Entity nodes, source geometry and alpha picking remain independently owned. */
/** Main-thread time per rendered frame spent composing atlases for appearances shown for the first time. */
const COMPOSE_BUDGET_MS = 4;

export class InstancedArchiveSprites implements SceneRenderPass {
  /** Appearances whose atlas is not composed yet, in first-use order. */
  private readonly composing = new Set<Appearance>();
  private readonly appearances = new Map<string, Appearance>();
  private readonly entries = new Set<Entry>();
  private readonly scenes = new Map<THREE.Scene, SceneBatches>();
  private readonly draws = new Map<THREE.Scene, Map<RgbaSpriteAtlas, DrawPage>>();
  private hierarchy = new WeakMap<THREE.Object3D, HierarchyState>();
  private generation = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly frameMatrix = new THREE.Matrix4();
  private readonly frustumMatrix = new THREE.Matrix4();
  private readonly previousFrustumMatrix = new THREE.Matrix4();
  private cameraVersion = 0;
  private coordinateSystem?: THREE.Camera['coordinateSystem'];
  private readonly frustum = new THREE.Frustum();
  private readonly bounds = new THREE.Sphere();
  private readonly attributeValues = new Float32Array(4);
  private renderer?: THREE.WebGLRenderer;
  private contextLost = false;

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.invalidateAtlases();
  };
  private readonly onContextRestored = (): void => { this.contextLost = false; };

  private bindRenderer(renderer: THREE.WebGLRenderer): void {
    if (this.renderer === renderer) return;
    if (this.renderer) { this.unbindRenderer(); this.invalidateAtlases(); }
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
      for (const batch of [...batches.pages.values(), ...batches.spare]) this.disposeBatch(batch);
      batches.pages.clear(); batches.spare.length = 0;
    }
    for (const appearance of this.appearances.values()) {
      appearance.composer?.cancel(); appearance.composer = undefined;
      for (const atlas of appearance.pages ?? []) atlas.texture.dispose();
      appearance.pages = appearance.locations = undefined;
    }
    this.composing.clear();
    this.draws.clear();
    for (const entry of this.entries) {
      entry.ready = undefined;
      if (entry.appearance) this.composing.add(entry.appearance);
    }
  }

  retain(model: THREE.Object3D, visual: THREE.Group, colour: readonly [number, number, number] = [1, 1, 1], opacity = 1,
    foot: THREE.Object3D = model) {
    const entry: Entry = { model, foot, visual, colour: new THREE.Color().setRGB(...colour), opacity, frame: 0,
      stopPass: registerSceneRenderPass(model, this) };
    this.entries.add(entry);
    return {
      show: (key: string, animation: Animation, resolve: () => (frameIndex: number) => ResolvedSprite[], frame: number) => {
        let appearance = this.appearances.get(key);
        if (!appearance) {
          appearance = { animation, frames: [], resolve: resolve() };
          this.appearances.set(key, appearance);
        }
        if (!appearance.pages) this.composing.add(appearance);
        entry.appearance = appearance; entry.frame = frame;
      },
      hide: () => { entry.appearance = entry.ready = undefined; },
      setOpacity: (value: number) => { entry.opacity = value; },
      setColour: (value: readonly [number, number, number]) => { entry.colour.setRGB(...value); },
      dispose: () => { entry.stopPass(); this.entries.delete(entry); },
    };
  }

  private createBatch(scene: SceneBatches, atlas: RgbaSpriteAtlas, source: THREE.MeshBasicMaterial, capacity: number): PageBatch {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('spriteUv', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('spriteOpacity', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('spriteLightOverride', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('spriteErosion', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    const colourMaterial = material(atlas, source), depthMaterial = colourMaterial.clone();
    depthMaterial.name = 'Instanced archive sprite depth';
    // Material.clone() deliberately omits callbacks.
    depthMaterial.onBeforeCompile = colourMaterial.onBeforeCompile;
    depthMaterial.customProgramCacheKey = colourMaterial.customProgramCacheKey;
    depthMaterial.transparent = false; depthMaterial.colorWrite = false; depthMaterial.depthWrite = true; depthMaterial.alphaTest = .98;
    const colour = new THREE.InstancedMesh(geometry, colourMaterial, capacity);
    const depth = new THREE.InstancedMesh(geometry, depthMaterial, capacity);
    for (const mesh of [colour, depth]) {
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false; mesh.matrixWorldAutoUpdate = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Only logical entity proxies participate in picking.
      mesh.raycast = () => {};
    }
    colour.name = 'ArchiveSpriteInstances:colour'; depth.name = 'ArchiveSpriteInstances:depth';
    colour.renderOrder = -.4; depth.renderOrder = -.41;
    depth.instanceMatrix = colour.instanceMatrix;
    colour.setColorAt(0, new THREE.Color(1, 1, 1));
    colour.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    scene.group.add(depth, colour);
    return { atlas, geometry, colour, depth, capacity, attributes: new InstanceAttributes(), transforms: [] };
  }

  private disposeBatch(batch: PageBatch): void {
    batch.colour.removeFromParent(); batch.depth.removeFromParent();
    batch.colour.dispose(); batch.depth.dispose();
    batch.geometry.dispose();
    (batch.colour.material as THREE.Material).dispose();
    (batch.depth.material as THREE.Material).dispose();
  }

  private recycleBatch(batches: SceneBatches, batch: PageBatch): void {
    batch.colour.count = batch.depth.count = 0;
    // A zero instance count still makes Three traverse and prepare the mesh. Park unused resources off-scene.
    batch.colour.removeFromParent(); batch.depth.removeFromParent();
    batches.spare.push(batch);
  }

  /** Shared ancestors are sampled once per pass, including direct visibility/light changes and reparenting. */
  private hierarchyState(node: THREE.Object3D): HierarchyState {
    let state = this.hierarchy.get(node);
    if (state?.generation === this.generation) return state;
    if (!state) { state = { generation: 0, visible: false }; this.hierarchy.set(node, state); }
    const parent = node.parent ? this.hierarchyState(node.parent) : undefined;
    state.generation = this.generation;
    state.scene = parent?.scene ?? (node instanceof THREE.Scene ? node : undefined);
    state.visible = node.visible && (parent?.visible ?? true);
    state.lightOverride = getLightOverride(node) ?? parent?.lightOverride;
    return state;
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    spritePerf('render', `${this.entries.size} entries`, () => this.renderPass(renderer, camera, COMPOSE_BUDGET_MS));
  }

  /** Spread atlas composition over frames: an appearance is drawn once its pages exist, never composed inside the draw loop. */
  private composeAtlases(renderer: THREE.WebGLRenderer, budgetMs: number, phase = 'compose'): void {
    this.bindRenderer(renderer);
    if (this.contextLost) return;
    if (this.composing.size === 0) return;
    const deadline = performance.now() + budgetMs;
    for (const appearance of this.composing) {
      const { animation, frames } = appearance;
      const pages = spritePerf(phase, `${animation.frames.length} frames`, () => {
        appearance.composer ??= createResolvedRgbaSpriteAtlasComposer(animation,
          index => frames[index] ??= spritePerf('resolve', animation.name, () => appearance.resolve(index)),
          Math.min(4096, renderer.capabilities.maxTextureSize), renderer);
        return appearance.composer.step(Math.max(0, deadline - performance.now()));
      });
      if (pages) {
        appearance.pages = pages; appearance.composer = undefined; appearance.locations = [];
        for (const atlas of pages) for (const frame of atlas.frames) appearance.locations[frame.frameIndex] = { atlas, frame };
        this.composing.delete(appearance);
      }
      if (performance.now() >= deadline) break;
    }
  }

  /** Composes every pending appearance now, for callers that need the next draw to be complete. */
  flush(renderer: THREE.WebGLRenderer): void { this.composeAtlases(renderer, Infinity, 'compose:flush'); }

  private renderPass(renderer: THREE.WebGLRenderer, camera: THREE.Camera, composeBudgetMs: number, composePhase?: string): void {
    this.composeAtlases(renderer, composeBudgetMs, composePhase);
    if (this.contextLost) return;
    this.generation++;
    this.frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (this.coordinateSystem !== camera.coordinateSystem || !this.frustumMatrix.equals(this.previousFrustumMatrix)) {
      this.previousFrustumMatrix.copy(this.frustumMatrix); this.coordinateSystem = camera.coordinateSystem;
      this.frustum.setFromProjectionMatrix(this.frustumMatrix, camera.coordinateSystem); this.cameraVersion++;
    }
    const draws = this.draws;
    for (const pages of draws.values()) for (const page of pages.values()) { page.count = 0; page.sortDirty = false; }
    for (const entry of this.entries) {
      if (entry.appearance?.pages) entry.ready = entry.appearance;
      const appearance = entry.ready;
      if (!appearance) continue;
      const { scene, visible, lightOverride } = this.hierarchyState(entry.model);
      if (!visible || !entry.visual.visible || !scene) continue;
      const { atlas, frame } = appearance.locations![Math.min(entry.frame, appearance.locations!.length - 1)];
      // A single InstancedMesh has no per-entity frustum culling. Cull the whole
      // assembled frame before sorting or uploading instances, retaining logical
      // playback and the cached atlas while the entity is outside the camera.
      let spatial = entry.spatial;
      if (!spatial) entry.spatial = spatial = { frame, world: new THREE.Matrix4(), sphere: new THREE.Sphere(), camera: -1, visible: false };
      if (spatial.camera === -1 || !spatial.world.equals(entry.visual.matrixWorld)
        || spatial.frame.width !== frame.width || spatial.frame.height !== frame.height
        || spatial.frame.minX !== frame.minX || spatial.frame.minY !== frame.minY) {
        spatial.world.copy(entry.visual.matrixWorld); spatial.frame = frame;
        spatial.sphere.center.set((frame.minX + frame.maxX) / 2, (frame.minY + frame.maxY) / 2, 0);
        spatial.sphere.radius = Math.hypot(frame.width, frame.height) / 2;
        spatial.sphere.applyMatrix4(entry.visual.matrixWorld); spatial.camera = -1;
      }
      if (spatial.camera !== this.cameraVersion) {
        spatial.visible = this.frustum.intersectsSphere(spatial.sphere); spatial.camera = this.cameraVersion;
      }
      if (!spatial.visible) continue;
      let pages = draws.get(scene);
      if (!pages) draws.set(scene, pages = new Map());
      let page = pages.get(atlas);
      if (!page) {
        const first = appearance.frames[0][0];
        pages.set(atlas, page = { source: first.materials[first.image.sampler ?? 0], members: [], entries: [], count: 0, sortDirty: false });
      }
      const world = entry.foot.matrixWorld.elements, view = camera.matrixWorldInverse.elements;
      const x = world[12], y = world[13], z = world[14];
      let draw = entry.draw;
      if (!draw) entry.draw = draw = { entry, frame, x, y, z, depth: 0, camera: -1, lightOverride: 0 };
      if (draw.camera !== this.cameraVersion || draw.x !== x || draw.y !== y || draw.z !== z) {
        const depth = Math.round((view[2] * x + view[6] * y + view[10] * z + view[14]) / .001);
        if (draw.depth !== depth || draw.x !== x || draw.z !== z) page.sortDirty = true;
        draw.depth = depth; draw.x = x; draw.y = y; draw.z = z; draw.camera = this.cameraVersion;
      }
      draw.frame = frame; draw.lightOverride = Math.max(lightOverride ?? 0, getLightOverride(page.source) ?? 0);
      if (page.members[page.count] !== draw) { page.members[page.count] = draw; page.sortDirty = true; }
      page.count++;
    }
    for (const pages of draws.values()) for (const page of pages.values()) {
      if (page.members.length !== page.count) { page.members.length = page.count; page.sortDirty = true; }
      if (page.sortDirty) {
        page.entries.length = page.count;
        for (let index = 0; index < page.count; index++) page.entries[index] = page.members[index];
        if (page.count > 1) page.entries.sort((a, b) => a.depth - b.depth || a.x - b.x || a.z - b.z || a.entry.foot.id - b.entry.foot.id);
      }
    }
    // Retain the pass on the batch group so removing/hiding the last entity clears stale instances too.
    for (const [scene, pages] of draws) if (!this.scenes.has(scene) && [...pages.values()].some(page => page.count > 0)) {
      // Keep the terrain's group order. Three compares groupOrder before each
      // mesh's renderOrder; a negative group would draw the forest before turf.
      const group = new THREE.Group(); group.name = 'InstancedArchiveSprites';
      group.matrixAutoUpdate = false; group.matrixWorldAutoUpdate = false;
      scene.add(group);
      this.scenes.set(scene, { group, pages: new Map(), spare: [], stopPass: registerSceneRenderPass(group, this) });
    }
    for (const [scene, batches] of this.scenes) {
      const visiblePages = draws.get(scene);
      for (const [atlas, batch] of batches.pages) {
        batch.colour.count = batch.depth.count = 0;
        if (!visiblePages?.get(atlas)?.count) { batches.pages.delete(atlas); this.recycleBatch(batches, batch); }
      }
      for (const [atlas, page] of draws.get(scene) ?? []) {
        if (!page.count) continue;
        let batch = batches.pages.get(atlas);
        if (!batch || batch.capacity < page.entries.length) {
          if (batch) this.recycleBatch(batches, batch);
          const source = page.source, count = page.entries.length;
          let reusable: PageBatch | undefined;
          for (const candidate of batches.spare)
            if (candidate.capacity >= count && (!reusable || candidate.capacity < reusable.capacity)) reusable = candidate;
          if (reusable) {
            batches.spare.splice(batches.spare.indexOf(reusable), 1);
            batch = reusable; batch.atlas = atlas;
            batches.group.add(batch.depth, batch.colour);
            for (const mesh of [batch.colour, batch.depth]) {
              const material = mesh.material as THREE.MeshBasicMaterial;
              material.map = atlas.texture; material.color.copy(source.color);
            }
          } else batch = spritePerf('createBatch', `${count}`, () => this.createBatch(batches, atlas, source, THREE.MathUtils.ceilPowerOfTwo(Math.max(1, count))));
          batches.pages.set(atlas, batch);
        }
        const uv = batch.geometry.getAttribute('spriteUv') as THREE.InstancedBufferAttribute;
        const opacity = batch.geometry.getAttribute('spriteOpacity') as THREE.InstancedBufferAttribute;
        const lightOverride = batch.geometry.getAttribute('spriteLightOverride') as THREE.InstancedBufferAttribute;
        const erosion = batch.geometry.getAttribute('spriteErosion') as THREE.InstancedBufferAttribute;
        const writer = batch.attributes, values = this.attributeValues;
        writer.begin();
        for (let index = 0; index < page.entries.length; index++) {
          const { entry, frame, lightOverride: light } = page.entries[index];
          let previous = batch.transforms[index];
          const replaced = !previous || previous.id !== entry.model.id;
          if (!previous) batch.transforms[index] = previous = { id: -1, world: new THREE.Matrix4(),
            r: NaN, g: NaN, b: NaN, opacity: NaN, light: NaN, erosion: NaN };
          if (replaced || !previous.world.equals(entry.visual.matrixWorld)
            || previous.frame!.width !== frame.width || previous.frame!.height !== frame.height
            || previous.frame!.minX !== frame.minX || previous.frame!.minY !== frame.minY) {
            this.frameMatrix.makeScale(frame.width, frame.height, 1).setPosition(frame.minX, frame.minY, 0);
            this.matrix.multiplyMatrices(entry.visual.matrixWorld, this.frameMatrix);
            writer.write(batch.colour.instanceMatrix, index, this.matrix.elements);
            previous.world.copy(entry.visual.matrixWorld);
          }
          if (replaced || previous.r !== entry.colour.r || previous.g !== entry.colour.g || previous.b !== entry.colour.b) {
            values[0] = previous.r = entry.colour.r; values[1] = previous.g = entry.colour.g; values[2] = previous.b = entry.colour.b;
            writer.write(batch.colour.instanceColor!, index, values);
          }
          if (replaced || previous.frame !== frame) {
            values[0] = frame.u0; values[1] = frame.v0; values[2] = frame.u1; values[3] = frame.v1;
            writer.write(uv, index, values);
          }
          if (replaced || previous.opacity !== entry.opacity) { values[0] = previous.opacity = entry.opacity; writer.write(opacity, index, values); }
          if (replaced || previous.light !== light) { values[0] = previous.light = light; writer.write(lightOverride, index, values); }
          const amount = getSpriteErosion(entry.model);
          if (replaced || previous.erosion !== amount) { values[0] = previous.erosion = amount; writer.write(erosion, index, values); }
          previous.id = entry.model.id; previous.frame = frame;
        }
        batch.colour.count = batch.depth.count = page.entries.length;
        writer.flush();
      }
      // With no drawn pages, this anchor need not keep an otherwise inactive manager in the render-pass registry walk.
      // A visible entity anchor invokes the pass again when it wakes or comes back into view.
      batches.group.visible = batches.pages.size > 0;
    }
  }

  async prewarm(renderer: THREE.WebGLRenderer, camera: THREE.Camera, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.renderPass(renderer, camera, Infinity, 'compose:prewarm');
    for (const { group, pages } of this.scenes.values()) {
      for (const batch of pages.values()) renderer.initTexture(batch.atlas.texture);
      await renderer.compileAsync(group, camera);
      signal?.throwIfAborted();
    }
    // Prepare the ordinary shared-frame material variant used when an entity starts working.
    const proxies = new Set<THREE.Mesh>();
    for (const entry of this.entries) {
      const proxy = entry.visual.children.find(child => child instanceof THREE.Mesh) as THREE.Mesh | undefined;
      if (proxy && !proxy.visible) proxies.add(proxy);
    }
    const staging = new THREE.Scene(); staging.children = [...proxies];
    for (const proxy of proxies) proxy.visible = true;
    try { await renderer.compileAsync(staging, camera); }
    finally { for (const proxy of proxies) proxy.visible = false; }
  }

  dispose(): void {
    this.unbindRenderer();
    for (const entry of this.entries) entry.stopPass();
    this.entries.clear();
    for (const batches of this.scenes.values()) {
      batches.stopPass(); batches.group.removeFromParent();
      for (const batch of [...batches.pages.values(), ...batches.spare]) this.disposeBatch(batch);
    }
    this.scenes.clear();
    this.draws.clear(); this.hierarchy = new WeakMap();
    for (const appearance of this.appearances.values()) {
      appearance.composer?.cancel();
      for (const atlas of appearance.pages ?? []) atlas.texture.dispose();
    }
    this.appearances.clear();
    this.composing.clear();
  }
}
