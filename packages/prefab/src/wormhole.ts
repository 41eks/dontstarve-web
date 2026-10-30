import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { ModelRecords } from './modelRecords';
import * as THREE from 'three';
import { SpriteResources, type PrefabDisplay, type SpriteState } from '@dontstarve-web/display';
import { createPrefabEntity, type PrefabInstance } from './prefabInstance';
import { newEntityId } from './saveRecord';
import { reskinTarget } from './reskin_tool';
import type { ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { TILE_SIZE } from './tile';
import { actionEntity, disposeActionEntity, findActionEntity } from './actionEntity';

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
  state: WormholeState;
  elapsed: number;
  nearby: boolean;
  groundLayer: boolean;
}

/** SGwormhole artwork/proximity only; no teleporter or paired destination. */
export class WormholeManager {
  private readonly resources: SpriteResources;
  private readonly mouseRecords = new ModelRecords<WormholeEntity>();
  private readonly wormholes = new Set<WormholeEntity>();
  private readonly displays: PrefabDisplayGroup;
  private readonly getPlayerPositions: () => readonly THREE.Vector3[];
  private disposed = false;

  constructor(scene: THREE.Scene, assetBaseUrl: string, getPlayerPositions: () => readonly THREE.Vector3[] = () => []) {
    this.displays = new PrefabDisplayGroup(scene);
    this.resources = new SpriteResources(assetBaseUrl);
    this.getPlayerPositions = getPlayerPositions;
  }

  async spawn(position: THREE.Vector3, saved?: WormholeRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Wormhole manager has been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid wormhole position');
    const skinId = saved?.components.wormhole?.skinId;
    if (skinId !== undefined && !(WORMHOLE_SKINS as readonly string[]).includes(skinId)) throw new Error(`Unsupported wormhole skin: ${skinId}`);
    const { instance, display } = createPrefabEntity(WORMHOLE_ID,
      this.resources.factory({ buildArchive: 'teleporter_worm_build.zip', animationArchive: 'teleporter_worm.zip' }),
      { name: 'idle_loop', billboard: true }, WORMHOLE_ID, entity => {
        entity.skinId = skinId;
        entity.sprite.setSkinSource({ art: this.resources.archives,
          archives: Object.fromEntries(WORMHOLE_SKINS.map(id => [id, `dynamic/${id}.zip`])) });
      });
    await display.artLoaded();
    if (this.disposed) { instance.remove(); display.dispose(); throw new Error('Wormhole manager has been disposed'); }
    const model = display.model;
    model.position.set(position.x, 0, position.z);
    instance.entityId = saved?.id ?? newEntityId();
    instance.skinId = skinId;
    const entity: WormholeEntity = { model, instance, display, state: 'idle', elapsed: 0, nearby: false, groundLayer: false };
    model.userData.wormholeState = entity.state;
    actionEntity(model, WORMHOLE_ID).reskinTarget = this.createReskinTarget(entity);
    this.wormholes.add(entity); this.mouseRecords.set(entity.model, entity);
    this.displays.mount(prefabDisplay(model)!);
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
    return [...this.wormholes].map(({ model, instance: { skinId, entityId } }) => ({
      id: String(entityId),
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
    this.displays.dispose();
    this.resources.dispose();
  }

  get reskinTargets(): readonly ReskinTarget[] {
    return Array.from(this.wormholes, entity => findActionEntity(entity.model)?.reskinTarget)
      .filter((target): target is ReskinTarget => target !== undefined);
  }

  private createReskinTarget(entity: WormholeEntity): ReskinTarget {
    const { model } = entity;
    const isValid = () => !this.disposed && this.wormholes.has(entity) && model.visible && model.parent !== null;
    return reskinTarget({
      get id() { return String(entity.instance.entityId); }, prefabId: WORMHOLE_ID, model, sprite: entity.instance.sprite,
      position: model.position, skins: WORMHOLE_SKINS, isValid, hasTag: tag => actionEntity(model, WORMHOLE_ID).hasTag(tag),
    });
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
