import * as THREE from 'three';
import { ArchiveSpriteAssets, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';

const REFERENCE_WIDTH = 1280;
const REFERENCE_HEIGHT = 720;

export async function createGeneratingWorldThreeStage(
  canvas: OffscreenCanvas,
  assetBaseUrl: string,
  isCave: boolean,
  pixelRatio: number,
) {
  const assets = new ArchiveSpriteAssets('worldgen', assetBaseUrl);
  const createIdleSprite = (bank: string, scale: number) => {
    const archive = `${bank}.zip`;
    return createSharedArchiveSprite(
      assets,
      { animationArchive: archive, buildArchives: [archive], bank, animation: 'idle', loop: true },
      { scale, pickable: false },
    );
  };

  try {
    const [world, rightHand, leftHand] = await Promise.all([
      createIdleSprite(isCave ? 'generating_cave' : 'generating_forest', 1),
      createIdleSprite('creepy_hands', 1.5),
      createIdleSprite('creepy_hands', 1.5),
    ]);
    // The hands draw over the world in the order the Lua screen adds them.
    rightHand.model.position.set(400, 0, 1);
    leftHand.model.position.set(-425, 0, 2);
    leftHand.model.scale.x = -1;
    for (const hand of [rightHand, leftHand]) {
      const frameRate = hand.frameCount / hand.currentAnimationLength;
      hand.setFrame(Math.floor(Math.random() * 2 * frameRate));
    }

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(pixelRatio, 2));
    const scene = new THREE.Scene();
    scene.add(world.model, rightHand.model, leftHand.model);
    const camera = new THREE.OrthographicCamera();
    camera.position.z = 10;

    return {
      resize(width: number, height: number) {
        renderer.setSize(width, height, false);
        // SCALEMODE_PROPORTIONAL with the origin anchored at the bottom center.
        const scale = Math.min(width / REFERENCE_WIDTH, height / REFERENCE_HEIGHT);
        camera.left = -width / (2 * scale);
        camera.right = width / (2 * scale);
        camera.top = height / scale;
        camera.bottom = 0;
        camera.updateProjectionMatrix();
      },
      render(dt: number) {
        world.update(dt);
        rightHand.update(dt);
        leftHand.update(dt);
        renderer.render(scene, camera);
      },
    };
  } catch (error) {
    assets.dispose();
    throw error;
  }
}
