import * as THREE from 'three';
import { loadAnim, loadBuild, loadSpriteSkinArchive, smallHash } from '@dontstarve-web/animation/animationAssets';
import {
  createSpriteFactory,
  type AnimatedSpriteFactory,
  type SpriteAnimationController,
  SpriteController,
} from '@dontstarve-web/animation/sprite';
import { MiniMapEntity } from './minimapEntity';
import { createEffect, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import { Hauntable, HAUNT_INSTANT_REZ } from '../../componets/src/hauntable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { FRAMES } from '../../stategraphs/src/stategraph';
import { actionEntity } from './actionEntity';
import type { RezSource } from './player_common';
import { newEntityId } from './saveRecord';
import { PlaySound, PreloadSounds, type SoundHandle } from './sound';

export const PORTAL_ID = 'multiplayer_portal_moonrock' as const;

const ANIM_ARCHIVE = 'portal_moonrock.zip';
const BUILD_ARCHIVE = 'portal_moonrock.zip';
const STONE_BUILD_ARCHIVE = 'portal_stone.zip';

// Symbols overridden from the portal_stone build (moonrock_common_postinit).
const STONE_SYMBOLS = ['light', 'portalbg', 'spiralfx1'] as const;

const JACOB_SOUND = 'dontstarve/common/together/spawn_vines/spawnportal_jacob' as const;
// MOONROCK_SOUNDS: the entries SGmultiplayerportal's spawn states play (blink, vines and armswing are nil).
const SPAWNING_SOUND = 'dontstarve/common/together/spawn_vines/spawnportal_spawning' as const;
const SHAKE_SOUND = 'dontstarve/common/together/spawn_vines/spawnportal_shake' as const;
const OPEN_SOUND = 'dontstarve/common/together/spawn_vines/spawnportal_open' as const;
/** SGmultiplayerportal spawn_loop: `open` at frame 55. */
const OPEN_TIME = 55 * FRAMES;

// SGmultiplayerportal: Jacob at idle entry and frame 30. The source idle_loop
// has 60 frames at 30fps, so every two-second animation cycle plays it twice.
const JACOB_FRAME = 30;

export interface PortalRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}

type SpawnPhase = 'spawn_pre' | 'spawn_loop' | 'spawn_pst';

interface PortalEntity {
  model: THREE.Group;
  fxModel: THREE.Group;
  minimap: MiniMapEntity;
  jacobSound?: SoundHandle;
  hauntable?: Hauntable;
  playJacob?: () => void;
  spawning?: { phase: SpawnPhase; elapsed: number; opened: boolean; loopSound?: SoundHandle };
  stopEvents: (() => void)[];
}

/** The world services OnGetPortalRez needs: the hauntable's cooldown timer and the portal_rez world setting. */
export interface PortalRezServices {
  scheduler: GameTimeScheduler;
  portalRez: ReadonlySignal<boolean>;
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
  private readonly services?: PortalRezServices;
  private disposed = false;

  constructor(scene: THREE.Scene, assetBaseUrl: string, services?: PortalRezServices) {
    this.scene = scene;
    this.assetBaseUrl = assetBaseUrl;
    this.services = services;
  }

  async spawn(position: THREE.Vector3, saved?: PortalRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Portal manager has been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid portal position');

    const [mainFactory, fxFactory] = await Promise.all([
      this.getMainFactory(),
      this.getFxFactory(),
      PreloadSounds(JACOB_SOUND, SPAWNING_SOUND, SHAKE_SOUND, OPEN_SOUND),
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

    const minimap = new MiniMapEntity(model.position);
    minimap.SetIcon('portal_dst.png');
    const entity: PortalEntity = { model, fxModel, minimap, stopEvents: [] };
    const playJacob = () => {
      entity.jacobSound?.stop();
      entity.jacobSound = PlaySound(JACOB_SOUND, model.position);
    };
    (model.userData.animationController as PortalController).onJacobFrame = playJacob;
    playJacob(); // Initial idle entry, after assets and sounds are ready.
    entity.playJacob = playJacob;
    this.bindRez(entity);
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

      const spawning = entity.spawning;
      if (spawning?.phase === 'spawn_loop' && !spawning.opened && Number.isFinite(dt) && dt > 0) {
        spawning.elapsed += dt;
        if (spawning.elapsed >= OPEN_TIME) { spawning.opened = true; PlaySound(OPEN_SOUND, model.position); }
      }
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

  get miniMapEntities(): MiniMapEntity[] {
    return [...this.portals].map(({ minimap }) => minimap);
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
      entity.stopEvents.splice(0).forEach(stop => stop());
      entity.hauntable?.dispose();
      delete entity.model.userData.components?.hauntable;
      entity.spawning?.loopSound?.stop();
      (entity.model.userData.animationController as PortalController).onJacobFrame = undefined;
      entity.jacobSound?.stop();
      entity.minimap.dispose();
      entity.model.removeFromParent();
      entity.fxModel.removeFromParent();
    }
    this.portals.clear();
    void this.mainFactory?.then((f) => f.dispose(), () => undefined);
    void this.fxFactory?.then((f) => f.dispose(), () => undefined);
  }

  /** SGmultiplayerportal's `rez_player` states and multiplayer_portal.lua OnGetPortalRez / ms_onportalrez. */
  private bindRez(entity: PortalEntity): void {
    const { model } = entity;
    const inst = actionEntity(model, PORTAL_ID);
    inst.addTag('multiplayer_portal');
    const source: RezSource & { addTag(tag: string): void; removeTag(tag: string): void } = {
      isValid: () => !this.disposed && !inst.isRemoved && this.portals.has(entity),
      get position() { return model.position; },
      hasTag: tag => inst.hasTag(tag),
      PushEvent: (name, data) => inst.PushEvent?.(name, data),
      addTag: tag => inst.addTag(tag),
      removeTag: tag => inst.removeTag(tag),
    };
    const onRezPlayer = () => this.startSpawn(entity);
    model.addEventListener('rez_player' as never, onRezPlayer);
    entity.stopEvents.push(() => model.removeEventListener('rez_player' as never, onRezPlayer));
    const services = this.services;
    if (!services) return;
    const portalRez = watchSignal(services.portalRez, stop => entity.stopEvents.push(stop));
    createEffect(() => {
      if (portalRez.get()) {
        if (entity.hauntable) return;
        entity.hauntable = new Hauntable(source, services.scheduler);
        entity.hauntable.SetHauntValue(HAUNT_INSTANT_REZ);
        (model.userData.components ??= {}).hauntable = entity.hauntable;
        inst.addTag('resurrector');
      } else if (entity.hauntable) {
        entity.hauntable.dispose();
        entity.hauntable = undefined;
        delete model.userData.components.hauntable;
        inst.removeTag('resurrector');
      }
    });
  }

  /** SGmultiplayerportal spawn_pre → spawn_loop → spawn_pst, then back to the idle loop. */
  private startSpawn(entity: PortalEntity): void {
    if (this.disposed) return;
    const { model, fxModel } = entity;
    const main = model.userData.animationController as PortalController;
    const fx = fxModel.userData.animationController as PortalFxController;
    entity.spawning?.loopSound?.stop();
    const spawning: NonNullable<PortalEntity['spawning']> = { phase: 'spawn_pre', elapsed: 0, opened: false };
    entity.spawning = spawning;
    const play = (name: string, done: () => void) => {
      fx.playOnce(name);
      main.playOnce(name, () => { if (entity.spawning === spawning && !this.disposed) done(); });
    };
    spawning.loopSound = PlaySound(SPAWNING_SOUND, model.position);
    PlaySound(SHAKE_SOUND, model.position);
    play('pre_fx', () => {
      spawning.phase = 'spawn_loop';
      play('fx', () => {
        spawning.loopSound?.stop();
        spawning.phase = 'spawn_pst';
        play('pst_fx', () => {
          entity.spawning = undefined;
          fx.start('idle_loop');
          main.start('idle_loop');
          entity.playJacob?.();
        });
      });
    });
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
