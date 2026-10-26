import * as THREE from 'three';
import { DstLocalLighting } from '../../../src/dstLocalLighting';
import { createEmptyEntity } from '../../prefab/src/prefabInstance';

/** An entity that declares only a light, as torch and lantern light entities do. */
const lightEntity = (light: Parameters<ReturnType<typeof createEmptyEntity>['instance']['light']['set']>[0]) => {
  const { instance, display } = createEmptyEntity('light'); instance.light.set(light); return display.model;
};
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

export async function checkLocalLightBatch() {
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(64, 64);
  renderer.info.autoReset = false;
  const lighting = new DstLocalLighting(), scene = new THREE.Scene();
  lighting.setAmbientColour(new THREE.Vector3(.05, .1, .15));
  await lighting.prewarm(renderer);
  const previousTarget = new THREE.WebGLRenderTarget(2, 2);
  const originalRender = renderer.render.bind(renderer);
  let submissions = 0;
  renderer.render = (...args) => { submissions++; originalRender(...args); };
  const copyMaterial = new THREE.ShaderMaterial({
    uniforms: { lightmap: { value: lighting.getRenderPassLighting().texture } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: 'varying vec2 vUv; uniform sampler2D lightmap; void main() { gl_FragColor = texture2D(lightmap, vUv); }',
    depthTest: false, depthWrite: false,
  });
  const copyScene = new THREE.Scene(), camera = new THREE.Camera();
  const copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial);
  copyQuad.frustumCulled = false; copyScene.add(copyQuad);
  const sample = () => {
    renderer.setRenderTarget(null); renderer.autoClear = true;
    renderer.render(copyScene, camera);
    const gl = renderer.getContext(), pixel = new Uint8Array(4);
    gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return Array.from(pixel.slice(0, 3));
  };
  const draw = () => {
    lighting.prepareScene(scene);
    renderer.setRenderTarget(previousTarget); renderer.autoClear = false;
    renderer.info.reset(); submissions = 0;
    lighting.renderLightmap(renderer);
    return { calls: renderer.info.render.calls, submissions,
      restored: renderer.getRenderTarget() === previousTarget && renderer.autoClear === false };
  };
  const empty = draw();
  for (const colour of [[1, 0, 0], [0, 1, 0]] as const) {
    scene.add(lightEntity({ radius: 1, intensity: .4, falloff: 1, colour }));
  }
  await settle();
  const overlapping = { ...draw(), pixel: sample() };
  for (let i = 2; i < 10_000; i++) {
    const owner = lightEntity({ radius: 1, intensity: .5, falloff: .5, colour: [1, 1, 1] });
    owner.position.set((i % 100) * 10, 0, Math.floor(i / 100) * 10);
    scene.add(owner);
  }
  await settle();
  const stress = draw();
  // Reuse the grown buffers with a smaller batch before removing every source.
  for (const child of [...scene.children].slice(2)) child.removeFromParent();
  const shrunk = { ...draw(), pixel: sample() };
  scene.clear();
  const removed = { ...draw(), pixel: sample() };
  lighting.dispose();
  const remainingGeometries = renderer.info.memory.geometries;
  copyQuad.geometry.dispose(); copyMaterial.dispose(); previousTarget.dispose(); renderer.dispose();
  return { empty, overlapping, stress, shrunk, removed, remainingGeometries };
}
