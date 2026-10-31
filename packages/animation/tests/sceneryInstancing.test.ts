import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { prefabDisplay, type PrefabDisplay } from '@dontstarve-web/display';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { StalagmiteManager } from '../../prefab/src/stalagmite';
import { LichenManager } from '../../prefab/src/lichen';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { prewarmScenePasses, renderScenePasses } from '../src/sceneRenderPass';
import { bindTestWorld } from './worldContentFixture';

// Exercise the real archive decoder, atlas layout, display membership and instance batches.
// Only browser canvas drawing and GPU submission are replaced in this Node test.
class Canvas {
  width = 0; height = 0;
  getContext() { return {
    createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData() {}, setTransform() {}, resetTransform() {}, drawImage() {},
  }; }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('batches both stalagmite banks and the lichen idle loop, retaining instance tint, playback and tile residency', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const world = bindTestWorld(scheduler);
  const displays = new Set<PrefabDisplay>();
  const tickingarea = () => createMemo(() => awake.get());
  const rocks = new StalagmiteManager(scene, { scheduler, tickingarea, spawnLoot: () => undefined,
    trackDisplay: display => displays.add(display) });
  const lichens = new LichenManager(scene, '/dst/data/anim', { tickingarea, spawnGroundItem: () => undefined });
  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, .1, 1000);
  camera.position.set(0, 30, 30); camera.lookAt(0, 0, 0);
  const renderer = { domElement: new EventTarget(), capabilities: { maxTextureSize: 4096 }, extensions: { has: () => false },
    getContext: () => ({ isContextLost: () => false }), initTexture() {}, compileAsync: async () => {} } as unknown as THREE.WebGLRenderer;
  const batches = () => {
    const result: THREE.InstancedMesh[] = [];
    scene.traverse(object => { if (object instanceof THREE.InstancedMesh && object.name === 'ArchiveSpriteInstances:colour') result.push(object); });
    return result;
  };
  const update = (dt: number) => {
    scheduler.advance(dt);
    for (const display of displays) display.update(dt);
    lichens.update(dt, new THREE.Quaternion());
  };
  try {
    const models = [
      rocks.spawn('stalagmite', new THREE.Vector3(-6, 0, 0)), rocks.spawn('stalagmite_full', new THREE.Vector3(-4, 0, 0)),
      rocks.spawn('stalagmite_tall', new THREE.Vector3(-1, 0, 0)), rocks.spawn('stalagmite_tall_full', new THREE.Vector3(1, 0, 0)),
      lichens.spawn(new THREE.Vector3(5, 0, 0)), lichens.spawn(new THREE.Vector3(7, 0, 0)),
    ];
    const instances = models.map(model => prefabInstance(model)!);
    // Compare two copies of one tall pose; the source's random handedness is otherwise independent per entity.
    instances[3].sprite.playOnce(instances[2].sprite.sprite.peek().clip.name);
    const greys = [.5, 1, .6, .9, .75, .95];
    instances.forEach((inst, index) => inst.sprite.setColour([greys[index], greys[index], greys[index]]));
    instances.slice(4).forEach(inst => inst.sprite.setFrame(0));
    await Promise.all(models.map(model => prefabDisplay(model)!.artLoaded()));
    update(0);
    await prewarmScenePasses(renderer, scene, camera);
    renderScenePasses(renderer, scene, camera);
    const initial = batches();
    expect(initial.map(mesh => mesh.count).sort()).toEqual([2, 2, 2]);
    const colours = initial.flatMap(mesh => Array.from({ length: mesh.count }, (_, index) => mesh.instanceColor!.getX(index)));
    expect(colours.sort()).toEqual(greys.map(value => Math.fround(value)).sort());
    for (const [index, model] of models.entries()) {
      const proxies: THREE.Mesh[] = [];
      model.traverse(object => { if (object instanceof THREE.Mesh) proxies.push(object); });
      expect(proxies.length).toBeGreaterThan(0);
      expect(proxies.every(mesh => !mesh.visible)).toBe(true); // Picking proxies never duplicate batch draw calls.
      expect(instances[index].sprite.sprite.peek().clip.loop).toBe(index >= 4);
    }
    const lichenBatch = initial.find(mesh => Array.from({ length: mesh.count }, (_, i) => mesh.instanceColor!.getX(i)).includes(.75))!;
    const uv = lichenBatch.geometry.getAttribute('spriteUv') as THREE.BufferAttribute;
    const before = Array.from(uv.array);
    update(.1); renderScenePasses(renderer, scene, camera);
    expect(Array.from(uv.array)).not.toEqual(before); // Looping idle advances inside the same mesh.
    expect(batches()).toEqual(initial);

    const saved = [rocks.exportRecords(), lichens.exportRecords()], requests = vi.mocked(fetch).mock.calls.length;
    awake.set(false); await new Promise(resolve => setTimeout(resolve, 0));
    renderScenePasses(renderer, scene, camera);
    expect(batches()).toHaveLength(0);
    awake.set(true); await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.all(models.map(model => prefabDisplay(model)!.artLoaded()));
    update(0); renderScenePasses(renderer, scene, camera);
    expect(batches().map(mesh => mesh.count).sort()).toEqual([2, 2, 2]);
    expect(batches().every(mesh => initial.includes(mesh))).toBe(true);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(requests);
    expect([rocks.exportRecords(), lichens.exportRecords()]).toEqual(saved);
    expect(instances.map(inst => inst.sprite.sprite.peek().colour![0])).toEqual(greys);
  } finally { rocks.dispose(); lichens.dispose(); world.unbind(); scheduler.dispose(); }
});
