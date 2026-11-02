import * as THREE from 'three';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { SpriteResources } from '@dontstarve-web/display';
import { ArchiveSpriteAssets, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import type { DeployPlacerMap } from './deployMap';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { PLANTABLES } from './plantables';
import { createArchiveEntity, createPrefabEntity } from './prefabInstance';
import type { WorldContext } from './worldContext';

interface Placer {
  readonly instance: ReturnType<typeof createPrefabEntity>['instance'];
  readonly display: ReturnType<typeof createPrefabEntity>['display'];
  /** The hidden/shown state its sprite json was last told. */
  visible: boolean;
  place(point: THREE.Vector3, valid: boolean): void;
}

/** playercontroller.lua deployplacer: follows the pointer while the active item is deployable. */
export class DeployPlacer {
  private readonly pointer: PointerRaycaster;
  private readonly gridAssets = new ArchiveSpriteAssets('turf-grid');
  private readonly resources = new SpriteResources();
  private readonly stopUpdate: () => void;
  private readonly world: WorldContext;
  private readonly map: DeployPlacerMap;
  private readonly getActiveItem: () => ItemEntity | null;
  private item?: ItemEntity;
  private skinId?: string;
  private placer?: Placer;
  private disposed = false;

  constructor(world: WorldContext, map: DeployPlacerMap, getActiveItem: () => ItemEntity | null) {
    this.world = world; this.map = map; this.getActiveItem = getActiveItem;
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.stopUpdate = world.registerFrameTask?.(dt => this.update(dt)) ?? (() => {});
  }

  update(dt = 0): void {
    if (this.disposed) return;
    const active = this.getActiveItem();
    const item = active && !active.isRemoved && active.components.deployable ? active : undefined;
    if (item !== this.item || item?.skinId !== this.skinId) {
      this.item = item; this.skinId = item?.skinId;
      this.release();
      // inventoryitem_replica.lua GetDeployPlacerName.
      if (item?.components.deployable?.usegridplacer) this.createGridPlacer(item);
      else if (item) this.createPlantPlacer(item);
    }
    const placer = this.placer;
    if (!placer || !item) return;
    placer.display.update(dt);
    const point = this.pointer.groundPoint();
    if (!!point !== placer.visible) placer.instance.sprite.setVisible(placer.visible = !!point);
    if (point) placer.place(point, item.components.deployable!.CanDeploy(point, this.map));
  }

  private createGridPlacer(item: ItemEntity): void {
    // A private colour copy: the placer tints only itself.
    const create = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(this.gridAssets, { animationArchive: 'gridplacer.zip',
      buildArchives: ['gridplacer.zip'], bank: 'gridplacer', animation: clip.name, loop: clip.loop }, { name: 'TurfGridPlacer', colour: [1, 1, 1] });
    void create({ name: 'anim', loop: true }).then(initial => {
      if (this.disposed || this.item !== item) { initial.dispose(); return; }
      const entity = createArchiveEntity('gridplacer', { create, initial }, { name: 'anim' }, 'TurfGridPlacer');
      const model = entity.display.model, { instance } = entity, { sprite } = instance;
      this.tagPlacer(instance);
      model.userData.billboard = false;
      model.rotation.x = -Math.PI / 2;
      sprite.setVisible(false);
      sprite.setMeshOrder(-.5);
      let tinted: boolean | undefined;
      this.placer = { instance, display: entity.display, visible: false, place: (point, valid) => {
        const centre = this.map.tileCenter(point);
        instance.position.set(centre.x, .05, centre.z);
        // gridplacer.lua OnCanBuild / OnCannotBuild.
        if (valid !== tinted) sprite.setColour((tinted = valid) ? [1, 1, 1] : [.75, .25, .25]);
      } };
      this.world.scene.add(model);
    }).catch((error: unknown) => console.error('Unable to load turf gridplacer', error));
  }

  private createPlantPlacer(item: ItemEntity): void {
    const definition = PLANTABLES[item.prefab];
    if (!definition) return;
    const skinArchive = item.skinId && GROUND_ITEM_DEFINITIONS[item.prefab].skinArchives[item.skinId];
    // The placer's display loads its art; it is hidden until the pointer is over the ground.
    const entity = createPrefabEntity(`${item.prefab}_placer`, this.resources.factory({ buildArchive: `${definition.build}.zip`,
      animationArchive: definition.animationArchive ?? `${definition.bank}.zip`, ...skinArchive ? { skinArchive } : {} }),
      { name: definition.animation, billboard: true }, 'PlantPlacer');
    const model = entity.display.model, { instance } = entity;
    this.tagPlacer(instance);
    model.userData.placer = true;
    instance.sprite.setVisible(false);
    this.placer = { instance, display: entity.display, visible: false, place: (point, valid) => {
      instance.position.copy(point);
      model.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!(material instanceof THREE.MeshBasicMaterial)) continue;
          if (valid) material.color.setRGB(1, 1, 1); else material.color.setRGB(.75, .25, .25);
          material.opacity = .65;
        }
      });
    } };
    this.world.scene.add(model);
  }

  private tagPlacer(instance: Placer['instance']): void {
    for (const tag of ['FX', 'NOCLICK']) instance.addTag(tag);
    instance.persists = false;
    instance.sprite.setLightOverride(1);
  }

  private release(): void {
    if (this.placer) { this.placer.instance.remove(); this.placer.display.dispose(); }
    this.placer = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.stopUpdate();
    this.release();
    this.gridAssets.dispose();
    this.resources.dispose();
    if (this.pointer !== this.world.mouseActions?.pointer) this.pointer.dispose();
  }
}
