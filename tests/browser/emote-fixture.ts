import { wortox } from '../../packages/prefab/src/wortox';
import { cancelEmote, playBuild, playEmote, playPickup, startMovement } from '../../packages/prefab/src/player_common';
import { createPlayerEquipper } from '../fixtures/playerEquipFixture';
import { advancePlayer, facePlayer, registerPlayer } from '../fixtures/playerVisual';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { type PlayerInstance } from '../../packages/prefab/src/player_common';
import { EMOTES, type EmoteName, type EmoteDefinition } from '../../packages/prefab/src/emotes';
import { Locomotor } from '../../packages/prefab/src/locomotor';
import { mountGameUi } from '../../packages/ui/src';
import { setupEmoteWheel } from '../../src/emoteWheel';
import { input } from '../../src/InputManager';
import { updateMovement } from '../../src/updatePlayerMovement';
import { fixedCamera } from '../../packages/prefab/src/followcamera';
import { EventEmitter } from '../../packages/signals/src';
import { bindActionCancellation, type PlayerActionEvents } from '../../packages/stategraphs/src';

export async function createEmoteFixture() {
  const { emoteWheel } = mountGameUi({ assetBaseUrl: '/dst/data/ui/' });
  const { model, body, instance, display } = wortox('/dst/data/anim', new CANNON.World());
  registerPlayer(model);
  await display.artLoaded();
  instance.setPosition(0, 0, 0);
  body.position.set(0, 4.5, 0);
  body.canJump = true;
  const animation = instance;
  const animationEquipper = createPlayerEquipper(animation);
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
  const movement = updateMovement(fixedCamera(0), model, body, locomotor);
  const requests: string[] = [];
  let worldClicks = 0;
  const actionEvents = new EventEmitter<PlayerActionEvents>();
  bindActionCancellation(
    { actionEvents },
    locomotor,
    () => locomotor.stop(),
    reason => reason === 'emote',
  );
  setupEmoteWheel(emoteWheel, animation, actionEvents, () => {});
  emoteWheel.addEventListener('game:emote-request', event =>
    requests.push((event as CustomEvent<{ emote: string }>).detail.emote),
  );
  renderer.domElement.addEventListener('pointerdown', () => worldClicks++);
  const draw = () => renderer.render(scene, camera);
  draw();
  return {
    animation,
    emoteWheel,
    requests,
    locomotor,
    model,
    /** The emote SGwilson's emote state is playing. */
    get currentEmote() {
      return animation.emote?.id ?? null;
    },
    playEmote: (emote: Parameters<typeof playEmote>[1]) => playEmote(animation, emote),
    get worldClicks() {
      return worldClicks;
    },
    get moving() {
      return input.isPressed('KeyW');
    },
    get velocity() {
      return [body.velocity.x, body.velocity.y, body.velocity.z];
    },
    tick(count = 1) {
      for (let i = 0; i < count; i++) {
        movement(6, 1 / 30);
        startMovement(animation, Math.hypot(body.velocity.x, body.velocity.z) > 0.01 ? 'walk' : 'idle');
        advancePlayer(animation, 1 / 30);
      }
      draw();
    },
    async checkAnimations() {
      const failures: string[] = [];
      let changed = 0;
      for (const id of Object.keys(EMOTES) as EmoteName[]) {
        const definition: EmoteDefinition = EMOTES[id];
        startMovement(animation, 'idle');
        for (const facing of ['up', 'down', 'side'] as const) {
          for (const mirrored of [false, true]) {
            facePlayer(animation, facing, mirrored);
            if (!(await playEmote(animation, id))) {
              failures.push(`start:${id}`);
            }
            const mesh = model.getObjectByProperty('isMesh', true) as THREE.Mesh<
              THREE.BufferGeometry,
              THREE.MeshBasicMaterial[]
            >;
            const before = [...mesh.geometry.getAttribute('position').array];
            for (let f = 0; f < 8; f++) {
              advancePlayer(animation, 1 / 30);
            }
            const after = [...mesh.geometry.getAttribute('position').array];
            if (JSON.stringify(before) !== JSON.stringify(after)) {
              changed++;
            } else {
              failures.push(`static:${id}:${facing}:${mirrored}`);
            }
            if (!mesh.geometry.drawRange.count || mesh.material.some(material => !material.forceSinglePass)) {
              failures.push(`geometry:${id}:${facing}:${mirrored}`);
            }
            for (let f = 0; f < 360; f++) {
              advancePlayer(animation, 1 / 30);
            }
            if (((animation.emote?.id ?? null) === id) !== !!definition.loop) {
              failures.push(`end:${id}`);
            }
            if (id === 'toast' && mesh.material.length < 2) {
              failures.push('toast props');
            }
            cancelEmote(animation);
          }
        }
      }
      await animationEquipper.equip('strawhat', undefined, 'head');
      await animationEquipper.equip('torch');
      await playEmote(animation, 'wave');
      const mesh = model.getObjectByProperty('isMesh', true) as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial[]
      >;
      const equipmentMaterials = mesh.material.map(material => material.name);
      const withTorch = [...mesh.material];
      await animationEquipper.equip(null);
      const torchRendered = withTorch.some(material => !mesh.material.includes(material));
      playPickup(animation);
      const pickupInterrupts = !(animation.emote !== null);
      for (let i = 0; i < 120; i++) {
        advancePlayer(animation, 1 / 30);
      }
      await playEmote(animation, 'dance');
      playBuild(animation, () => true);
      const craftingInterrupts = !(animation.emote !== null) && !(await playEmote(animation, 'happy'));
      for (let i = 0; i < 60; i++) {
        advancePlayer(animation, 1 / 30);
      }
      const started = playEmote(animation, 'sit');
      cancelEmote(animation);
      const cancelledEmote = started && !(animation.emote !== null);
      startMovement(animation, 'idle');
      draw();
      return {
        failures,
        changed,
        equipmentMaterials,
        torchRendered,
        pickupInterrupts,
        craftingInterrupts,
        cancelledEmote,
      };
    },
  };
}
