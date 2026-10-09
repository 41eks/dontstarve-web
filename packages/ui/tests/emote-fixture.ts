import * as THREE from 'three';
import { createWilsonPlayerPrefab, type WilsonAnimationController } from '../../prefab/src/player';
import { WILSON_EMOTES, type WilsonEmote, type WilsonEmoteDefinition } from '../../prefab/src/emotes';
import { Locomotor } from '../../prefab/src/locomotor';
import { mountGameUi } from '../src';
import { setupEmoteWheel } from '../../../src/emoteWheel';
import { input } from '../../../src/InputManager';
import { updateMovement } from '../../../src/updatePlayerMovement';

export async function createEmoteFixture() {
  const { emoteWheel } = mountGameUi({ assetBaseUrl: '/dst/data/ui/' });
  const { model, body } = await createWilsonPlayerPrefab('/dst/data/anim');
  model.position.set(0, 0, 0);
  body.position.set(0, 4.5, 0);
  body.canJump = true;
  const animation = model.userData.animationController as WilsonAnimationController;
  const locomotor = new Locomotor(body);
  const renderer = new THREE.WebGLRenderer({ alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(600, 480);
  renderer.domElement.id = 'emote-world';
  document.body.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#454b35');
  scene.add(model);
  const camera = new THREE.PerspectiveCamera(35, 600 / 480, 0.1, 100);
  camera.position.set(0, 3, 20);
  camera.lookAt(0, 1.7, 0);
  const movement = updateMovement(camera, model, body, locomotor);
  const requests: string[] = [];
  let worldClicks = 0;
  setupEmoteWheel(emoteWheel, renderer.domElement, animation, () => locomotor.stop(), () => {}, () => {});
  emoteWheel.addEventListener('game:emote-request', (event) => requests.push((event as CustomEvent<{ emote: string }>).detail.emote));
  renderer.domElement.addEventListener('pointerdown', () => worldClicks++);
  const draw = () => renderer.render(scene, camera);
  draw();
  return {
    animation, emoteWheel, requests, locomotor, model,
    get worldClicks() { return worldClicks; },
    get moving() { return input.isPressed('KeyW'); },
    get velocity() { return [body.velocity.x, body.velocity.y, body.velocity.z]; },
    tick(count = 1) {
      for (let i = 0; i < count; i++) {
        movement(6, 1 / 30);
        animation.start(Math.hypot(body.velocity.x, body.velocity.z) > 0.01 ? 'walk' : 'idle');
        animation.update(1 / 30);
      }
      draw();
    },
    async checkAnimations() {
      const failures: string[] = [];
      let changed = 0;
      for (const id of Object.keys(WILSON_EMOTES) as WilsonEmote[]) {
        const definition: WilsonEmoteDefinition = WILSON_EMOTES[id];
        animation.start('idle');
        for (const facing of ['up', 'down', 'side'] as const) {
          for (const mirrored of [false, true]) {
            animation.setFacing(facing, mirrored);
            if (!await animation.playEmote(id)) failures.push(`start:${id}`);
            const mesh = model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
            const before = [...mesh.geometry.getAttribute('position').array];
            for (let f = 0; f < 8; f++) animation.update(1 / 30);
            const after = [...mesh.geometry.getAttribute('position').array];
            if (JSON.stringify(before) !== JSON.stringify(after)) changed++;
            else failures.push(`static:${id}:${facing}:${mirrored}`);
            if (!mesh.geometry.drawRange.count || mesh.material.some((material) => !material.forceSinglePass)) {
              failures.push(`geometry:${id}:${facing}:${mirrored}`);
            }
            for (let f = 0; f < 360; f++) animation.update(1 / 30);
            if ((animation.currentEmote === id) !== !!definition.loop) failures.push(`end:${id}`);
            if (id === 'toast' && mesh.material.length < 2) {
              failures.push('toast props');
            }
            animation.cancelEmote();
          }
        }
      }
      await animation.setHat('strawhat');
      await animation.setCarryItem('torch');
      await animation.playEmote('wave');
      const mesh = model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
      const equipmentMaterials = mesh.material.map((material) => material.name);
      const withTorch = [...mesh.material];
      await animation.setCarryItem(null);
      const torchRendered = withTorch.some((material) => !mesh.material.includes(material));
      animation.playPickup();
      const pickupInterrupts = !animation.isEmoting;
      for (let i = 0; i < 120; i++) animation.update(1 / 30);
      await animation.playEmote('dance');
      animation.setCrafting(true);
      const craftingInterrupts = !animation.isEmoting && !await animation.playEmote('happy');
      animation.setCrafting(false);
      const pending = animation.playEmote('sit');
      animation.cancelEmote();
      const cancelledRequest = !await pending && !animation.isEmoting;
      animation.start('idle');
      draw();
      return { failures, changed, equipmentMaterials, torchRendered, pickupInterrupts, craftingInterrupts, cancelledRequest };
    },
  };
}
