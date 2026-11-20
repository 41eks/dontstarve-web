import type * as THREE from 'three';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { SpriteResources } from '@dontstarve-web/display';
import { ArchiveSpriteAssets, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { PLACER_ARCHIVE_OPTIONS } from './buildingPlacer';
import type { DeployPlacerMap } from './deployMap';
import { FARM_PLOW_ITEM_ID, FARM_PLOW_PLACER_ART } from './farm_plow';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { createArchiveEntity } from './prefabInstance';
import type { WorldContext } from './worldContext';

interface Placer {
  readonly instance: ReturnType<typeof createArchiveEntity>['instance'];
  readonly display: ReturnType<typeof createArchiveEntity>['display'];
  /** placer:LinkEntity: follows the placer's visibility. */
  readonly linked?: Pick<Placer, 'instance' | 'display'>;
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
    if (this.disposed) { return; }
    const active = this.getActiveItem();
    const item = active && !active.isRemoved && active.components.deployable ? active : undefined;
    if (item !== this.item || item?.skinId !== this.skinId) {
      this.item = item; this.skinId = item?.skinId;
      this.release();
      // inventoryitem_replica.lua GetDeployPlacerName.
      if (item?.components.deployable?.usegridplacer) { this.createGridPlacer(item); }
      else if (item?.prefab === FARM_PLOW_ITEM_ID) { this.createPlowPlacer(); }
      else if (item) { this.createPlantPlacer(item); }
    }
    const placer = this.placer;
    if (!placer || !item) { return; }
    placer.display.update(dt); placer.linked?.display.update(dt);
    const point = this.pointer.groundPoint();
    if (!!point !== placer.visible) {
      placer.instance.sprite.setVisible(placer.visible = !!point);
      placer.linked?.instance.sprite.setVisible(!!point);
    }
    if (point) { placer.place(point, item.components.deployable!.CanDeploy(point, this.map)); }
  }

  private createGridPlacer(item: ItemEntity): void {
    // A private colour copy: the placer tints only itself. Its looping anim is drawn by the shared batches.
    const create = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(this.gridAssets, { animationArchive: 'gridplacer.zip',
      buildArchives: ['gridplacer.zip'], bank: 'gridplacer', animation: clip.name, loop: clip.loop },
      { name: 'TurfGridPlacer', colour: [1, 1, 1], instancedAnimations: 'all' });
    void create({ name: 'anim', loop: true }).then(initial => {
      if (this.disposed || this.item !== item) { initial.dispose(); return; }
      const entity = createArchiveEntity('gridplacer', { create, initial }, { name: 'anim' }, 'TurfGridPlacer');
      const model = entity.display.model, { instance } = entity, { sprite } = instance;
      this.tagPlacer(instance);
      model.userData.billboard = false;
      // gridplacer.lua: SetLayer(LAYER_BACKGROUND), SetOrientation(ANIM_ORIENTATION.OnGround).
      sprite.setGround(0);
      sprite.setVisible(false);
      sprite.setMeshOrder(-.5);
      let tinted: boolean | undefined;
      this.placer = { instance, display: entity.display, visible: false, place: (point, valid) => {
        const centre = this.map.tileCenter(point);
        instance.setPosition(centre.x, .05, centre.z);
        // gridplacer.lua OnCanBuild / OnCannotBuild.
        if (valid !== tinted) { sprite.setColour((tinted = valid) ? [1, 1, 1] : [.75, .25, .25]); }
      } };
      this.world.scene.add(model);
    }).catch((error: unknown) => console.error('Unable to load turf gridplacer', error));
  }

  /** farm_plow.lua placer_fn: snap_to_tile, with the tile_outline linked. */
  private createPlowPlacer(): void {
    const { animation, ...art } = FARM_PLOW_PLACER_ART;
    // Placers own private translucent material copies, tinted only for themselves, drawn by the shared batches.
    const appearance = PLACER_ARCHIVE_OPTIONS;
    const entity = createArchiveEntity('FarmPlowPlacer', this.resources.archive(art, appearance), { name: animation, billboard: true }, 'FarmPlowPlacer');
    const outline = createArchiveEntity('FarmPlowTileOutline', this.resources.archive({ animationArchive: 'gridplacer.zip',
      buildArchives: ['gridplacer.zip'], bank: 'gridplacer' }, appearance), { name: 'anim', billboard: false }, 'FarmPlowTileOutline');
    // tile_outline (gridplacer.lua): SetLayer(LAYER_BACKGROUND), SetOrientation(ANIM_ORIENTATION.OnGround).
    outline.instance.sprite.setGround(0);
    outline.display.model.userData.billboard = false;
    for (const { instance } of [entity, outline]) { this.tagPlacer(instance); instance.sprite.setVisible(false); }
    let tinted: boolean | undefined;
    this.placer = { instance: entity.instance, display: entity.display, linked: outline, visible: false, place: (point, valid) => {
      const centre = this.map.tileCenter(point);
      entity.instance.setPosition(centre.x, 0, centre.z);
      outline.instance.setPosition(centre.x, .05, centre.z);
      if (valid === tinted) { return; }
      tinted = valid;
      for (const { instance } of [entity, outline]) { instance.sprite.setColour(valid ? [1, 1, 1] : [.75, .25, .25]); }
    } };
    this.world.scene.add(entity.display.model, outline.display.model);
  }

  private createPlantPlacer(item: ItemEntity): void {
    const definition = item.components.deployable?.placer;
    if (!definition) { return; }
    const skins = GROUND_ITEM_DEFINITIONS[item.prefab].skinArchives;
    if (item.skinId !== undefined && !skins[item.skinId]) { throw new Error(`Unsupported ${item.prefab} skin: ${item.skinId}`); }
    // MakePlacer(name, bank, build, anim) in the item's skin, drawn by the shared batches. The placer's display loads its
    // art; it is hidden until the pointer is over the ground.
    const entity = createArchiveEntity(`${item.prefab}_placer`, this.resources.archive({ animationArchive: definition.animationArchive ?? `${definition.bank}.zip`,
      buildArchives: [`${definition.build}.zip`], bank: definition.bank }, PLACER_ARCHIVE_OPTIONS), { name: definition.animation, billboard: true }, 'PlantPlacer',
      placer => {
        if (item.skinId === undefined) { return; }
        placer.skinId = item.skinId;
        placer.sprite.setSkinSource({ art: this.resources.archives, archives: skins });
      });
    const { instance } = entity;
    this.tagPlacer(instance);
    instance.sprite.setVisible(false);
    let tinted: boolean | undefined;
    this.placer = { instance, display: entity.display, visible: false, place: (point, valid) => {
      instance.copyPosition(point);
      if (valid !== tinted) { instance.sprite.setColour((tinted = valid) ? [1, 1, 1] : [.75, .25, .25]); }
    } };
    this.world.scene.add(entity.display.model);
  }

  private tagPlacer(instance: Placer['instance']): void {
    // prefabutil.lua MakePlacer and gridplacer.lua tag their placer "placer".
    for (const tag of ['FX', 'NOCLICK', 'placer']) { instance.addTag(tag); }
    instance.persists = false;
    instance.sprite.setLightOverride(1);
  }

  private release(): void {
    const placer = this.placer;
    for (const entity of placer ? [placer, ...placer.linked ? [placer.linked] : []] : []) { entity.instance.remove(); entity.display.dispose(); }
    this.placer = undefined;
  }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true; this.stopUpdate();
    this.release();
    this.gridAssets.dispose();
    this.resources.dispose();
    if (this.pointer !== this.world.mouseActions?.pointer) { this.pointer.dispose(); }
  }
}
