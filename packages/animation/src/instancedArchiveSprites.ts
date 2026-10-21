import * as THREE from 'three';
import type { Animation, ResolvedSprite } from './animationAssets';
import { composeResolvedRgbaSpriteAtlases, type RgbaSpriteAtlas, type RgbaSpriteAtlasFrame } from './rgbaSpriteAtlas';
import { registerSceneRenderPass, type SceneRenderPass } from './sceneRenderPass';
import { getLightOverride } from './lightOverride';
import { getSpriteErosion } from './spriteErosion';

interface Appearance {
  animation: Animation;
  frames: ResolvedSprite[][];
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
  frame: number;
  stopPass: () => void;
}
interface DrawEntry { entry: Entry; frame: RgbaSpriteAtlasFrame; depth: number; x: number; z: number; lightOverride: number }
interface PageBatch {
  atlas: RgbaSpriteAtlas;
  geometry: THREE.BufferGeometry;
  colour: THREE.InstancedMesh;
  depth: THREE.InstancedMesh;
  capacity: number;
  attributes: InstanceAttributes;
  transforms: { id: number; world: THREE.Matrix4; frame: RgbaSpriteAtlasFrame }[];
}
interface SceneBatches { group: THREE.Group; pages: Map<RgbaSpriteAtlas, PageBatch>; stopPass: () => void }

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
export class InstancedArchiveSprites implements SceneRenderPass {
  private readonly appearances = new Map<string, Appearance>();
  private readonly entries = new Set<Entry>();
  private readonly scenes = new Map<THREE.Scene, SceneBatches>();
  private readonly matrix = new THREE.Matrix4();
  private readonly frameMatrix = new THREE.Matrix4();
  private readonly frustumMatrix = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly bounds = new THREE.Sphere();
  private readonly attributeValues = new Float32Array(4);

  retain(model: THREE.Object3D, visual: THREE.Group, colour: readonly [number, number, number] = [1, 1, 1], opacity = 1,
    foot: THREE.Object3D = model) {
    const entry: Entry = { model, foot, visual, colour: new THREE.Color().setRGB(...colour), opacity, frame: 0,
      stopPass: registerSceneRenderPass(model, this) };
    this.entries.add(entry);
    return {
      show: (key: string, animation: Animation, resolve: () => ResolvedSprite[][], frame: number) => {
        let appearance = this.appearances.get(key);
        if (!appearance) {
          appearance = { animation, frames: resolve() };
          this.appearances.set(key, appearance);
        }
        entry.appearance = appearance; entry.frame = frame;
      },
      hide: () => { entry.appearance = undefined; },
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

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    this.frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.frustumMatrix, camera.coordinateSystem);
    const draws = new Map<THREE.Scene, Map<RgbaSpriteAtlas, { source: THREE.MeshBasicMaterial; entries: DrawEntry[] }>>();
    for (const entry of this.entries) {
      const appearance = entry.appearance;
      if (!appearance) continue;
      let scene: THREE.Scene | undefined;
      let visible = true;
      let lightOverride: number | undefined;
      for (let node: THREE.Object3D | null = entry.model; node; node = node.parent) {
        if (!node.visible) visible = false;
        lightOverride ??= getLightOverride(node);
        if (node instanceof THREE.Scene) scene = node;
      }
      if (!visible || !entry.visual.visible || !scene) continue;
      if (!appearance.pages) {
        appearance.pages = composeResolvedRgbaSpriteAtlases(appearance.animation, appearance.frames,
          Math.min(4096, renderer.capabilities.maxTextureSize));
        appearance.locations = [];
        for (const atlas of appearance.pages) for (const frame of atlas.frames) {
          appearance.locations[frame.frameIndex] = { atlas, frame };
        }
      }
      const { atlas, frame } = appearance.locations![entry.frame];
      // A single InstancedMesh has no per-entity frustum culling. Cull the whole
      // assembled frame before sorting or uploading instances, retaining logical
      // playback and the cached atlas while the entity is outside the camera.
      this.bounds.center.set((frame.minX + frame.maxX) / 2, (frame.minY + frame.maxY) / 2, 0);
      this.bounds.radius = Math.hypot(frame.width, frame.height) / 2;
      this.bounds.applyMatrix4(entry.visual.matrixWorld);
      if (!this.frustum.intersectsSphere(this.bounds)) continue;
      let pages = draws.get(scene);
      if (!pages) draws.set(scene, pages = new Map());
      let page = pages.get(atlas);
      if (!page) {
        const first = appearance.frames[0][0];
        pages.set(atlas, page = { source: first.materials[first.image.sampler ?? 0], entries: [] });
      }
      const world = entry.foot.matrixWorld.elements, view = camera.matrixWorldInverse.elements;
      const x = world[12], y = world[13], z = world[14];
      page.entries.push({ entry, frame, x, z, lightOverride: Math.max(lightOverride ?? 0, getLightOverride(page.source) ?? 0),
        depth: Math.round((view[2] * x + view[6] * y + view[10] * z + view[14]) / .001) });
    }
    // Retain the pass on the batch group so removing/hiding the last entity clears stale instances too.
    for (const scene of draws.keys()) if (!this.scenes.has(scene)) {
      // Keep the terrain's group order. Three compares groupOrder before each
      // mesh's renderOrder; a negative group would draw the forest before turf.
      const group = new THREE.Group(); group.name = 'InstancedArchiveSprites';
      group.matrixAutoUpdate = false; group.matrixWorldAutoUpdate = false;
      scene.add(group);
      this.scenes.set(scene, { group, pages: new Map(), stopPass: registerSceneRenderPass(group, this) });
    }
    for (const [scene, batches] of this.scenes) {
      for (const batch of batches.pages.values()) batch.colour.count = batch.depth.count = 0;
      for (const [atlas, page] of draws.get(scene) ?? []) {
        let batch = batches.pages.get(atlas);
        if (!batch || batch.capacity < page.entries.length) {
          if (batch) this.disposeBatch(batch);
          batch = this.createBatch(batches, atlas, page.source, THREE.MathUtils.ceilPowerOfTwo(Math.max(1, page.entries.length)));
          batches.pages.set(atlas, batch);
        }
        page.entries.sort((a, b) => a.depth - b.depth || a.x - b.x || a.z - b.z || a.entry.foot.id - b.entry.foot.id);
        const uv = batch.geometry.getAttribute('spriteUv') as THREE.InstancedBufferAttribute;
        const opacity = batch.geometry.getAttribute('spriteOpacity') as THREE.InstancedBufferAttribute;
        const lightOverride = batch.geometry.getAttribute('spriteLightOverride') as THREE.InstancedBufferAttribute;
        const erosion = batch.geometry.getAttribute('spriteErosion') as THREE.InstancedBufferAttribute;
        const writer = batch.attributes, values = this.attributeValues;
        writer.begin();
        for (let index = 0; index < page.entries.length; index++) {
          const { entry, frame, lightOverride: light } = page.entries[index];
          let previous = batch.transforms[index];
          if (!previous || previous.id !== entry.model.id || !previous.world.equals(entry.visual.matrixWorld)
            || previous.frame.width !== frame.width || previous.frame.height !== frame.height
            || previous.frame.minX !== frame.minX || previous.frame.minY !== frame.minY) {
            this.frameMatrix.makeScale(frame.width, frame.height, 1).setPosition(frame.minX, frame.minY, 0);
            this.matrix.multiplyMatrices(entry.visual.matrixWorld, this.frameMatrix);
            writer.write(batch.colour.instanceMatrix, index, this.matrix.elements);
            if (!previous) batch.transforms[index] = previous = { id: entry.model.id, world: new THREE.Matrix4(), frame };
            previous.id = entry.model.id; previous.world.copy(entry.visual.matrixWorld); previous.frame = frame;
          }
          values[0] = entry.colour.r; values[1] = entry.colour.g; values[2] = entry.colour.b;
          writer.write(batch.colour.instanceColor!, index, values);
          values[0] = frame.u0; values[1] = frame.v0; values[2] = frame.u1; values[3] = frame.v1;
          writer.write(uv, index, values);
          values[0] = entry.opacity; writer.write(opacity, index, values);
          values[0] = light; writer.write(lightOverride, index, values);
          values[0] = getSpriteErosion(entry.model); writer.write(erosion, index, values);
        }
        batch.colour.count = batch.depth.count = page.entries.length;
        writer.flush();
      }
    }
  }

  async prewarm(renderer: THREE.WebGLRenderer, camera: THREE.Camera, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.render(renderer, camera);
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
    for (const entry of this.entries) entry.stopPass();
    this.entries.clear();
    for (const batches of this.scenes.values()) {
      batches.stopPass(); batches.group.removeFromParent();
      for (const batch of batches.pages.values()) this.disposeBatch(batch);
    }
    this.scenes.clear();
    for (const appearance of this.appearances.values()) for (const atlas of appearance.pages ?? []) atlas.texture.dispose();
    this.appearances.clear();
  }
}
