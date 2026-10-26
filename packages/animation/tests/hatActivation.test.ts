import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HatActivationController, HatEquipmentAssets } from '../../prefab/src/hats';
import { getMaterialLightOverride } from '../src/lightOverride';
import { LanternLightController } from '../../prefab/src/lantern';
import { smallHash, type AnimElement } from '../src/animationAssets';
import { createSanityState } from '@dontstarve-web/signals';
import { prefabInstance } from '../../prefab/src/prefabInstance';

/** The inst.Light an entity's model declares. */
const declaredLight = (model: THREE.Object3D) => prefabInstance(model)?.light.peek();

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
    const lanternNode = owner.getObjectByName('lanternlight')!;
    const lanternLight = declaredLight(lanternNode);
    const crownLight = () => { const node = owner.getObjectByName('alterguardianhatlight'); return node && declaredLight(node); };
    const sanity = createSanityState(169, 200);
    const sanityRead = vi.spyOn(sanity.percent, 'get');
    const crown = new HatActivationController(owner, sanity.percent);
    expect(sanityRead).toHaveBeenCalledOnce();
    crown.setHat(hat);
    expect(crown.activated.peek()).toBe(false);
    expect(crownLight()).toBeUndefined();
    sanity.set(171);
    expect(crown.activated.peek()).toBe(true);
    expect(crownLight()).toMatchObject({ radius: 12, intensity: 0.8, falloff: 0.5 });
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
    expect(getMaterialLightOverride(glow.materials[0])).toBe(1);
    expect(glow.materials[0].forceSinglePass).toBe(true);

    sanity.set(170);
    expect(crown.activated.peek()).toBe(false);
    expect(crownLight()).toBeUndefined();
    expect(crown.hidesSwapHat).toBe(true);
    crown.update(8 / 30);
    expect(crown.hidesSwapHat).toBe(false);
    expect(crown.isAnimating).toBe(true);
    crown.update(7 / 30);
    expect(crown.isAnimating).toBe(false);
    expect(crown.resolve(anchor, false)).toEqual({ back: [], front: [] });
    sanity.set(172);
    expect(crown.resolve(anchor, false)).toEqual(initial);
    crown.setHat(null);
    expect(crownLight()).toBeUndefined();
    expect(declaredLight(lanternNode)).toEqual(lanternLight);
    expect(crown.isAnimating).toBe(false);
    sanityRead.mockClear();
    sanity.set(200);
    expect(sanityRead).toHaveBeenCalledOnce();
    crown.setHat(hat);
    expect(crown.activated.peek()).toBe(true);
    crown.dispose();
    sanityRead.mockClear();
    sanity.set(0);
    expect(sanityRead).not.toHaveBeenCalled();
    expect(crownLight()).toBeUndefined();
    lantern.dispose();
  });

});
