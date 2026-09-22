import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {
  createAnimatedSprite,
  type SpriteAnimationController,
} from '@three-roaming/animation/sprite';

export interface PigKingPrefabOptions {
  floorTextureUrl: string;
  position?: THREE.Vector3;
  scale?: number;
}

export interface PigKingPrefab {
  body: CANNON.Body;
  floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  standee: THREE.Group;
  setNormal(cameraWorldQuaternion: THREE.Quaternion): void;
  setupInteraction(camera: THREE.Camera, renderer: THREE.WebGLRenderer): () => void;
  update(dt: number): void;
}

const pigKingHeight = 24;
const pigKingWidth = pigKingHeight * (384 / 344);
const pigKingDepth = 1;

export async function createPigKing(
  assetBaseUrl: string,
  options: PigKingPrefabOptions,
): Promise<PigKingPrefab> {
  const standee = await createAnimatedSprite(assetBaseUrl, 'pig_king.zip', {
    initialAnimation: 'idle',
    name: 'PigKingStandee',
    scale: options.scale ?? 0.02,
  });
  standee.position.copy(options.position ?? new THREE.Vector3(0, 0, 25));
  standee.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(standee);
  standee.position.y -= bounds.min.y;

  const animation = standee.userData.animationController as SpriteAnimationController;
  const floorTexture = new THREE.TextureLoader().load(options.floorTextureUrl);
  floorTexture.colorSpace = THREE.SRGBColorSpace;
  floorTexture.wrapS = THREE.RepeatWrapping;
  floorTexture.wrapT = THREE.RepeatWrapping;
  floorTexture.repeat.set(0.3, 0.3);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 36),
    new THREE.MeshLambertMaterial({
      map: floorTexture,
      side: THREE.DoubleSide,
    }),
  );
  floor.name = 'PigKingFloor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(standee.position.x, 0.02, standee.position.z);
  floor.receiveShadow = true;

  const body = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(
      pigKingWidth / 4,
      pigKingHeight / 2,
      pigKingDepth / 4,
    )),
    position: new CANNON.Vec3(
      standee.position.x,
      pigKingHeight / 2,
      standee.position.z,
    ),
  });
  const cameraZ = new THREE.Vector3();

  return {
    body,
    floor,
    standee,
    setNormal(cameraWorldQuaternion) {
      standee.quaternion.copy(cameraWorldQuaternion);

      cameraZ.set(0, 0, 1).applyQuaternion(cameraWorldQuaternion);
      cameraZ.y = 0;
      if (cameraZ.lengthSq() === 0) return;
      cameraZ.normalize();
      const bodyRotationY = Math.atan2(cameraZ.x, cameraZ.z);
      body.quaternion.setFromEuler(0, bodyRotationY, 0);
      body.aabbNeedsUpdate = true;
    },
    setupInteraction(camera, renderer) {
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const handlePointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return;

        const rendererBounds = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rendererBounds.left) / rendererBounds.width) * 2 - 1;
        pointer.y = -((event.clientY - rendererBounds.top) / rendererBounds.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        standee.updateWorldMatrix(true, true);
        if (raycaster.intersectObject(standee, true).length === 0) return;

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
