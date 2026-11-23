import type * as THREE from 'three';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { PrefabDisplayGroup, SpriteResources } from '@dontstarve-web/display';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { declarePlacer } from './buildCursor';
import { PLACER_ARCHIVE_OPTIONS } from './buildingPlacer';
import type { DeployPlacerMap } from './deployMap';
import { FARM_PLOW_ITEM_ID, FARM_PLOW_PLACER_ART } from './farm_plow';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { createArchiveEntity } from './prefabInstance';
import { isWallId, wallPlacer } from './walls';
import { FENCE_ITEM_ID, fencePlacer } from './fence';
import type { WorldContext } from './worldContext';

interface Placer {
  readonly instance: ReturnType<typeof createArchiveEntity>['instance'];
  readonly display: ReturnType<typeof createArchiveEntity>['display'];
  /** placer:LinkEntity: follows the placer's visibility. */
  readonly linked?: Pick<Placer, 'instance' | 'display'>;
  /** The hidden/shown state its sprite json was last told. */
  visible: boolean;
  place(point: THREE.Vector3, valid: boolean, rotation?: number): void;
}

/** playercontroller.lua deployplacer: follows the pointer while the active item is deployable. */
export class DeployPlacer {
  private readonly pointer: PointerRaycaster;
  private readonly ownsPointer: boolean;
  private readonly resources = new SpriteResources();
  private readonly stopUpdate: () => void;
  private readonly displays: PrefabDisplayGroup;
  private readonly map: DeployPlacerMap;
  private readonly getActiveItem: () => ItemEntity | null;
  private item?: ItemEntity;
  private skinId?: string;
  private placer?: Placer;
  private disposed = false;

  constructor(world: WorldContext, map: DeployPlacerMap, getActiveItem: () => ItemEntity | null) {
    const { scene } = world;
    this.displays = new PrefabDisplayGroup(scene);
    this.map = map;
    this.getActiveItem = getActiveItem;
    this.ownsPointer = !world.mouseActions?.pointer;
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.stopUpdate = world.registerFrameTask?.(dt => this.update(dt)) ?? (() => {});
  }

  update(dt = 0): void {
    if (this.disposed) {
      return;
    }
    const active = this.getActiveItem();
    const item = active && !active.isRemoved && active.components.deployable ? active : undefined;
    if (item !== this.item || item?.skinId !== this.skinId) {
      this.item = item;
      this.skinId = item?.skinId;
      this.release();
      // inventoryitem_replica.lua GetDeployPlacerName.
      if (item?.components.deployable?.usegridplacer) {
        this.createGridPlacer();
      } else if (item?.prefab === FARM_PLOW_ITEM_ID) {
        this.createPlowPlacer();
      } else if (item?.components.deployable?.mode === 'WALL') {
        this.createWallPlacer(item);
      } else if (item) {
        this.createPlantPlacer(item);
      }
    }
    const placer = this.placer;
    if (!placer || !item) {
      return;
    }
    this.displays.update(dt);
    const point = this.pointer.groundPoint();
    if (!!point !== placer.visible) {
      placer.instance.sprite.setVisible((placer.visible = !!point));
      placer.linked?.instance.sprite.setVisible(!!point);
    }
    if (point) {
      const deployable = item.components.deployable!;
      const placement = deployable.GetPlacement(point, this.map);
      placer.place(placement.point, deployable.CanDeploy(placement.point, this.map), placement.rotation);
    }
  }

  private createGridPlacer(): void {
    const { instance, display } = createArchiveEntity(
      'gridplacer',
      this.resources.archive(
        { animationArchive: 'gridplacer.zip', buildArchives: ['gridplacer.zip'], bank: 'gridplacer' },
        { colour: [1, 1, 1], instancedAnimations: 'all' },
      ),
      { name: 'anim', billboard: false },
      'TurfGridPlacer',
    );
    this.tagPlacer(instance);
    // gridplacer.lua: SetLayer(LAYER_BACKGROUND), SetOrientation(ANIM_ORIENTATION.OnGround).
    instance.sprite.setGround(0);
    instance.sprite.setVisible(false);
    instance.sprite.setMeshOrder(-0.5);
    let tinted: boolean | undefined;
    this.placer = {
      instance,
      display,
      visible: false,
      place: (point, valid) => {
        const centre = this.map.tileCenter(point);
        instance.setPosition(centre.x, 0.05, centre.z);
        if (valid !== tinted) {
          instance.sprite.setColour((tinted = valid) ? [1, 1, 1] : [0.75, 0.25, 0.25]);
        }
      },
    };
    this.displays.mount(display);
  }

  /** farm_plow.lua placer_fn: snap_to_tile, with the tile_outline linked. */
  private createPlowPlacer(): void {
    const { animation, ...art } = FARM_PLOW_PLACER_ART;
    // Placers own private translucent material copies, tinted only for themselves, drawn by the shared batches.
    const appearance = PLACER_ARCHIVE_OPTIONS;
    const entity = createArchiveEntity(
      'FarmPlowPlacer',
      this.resources.archive(art, appearance),
      { name: animation, billboard: true },
      'FarmPlowPlacer',
    );
    const outline = createArchiveEntity(
      'FarmPlowTileOutline',
      this.resources.archive(
        { animationArchive: 'gridplacer.zip', buildArchives: ['gridplacer.zip'], bank: 'gridplacer' },
        appearance,
      ),
      { name: 'anim', billboard: false },
      'FarmPlowTileOutline',
    );
    // tile_outline (gridplacer.lua): SetLayer(LAYER_BACKGROUND), SetOrientation(ANIM_ORIENTATION.OnGround).
    outline.instance.sprite.setGround(0);
    for (const { instance } of [entity, outline]) {
      this.tagPlacer(instance);
      instance.sprite.setVisible(false);
    }
    let tinted: boolean | undefined;
    this.placer = {
      instance: entity.instance,
      display: entity.display,
      linked: outline,
      visible: false,
      place: (point, valid) => {
        const centre = this.map.tileCenter(point);
        entity.instance.setPosition(centre.x, 0, centre.z);
        outline.instance.setPosition(centre.x, 0.05, centre.z);
        if (valid === tinted) {
          return;
        }
        tinted = valid;
        for (const { instance } of [entity, outline]) {
          instance.sprite.setColour(valid ? [1, 1, 1] : [0.75, 0.25, 0.25]);
        }
      },
    };
    this.displays.mount(entity.display);
    this.displays.mount(outline.display);
  }

  /** The wall-grid preview uses the same snapped point and rotation as DEPLOY. */
  private createWallPlacer(item: ItemEntity): void {
    const fence = item.prefab === FENCE_ITEM_ID ? fencePlacer(this.map.GetCameraHeading?.() ?? 0) : undefined;
    const spec = fence ?? (isWallId(item.prefab) ? wallPlacer(item.prefab) : undefined);
    if (!spec) {
      return;
    }
    const art = spec.art(this.resources, item.skinId);
    const { instance, display } = createArchiveEntity(
      `${item.prefab}_placer`,
      this.resources.archive(art.archive, PLACER_ARCHIVE_OPTIONS),
      { name: spec.animation, billboard: true },
      `${spec.name}Placer`,
      placer => art.initialize?.(placer),
    );
    declarePlacer(instance);
    instance.addTag('FX');
    let tinted: boolean | undefined;
    let lastRotation: number | undefined;
    this.placer = {
      instance,
      display,
      visible: false,
      place: (point, valid, rotation) => {
        instance.copyPosition(point);
        if (rotation !== undefined && rotation !== lastRotation) {
          lastRotation = rotation;
          fence?.setRotation(instance, rotation);
        }
        if (valid !== tinted) {
          instance.sprite.setColour((tinted = valid) ? [1, 1, 1] : [0.75, 0.25, 0.25]);
        }
      },
    };
    this.displays.mount(display);
  }

  private createPlantPlacer(item: ItemEntity): void {
    const definition = item.components.deployable?.placer;
    if (!definition) {
      return;
    }
    const skins = GROUND_ITEM_DEFINITIONS[item.prefab].skinArchives;
    if (item.skinId !== undefined && !skins[item.skinId]) {
      throw new Error(`Unsupported ${item.prefab} skin: ${item.skinId}`);
    }
    // MakePlacer(name, bank, build, anim) in the item's skin, drawn by the shared batches. The placer's display loads its
    // art; it is hidden until the pointer is over the ground.
    const entity = createArchiveEntity(
      `${item.prefab}_placer`,
      this.resources.archive(
        {
          animationArchive: definition.animationArchive ?? `${definition.bank}.zip`,
          buildArchives: [`${definition.build}.zip`],
          bank: definition.bank,
        },
        PLACER_ARCHIVE_OPTIONS,
      ),
      { name: definition.animation, billboard: true },
      'PlantPlacer',
      placer => {
        if (item.skinId === undefined) {
          return;
        }
        placer.skinId = item.skinId;
        placer.sprite.setSkinSource({ art: this.resources.archives, archives: skins });
      },
    );
    const { instance } = entity;
    this.tagPlacer(instance);
    instance.sprite.setVisible(false);
    let tinted: boolean | undefined;
    this.placer = {
      instance,
      display: entity.display,
      visible: false,
      place: (point, valid) => {
        instance.copyPosition(point);
        if (valid !== tinted) {
          instance.sprite.setColour((tinted = valid) ? [1, 1, 1] : [0.75, 0.25, 0.25]);
        }
      },
    };
    this.displays.mount(entity.display);
  }

  private tagPlacer(instance: Placer['instance']): void {
    // prefabutil.lua MakePlacer and gridplacer.lua tag their placer "placer".
    for (const tag of ['FX', 'NOCLICK', 'placer']) {
      instance.addTag(tag);
    }
    instance.persists = false;
    instance.sprite.setLightOverride(1);
  }

  private release(): void {
    const placer = this.placer;
    for (const entity of placer ? [placer, ...(placer.linked ? [placer.linked] : [])] : []) {
      entity.instance.remove();
      entity.display.dispose();
    }
    this.placer = undefined;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopUpdate();
    if (this.ownsPointer) {
      this.pointer.dispose();
    }
    this.release();
    this.displays.dispose();
    this.resources.dispose();
  }
}
