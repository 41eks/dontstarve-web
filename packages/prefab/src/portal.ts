import * as THREE from 'three';
import { loadAnim, loadBuild, loadSpriteSkinArchive, smallHash } from '@dontstarve-web/animation/animationAssets';
import {
  createSpriteFactory,
  type AnimatedSpriteFactory,
  type SpriteAnimationController,
  SpriteController,
} from '@dontstarve-web/animation/sprite';
import { newEntityId } from './saveRecord';
import { PlaySound, PreloadSounds, type SoundHandle } from './sound';

export const PORTAL_ID = 'multiplayer_portal_moonrock' as const;

const ANIM_ARCHIVE = 'portal_moonrock.zip';
const BUILD_ARCHIVE = 'portal_moonrock.zip';
const STONE_BUILD_ARCHIVE = 'portal_stone.zip';

// Symbols overridden from the portal_stone build (moonrock_common_postinit).
const STONE_SYMBOLS = ['light', 'portalbg', 'spiralfx1'] as const;

const JACOB_SOUND = 'dontstarve/common/together/spawn_vines/spawnportal_jacob' as const;

// SGmultiplayerportal: Jacob at idle entry and frame 30. The source idle_loop
// has 60 frames at 30fps, so every two-second animation cycle plays it twice.
const JACOB_FRAME = 30;

export interface PortalRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}

interface PortalEntity {
  model: THREE.Group;
  fxModel: THREE.Group;
  jacobSound?: SoundHandle;
}

/** Sound events follow the sprite's actual playback, including its delta clamp. */
class PortalController extends SpriteController {
  onJacobFrame?: () => void;

  override update(dt: number): void {
    const previousFrame = Math.floor(this.elapsed * this.animation.frameRate);
    super.update(dt);
    if (this.animationName !== 'idle_loop' || !this.loop) return;
    const currentFrame = Math.floor(this.elapsed * this.animation.frameRate);
    for (let frame = previousFrame + 1; frame <= currentFrame; frame++) {
      const index = frame % this.animation.frames.length;
      if (index === 0 || index === JACOB_FRAME) this.onJacobFrame?.();
    }
  }
}

/** Hides the 'portal' layer (DST AnimState:Hide("portal") on the FX entity). */
class PortalFxController extends SpriteController {
  protected override isLayerVisible(layerHash: number): boolean {
    return layerHash !== smallHash('portal');
  }
}

export class PortalManager {
  private mainFactory?: Promise<AnimatedSpriteFactory>;
  private fxFactory?: Promise<AnimatedSpriteFactory>;
  private readonly portals = new Set<PortalEntity>();
  private readonly scene: THREE.Scene;
  private readonly assetBaseUrl: string;
  private disposed = false;

  constructor(scene: THREE.Scene, assetBaseUrl: string) {
    this.scene = scene;
    this.assetBaseUrl = assetBaseUrl;
  }

  async spawn(position: THREE.Vector3, saved?: PortalRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Portal manager has been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid portal position');

    const [mainFactory, fxFactory] = await Promise.all([
      this.getMainFactory(),
      this.getFxFactory(),
      PreloadSounds(JACOB_SOUND),
    ]);
    if (this.disposed) throw new Error('Portal manager has been disposed');

    const entityId = saved?.id ?? newEntityId();

    // Main portal sprite with symbol overrides from portal_stone.
    const model = mainFactory.create({
      initialAnimation: 'idle_loop',
      name: PORTAL_ID,
      skinSymbols: [...STONE_SYMBOLS],
    });
    model.position.set(position.x, 0, position.z);
    Object.assign(model.userData, { prefab: PORTAL_ID, entityId });

    // FX child: same animations, hides 'portal' layer, overrides FX_ray1 from portal_stone.
    const fxModel = fxFactory.create({
      initialAnimation: 'idle_loop',
      name: `${PORTAL_ID}_fx`,
      skinSymbols: ['FX_ray1'],
    });
    fxModel.position.copy(model.position);
    this.scene.add(fxModel);

    const entity: PortalEntity = { model, fxModel };
    const playJacob = () => {
      entity.jacobSound?.stop();
      entity.jacobSound = PlaySound(JACOB_SOUND, model.position);
    };
    (model.userData.animationController as PortalController).onJacobFrame = playJacob;
    playJacob(); // Initial idle entry, after assets and sounds are ready.
    this.portals.add(entity);
    this.scene.add(model);
    return model;
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    for (const entity of this.portals) {
      const { model, fxModel } = entity;
      model.quaternion.copy(cameraQuaternion);
      fxModel.quaternion.copy(cameraQuaternion);
      fxModel.position.copy(model.position);

      if (Number.isFinite(dt) && dt > 0) {
        const controller = model.userData.animationController as SpriteAnimationController;
        controller.update(dt);
        const fxController = fxModel.userData.animationController as SpriteAnimationController;
        fxController.update(dt);
      }
    }
  }

  get renderEntities() {
    return [...this.portals].map(({ model }) => ({
      object: model, footPosition: model.position, cameraDepth: 0,
    }));
  }

  exportRecords(): PortalRecord[] {
    return [...this.portals].map(({ model }) => ({
      id: String(model.userData.entityId),
      transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: {} as Record<string, never>,
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entity of this.portals) {
      (entity.model.userData.animationController as PortalController).onJacobFrame = undefined;
      entity.jacobSound?.stop();
      entity.model.removeFromParent();
      entity.fxModel.removeFromParent();
    }
    this.portals.clear();
    void this.mainFactory?.then((f) => f.dispose(), () => undefined);
    void this.fxFactory?.then((f) => f.dispose(), () => undefined);
  }

  private getMainFactory(): Promise<AnimatedSpriteFactory> {
    if (!this.mainFactory) {
      this.mainFactory = Promise.all([
        loadBuild(BUILD_ARCHIVE, this.assetBaseUrl),
        loadAnim(ANIM_ARCHIVE, this.assetBaseUrl),
        loadSpriteSkinArchive(STONE_BUILD_ARCHIVE, this.assetBaseUrl),
      ]).then(([build, anim, skin]) => createSpriteFactory(build, anim, PortalController, skin));
      void this.mainFactory.catch(() => { this.mainFactory = undefined; });
    }
    return this.mainFactory;
  }

  private getFxFactory(): Promise<AnimatedSpriteFactory> {
    if (!this.fxFactory) {
      this.fxFactory = Promise.all([
        loadBuild(BUILD_ARCHIVE, this.assetBaseUrl),
        loadAnim(ANIM_ARCHIVE, this.assetBaseUrl),
        loadSpriteSkinArchive(STONE_BUILD_ARCHIVE, this.assetBaseUrl),
      ]).then(([build, anim, skin]) => createSpriteFactory(build, anim, PortalFxController, skin));
      void this.fxFactory.catch(() => { this.fxFactory = undefined; });
    }
    return this.fxFactory;
  }
}
