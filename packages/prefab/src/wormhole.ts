import { ModelRecords } from './modelRecords';
import * as THREE from 'three';
import { loadAnim, loadBuild, loadSpriteSkinArchive } from '@dontstarve-web/animation/animationAssets';
import {
  createSpriteFactory,
  type AnimatedSpriteFactory,
  SpriteController,
} from '@dontstarve-web/animation/sprite';
import type { PrefabDisplay, SpriteState } from '@dontstarve-web/display';
import { createPrefabEntity, type PrefabInstance } from './prefabInstance';
import { newEntityId } from './saveRecord';
import { nextReskin } from './reskin_tool';
import { type ReskinFxMessage, type ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { TILE_SIZE } from './tile';
import { actionEntity, disposeActionEntity } from './actionEntity';

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
  instance: PrefabInstance;
  display: PrefabDisplay;
  skinId?: string;
  state: WormholeState;
  elapsed: number;
  nearby: boolean;
  groundLayer: boolean;
}

/** SGwormhole artwork/proximity only; no teleporter or paired destination. */
export class WormholeManager {
  private readonly factories = new Map<string, Promise<AnimatedSpriteFactory>>();
  private readonly mouseRecords = new ModelRecords<WormholeEntity>();
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
    const { instance, display } = this.createEntity(factory);
    const model = display.model;
    model.position.set(position.x, 0, position.z);
    Object.assign(model.userData, { prefab: WORMHOLE_ID, entityId: saved?.id ?? newEntityId() });
    if (skinId !== undefined) model.userData.skinId = skinId;
    const entity: WormholeEntity = { model, instance, display, skinId, state: 'idle', elapsed: 0, nearby: false, groundLayer: false };
    model.userData.wormholeState = entity.state;
    actionEntity(model, WORMHOLE_ID);
    this.wormholes.add(entity); this.mouseRecords.set(entity.model, entity);
    this.scene.add(model);
    return model;
  }

  update(dt: number, _cameraQuaternion: THREE.Quaternion): void {
    const players = this.getPlayerPositions();
    for (const entity of this.wormholes) {
      const { model } = entity;
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
    for (const { model, instance, display } of this.wormholes) {
      disposeActionEntity(model);
      instance.remove(); display.dispose();
    }
    this.wormholes.clear();
    for (const request of this.factories.values()) void request.then((factory) => factory.dispose(), () => undefined);
    this.factories.clear();
  }

  get reskinTargets(): readonly ReskinTarget[] { return this.getReskinTargets(); }

  getReskinTargets(model?: THREE.Object3D): readonly ReskinTarget[] {
    return this.mouseRecords.select(model, this.wormholes).map((entity) => {
      const { model } = entity;
      const isValid = () => !this.disposed && this.wormholes.has(entity) && model.visible && model.parent !== null;
      return {
        id: String(model.userData.entityId), prefabId: WORMHOLE_ID, model, position: model.position, isValid,
        skins: WORMHOLE_SKINS, get skinId() { return entity.skinId; },
        get isRemoved() { return !isValid(); }, hasTag: tag => actionEntity(model, WORMHOLE_ID).hasTag(tag),
        prepareNextSkin: async (tool) => {
          const previousSkin = entity.skinId;
          const skinId = nextReskin(WORMHOLE_SKINS, previousSkin, tool?._cached_reskinname, WORMHOLE_ID);
          const factory = await this.getFactory(skinId);
          if (!isValid()) throw new Error('Wormhole is no longer available');
          // The replacement's display only lends its source and drawn sprite; this entity, model and json stay.
          const replacement = this.createEntity(factory);
          const release = () => { replacement.instance.remove(); replacement.display.dispose(); };
          let used = false;
          return {
            apply: (fx?: ReskinFxMessage) => {
              if (used || !isValid() || entity.skinId !== previousSkin) return false;
              entity.display.adopt(replacement.display);
              entity.skinId = skinId;
              if (skinId === undefined) delete model.userData.skinId;
              else model.userData.skinId = skinId;
              release();
              used = true;
              fx?.play(model.position, WORMHOLE_ID);
              return true;
            },
            dispose: () => { if (!used) { release(); used = true; } },
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

  private createEntity(factory: AnimatedSpriteFactory) {
    return createPrefabEntity(WORMHOLE_ID, { create: animation => factory.create({ initialAnimation: animation, name: WORMHOLE_ID }),
      release: sprite => factory.disposeSprite(sprite) }, { name: 'idle_loop', billboard: true }, WORMHOLE_ID);
  }

  private controller(entity: WormholeEntity): SpriteState {
    return entity.instance.sprite;
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
    // The frame checks run every update: write the layer only when it changes (the art starts at mesh order 0).
    if (entity.groundLayer === ground) return;
    entity.groundLayer = ground;
    entity.instance.sprite.setMeshOrder(ground ? -0.5 : 0);
  }
}
