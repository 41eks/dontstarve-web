import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {
  createAnimatedSprite,
  type SpriteAnimationController,
} from '@dontstarve-web/animation/sprite';
import type { PointerContext } from './worldContext';
import { MakeObstaclePhysics } from './standardcomponents';
import definitions from './definitions.json' with { type: 'json' };

export interface PigKingPrefabOptions {
  position?: THREE.Vector3;
  scale?: number;
}

export interface PigKingPrefab {
  body: CANNON.Body;
  standee: THREE.Group;
  setNormal(cameraWorldQuaternion: THREE.Quaternion): void;
  setupInteraction(context: PointerContext): () => void;
  update(dt: number): void;
}


export async function createPigKing(
  assetBaseUrl: string,
  options: PigKingPrefabOptions = {},
): Promise<PigKingPrefab> {
  const standee = await createAnimatedSprite(assetBaseUrl, definitions.pigKing.archive, {
    initialAnimation: definitions.pigKing.animationName,
    name: 'PigKingStandee',
    scale: options.scale ?? definitions.pigKing.scale,
  });
  const position = options.position ?? new THREE.Vector3(0, 0, 25);
  standee.position.copy(position);
  standee.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(standee);
  standee.position.y += position.y - bounds.min.y;

  const animation = standee.userData.animationController as SpriteAnimationController;
  // pigking.lua: MakeObstaclePhysics(inst, 2, .5)
  const body = MakeObstaclePhysics({ x: standee.position.x, y: position.y, z: standee.position.z }, 2, .5);

  return {
    body,
    standee,
    setNormal(cameraWorldQuaternion) {
      standee.quaternion.copy(cameraWorldQuaternion);
    },
    setupInteraction({ camera, renderer }) {
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const handlePointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || event.defaultPrevented) return;

        const rendererBounds = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rendererBounds.left) / rendererBounds.width) * 2 - 1;
        pointer.y = -((event.clientY - rendererBounds.top) / rendererBounds.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        standee.updateWorldMatrix(true, true);
        if (raycaster.intersectObject(standee, true).length === 0) return;
        event.preventDefault();
        animation.playOnce('unimpressed', () => animation.start('idle'));
      };

      renderer.domElement.addEventListener('pointerdown', handlePointerDown);
      return () => renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
    },
    update(dt) {
      animation.update(dt);
    },
  };
}
