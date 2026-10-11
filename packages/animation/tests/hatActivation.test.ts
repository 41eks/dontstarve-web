import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HatActivationController, HatEquipmentAssets } from '../../prefab/src/hats';
import { getPrefabLightOverride, getPrefabLocalLight } from '../../prefab/src/localLight';
import { LanternLightController } from '../../prefab/src/lantern';
import { smallHash, type AnimElement } from '../src/animationAssets';
import { createWilsonPlayer } from '../../prefab/src/player';
import { DstLocalLighting } from '../../../src/dstLocalLighting';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function sourceAssets() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const relative = url.replace('/crown-test/', '');
    return new Response(await readFile(new URL(`../../../public/dst/data/anim/${relative}`, import.meta.url)));
  }));
  return new HatEquipmentAssets('/crown-test');
}

const anchor: AnimElement = {
  imageHash: smallHash('hair'), imageIndex: 0, layerHash: smallHash('hair'),
  matrix: [0.8, 0.2, -0.2, 0.8, 10, -190], z: 0,
};

describe('Enlightened Crown source activation', () => {
  it('plays source pre, loops with front/back layers, and retracts at the sanity threshold', async () => {
    const assets = sourceAssets();
    const hat = await assets.load('alterguardianhat');
    const owner = new THREE.Group();
    const lantern = new LanternLightController(owner);
    lantern.setLit(true);
    const lanternLight = getPrefabLocalLight(owner);
    const crown = new HatActivationController(owner);
    crown.setHat(hat);
    expect(getPrefabLocalLight(crown.model)).toMatchObject({ radius: 12, intensity: 0.8, falloff: 0.5 });
    const initial = crown.resolve(anchor, false);
    // Base art has five pieces; the bloom shader supplies their five halos.
    expect([...initial.back, ...initial.front]).toHaveLength(10);
    expect(initial.back.every(({ element }) => element.layerHash === smallHash('back'))).toBe(true);
    expect(initial.front.every(({ element }) => element.layerHash === smallHash('front'))).toBe(true);
    const before = initial.front[0].element.matrix;
    crown.update(14 / 30);
    const loop = crown.resolve(anchor, false);
    expect([...loop.back, ...loop.front]).toHaveLength(10);
    expect(loop.front[0].element.matrix).not.toEqual(before);
    // The same loop frame recurs after the complete source orbit.
    crown.update(160 / 30);
    expect(crown.resolve(anchor, false)).toEqual(loop);
    crown.update(0.4);
    expect(crown.resolve(anchor, false)).not.toEqual(loop);
    const glow = loop.front.find(({ materials }) => materials[0].name.endsWith(':bloom'))!;
    expect(getPrefabLightOverride(glow.materials[0])).toBe(1);
    expect(glow.materials[0].forceSinglePass).toBe(true);

    crown.setSanityPercent(0.85);
    expect(getPrefabLocalLight(crown.model)).toBeUndefined();
    expect(crown.hidesSwapHat).toBe(true);
    crown.update(8 / 30);
    expect(crown.hidesSwapHat).toBe(false);
    expect(crown.isAnimating).toBe(true);
    crown.update(7 / 30);
    expect(crown.isAnimating).toBe(false);
    expect(crown.resolve(anchor, false)).toEqual({ back: [], front: [] });
    crown.setSanityPercent(0.86);
    expect(crown.resolve(anchor, false)).toEqual(initial);
    crown.setHat(null);
    expect(getPrefabLocalLight(crown.model)).toBeUndefined();
    expect(getPrefabLocalLight(owner)).toEqual(lanternLight);
    expect(crown.isAnimating).toBe(false);
  });

  it('updates FX while Wilson is idle and merges both FX layers around the player geometry', async () => {
    sourceAssets();
    const player = await createWilsonPlayer('/crown-test');
    const controller = player.userData.animationController;
    await controller.setHat('alterguardianhat');
    const visual = player.children[0];
    const mesh = visual.children[0] as THREE.Mesh;
    controller.update(0.1);
    const vertices = () => Array.from(mesh.geometry.getAttribute('position').array).slice(0, mesh.geometry.drawRange.count / 6 * 12);
    const before = vertices();
    controller.update(0.1);
    expect(vertices()).not.toEqual(before);
    expect(visual.children).toHaveLength(1);
    const names = mesh.geometry.groups.map(g => (mesh.material as THREE.Material[])[g.materialIndex!].name);
    expect(names[0]).toContain('hat_alterguardian_equipped');
    expect(names.at(-1)).toContain('hat_alterguardian_equipped');
    expect(names.some(name => !name.startsWith('hat:'))).toBe(true);

    // Material glow affects only its group, without brightening Wilson's body.
    const scene = new THREE.Scene();
    scene.add(player);
    const lighting = new DstLocalLighting();
    lighting.prepareScene(scene);
    for (const material of mesh.material as THREE.Material[]) {
      const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' } as unknown as Parameters<THREE.Material['onBeforeCompile']>[0];
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(shader.uniforms.dstLightOverride.value).toBe(getPrefabLightOverride(material) ?? 0);
    }
    await controller.setHat('strawhat');
    expect(getPrefabLocalLight(player.children.find(child => child.name === 'HatActivationLight')!)).toBeUndefined();
    expect((mesh.material as THREE.Material[]).some(material => material.name.includes('hat_alterguardian_equipped'))).toBe(false);
  });
});
