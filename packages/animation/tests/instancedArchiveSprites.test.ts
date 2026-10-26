import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import type { Animation, ResolvedSprite } from '../src/animationAssets';
import { InstancedArchiveSprites } from '../src/instancedArchiveSprites';
import { installMatrixGate } from '../src/matrixGate';
import { updateSceneMatrices } from '../src/matrixUpdates';

vi.mock('../src/rgbaSpriteAtlas', async () => {
  const THREE = await import('three');
  return { createResolvedRgbaSpriteAtlasComposer: (animation: Animation, resolve: (index: number) => ResolvedSprite[]) => {
    const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
    let prepared = false;
    const frames = [0, 1].map(frameIndex => ({
      animationName: 'idle', frameIndex, minX: 0, minY: 0, maxX: 2, maxY: 2, width: 2, height: 2,
      u0: frameIndex / 2, v0: 0, u1: (frameIndex + 1) / 2, v1: 1,
    }));
    if (animation.name === 'resized') Object.assign(frames[1], { minX: -2, maxX: 2, width: 4 });
    const page = { texture, width: 4, height: 4, frameRate: 30, resolutionScale: 1, frames };
    const pages = animation.name === 'paged'
      ? frames.map(frame => ({ ...page, texture: texture.clone(), frames: [frame] })) : [page];
    return { step() { if (!prepared) { resolve(0); resolve(1); prepared = true; } return pages; }, cancel() {} };
  } };
});

afterEach(() => vi.restoreAllMocks());

function setup(separateFoot = false) {
  const scene = new THREE.Scene(), parent = new THREE.Group(); scene.add(parent);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 100); camera.position.z = 10;
  const renderer = { domElement: new EventTarget(), capabilities: { maxTextureSize: 4096 },
    getContext: () => ({ isContextLost: () => false }) } as unknown as THREE.WebGLRenderer;
  const instances = new InstancedArchiveSprites();
  const material = new THREE.MeshBasicMaterial();
  const part = { materials: [material], image: { sampler: 0 } } as ResolvedSprite;
  const animation: Animation = { name: 'idle', facing: 255, bankHash: 0, frameRate: 30,
    frames: [{ elements: [] }, { elements: [] }] };
  // The display layer's list: each drawn sprite and its json's light override.
  const members = new Set<{ sprite: ReturnType<InstancedArchiveSprites['retain']>; lightOverride: number }>();
  instances.bindMembers(members);
  const entries = [-3, 0, 3].map(x => {
    const model = new THREE.Group(), visual = new THREE.Group(); model.position.x = x; model.add(visual); parent.add(model);
    const gate = installMatrixGate(model, visual, false, false, true);
    const foot = separateFoot ? new THREE.Group() : model;
    if (separateFoot) { foot.position.copy(model.position); parent.add(foot); }
    const handle = instances.retain(model, visual, [1, 1, 1], 1, foot);
    const member = { sprite: handle, lightOverride: 0 }; members.add(member);
    const show = (frame: number, key = 'idle') => handle.show(key, { ...animation, name: key }, () => () => [part], frame);
    show(0); return { model, visual, foot, handle, member, show, gate };
  });
  const render = () => { updateSceneMatrices(scene); camera.updateMatrixWorld(); instances.render(renderer, camera, undefined, scene); };
  const batch = () => scene.getObjectByName('ArchiveSpriteInstances:colour') as THREE.InstancedMesh;
  return { instances, scene, parent, camera, renderer, material, members, entries, render, batch,
    dispose() { entries.forEach(entry => { entry.handle.dispose(); entry.gate.dispose(); }); instances.dispose(); material.dispose(); } };
}

it('advances only UVs on stationary animation frames, reusing culling, depth ordering, draw lists and unchanged instance attributes', () => {
  const s = setup();
  try {
    s.render();
    const mesh = s.batch(), uv = mesh.geometry.getAttribute('spriteUv') as THREE.BufferAttribute;
    const versions = () => [mesh.instanceMatrix.version, mesh.instanceColor!.version,
      ...['spriteOpacity', 'spriteLightOverride', 'spriteErosion'].map(name => (mesh.geometry.getAttribute(name) as THREE.BufferAttribute).version)];
    const before = versions(), uvBefore = uv.version;
    const cull = vi.spyOn(THREE.Frustum.prototype, 'intersectsSphere'), sort = vi.spyOn(Array.prototype, 'sort');
    const writes = vi.spyOn(Math, 'fround');
    const compares = vi.spyOn(THREE.Matrix4.prototype, 'equals');
    s.entries[0].show(1); s.render();
    const sorts = sort.mock.calls.length, culls = cull.mock.calls.length;
    const floats = writes.mock.calls.length;
    expect(compares.mock.calls.filter(([matrix]) => s.entries.some(entry => matrix === entry.visual.matrixWorld))).toHaveLength(0);
    expect(sorts).toBe(0); expect(culls).toBe(0);
    expect(floats).toBe(4);
    expect(versions()).toEqual(before); expect(uv.version).toBeGreaterThan(uvBefore);
    expect(mesh.count).toBe(3); expect(uv.getX(0)).toBe(.5);
    writes.mockClear();
    s.render(); const repeatedFloats = writes.mock.calls.length;
    expect(repeatedFloats).toBe(0);
    cull.mockClear(); sort.mockClear();
    s.entries[0].model.position.x = 5; s.render();
    const changedSorts = sort.mock.calls.length, changedCulls = cull.mock.calls.length;
    expect(changedSorts).toBe(1); expect(changedCulls).toBe(1);
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(2, matrix);
    expect(matrix.elements[12]).toBe(5); expect(uv.getX(2)).toBe(.5);
  } finally { s.dispose(); }
});

it('draws only listed sprites, reads light from the members, and updates private tint, opacity, erosion and culling', () => {
  const s = setup();
  try {
    s.render(); const mesh = s.batch();
    const cull = vi.spyOn(THREE.Frustum.prototype, 'intersectsSphere');
    // Whether an entity is drawn follows its tile, not its parents; its light is its display's declaration.
    s.parent.visible = false; s.entries[2].member.lightOverride = .6; s.render(); expect(mesh.count).toBe(3);
    expect(mesh.geometry.getAttribute('spriteLightOverride').getX(2)).toBeCloseTo(.6);
    s.parent.visible = true;
    s.entries[0].handle.setColour([.2, .3, .4]); s.entries[0].handle.setOpacity(.5); s.entries[0].handle.setErosion(.25); s.render();
    expect(mesh.count).toBe(3); expect(cull).not.toHaveBeenCalled();
    expect(mesh.instanceColor!.getX(0)).toBeCloseTo(.2);
    expect(mesh.geometry.getAttribute('spriteOpacity').getX(0)).toBe(.5);
    expect(mesh.geometry.getAttribute('spriteErosion').getX(0)).toBe(.25);
    s.entries[0].member.lightOverride = .1; s.render();
    expect(mesh.geometry.getAttribute('spriteLightOverride').getX(0)).toBeCloseTo(.1);
    s.entries[0].member.lightOverride = 0; s.render();
    expect(mesh.geometry.getAttribute('spriteLightOverride').getX(0)).toBe(0);
    s.camera.position.x = 100; s.render();
    expect(cull).toHaveBeenCalledTimes(3); expect(mesh.count).toBe(0);
    s.camera.position.x = 0; s.render(); expect(mesh.count).toBe(3);
    s.entries[0].handle.hide(); s.render(); expect(mesh.count).toBe(2);
    s.entries[0].show(1); s.render(); expect(mesh.count).toBe(3);
    s.entries[0].visual.visible = false; s.render(); expect(mesh.count).toBe(2);
    s.entries[0].visual.visible = true; s.render(); expect(mesh.count).toBe(3);
    // A retained sprite the display layer does not list is not drawn; listing it again draws it.
    s.members.delete(s.entries[1].member); s.render(); expect(mesh.count).toBe(2);
    s.members.add(s.entries[1].member); s.render(); expect(mesh.count).toBe(3);
    // A display may still list a released instance until its art changes; it draws nothing.
    s.entries[0].handle.dispose(); s.render(); expect(mesh.count).toBe(2);
    cull.mockClear(); s.parent.position.x = 1; s.render();
    expect(cull).toHaveBeenCalledTimes(2); // Both remaining entities move with their parent.
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBe(1);
  } finally { s.dispose(); }
});

it('orders by the independent foot point and refreshes culling and ordering when the camera turns or zooms', () => {
  const s = setup(true);
  try {
    s.entries.forEach((entry, index) => { entry.foot.position.z = index - 1; entry.handle.setColour([index / 2, 1, 1]); });
    s.render(); const mesh = s.batch();
    const cull = vi.spyOn(THREE.Frustum.prototype, 'intersectsSphere');
    s.entries[0].foot.position.z = 2; s.render();
    expect(cull).not.toHaveBeenCalled();
    expect(mesh.instanceColor!.getX(2)).toBe(0);
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(2, matrix);
    expect(matrix.elements[12]).toBe(-3); // The visual stays at its own transform.
    s.camera.position.z = -10; s.camera.lookAt(0, 0, 0); s.render();
    expect(cull).toHaveBeenCalledTimes(3);
    expect(mesh.instanceColor!.getX(0)).toBe(0);
    expect(mesh.instanceColor!.getX(2)).toBe(.5);
    cull.mockClear();
    s.camera.left = -.5; s.camera.right = .5; s.camera.updateProjectionMatrix(); s.render();
    expect(cull).toHaveBeenCalledTimes(3); expect(mesh.count).toBe(1);
    expect(mesh.instanceColor!.getX(0)).toBe(.5);
  } finally { s.dispose(); }
});

it('invalidates transformed bounds on appearance changes and keeps a recycled page correct', () => {
  const s = setup();
  try {
    s.entries.slice(1).forEach(entry => entry.handle.hide());
    s.entries[0].model.position.x = 12;
    s.entries[0].show(0, 'resized'); s.render(); expect(s.batch()).toBeUndefined();
    const cull = vi.spyOn(THREE.Frustum.prototype, 'intersectsSphere');
    s.entries[0].show(1, 'resized'); s.render();
    expect(cull).toHaveBeenCalledTimes(1);
    const mesh = s.batch(); expect(mesh.count).toBe(1);
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix);
    expect(matrix.elements[0]).toBe(4); expect(matrix.elements[12]).toBe(10);
    s.entries[0].model.position.x = 0; s.entries[0].show(0, 'paged'); s.render();
    const firstTexture = (mesh.material as THREE.MeshBasicMaterial).map;
    expect(s.batch()).toBe(mesh);
    s.entries[0].show(1, 'paged'); s.render();
    expect(s.batch()).toBe(mesh); expect(mesh.count).toBe(1);
    expect((mesh.material as THREE.MeshBasicMaterial).map).not.toBe(firstTexture);
    expect(mesh.geometry.getAttribute('spriteUv').getX(0)).toBe(.5);
    mesh.getMatrixAt(0, matrix); expect(matrix.elements[0]).toBe(2); expect(matrix.elements[12]).toBe(0);
    s.entries[0].handle.hide(); s.render(); expect(mesh.parent).toBeNull();
    s.entries[0].handle.setOpacity(.25); s.entries[0].show(1, 'paged'); s.render();
    expect(s.batch()).toBe(mesh); expect(mesh.geometry.getAttribute('spriteOpacity').getX(0)).toBe(.25);
  } finally { s.dispose(); }
});

it('retains all unconsumed attribute update ranges across passes', () => {
  const s = setup();
  try {
    s.render(); const uv = s.batch().geometry.getAttribute('spriteUv') as THREE.BufferAttribute;
    uv.clearUpdateRanges(); // Model the first upload having been consumed by WebGL.
    s.entries[0].show(1); s.render();
    expect(uv.updateRanges).toEqual([{ start: 0, count: 3 }]);
    s.entries[2].show(1); s.render();
    expect(uv.updateRanges).toEqual([{ start: 0, count: 11 }]);
    const version = uv.version;
    s.render(); expect(uv.version).toBe(version);
    expect(uv.updateRanges).toEqual([{ start: 0, count: 11 }]);
  } finally { s.dispose(); }
});
