import { placementEntities, ignoresPlacement, type PlacementQuery } from './placementEntities';
import * as THREE from 'three';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { SpriteResources } from '@dontstarve-web/display';
import { createPrefabEntity } from './prefabInstance';
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
import { PlaySound, type SoundHandle } from './sound';

export interface PlantDeploymentWorld {
  canPlant(position: THREE.Vector3): boolean;
  blockers?: PlacementQuery;
  /** ondeploy's SpawnPrefab of the planted prefab, with the deployed item's skin; its display loads the art. */
  plants: Readonly<Record<string, { transplant(position: THREE.Vector3, skinId?: string): boolean }>>;
}

/** PLANT deployment: source-owned placer art, locomotion and SGwilson's frame-six commit. */
export class PlantDeployment {
  private readonly pointer: PointerRaycaster;
  private readonly resources = new SpriteResources();
  private readonly cleanups: (() => void)[] = [];
  private readonly reach = 1.1 * TILE_SIZE / 4;
  private version = 0;
  private disposed = false;
  private pending?: { point: THREE.Vector3; source: TurfSource };
  private buffered?: BufferedAction<'DEPLOY'>;
  /** The placer entity, drawn by its own display; `visible` is what its sprite json was last told. */
  private preview?: ReturnType<typeof createPrefabEntity> & { model: THREE.Group; visible: boolean };
  private previewEntity?: ItemEntity;
  private previewSkin?: string;
  private sound?: SoundHandle;

  private readonly world: WorldContext;
  private readonly animation: ActionAnimationController;
  private readonly locomotor: ActionLocomotor;
  private readonly getSource: () => TurfSource | undefined;
  private readonly planting: PlantDeploymentWorld;
  private readonly blockers: PlacementQuery;
  private readonly interrupted: () => boolean;

  constructor(world: WorldContext, animation: ActionAnimationController,
    locomotor: ActionLocomotor, getSource: () => TurfSource | undefined,
    planting: PlantDeploymentWorld, interrupted = () => false) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.getSource = getSource; this.planting = planting; this.interrupted = interrupted;
    this.blockers = planting.blockers ?? placementEntities(world.scene);
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
    return !this.blockers.someNear(point, spacing, blocker => {
      if ((blocker.visible === false && !blocker.logicalTree) || ignoresPlacement(blocker, ['NOBLOCK', 'player', 'FX', 'INLIMBO', 'DECOR', 'walkableplatform', 'walkableperipheral', 'isdead'])) return false;
      const inventoryRadius = blocker.getInventoryRadius?.(.5 * (TILE_SIZE / 4)) ?? blocker.inventoryRadius;
      const radius = blocker.smartRadius !== undefined ? blocker.smartRadius + spacing / 2
        : inventoryRadius !== undefined ? Math.min(spacing, inventoryRadius + spacing / 2) : spacing;
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
    this.pending = { point: point.clone(), source };
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
    const direction = point.clone().sub(this.world.player.position);
    const forward = this.world.camera.getWorldDirection(new THREE.Vector3()); forward.y = 0; forward.normalize();
    const side = direction.dot(new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0))), depth = direction.dot(forward);
    this.animation.setFacing(Math.abs(depth) >= Math.abs(side) ? (depth > 0 ? 'up' : 'down') : 'side', Math.abs(side) > Math.abs(depth) && side < 0);
    const version = this.version;
    const valid = () => !this.disposed && version === this.version && source.isValid() && this.canDeploy(point, source.entity)
      && this.world.player.position.distanceToSquared(point) <= this.reach ** 2;
    const map: PlantDeployMap = {
      canDeployPlant: position => this.canDeploy(position, source.entity),
      deployPlant: position => this.planting.plants[PLANTABLES[source.entity.prefab].prefab].transplant(position, source.entity.skinId),
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
      this.pending = undefined;
      return success;
    }, valid, { pos: point, invobject: source.entity, distance: this.reach });
    if (this.animation.stategraph.pushBufferedAction(buffered)) this.buffered = buffered;
  }

  private updatePreview(dt: number): void {
    const source = this.getSource(), entity = source?.entity;
    if (entity !== this.previewEntity || entity?.skinId !== this.previewSkin) {
      this.previewEntity = entity; this.previewSkin = entity?.skinId;
      this.releasePreview();
      const definition = entity && PLANTABLES[entity.prefab];
      if (definition) {
        const skinArchive = entity!.skinId && GROUND_ITEM_DEFINITIONS[entity!.prefab].skinArchives[entity!.skinId];
        // The placer's display loads its art; it is hidden until the pointer is over the ground.
        const placer = createPrefabEntity(`${entity!.prefab}_placer`, this.resources.factory({ buildArchive: `${definition.build}.zip`,
          animationArchive: definition.animationArchive ?? `${definition.bank}.zip`, ...skinArchive ? { skinArchive } : {} }),
          { name: definition.animation }, 'PlantPlacer');
        const model = placer.display.model;
        for (const tag of ['FX', 'NOCLICK']) placer.instance.addTag(tag);
        placer.instance.persists = false; model.userData.placer = true;
        placer.instance.sprite.setLightOverride(1);
        placer.instance.sprite.setVisible(false);
        this.preview = { ...placer, model, visible: false }; this.world.scene.add(model);
      }
    }
    const preview = this.preview;
    if (!preview) return;
    const point = this.pointer.groundPoint();
    const visible = !!point && !!source?.isValid();
    if (visible !== preview.visible) preview.instance.sprite.setVisible(preview.visible = visible);
    if (!point || !source) return;
    preview.instance.position.copy(point); preview.model.quaternion.copy(this.world.camera.quaternion);
    preview.instance.sprite.update(dt);
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
    this.pending = undefined;
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
  private releasePreview(): void {
    if (this.preview) { this.preview.instance.remove(); this.preview.display.dispose(); }
    this.preview = undefined;
  }
  private readonly keyDown = (event: KeyboardEvent): void => { if (event.code === 'Escape') this.cancel(); };
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.cancel(); this.cleanups.splice(0).forEach(cleanup => cleanup());
    this.sound?.stop();
    this.releasePreview();
    this.resources.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.pointerDown, true);
    window.removeEventListener('keydown', this.keyDown);
    if (this.pointer !== this.world.mouseActions?.pointer) this.pointer.dispose();
  }
}
