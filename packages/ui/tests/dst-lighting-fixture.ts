import * as THREE from 'three';
import { DstLightingRenderer } from '../../../src/dstLighting';
import { getDstCycle } from '../../../src/tuning';
import { clockstate, seasonstate } from '@dontstarve-web/signals';

export async function checkDstLocalLighting() {
  clockstate.set({ phase: 'night', timeinphase: 0 });
  seasonstate.set({ season: 'spring', progress: 0.5 });
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(400, 400);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.append(renderer.domElement);
  const lighting = await DstLightingRenderer.create(renderer, '/dst/data/images/colour_cubes');
  const scene = new THREE.Scene();
  const background = new THREE.Color(0xbfd1e5);
  scene.background = background;
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI));
  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 100);
  camera.position.set(0, 40, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const plane = new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2);
  scene.add(new THREE.Mesh(plane, new THREE.MeshLambertMaterial({ color: 0xffffff })));
  const owner = new THREE.Object3D();
  scene.add(owner);
  const pixels = new Uint8Array(4);
  const sample = (x: number, z: number) => {
    const point = new THREE.Vector3(x, 0.1, z).project(camera);
    renderer.getContext().readPixels(
      Math.floor((point.x + 1) * 200), Math.floor((point.y + 1) * 200),
      1, 1, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, pixels,
    );
    return Array.from(pixels.slice(0, 3));
  };
  const draw = () => lighting.render(scene, camera);
  draw();
  const night = { phase: lighting.getPhase(), season: lighting.getSeason(), centre: sample(0, 0), far: sample(15, 0) };
  lighting.setTorchOwner(owner);
  draw();
  const torch = { centre: sample(0, 0), middle: sample(6, 0), far: sample(15, 0) };

  // Materials arriving after the first frame, including instance transforms.
  const tiles = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }),
    2,
  );
  tiles.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0.1, 2));
  tiles.setMatrixAt(1, new THREE.Matrix4().makeTranslation(15, 0.1, 2));
  scene.add(tiles);
  draw();
  const instances = { near: sample(0, 2), far: sample(15, 2) };
  owner.position.x = 12;
  draw();
  const moved = { previous: sample(0, 0), current: sample(12, 0) };
  lighting.setTorchOwner(null);
  draw();
  const removed = { centre: sample(12, 0), instance: sample(0, 2) };
  clockstate.set({ phase: 'day', timeinphase: 0 });
  await Promise.resolve();
  lighting.update(4);
  draw();
  const day = { near: sample(0, 0), far: sample(15, 0) };
  // Drive the renderer with the same elapsed-time cycle used by the world.
  const cycleFrames = [];
  for (const { elapsed, blend } of [
    { elapsed: 300, blend: 6 },
    { elapsed: 420, blend: 8 },
    { elapsed: 480, blend: 4 },
  ]) {
    const cycle = getDstCycle(elapsed);
    clockstate.set({ phase: cycle.phase, timeinphase: cycle.phaseProgress });
    await Promise.resolve();
    lighting.update(blend / 2);
    draw();
    const halfway = sample(15, 0);
    lighting.update(blend / 2);
    draw();
    cycleFrames.push({ ...cycle, halfway, colour: sample(15, 0) });
  }
  const restoredBackground = scene.background === background;
  lighting.dispose();
  renderer.dispose();
  return { night, torch, instances, moved, removed, day, cycleFrames, restoredBackground };
}
