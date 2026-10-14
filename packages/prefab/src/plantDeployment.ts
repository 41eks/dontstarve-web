import * as THREE from 'three';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { loadBuild, loadAnim, loadSpriteSkinArchive } from '@dontstarve-web/animation/animationAssets';
import { createSpriteFactory, SpriteController, type AnimatedSpriteFactory, type TransientSpriteAnimationController } from '@dontstarve-web/animation/sprite';
import { BufferedAction } from '../../stategraphs/src/bufferedaction';
import { bindActionCancellation } from '../../stategraphs/src/actionEvents';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import type { ActionAnimationController, ActionLocomotor } from '../../stategraphs/src/actionContext';
import type { PlantDeployMap } from '../../componets/src/deployable';
import type { WorldContext } from './worldContext';
import type { TurfSource } from './turfDeployment';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { PLANTABLES } from './plantables';
import { TILE_SIZE } from './tile';
import { PlaySound, PreloadSounds, type SoundHandle } from './sound';
import { setPrefabLightOverride } from './localLight';

export interface PreparedPlant { spawn(position: THREE.Vector3): boolean; dispose(): void; }
export interface PlantDeploymentWorld {
  canPlant(position: THREE.Vector3): boolean;
  getBlockers(): readonly { position: THREE.Vector3; tags?: readonly string[]; smartRadius?: number; inventoryRadius?: number }[];
  plants: Readonly<Record<string, { prepareTransplant(skinId?: string): Promise<PreparedPlant> }>>;
}

/** PLANT deployment: source-owned placer art, locomotion and SGwilson's frame-six commit. */
export class PlantDeployment {
  private readonly pointer: PointerRaycaster;
  private readonly factories = new Map<string, Promise<AnimatedSpriteFactory>>();
  private readonly cleanups: (() => void)[] = [];
  private readonly reach = 1.1 * TILE_SIZE / 4;
  private version = 0;
  private disposed = false;
  private pending?: { point: THREE.Vector3; source: TurfSource; prepared?: PreparedPlant };
  private buffered?: BufferedAction<'DEPLOY'>;
  private preview?: { model: THREE.Group; factory: AnimatedSpriteFactory };
  private previewEntity?: ItemEntity;
  private previewVersion = 0;
  private previewSkin?: string;
  private sound?: SoundHandle;

  private readonly world: WorldContext;
  private readonly animation: ActionAnimationController;
  private readonly locomotor: ActionLocomotor;
  private readonly getSource: () => TurfSource | undefined;
  private readonly planting: PlantDeploymentWorld;
  private readonly interrupted: () => boolean;

  constructor(world: WorldContext, animation: ActionAnimationController,
    locomotor: ActionLocomotor, getSource: () => TurfSource | undefined,
    planting: PlantDeploymentWorld, interrupted = () => false) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.getSource = getSource; this.planting = planting; this.interrupted = interrupted;
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.cleanups.push(bindActionCancellation(world, this, 'deploy', () => this.cancel()));
    if (world.registerFrameTask) this.cleanups.push(world.registerFrameTask(dt => this.update(dt)));
    if (world.mouseActions) {
      this.cleanups.push(world.mouseActions.registerActiveItemSource(() => !!getSource()));
      this.cleanups.push(world.mouseActions.register(() => {
        const source = getSource(), point = this.pointer.groundPoint();
        return source && point && this.canDeploy(point, source.entity)
          ? [{ action: { action: 'DEPLOY', modifier: 'PLANT', invobject: source.entity }, button: 'right', source: 'inventory' }] : [];
      }));
    }
    world.renderer.domElement.addEventListener('pointerdown', this.pointerDown, true);
    window.addEventListener('keydown', this.keyDown);
  }

  canDeploy(point: THREE.Vector3, entity: ItemEntity): boolean {
    const deployable = entity.components.deployable;
    if (entity.isRemoved || deployable?.mode !== 'PLANT' || !this.planting.canPlant(point)) return false;
    const spacing = deployable.spacing;
    return !this.planting.getBlockers().some(blocker => {
      if (blocker.tags?.some(tag => ['NOBLOCK', 'player', 'FX', 'INLIMBO', 'DECOR', 'walkableplatform', 'walkableperipheral', 'isdead'].includes(tag))) return false;
      const radius = blocker.smartRadius !== undefined ? blocker.smartRadius + spacing / 2
        : blocker.inventoryRadius !== undefined ? Math.min(spacing, blocker.inventoryRadius + spacing / 2) : spacing;
      return blocker.position.distanceToSquared(point) < radius ** 2;
    });
  }

  request(point: THREE.Vector3): boolean {
    const source = this.getSource(), definition = source && PLANTABLES[source.entity.prefab];
    if (this.disposed || !source?.isValid() || !definition || !this.canDeploy(point, source.entity)
      || this.animation.stategraph.hasStateTag('busy')) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'DEPLOY' });
    this.animation.cancelEmote();
    const pending = { point: point.clone(), source, prepared: undefined as PreparedPlant | undefined };
    this.pending = pending;
    const version = this.version;
    void Promise.allSettled([this.planting.plants[definition.prefab].prepareTransplant(source.entity.skinId), PreloadSounds(definition.plantSound ?? 'dontstarve/common/plant')])
      .then(results => {
        const prepared = results[0].status === 'fulfilled' ? results[0].value : undefined;
        const failed = results.find(result => result.status === 'rejected');
        if (this.disposed || version !== this.version || failed) {
          prepared?.dispose();
          if (version === this.version) this.cancel();
          if (failed?.status === 'rejected') console.error('Unable to prepare plant deployment', failed.reason);
        } else pending.prepared = prepared;
      });
    return true;
  }

  update(dt = 0): void {
    if (this.disposed) return;
    this.updatePreview(dt);
    if (this.interrupted()) { this.cancel(); return; }
    if (this.buffered && !this.animation.stategraph.isActionActive(this.buffered)) { this.cancel(); return; }
    const pending = this.pending;
    if (!pending || this.buffered) return;
    const { source, point } = pending;
    if (!source.isValid() || !this.canDeploy(point, source.entity)) { this.cancel(); return; }
    if (this.world.player.position.distanceToSquared(point) > this.reach ** 2) {
      const destination = point.clone().addScaledVector(this.world.player.position.clone().sub(point).normalize(), this.reach * .8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > .01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    if (!pending.prepared) return;
    const direction = point.clone().sub(this.world.player.position);
    const forward = this.world.camera.getWorldDirection(new THREE.Vector3()); forward.y = 0; forward.normalize();
    const side = direction.dot(new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0))), depth = direction.dot(forward);
    this.animation.setFacing(Math.abs(depth) >= Math.abs(side) ? (depth > 0 ? 'up' : 'down') : 'side', Math.abs(side) > Math.abs(depth) && side < 0);
    const version = this.version;
    const valid = () => !this.disposed && version === this.version && source.isValid() && this.canDeploy(point, source.entity)
      && this.world.player.position.distanceToSquared(point) <= this.reach ** 2;
    const map: PlantDeployMap = {
      canDeployPlant: position => this.canDeploy(position, source.entity),
      deployPlant: position => pending.prepared!.spawn(position),
    };
    const buffered = new BufferedAction('DEPLOY', () => {
      const item = source.take();
      if (!item) return false;
      const success = item.components.deployable?.Deploy(point, {
        position: this.world.player.position,
        PushEvent: (name, data) => this.world.player.dispatchEvent({ type: name, data } as never),
      }, map) ?? false;
      if (!success) source.putBack(item);
      else {
        this.sound?.stop(); this.sound = PlaySound(PLANTABLES[item.prefab].plantSound ?? 'dontstarve/common/plant', point);
        this.world.player.dispatchEvent({ type: 'itemplanted', data: { pos: point } } as never);
      }
      pending.prepared?.dispose(); this.pending = undefined;
      return success;
    }, valid, { pos: point, invobject: source.entity, distance: this.reach });
    if (this.animation.stategraph.pushBufferedAction(buffered)) this.buffered = buffered;
  }

  private updatePreview(dt: number): void {
    const source = this.getSource(), entity = source?.entity;
    if (entity !== this.previewEntity || entity?.skinId !== this.previewSkin) {
      const version = ++this.previewVersion;
      this.previewEntity = entity; this.previewSkin = entity?.skinId;
      if (this.preview) this.preview.factory.disposeSprite(this.preview.model);
      this.preview = undefined;
      const definition = entity && PLANTABLES[entity.prefab];
      if (definition) {
        const key = `${entity!.prefab}:${entity!.skinId ?? ''}`;
        let request = this.factories.get(key);
        if (!request) {
          const baseUrl = `${import.meta.env.BASE_URL}dst/data/anim`;
          const skinArchive = entity!.skinId && GROUND_ITEM_DEFINITIONS[entity!.prefab].skinArchives[entity!.skinId];
          request = Promise.all([loadBuild(`${definition.build}.zip`, baseUrl), loadAnim(definition.animationArchive ?? `${definition.bank}.zip`, baseUrl),
            skinArchive ? loadSpriteSkinArchive(skinArchive, baseUrl) : undefined])
            .then(([build, anim, skin]) => createSpriteFactory(build, anim, SpriteController, skin));
          this.factories.set(key, request);
        }
        void request.then(factory => {
          if (this.disposed || this.previewVersion !== version) return;
          const model = factory.create({ initialAnimation: definition.animation, name: 'PlantPlacer' });
          model.userData.tags = ['FX', 'NOCLICK']; model.userData.placer = true;
          setPrefabLightOverride(model, 1);
          model.visible = false; this.preview = { model, factory }; this.world.scene.add(model);
        }).catch(error => console.error('Unable to load plant placer', error));
      }
    }
    const preview = this.preview, point = this.pointer.groundPoint();
    if (!preview) return;
    preview.model.visible = !!point && !!source?.isValid();
    if (!point || !source) return;
    preview.model.position.copy(point); preview.model.quaternion.copy(this.world.camera.quaternion);
    (preview.model.userData.animationController as TransientSpriteAnimationController).update(dt);
    const valid = this.canDeploy(point, source.entity);
    preview.model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material instanceof THREE.MeshBasicMaterial) {
          if (valid) material.color.setRGB(1, 1, 1);
          else material.color.setRGB(.75, .25, .25);
          material.opacity = .65;
        }
      }
    });
  }
  cancel(): void {
    this.version++;
    if (this.pending || this.buffered) this.locomotor.stop();
    this.pending?.prepared?.dispose(); this.pending = undefined;
    if (this.buffered && this.animation.stategraph.isActionActive(this.buffered)) this.animation.stategraph.cancelAction('DEPLOY');
    this.buffered = undefined;
  }
  private readonly pointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented) return;
    if (event.button === 0) { this.cancel(); return; }
    if (event.button !== 2 || !this.getSource()) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.pointer.trackPointer(event);
    const point = this.pointer.groundPoint();
    if (!point || !this.request(point)) this.cancel();
  };
  private readonly keyDown = (event: KeyboardEvent): void => { if (event.code === 'Escape') this.cancel(); };
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.cancel(); this.cleanups.splice(0).forEach(cleanup => cleanup());
    this.sound?.stop();
    if (this.preview) this.preview.factory.disposeSprite(this.preview.model);
    for (const request of this.factories.values()) void request.then(factory => factory.dispose(), () => undefined);
    this.world.renderer.domElement.removeEventListener('pointerdown', this.pointerDown, true);
    window.removeEventListener('keydown', this.keyDown);
    if (this.pointer !== this.world.mouseActions?.pointer) this.pointer.dispose();
  }
}
