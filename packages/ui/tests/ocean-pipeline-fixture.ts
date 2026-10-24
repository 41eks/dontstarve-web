import * as THREE from 'three';
import { prewarmScenePasses, renderScenePasses } from '@dontstarve-web/animation/sceneRenderPass';
import { OceanRenderPipeline } from '../../prefab/src/oceanRenderPipeline';

export async function checkOceanPipeline() {
  const renderer = new THREE.WebGLRenderer();
  renderer.setPixelRatio(2);
  renderer.setSize(120, 80);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-192, 192, 192, -192, 0.1, 100);
  camera.position.set(0, 50, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  const noise = new THREE.DataTexture(new Uint8Array([0, 128, 0, 255]), 1, 1, THREE.RGBAFormat);
  noise.needsUpdate = true;
  const lightmap = new THREE.DataTexture(new Uint8Array([64, 128, 255, 255]), 1, 1, THREE.RGBAFormat);
  lightmap.needsUpdate = true;
  const pipeline = new OceanRenderPipeline(noise, { size: 384, tileSize: 12, isOceanTileAt: col => col >= 0 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(192, 384).rotateX(-Math.PI / 2));
  mesh.position.x = 96;
  mesh.renderOrder = -1.75;
  scene.add(mesh);
  pipeline.attach(mesh);
  const floor = new THREE.Vector3(0, 19 / 255, 20 / 255);
  pipeline.setPhase(0.25, floor);
  const output = new THREE.WebGLRenderTarget(240, 160);
  renderer.setRenderTarget(output);
  renderer.setClearColor(0x213141, 0.42);
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  const beforeViewport = renderer.getCurrentViewport(new THREE.Vector4()).toArray();
  const beforeColour = renderer.getClearColor(new THREE.Color()).toArray();
  const targets = new Map<string, THREE.WebGLRenderTarget>();
  const setTarget = renderer.setRenderTarget.bind(renderer);
  renderer.setRenderTarget = (target, face, mip) => {
    if (target?.texture.name.startsWith('DST ocean ')) targets.set(target.texture.name, target);
    setTarget(target, face, mip);
  };
  await prewarmScenePasses(renderer, scene, camera);
  const lighting = { texture: lightmap, extents: new THREE.Vector4(-192, -192, 1 / 384, 1 / 384),
    ambient: new THREE.Vector3(1, 1, 1) };
  renderScenePasses(renderer, scene, camera, lighting);
  const statePreserved = renderer.getRenderTarget() === output && renderer.autoClear === false
    && renderer.getClearAlpha() === 0.42 && renderer.getScissorTest()
    && JSON.stringify(renderer.getCurrentViewport(new THREE.Vector4()).toArray()) === JSON.stringify(beforeViewport)
    && JSON.stringify(renderer.getClearColor(new THREE.Color()).toArray()) === JSON.stringify(beforeColour);
  const readHalf = (name: string, x: number, y: number) => {
    const target = targets.get(name);
    if (!target) throw new Error(`Missing ocean stage: ${name}`);
    const values = new Uint16Array(4);
    renderer.readRenderTargetPixels(target, x, y, 1, 1, values);
    return [...values].map(value => THREE.DataUtils.fromHalfFloat(value));
  };
  const dayFar = readHalf('DST ocean blurred day', 31, 16);
  const duskFar = readHalf('DST ocean blurred dusk', 31, 16);
  const primaryFar = readHalf('DST ocean blurred primary', 31, 16);
  const blendFar = readHalf('DST ocean day-dusk blend', 31, 16);
  const landBoundary = readHalf('DST ocean blurred day', 15, 16);
  const seaBoundary = readHalf('DST ocean blurred day', 16, 16);
  const sample = new THREE.Vector3(180, 0, 6).project(camera);
  const px = Math.floor((sample.x + 1) * 120), py = Math.floor((sample.y + 1) * 80);
  const encoded = readHalf('DST ocean encoded screen colour', px, py);
  const screen = targets.get('DST ocean encoded screen colour')!;
  const initialSize = [screen.width, screen.height];
  // Resolve must decode the HDR result, blend once over the unlit clear colour,
  // and leave opaque alpha. The scene target itself stores linear RGB.
  renderer.setScissorTest(false);
  renderer.render(scene, camera);
  const resolved = new Uint8Array(4);
  renderer.readRenderTargetPixels(output, px, py, 1, 1, resolved);
  const decodedLinear = new THREE.Color().setRGB(encoded[0] * 0.5, encoded[1] * 0.5, encoded[2] * 0.5, THREE.SRGBColorSpace);
  const floorLinear = new THREE.Color().setRGB(floor.x, floor.y, floor.z, THREE.SRGBColorSpace);
  const expectedResolved = floorLinear.lerp(decodedLinear, encoded[3]).toArray();
  output.setSize(96, 64);
  renderer.setRenderTarget(output);
  renderScenePasses(renderer, scene, camera, lighting);
  const resized = [screen.width, screen.height];
  let borrowedNoiseDisposed = false;
  noise.addEventListener('dispose', () => { borrowedNoiseDisposed = true; });
  let targetsDisposed = 0;
  for (const target of targets.values()) target.addEventListener('dispose', () => targetsDisposed++);
  pipeline.dispose();
  const beforeRemovedPass = renderer.info.render.frame;
  renderScenePasses(renderer, scene, camera, lighting);
  const removedPass = renderer.info.render.frame === beforeRemovedPass;
  const result = { dayFar, duskFar, primaryFar, blendFar, landBoundary, seaBoundary, encoded,
    resolved: [...resolved].map(value => value / 255), expectedResolved, initialSize, resized,
    statePreserved, targetsDisposed, borrowedNoiseDisposed, removedPass };
  mesh.geometry.dispose();
  noise.dispose(); lightmap.dispose(); output.dispose(); renderer.dispose();
  return result;
}
