import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { spawnLightEntity } from '../../prefab/src/localLight';
import { displayLights } from '../../display/src/displaySprites';
import { DstLocalLighting } from '../../../src/dstLocalLighting';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

it('renders and samples only the lights displays list for active entities in the scene', async () => {
  const lighting = new DstLocalLighting(), scene = new THREE.Scene();
  const red = { radius: 4, intensity: .2, falloff: 1, colour: [1, 0, 0] as const };
  const lit = createEmptyEntity('lit'), asleep = createEmptyEntity('asleep'), held = createEmptyEntity('held');
  lit.instance.position.x = 130; asleep.instance.position.x = 131;
  scene.add(lit.display.model, asleep.display.model);
  for (const { instance } of [lit, asleep, held]) instance.light.set(red);
  // A light entity parented to `owner` has no display of its own: the owner's display lists it at the owner.
  const owner = createEmptyEntity('owner'); owner.instance.position.x = 132; scene.add(owner.display.model);
  const child = spawnLightEntity('lanternlight', owner.instance); child.instance.light.set({ ...red, colour: [0, 1, 0] });
  const listedModels = () => [...displayLights()].map(light => light.model);
  let sources = 0;
  const renderer = {
    autoClear: false, getRenderTarget: () => null, setRenderTarget: vi.fn(),
    render: (lightScene: THREE.Scene) => { sources = (lightScene.children[1] as THREE.Mesh<THREE.InstancedBufferGeometry>).geometry.instanceCount; },
  } as unknown as THREE.WebGLRenderer;
  const render = () => { scene.updateMatrixWorld(); lighting.renderLightmap(renderer, scene); };
  const sample = new THREE.Vector3(132, 0, 0);
  try {
    asleep.instance.setActive(false); await settle();
    // A sleeping entity's display lists nothing; one held out of the scene (in a pack) is listed but emits nothing.
    expect(listedModels()).toEqual([lit.display.model, held.display.model, owner.display.model]);
    render();
    expect(sources).toBe(2);
    expect(lighting.sampleLightLevel(sample)).toBeCloseTo(.2 * .2126 + .2 * .7152);
    expect(lighting.sampleLightLevel(sample, lit.display.model)).toBeCloseTo(.2 * .7152); // An entity excludes its own light.
    // The parented light goes out while its parent sleeps and comes back with it.
    owner.instance.setActive(false); await settle();
    expect(listedModels()).toEqual([lit.display.model, held.display.model]);
    owner.instance.setActive(true); await settle();
    expect(listedModels()).toEqual([lit.display.model, held.display.model, owner.display.model]);

    asleep.instance.setActive(true); child.instance.light.set(null); await settle();
    render();
    expect(sources).toBe(2);
    expect(lighting.sampleLightLevel(sample)).toBeCloseTo(.4 * .2126);

    lit.instance.light.set({ ...red, intensity: .5 }); await settle();
    expect(lighting.sampleLightLevel(sample)).toBeCloseTo(.7 * .2126);
    lit.instance.remove(); asleep.instance.remove(); await settle();
    render();
    expect(sources).toBe(0);
    expect(lighting.sampleLightLevel(sample)).toBe(0);
  } finally {
    for (const { instance } of [lit, asleep, held]) instance.remove();
    child.remove(); owner.instance.remove(); await settle();
    lighting.dispose(); scene.clear();
  }
  expect(displayLights().size).toBe(0); // Removed entities release their listing.
});
