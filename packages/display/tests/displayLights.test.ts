import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { spawnLightEntity } from '../../prefab/src/localLight';
import { displayLights } from '../src/displaySprites';
import { DstLocalLighting, sampleLightLevel } from '../src/localLighting';
import { injectOceanShading, oceanShadingMaterialUniforms } from '../../animation/src/oceanShading';

const NO_AMBIENT = new THREE.Vector3();
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

it('renders and samples only the lights displays list for active entities in the scene', async () => {
  const lighting = new DstLocalLighting(),
    scene = new THREE.Scene();
  const red = { radius: 4, intensity: 0.2, falloff: 1, colour: [1, 0, 0] as const };
  const lit = createEmptyEntity('lit'),
    asleep = createEmptyEntity('asleep'),
    held = createEmptyEntity('held');
  lit.instance.setPosition(130, 0, 0);
  asleep.instance.setPosition(131, 0, 0);
  scene.add(lit.display.model, asleep.display.model);
  for (const { instance } of [lit, asleep, held]) {
    instance.light.set(red);
  }
  // A light entity parented to `owner` has no display of its own: the owner's display lists it at the owner.
  const owner = createEmptyEntity('owner');
  owner.instance.setPosition(132, 0, 0);
  scene.add(owner.display.model);
  const child = spawnLightEntity('lanternlight', owner.instance);
  child.instance.light.set({ ...red, colour: [0, 1, 0] });
  const listedModels = () => [...displayLights()].map(light => light.model);
  let sources = 0;
  const renderer = {
    autoClear: false,
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(),
    render: (lightScene: THREE.Scene) => {
      sources = (lightScene.children[1] as THREE.Mesh<THREE.InstancedBufferGeometry>).geometry.instanceCount;
    },
  } as unknown as THREE.WebGLRenderer;
  const render = () => {
    scene.updateMatrixWorld();
    lighting.renderLightmap(renderer, scene);
  };
  const sample = new THREE.Vector3(132, 0, 0);
  try {
    asleep.instance.setActive(false);
    await settle();
    // A sleeping entity's display lists nothing; one held out of the scene (in a pack) is listed but emits nothing.
    expect(listedModels()).toEqual([lit.display.model, held.display.model, owner.display.model]);
    render();
    expect(sources).toBe(2);
    expect(sampleLightLevel(sample, NO_AMBIENT)).toBeCloseTo(0.2 * 0.2126 + 0.2 * 0.7152);
    expect(sampleLightLevel(sample, NO_AMBIENT, lit.display.model)).toBeCloseTo(0.2 * 0.7152); // An entity excludes its own light.
    // The parented light goes out while its parent sleeps and comes back with it.
    owner.instance.setActive(false);
    await settle();
    expect(listedModels()).toEqual([lit.display.model, held.display.model]);
    owner.instance.setActive(true);
    await settle();
    expect(listedModels()).toEqual([lit.display.model, held.display.model, owner.display.model]);

    asleep.instance.setActive(true);
    child.instance.light.set(null);
    await settle();
    render();
    expect(sources).toBe(2);
    expect(sampleLightLevel(sample, NO_AMBIENT)).toBeCloseTo(0.4 * 0.2126);

    lit.instance.light.set({ ...red, intensity: 0.5 });
    await settle();
    expect(sampleLightLevel(sample, NO_AMBIENT)).toBeCloseTo(0.7 * 0.2126);
    lit.instance.remove();
    asleep.instance.remove();
    await settle();
    render();
    expect(sources).toBe(0);
    expect(sampleLightLevel(sample, NO_AMBIENT)).toBe(0);
  } finally {
    for (const { instance } of [lit, asleep, held]) {
      instance.remove();
    }
    child.remove();
    owner.instance.remove();
    await settle();
    lighting.dispose();
    scene.clear();
  }
  expect(displayLights().size).toBe(0); // Removed entities release their listing.
});

it("lights a depth-offset or ocean copy compiled through its lit source once, with the copy's own override", () => {
  const lighting = new DstLocalLighting(),
    renderer = {
      autoClear: false,
      getRenderTarget: () => null,
      setRenderTarget: vi.fn(),
      render: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
  const object = new THREE.Object3D();
  const basicShader = () =>
    ({
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
      uniforms: {},
    }) as unknown as THREE.WebGLProgramParametersWithUniforms;
  const count = (text: string, part: string) => text.split(part).length - 1;
  try {
    lighting.renderLightmap(renderer, new THREE.Scene());
    const source = new THREE.MeshBasicMaterial();
    lighting.prepareDrawnMaterial(source, object, renderer);
    // animationAssets copyOffset: the copy compiles through the source's callback, then adds the ocean shading.
    const copy = new THREE.MeshBasicMaterial().copy(source),
      ocean = oceanShadingMaterialUniforms({ float: [0, 1, 1], blend: 1 });
    copy.onBeforeCompile = (shader, gl) => {
      source.onBeforeCompile(shader, gl);
      injectOceanShading(shader, ocean);
    };
    lighting.prepareDrawnMaterial(copy, object, renderer);
    const shader = basicShader();
    copy.onBeforeCompile(shader, renderer);
    expect(count(shader.vertexShader, 'varying vec2 vDstWorldXZ')).toBe(1);
    expect(count(shader.vertexShader, 'vec4 dstWorldPosition')).toBe(1);
    expect(count(shader.fragmentShader, 'uniform sampler2D dstLightmap')).toBe(1);
    expect(count(shader.fragmentShader, 'vec3 dstDisplay')).toBe(1);
    expect(count(shader.vertexShader, 'varying vec3 vDstOceanWorld')).toBe(1);
    // The override the copy is drawn with is the copy's, not its source's.
    const sourceShader = basicShader();
    source.onBeforeCompile(sourceShader, renderer);
    expect(shader.uniforms.dstLightOverride).not.toBe(sourceShader.uniforms.dstLightOverride);
  } finally {
    lighting.dispose();
  }
});
