import * as THREE from 'three';
import { loadAnim, loadBuild, loadSpriteSkinArchive } from '@dontstarve-web/animation/animationAssets';
import {
  createSpriteFactory,
  type AnimatedSpriteFactory,
  SpriteController,
} from '@dontstarve-web/animation/sprite';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { newEntityId } from './saveRecord';
import { nextReskin } from './reskin_tool';
import { type ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { TILE_SIZE } from './tile';

export const WORMHOLE_ID = 'wormhole' as const;
// prefabskins.lua order; wormhole_init_fn swaps the build, retaining the base bank.
export const WORMHOLE_SKINS = [
  'wormhole_claw', 'wormhole_fantasy', 'wormhole_gothic',
  'wormhole_lureplant', 'wormhole_spider', 'wormhole_worm',
] as const;
export const WORMHOLE_ENTER_DISTANCE = 4 * (TILE_SIZE / 4);
export const WORMHOLE_EXIT_DISTANCE = 5 * (TILE_SIZE / 4);

export interface WormholeSaveState { skinId?: string }

export interface WormholeRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { wormhole?: WormholeSaveState };
}

type WormholeState = 'idle' | 'opening' | 'open' | 'closing';
interface WormholeEntity {
  model: THREE.Group;
  skinId?: string;
  state: WormholeState;
  elapsed: number;
  nearby: boolean;
  groundLayer: boolean;
}

/** SGwormhole artwork/proximity only; no teleporter or paired destination. */
export class WormholeManager {
  private readonly factories = new Map<string, Promise<AnimatedSpriteFactory>>();
  private readonly wormholes = new Set<WormholeEntity>();
  private readonly scene: THREE.Scene;
  private readonly assetBaseUrl: string;
  private readonly getPlayerPositions: () => readonly THREE.Vector3[];
  private disposed = false;

  constructor(scene: THREE.Scene, assetBaseUrl: string, getPlayerPositions: () => readonly THREE.Vector3[] = () => []) {
    this.scene = scene;
    this.assetBaseUrl = assetBaseUrl;
    this.getPlayerPositions = getPlayerPositions;
  }

  async spawn(position: THREE.Vector3, saved?: WormholeRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Wormhole manager has been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid wormhole position');
    const skinId = saved?.components.wormhole?.skinId;
    const factory = await this.getFactory(skinId);
    if (this.disposed) throw new Error('Wormhole manager has been disposed');
    const model = factory.create({ initialAnimation: 'idle_loop', name: WORMHOLE_ID });
    model.position.set(position.x, 0, position.z);
    Object.assign(model.userData, { prefab: WORMHOLE_ID, entityId: saved?.id ?? newEntityId() });
    if (skinId !== undefined) model.userData.skinId = skinId;
    const entity: WormholeEntity = { model, skinId, state: 'idle', elapsed: 0, nearby: false, groundLayer: false };
    model.userData.wormholeState = entity.state;
    this.wormholes.add(entity);
    this.scene.add(model);
    return model;
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    const players = this.getPlayerPositions();
    for (const entity of this.wormholes) {
      const { model } = entity;
      model.quaternion.copy(cameraQuaternion);
      if (Number.isFinite(dt) && dt > 0) {
        const distance = entity.nearby ? WORMHOLE_EXIT_DISTANCE : WORMHOLE_ENTER_DISTANCE;
        const nearby = players.some((player) => (player.x - model.position.x) ** 2
          + (player.z - model.position.z) ** 2 <= distance ** 2);
        if (nearby !== entity.nearby) {
          entity.nearby = nearby;
          this.transition(entity, nearby ? 'opening' : 'closing');
        }
        const state = entity.state;
        this.controller(entity).update(dt);
        if (entity.state === state) entity.elapsed += Math.min(dt, 0.1);
        // SGwormhole frame 10 opening / frame 4 closing changes only layering,
        // not AnimState orientation: even open artwork remains a billboard.
        if (entity.state === 'opening' && entity.elapsed + 1e-8 >= 10 / 30) this.setGroundLayer(entity, true);
        if (entity.state === 'closing' && entity.elapsed + 1e-8 >= 4 / 30) this.setGroundLayer(entity, false);
      }
    }
  }

  get renderEntities() {
    return [...this.wormholes].filter((entity) => !entity.groundLayer)
      .map(({ model }) => ({ object: model, footPosition: model.position, cameraDepth: 0 }));
  }

  exportRecords(): WormholeRecord[] {
    return [...this.wormholes].map(({ model, skinId }) => ({
      id: String(model.userData.entityId),
      transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: skinId === undefined ? {} : { wormhole: { skinId } },
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { model } of this.wormholes) model.removeFromParent();
    this.wormholes.clear();
    for (const request of this.factories.values()) void request.then((factory) => factory.dispose(), () => undefined);
    this.factories.clear();
  }

  get reskinTargets(): readonly ReskinTarget[] {
    return [...this.wormholes].map((entity) => {
      const { model } = entity;
      const isValid = () => !this.disposed && this.wormholes.has(entity) && model.visible && model.parent !== null;
      return {
        id: String(model.userData.entityId), prefabId: WORMHOLE_ID, model, position: model.position, isValid,
        prepareNextSkin: async () => {
          const previousSkin = entity.skinId;
          const skinId = nextReskin(WORMHOLE_SKINS, previousSkin);
          const factory = await this.getFactory(skinId);
          if (!isValid()) throw new Error('Wormhole is no longer available');
          const replacement = factory.create({ initialAnimation: 'idle_loop', name: WORMHOLE_ID });
          let used = false;
          return {
            apply: () => {
              if (used || !isValid() || entity.skinId !== previousSkin) return false;
              const previous = this.controller(entity);
              for (const child of [...model.children]) {
                child.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
                model.remove(child);
              }
              for (const child of [...replacement.children]) model.add(child);
              model.userData.animationController = replacement.userData.animationController;
              registerSpriteRenderGroup(model, model.children[0] as THREE.Group);
              this.controller(entity).copyPlaybackFrom(previous);
              entity.skinId = skinId;
              if (skinId === undefined) delete model.userData.skinId;
              else model.userData.skinId = skinId;
              this.setGroundLayer(entity, entity.groundLayer);
              factory.disposeSprite(replacement);
              used = true;
              return true;
            },
            dispose: () => { if (!used) { factory.disposeSprite(replacement); used = true; } },
          };
        },
      };
    });
  }

  private getFactory(skinId?: string): Promise<AnimatedSpriteFactory> {
    if (this.disposed) throw new Error('Wormhole manager has been disposed');
    if (skinId !== undefined && !(WORMHOLE_SKINS as readonly string[]).includes(skinId)) {
      throw new Error(`Unsupported wormhole skin: ${skinId}`);
    }
    const key = skinId ?? '';
    let request = this.factories.get(key);
    if (!request) {
      request = Promise.all([
        loadBuild('teleporter_worm_build.zip', this.assetBaseUrl),
        loadAnim('teleporter_worm.zip', this.assetBaseUrl),
        skinId ? loadSpriteSkinArchive(`dynamic/${skinId}.zip`, this.assetBaseUrl) : undefined,
      ]).then(([build, animations, skin]) => createSpriteFactory(build, animations, SpriteController, skin));
      this.factories.set(key, request);
      void request.catch(() => { if (this.factories.get(key) === request) this.factories.delete(key); });
    }
    return request;
  }

  private controller(entity: WormholeEntity): SpriteController {
    return entity.model.userData.animationController as SpriteController;
  }

  private transition(entity: WormholeEntity, state: 'opening' | 'closing'): void {
    entity.state = state;
    entity.elapsed = 0;
    entity.model.userData.wormholeState = state;
    this.setGroundLayer(entity, state === 'closing');
    this.controller(entity).playOnce(state === 'opening' ? 'open_pre' : 'open_pst', () => {
      entity.state = state === 'opening' ? 'open' : 'idle';
      entity.elapsed = 0;
      entity.model.userData.wormholeState = entity.state;
      this.controller(entity).start(state === 'opening' ? 'open_loop' : 'idle_loop');
      this.setGroundLayer(entity, state === 'opening');
    });
  }

  private setGroundLayer(entity: WormholeEntity, ground: boolean): void {
    entity.groundLayer = ground;
    const visual = entity.model.children[0] as THREE.Group;
    visual.renderOrder = 0;
    (visual.children[0] as THREE.Mesh).renderOrder = ground ? -0.5 : 0;
  }
}
