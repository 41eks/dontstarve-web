import * as THREE from 'three';
import type { Animation, ResolvedSprite } from './animationAssets';
import { composeResolvedRgbaSpriteAtlases, type RgbaSpriteAtlas, type RgbaSpriteAtlasFrame } from './rgbaSpriteAtlas';
import { registerSceneRenderPass, type SceneRenderPass } from './sceneRenderPass';

interface Appearance {
  animation: Animation;
  frames: ResolvedSprite[][];
  pages?: RgbaSpriteAtlas[];
  locations?: { atlas: RgbaSpriteAtlas; frame: RgbaSpriteAtlasFrame }[];
}
interface Entry {
  model: THREE.Object3D;
  visual: THREE.Group;
  colour: THREE.Color;
  opacity: number;
  appearance?: Appearance;
  frame: number;
  stopPass: () => void;
}
interface DrawEntry { entry: Entry; frame: RgbaSpriteAtlasFrame; depth: number; x: number; z: number }
interface PageBatch {
  atlas: RgbaSpriteAtlas;
  geometry: THREE.BufferGeometry;
  colour: THREE.InstancedMesh;
  depth: THREE.InstancedMesh;
  capacity: number;
}
interface SceneBatches { group: THREE.Group; pages: Map<RgbaSpriteAtlas, PageBatch>; stopPass: () => void }

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
    `).replace('#include <uv_vertex>', `
      #include <uv_vertex>
      vMapUv = mix(spriteUv.xy, spriteUv.zw, uv);
      vSpriteOpacity = spriteOpacity;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      varying float vSpriteOpacity;
    `).replace('#include <color_fragment>', `
      #include <color_fragment>
      diffuseColor.a *= vSpriteOpacity;
    `);
  };
  result.customProgramCacheKey = () => 'dst-instanced-archive-sprite-v1';
  return result;
}

/** Render-only batching. Entity nodes, source geometry and alpha picking remain independently owned. */
export class InstancedArchiveSprites implements SceneRenderPass {
  private readonly appearances = new Map<string, Appearance>();
  private readonly entries = new Set<Entry>();
  private readonly scenes = new Map<THREE.Scene, SceneBatches>();
  private readonly matrix = new THREE.Matrix4();
  private readonly frameMatrix = new THREE.Matrix4();

  retain(model: THREE.Object3D, visual: THREE.Group, colour: readonly [number, number, number] = [1, 1, 1], opacity = 1) {
    const entry: Entry = { model, visual, colour: new THREE.Color().setRGB(...colour), opacity, frame: 0,
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
    return { atlas, geometry, colour, depth, capacity };
  }

  private disposeBatch(batch: PageBatch): void {
    batch.colour.removeFromParent(); batch.depth.removeFromParent();
    batch.colour.dispose(); batch.depth.dispose();
    batch.geometry.dispose();
    (batch.colour.material as THREE.Material).dispose();
    (batch.depth.material as THREE.Material).dispose();
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    const draws = new Map<THREE.Scene, Map<RgbaSpriteAtlas, { source: THREE.MeshBasicMaterial; entries: DrawEntry[] }>>();
    for (const entry of this.entries) {
      const appearance = entry.appearance;
      if (!appearance) continue;
      let scene: THREE.Scene | undefined;
      let visible = true;
      for (let node: THREE.Object3D | null = entry.model; node; node = node.parent) {
        if (!node.visible) visible = false;
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
      let pages = draws.get(scene);
      if (!pages) draws.set(scene, pages = new Map());
      let page = pages.get(atlas);
      if (!page) {
        const first = appearance.frames[0][0];
        pages.set(atlas, page = { source: first.materials[first.image.sampler ?? 0], entries: [] });
      }
      const world = entry.model.matrixWorld.elements, view = camera.matrixWorldInverse.elements;
      const x = world[12], y = world[13], z = world[14];
      page.entries.push({ entry, frame, x, z,
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
        page.entries.sort((a, b) => a.depth - b.depth || a.x - b.x || a.z - b.z || a.entry.model.id - b.entry.model.id);
        const uv = batch.geometry.getAttribute('spriteUv') as THREE.InstancedBufferAttribute;
        const opacity = batch.geometry.getAttribute('spriteOpacity') as THREE.InstancedBufferAttribute;
        for (let index = 0; index < page.entries.length; index++) {
          const { entry, frame } = page.entries[index];
          this.frameMatrix.makeScale(frame.width, frame.height, 1).setPosition(frame.minX, frame.minY, 0);
          this.matrix.multiplyMatrices(entry.visual.matrixWorld, this.frameMatrix);
          batch.colour.setMatrixAt(index, this.matrix);
          batch.colour.setColorAt(index, entry.colour);
          uv.setXYZW(index, frame.u0, frame.v0, frame.u1, frame.v1);
          opacity.setX(index, entry.opacity);
        }
        batch.colour.count = batch.depth.count = page.entries.length;
        for (const attribute of [uv, opacity, batch.colour.instanceMatrix, batch.colour.instanceColor!]) {
          attribute.clearUpdateRanges(); attribute.addUpdateRange(0, page.entries.length * attribute.itemSize); attribute.needsUpdate = true;
        }
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
