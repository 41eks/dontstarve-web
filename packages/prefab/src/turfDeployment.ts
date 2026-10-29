import * as THREE from 'three';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { BufferedAction } from '../../stategraphs/src/bufferedaction';
import type { WilsonAction } from '../../stategraphs/src/SGwilson';
import type { ActionAnimationController, ActionLocomotor } from '../../stategraphs/src/actionContext';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { ArchiveSpriteAssets, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { createArchiveEntity } from './prefabInstance';
import { turfTileName } from './turfs';
import { TurfMap } from './turfMap';
import { TILE_SIZE } from './tile';
import type { WorldContext } from './worldContext';

export interface TurfSource {
  readonly entity: ItemEntity;
  isValid(): boolean;
  take(): ItemEntity | undefined;
  putBack(item: ItemEntity): void;
}

/** Cursor-held turfs: gridplacer, locomotion, buffered DEPLOY and frame-six commit. */
export class TurfDeployment {
  private readonly pointer: PointerRaycaster;
  private readonly stopActions: () => void;
  private readonly stopHover: () => void;
  private readonly stopUpdate: () => void;
  private readonly assets: ArchiveSpriteAssets;
  private target?: THREE.Vector3;
  private source?: TurfSource;
  private action?: BufferedAction<WilsonAction>;
  private version = 0;
  private ready = false;
  private disposed = false;
  private previewEntity?: ItemEntity;
  /** The gridplacer entity; `visible` and `valid` are what its sprite json was last told. */
  private preview?: ReturnType<typeof createArchiveEntity> & { visible: boolean; valid?: boolean };
  private readonly reach = 1.1 * TILE_SIZE / 4;
  private readonly world: WorldContext;
  private readonly turf: TurfMap;
  private readonly animation: ActionAnimationController;
  private readonly locomotor: ActionLocomotor;
  private readonly getSource: () => TurfSource | undefined;
  private readonly isManualMovement: () => boolean;

  constructor(world: WorldContext, turf: TurfMap,
    animation: ActionAnimationController, locomotor: ActionLocomotor,
    getSource: () => TurfSource | undefined, isManualMovement = () => false) {
    this.world = world; this.turf = turf; this.animation = animation; this.locomotor = locomotor;
    this.getSource = getSource; this.isManualMovement = isManualMovement;
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.assets = new ArchiveSpriteAssets('turf-grid');
    this.stopActions = bindActionCancellation(world, this, 'deploy', () => this.cancel());
    this.stopHover = world.mouseActions?.register(() => {
      const source = this.getSource(), point = this.pointer.groundPoint();
      return source?.entity.components.deployable && point && this.turf.canPlaceTurf(point)
        ? [{ action: { action: 'DEPLOY', invobject: source.entity }, button: 'right' }] : [];
    }) ?? (() => {});
    this.stopUpdate = world.registerFrameTask?.(dt => this.update(dt)) ?? (() => {});
    world.renderer.domElement.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('keydown', this.onKeyDown);
  }

  request(point: THREE.Vector3): boolean {
    const source = this.getSource(), name = source && turfTileName(source.entity.prefab);
    if (this.disposed || !source?.isValid() || !name || !this.turf.canPlaceTurf(point)
      || this.animation.stategraph.hasStateTag('busy')) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'DEPLOY' });
    this.animation.cancelEmote();
    const centre = this.turf.tileCenter(point);
    this.target = new THREE.Vector3(centre.x, 0, centre.z);
    this.source = source;
    const version = this.version;
    void this.turf.prepareTurf(name).then(() => {
      if (!this.disposed && version === this.version) this.ready = true;
    }).catch((error: unknown) => {
      if (version === this.version) this.cancel();
      console.error('Unable to prepare turf deployment', error);
    });
    return true;
  }

  cancel(): void {
    this.version++;
    if (this.target) this.locomotor.stop();
    this.target = undefined; this.source = undefined; this.ready = false;
    if (this.action && this.animation.stategraph.isPerformingAction('DEPLOY')) this.animation.stategraph.cancelAction();
    this.action = undefined;
  }

  update(dt = 0): void {
    if (this.disposed) return;
    this.updatePreview(dt);
    if (this.isManualMovement() || this.source && !this.source.isValid()) { this.cancel(); return; }
    const point = this.target, source = this.source;
    if (!point || !source) return;
    if (!this.turf.canPlaceTurf(point)) { this.cancel(); return; }
    if (this.world.player.position.distanceToSquared(point) > this.reach ** 2) {
      const direction = this.world.player.position.clone().sub(point).normalize();
      const destination = point.clone().addScaledVector(direction, this.reach * .8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > .01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    if (!this.ready) return;
    const direction = point.clone().sub(this.world.player.position);
    if (direction.lengthSq() > 1e-8) {
      const forward = this.world.camera.getWorldDirection(new THREE.Vector3());
      forward.y = 0; forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
      const along = direction.dot(forward), side = direction.dot(right);
      this.animation.setFacing(Math.abs(along) >= Math.abs(side) ? (along > 0 ? 'up' : 'down') : 'side',
        Math.abs(side) > Math.abs(along) && side < 0);
    }
    const version = this.version;
    const valid = () => !this.disposed && version === this.version && source.isValid()
      && this.turf.canPlaceTurf(point) && this.world.player.position.distanceToSquared(point) <= this.reach ** 2;
    const action = new BufferedAction<WilsonAction>('DEPLOY', () => {
      if (!valid()) return false;
      const item = source.take();
      if (!item) return false;
      const deployed = item.components.deployable?.Deploy(point, {
        position: this.world.player.position,
        PushEvent: (name, data) => this.world.player.dispatchEvent({ type: name, data } as never),
      }, this.turf) ?? false;
      if (!deployed) source.putBack(item);
      this.source = undefined;
      return deployed;
    }, valid, { invobject: source.entity, pos: point, distance: this.reach });
    if (this.animation.stategraph.pushBufferedAction(action)) { this.action = action; this.target = undefined; }
  }

  private updatePreview(dt: number): void {
    const source = this.getSource(), entity = source?.entity;
    if (entity !== this.previewEntity) {
      this.previewEntity = entity;
      this.releasePreview();
      // A private colour copy: the placer tints only itself.
      const create = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(this.assets, { animationArchive: 'gridplacer.zip',
        buildArchives: ['gridplacer.zip'], bank: 'gridplacer', animation: clip.name, loop: clip.loop }, { name: 'TurfGridPlacer', colour: [1, 1, 1] });
      if (entity && turfTileName(entity.prefab)) void create({ name: 'anim', loop: true }).then(initial => {
        if (this.disposed || this.previewEntity !== entity) { initial.dispose(); return; }
        const placer = createArchiveEntity('gridplacer', { create, initial }, { name: 'anim' }, 'TurfGridPlacer');
        const model = placer.display.model, { sprite } = placer.instance;
        for (const tag of ['FX', 'NOCLICK']) placer.instance.addTag(tag);
        placer.instance.persists = false;
        model.userData.billboard = false;
        model.rotation.x = -Math.PI / 2;
        sprite.setVisible(false);
        sprite.setMeshOrder(-.5);
        sprite.setLightOverride(1);
        this.preview = { ...placer, visible: false };
        this.world.scene.add(model);
      }).catch((error: unknown) => console.error('Unable to load turf gridplacer', error));
    }
    const preview = this.preview;
    if (!preview) return;
    const { sprite } = preview.instance;
    sprite.update(dt);
    const point = this.pointer.groundPoint();
    const visible = point !== undefined && source?.isValid() === true;
    if (visible !== preview.visible) sprite.setVisible(preview.visible = visible);
    if (!point) return;
    const centre = this.turf.tileCenter(point);
    preview.instance.position.set(centre.x, .05, centre.z);
    // gridplacer.lua OnCanBuild / OnCannotBuild.
    const valid = this.turf.canPlaceTurf(point);
    if (valid !== preview.valid) sprite.setColour((preview.valid = valid) ? [1, 1, 1] : [.75, .25, .25]);
  }

  private releasePreview(): void {
    if (this.preview) { this.preview.instance.remove(); this.preview.display.dispose(); }
    this.preview = undefined;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented) return;
    if (event.button === 0) { this.cancel(); return; }
    if (event.button !== 2 || !this.getSource()?.entity.components.deployable) return;
    // Claim invalid turf clicks too: they must preserve the cursor item.
    event.preventDefault(); event.stopImmediatePropagation(); this.pointer.trackPointer(event);
    const point = this.pointer.groundPoint();
    if (!point || !this.request(point)) this.cancel();
  };
  private readonly onKeyDown = (event: KeyboardEvent): void => { if (event.code === 'Escape') this.cancel(); };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.cancel(); this.stopActions(); this.stopHover(); this.stopUpdate();
    this.releasePreview();
    this.assets.dispose();
    if (this.pointer !== this.world.mouseActions?.pointer) this.pointer.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('keydown', this.onKeyDown);
  }
}
