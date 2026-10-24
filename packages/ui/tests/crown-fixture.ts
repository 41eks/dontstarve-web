import * as THREE from 'three';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { getPrefabLocalLight } from '../../prefab/src/localLight';
import { DstLocalLighting } from '../../../src/dstLocalLighting';

export async function checkCrown() {
  const player = await createWilsonPlayer('/dst/data/anim');
  player.position.set(0, 0, 0);
  const animation = player.userData.animationController as WilsonAnimationController;
  const scene = new THREE.Scene();
  scene.add(player);
  const camera = new THREE.OrthographicCamera(-7, 7, 14, -1, 0.1, 100);
  camera.position.set(0, 0, 30);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(260, 280);
  document.body.innerHTML = '<div id="crown-gallery"></div>';
  document.body.style.cssText = 'margin:0;background:#182025;color:white;font:14px sans-serif';
  const gallery = document.querySelector<HTMLElement>('#crown-gallery')!;
  gallery.style.cssText = 'display:grid;grid-template-columns:repeat(3,260px);width:780px';
  const visual = player.children[0];
  const mesh = visual.children[0] as THREE.Mesh;
  const capture = (label: string) => {
    renderer.render(scene, camera);
    const canvas = document.createElement('canvas');
    canvas.width = 260; canvas.height = 280;
    canvas.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
    const card = document.createElement('div');
    card.append(canvas);
    const title = document.createElement('div');
    title.textContent = label; title.style.textAlign = 'center';
    card.append(title); gallery.append(card);
    return canvas.toDataURL();
  };
  capture('Unequipped');
  await animation.setHat('alterguardianhat');
  animation.update(0.1);
  const rising = capture('Crown: activating');
  for (let i = 0; i < 9; i++) animation.update(0.1);
  const orbit = capture('Crown: floating orbit');
  const bloomMaterials = (mesh.material as THREE.Material[]).filter(material => material.name.endsWith(':bloom'));
  const withBloom = renderer.domElement.toDataURL();
  bloomMaterials.forEach(material => { material.opacity = 0; });
  renderer.render(scene, camera);
  const bloomChangesPixels = withBloom !== renderer.domElement.toDataURL();
  bloomMaterials.forEach(material => { material.opacity = 0.6; });
  for (let i = 0; i < 14; i++) animation.update(0.1);
  const rotated = capture('Crown: later orbit frame');
  const failures: string[] = [];
  for (const facing of ['down', 'up', 'side'] as const) {
    for (const mirrored of [false, true]) {
      animation.setFacing(facing, mirrored);
      animation.update(0.04);
      const names = mesh.geometry.groups.map(g => (mesh.material as THREE.Material[])[g.materialIndex!].name);
      if (!names[0].includes('hat_alterguardian_equipped') || !names.at(-1)!.includes('hat_alterguardian_equipped')
        || visual.children.length !== 1) failures.push(`${facing}:${mirrored}`);
    }
  }
  animation.setFacing('down');
  await animation.setHat('alterguardianhat', 'alterguardianhat_lastprism');
  for (let i = 0; i < 10; i++) animation.update(0.1);
  capture('Last Prism: floating orbit');
  animation.setSanityPercent(0.85);
  for (let i = 0; i < 6; i++) animation.update(0.1);
  capture('Sanity <= 85%: inactive');

  // Exercise the actual world lightmap and read ground pixels in darkness.
  const light = new DstLocalLighting();
  light.setAmbientColour(new THREE.Vector3(0.01, 0.01, 0.01));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  scene.add(ground);
  const top = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 200);
  top.position.set(0, 80, 0); top.up.set(0, 0, -1); top.lookAt(0, 0, 0);
  top.updateMatrixWorld();
  const draw = () => { light.prepareScene(scene); light.renderLightmap(renderer); renderer.render(scene, top); };
  const sample = (x: number, z: number) => {
    const point = new THREE.Vector3(x, 0, z).project(top);
    const pixels = new Uint8Array(4);
    const gl = renderer.getContext();
    gl.readPixels(Math.floor((point.x + 1) * 130), Math.floor((point.y + 1) * 140),
      1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return Array.from(pixels.slice(0, 3)).reduce((sum, value) => sum + value, 0);
  };
  draw();
  const dark = sample(8, 8);
  animation.setSanityPercent(1);
  draw();
  const lit = sample(8, 8);
  const far = sample(-35, -35);
  player.position.x = 20;
  draw();
  const moved = sample(28, 8);
  await animation.setHat(null);
  draw();
  const removed = sample(28, 8);
  const lightOwner = player.children.find(child => child.name === 'HatActivationLight')!;
  const removedLight = getPrefabLocalLight(lightOwner) === undefined;
  renderer.dispose();
  return { differentFrames: rising !== orbit && orbit !== rotated, bloomChangesPixels, failures,
    groundLight: { dark, lit, far, moved, removed }, removedLight };
}
