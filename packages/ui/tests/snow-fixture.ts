import * as THREE from 'three';
import { createSignal, clockstate, seasonstate } from '@dontstarve-web/signals';
import { SnowEffect } from '../../prefab/src/snow';
import { DstLightingRenderer } from '../../../src/dstLighting';

async function checkSnowMotion() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.1, 5000);
  const rate = createSignal(0), cover = createSignal(0);
  const orient = (heading: number) => {
    camera.position.set(Math.cos(heading) * 35, 60, Math.sin(heading) * 35);
    camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    return camera.getWorldQuaternion(new THREE.Quaternion());
  };
  let quaternion = orient(Math.PI / 4);
  const snow = new SnowEffect({ scene, dataBaseUrl: '/dst/data', getFocus: () => new THREE.Vector3(),
    camera, rate, cover, groundSize: 400 });
  try {
    for (let i = 0; i < 100 && !scene.getObjectByName('snow'); i++) await new Promise(resolve => setTimeout(resolve, 50));
    const mesh = scene.getObjectByName('snow') as THREE.Mesh<THREE.BufferGeometry>;
    if (!mesh) throw new Error('Snow motion art did not load');
    rate.set(1); await Promise.resolve();
    snow.update(1 / 30, quaternion); snow.update(1 / 30, quaternion);
    rate.set(0); await Promise.resolve();
    const sample = () => {
      const positions = mesh.geometry.getAttribute('position');
      const result: { x: number; y: number; width: number; size: number }[] = [];
      const focusDepth = -new THREE.Vector3().applyMatrix4(camera.matrixWorldInverse).z;
      for (let i = 0; i < mesh.geometry.drawRange.count / 6; i++) {
        const corners = Array.from({ length: 4 }, (_, k) => new THREE.Vector3()
          .fromBufferAttribute(positions, i * 4 + k).project(camera));
        const center = new THREE.Vector3();
        for (let k = 0; k < 4; k++) center.add(new THREE.Vector3().fromBufferAttribute(positions, i * 4 + k));
        center.multiplyScalar(0.25);
        const depth = -center.applyMatrix4(camera.matrixWorldInverse).z;
        const width = (corners[1].x - corners[0].x) * 240;
        // The previous minimum was a 0.48-unit quad, with near-camera size capped at focus depth.
        const minimumWidth = 0.48 * 360 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(depth, focusDepth));
        result.push({ x: corners.reduce((sum, p) => sum + p.x, 0) / 4,
          y: corners.reduce((sum, p) => sum + p.y, 0) / 4,
          width, size: width / minimumWidth });
      }
      return result;
    };
    const result = [];
    for (const heading of [Math.PI / 4, Math.PI * 3 / 4]) {
      quaternion = orient(heading);
      snow.update(1 / 30, quaternion);
      const before = sample();
      for (let frame = 0; frame < 12; frame++) snow.update(1 / 30, quaternion);
      const after = sample();
      if (before.length !== after.length || before.length === 0) throw new Error('Snow probe lost its fresh particles');
      const distances = before.map((p, i) => ({ dx: after[i].x - p.x, dy: p.y - after[i].y }));
      result.push({ count: after.length, minimumWidth: Math.min(...after.map(p => p.width)),
        minimumSize: Math.min(...after.map(p => p.size)), maximumSize: Math.max(...after.map(p => p.size)),
        sizeStable: before.every((p, i) => Math.abs(p.size - after[i].size) < 0.0001),
        falling: distances.every(p => p.dy > 0),
        driftRatio: distances.reduce((sum, p) => sum + Math.abs(p.dx), 0) / distances.reduce((sum, p) => sum + p.dy, 0) });
    }
    return result;
  } finally { snow.dispose(); }
}

export async function checkSnow() {
  clockstate.set({ phase: 'day', timeinphase: 0.5 });
  seasonstate.set({ season: 'winter', progress: 0.5 });
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(480, 360);
  document.body.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x302b20);
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI));
  const terrain = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x63532a, depthWrite: false }));
  terrain.renderOrder = -2;
  scene.add(terrain);
  const camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.1, 5000);
  camera.position.set(25, 60, 25);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const quaternion = camera.getWorldQuaternion(new THREE.Quaternion());
  const rate = createSignal(0.8), cover = createSignal(0.24);
  const snow = new SnowEffect({ scene, dataBaseUrl: '/dst/data', getFocus: () => new THREE.Vector3(),
    camera, rate, cover, groundSize: 400 });
  const lighting = await DstLightingRenderer.create(renderer, '/dst/data/images/colour_cubes');
  for (let i = 0; i < 100 && (!scene.getObjectByName('snow') || !scene.getObjectByName('SnowGroundOverlay')); i++) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const mesh = scene.getObjectByName('snow') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  const ground = scene.getObjectByName('SnowGroundOverlay') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  if (!mesh || !ground) throw new Error('Snow textures did not load');
  const draw = () => lighting.render(scene, camera);
  const pixels = () => {
    const gl = renderer.getContext(), result = new Uint8Array(480 * 360 * 4);
    gl.readPixels(0, 0, 480, 360, gl.RGBA, gl.UNSIGNED_BYTE, result);
    return result;
  };
  snow.update(1 / 30, quaternion);
  const prefilled = mesh.geometry.drawRange.count / 6;
  // Before the lighting renderer patches materials, isolate the cover against
  // black: the source texture's RGB masks must render white, never coloured art.
  const background = scene.background;
  scene.background = new THREE.Color(0);
  terrain.visible = false; mesh.visible = false;
  renderer.render(scene, camera);
  const coverPixels = pixels();
  let coveredPixels = 0, multicolorPixels = 0;
  for (let i = 0; i < coverPixels.length; i += 4) {
    const channels = [coverPixels[i], coverPixels[i + 1], coverPixels[i + 2]];
    if (Math.max(...channels) > 12) coveredPixels++;
    if (Math.max(...channels) - Math.min(...channels) > 1) multicolorPixels++;
  }
  scene.background = background; terrain.visible = true;
  mesh.visible = false; draw();
  const without = pixels();
  mesh.visible = true; draw();
  const withSnow = pixels();
  let changedPixels = 0;
  for (let i = 0; i < without.length; i += 4) {
    if (Math.abs(withSnow[i] - without[i]) + Math.abs(withSnow[i + 1] - without[i + 1]) + Math.abs(withSnow[i + 2] - without[i + 2]) > 12) changedPixels++;
  }
  // Probe the actual shader: softness changes pixels near the viewport edges,
  // while the central region stays sharp. Selection normally stays per particle.
  const blurAttribute = mesh.geometry.getAttribute('snowBlur') as THREE.BufferAttribute;
  const originalBlur = new Float32Array(blurAttribute.array);
  const eligible = Array.from({ length: prefilled }, (_, i) => originalBlur[i * 4]).filter(value => value > 0).length;
  (blurAttribute.array as Float32Array).fill(0); blurAttribute.needsUpdate = true;
  draw(); const sharpPixels = pixels();
  (blurAttribute.array as Float32Array).fill(1); blurAttribute.needsUpdate = true;
  draw(); const softPixels = pixels();
  let softEdgePixels = 0, softCentrePixels = 0;
  for (let y = 0; y < 360; y++) for (let x = 0; x < 480; x++) {
    const offset = (y * 480 + x) * 4;
    const difference = Math.abs(sharpPixels[offset] - softPixels[offset])
      + Math.abs(sharpPixels[offset + 1] - softPixels[offset + 1]) + Math.abs(sharpPixels[offset + 2] - softPixels[offset + 2]);
    if (difference <= 3) continue;
    const edge = Math.max(Math.abs((x + 0.5) / 240 - 1), Math.abs((y + 0.5) / 180 - 1));
    if (edge > 0.7) softEdgePixels++;
    if (edge < 0.55) softCentrePixels++;
  }
  (blurAttribute.array as Float32Array).set(originalBlur); blurAttribute.needsUpdate = true;
  // A close, depth-writing transparent group would occlude all world-space
  // flakes unless their final group order and disabled depth test both work.
  const obstruction = new THREE.Mesh(new THREE.PlaneGeometry(400, 400),
    new THREE.MeshBasicMaterial({ color: 0x152535, transparent: true, depthWrite: true }));
  obstruction.position.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 5);
  obstruction.quaternion.copy(camera.quaternion);
  const foreground = new THREE.Group();
  foreground.renderOrder = 1_000_001;
  foreground.add(obstruction); scene.add(foreground);
  mesh.visible = false; draw(); const foregroundOnly = pixels();
  mesh.visible = true; draw(); const snowfallInFront = pixels();
  let foregroundSnowPixels = 0;
  for (let i = 0; i < foregroundOnly.length; i += 4) {
    if (Math.abs(foregroundOnly[i] - snowfallInFront[i]) + Math.abs(foregroundOnly[i + 1] - snowfallInFront[i + 1])
      + Math.abs(foregroundOnly[i + 2] - snowfallInFront[i + 2]) > 12) foregroundSnowPixels++;
  }
  foreground.removeFromParent(); obstruction.geometry.dispose(); obstruction.material.dispose();
  const paused = mesh.geometry.getAttribute('position').version;
  snow.update(0, quaternion);
  const pausePreserved = mesh.geometry.getAttribute('position').version === paused;
  rate.set(0); await Promise.resolve();
  for (let frame = 0; frame < 240; frame++) snow.update(1 / 30, quaternion);
  const stopped = { quads: mesh.geometry.drawRange.count / 6, cover: ground.userData.snowCover, groundVisible: ground.visible };
  cover.set(0); await Promise.resolve();
  const melted = !ground.visible;
  const released: string[] = [];
  for (const [label, resource] of [['particles', mesh.geometry], ['material', mesh.material], ['texture', mesh.material.map!],
    ['ground', ground.geometry], ['groundMaterial', ground.material], ['groundTexture', ground.material.map!]] as const) {
    resource.addEventListener('dispose', () => released.push(label));
  }
  snow.dispose(); snow.dispose();
  const removed = !scene.getObjectByName('snow') && !scene.getObjectByName('SnowGroundOverlay');
  // Disposal while async texture work is in flight must not re-add a visual.
  const pending = new SnowEffect({ scene, dataBaseUrl: '/dst/data', getFocus: () => new THREE.Vector3(), camera, rate, cover, groundSize: 400 });
  pending.dispose();
  await new Promise(resolve => setTimeout(resolve, 100));
  const pendingRemoved = !scene.getObjectByName('snow') && !scene.getObjectByName('SnowGroundOverlay');
  lighting.dispose(); terrain.geometry.dispose(); terrain.material.dispose(); renderer.dispose();
  renderer.domElement.remove();
  const motion = await checkSnowMotion();
  return { prefilled, changedPixels, coveredPixels, multicolorPixels, eligible, softEdgePixels, softCentrePixels, foregroundSnowPixels,
    pausePreserved, stopped, melted, released, removed, pendingRemoved, motion };
}
