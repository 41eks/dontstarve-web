import { placementEntities, ignoresPlacement, hasPlacementTag, type PlacementQuery, type PlacementBlocker } from './placementEntities';
import * as THREE from 'three';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { SpriteResources } from '@dontstarve-web/display';
import { createArchiveEntity } from './prefabInstance';

// The placer tints: valid and blocked cells.
const VALID_TINT = new THREE.Color(0x66ff66).toArray() as [number, number, number];
const BLOCKED_TINT = new THREE.Color(0xff5555).toArray() as [number, number, number];
import { BuildCursor, modelPlacer } from './buildCursor';
import { PlaySound } from './sound';
import { snapToTileCenter, TILE_SIZE } from './tile';
import { TurfMap, WORLD_TILES, isLandTile } from './turfMap';
import type { WorldContext } from './worldContext';
import { DockManager, type DockMap } from '../../componets/src/dockmanager';

export const DOCK_KIT_ID = 'dock_kit';
/** TUNING.STACK_SIZE_MEDITEM, the stackable default dock_kit.lua sets. */
export const DOCK_KIT_MAX_STACK = 20;
const SCALE = TILE_SIZE / 4;
/** map.lua DEPLOY_IGNORE_TAGS. */
const DEPLOY_IGNORE_TAGS = new Set(['NOBLOCK', 'player', 'FX', 'INLIMBO', 'DECOR', 'walkableplatform', 'walkableperipheral', 'isdead']);
/** (TILE_SCALE / 2) + 1.2 in DST units: CanDeployDockAtPoint's min_distance_from_entities. */
const MIN_DISTANCE_FROM_ENTITIES = (4 / 2 + 1.2) * SCALE;
const DOCK_DEPLOY_SOUND = 'dontstarve/common/together/boat/damage' as const;

export type DockBlocker = PlacementBlocker;

/** tilegroups.lua classification: void tiles are neither land nor ocean. */
export const dockMapOf = (turf: TurfMap): DockMap => ({
  getTile: (col, row) => turf.tileIdAtCell(col, row),
  setTile: (col, row, tile, under) => turf.setTile(col, row, tile as never, under as never),
  cellsOfTile: tile => turf.cellsOfTile(tile),
  isLandTile,
  isTemporaryTile: tile => tile === WORLD_TILES.FARMING_SOIL || tile === WORLD_TILES.MONKEY_DOCK,
});

/** dock_kit.lua: CLIENT_CanDeployDockKit, deployable on_deploy and the gridplacer. */
export class DockKitPlacement {
  readonly dockmanager: DockManager;
  private readonly stopActionEvents: () => void;
  /** The gridplacer's shared archive; declaring it performs no IO, the outline's display loads it. */
  private readonly sprites = new SpriteResources(undefined, 'dock-kit');
  private readonly pointer: PointerRaycaster;
  private readonly cursor: BuildCursor;
  private readonly world: WorldContext;
  private readonly turf: TurfMap;
  private readonly blockers: PlacementQuery;
  /** The gridplacer entity; `visible` and `valid` are what its sprite json was last told. */
  private outline?: ReturnType<typeof createArchiveEntity> & { visible: boolean; valid?: boolean };
  private anchor?: THREE.Object3D;
  private takeItem?: () => ItemEntity | undefined;
  private disposed = false;

  constructor(world: WorldContext, turf: TurfMap, blockers: PlacementQuery = placementEntities(world.scene)) {
    this.world = world; this.turf = turf; this.blockers = blockers;
    this.dockmanager = new DockManager(dockMapOf(turf), { dock: WORLD_TILES.MONKEY_DOCK, farmingSoil: WORLD_TILES.FARMING_SOIL });
    this.stopActionEvents = bindActionCancellation(world, this, 'deploy', () => this.cancel());
    this.pointer = new PointerRaycaster(world);
    this.cursor = new BuildCursor(world, this.pointer);
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  /** The gridplacer snapped to tile centres; `takeItem` detaches one kit when the deploy commits. */
  begin(takeItem: () => ItemEntity | undefined): void {
    if (this.disposed) throw new Error('Dock kit placement has been disposed');
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'DEPLOY' });
    this.takeItem = takeItem;
    this.cursor.show('鼠标右键：布署', 'right');
    // Private colour and opacity copies: the placer tints only itself.
    const entity = createArchiveEntity('gridplacer', this.sprites.archive({ animationArchive: 'gridplacer.zip',
      buildArchives: ['gridplacer.zip'], bank: 'gridplacer' }, { opacity: .65, colour: [1, 1, 1] }), { name: 'anim' }, 'DockKitGridPlacer');
    // gridplacer.lua: PlayAnimation("anim", true).
    const model = entity.display.model;
    for (const tag of ['FX', 'NOCLICK']) entity.instance.addTag(tag);
    entity.instance.persists = false;
    model.userData.billboard = false;
    model.rotation.x = -Math.PI / 2;
    this.outline = { ...entity, visible: true };
    this.world.scene.add(model);
    // BuildCursor moves and hides an anchor; the outline follows it lifted off the ground and shows through its sprite.
    this.anchor = new THREE.Object3D();
    entity.instance.sprite.setLightOverride(1);
    this.cursor.setPreview(modelPlacer(this.anchor), 0, point => this.center(point));
    this.cursor.update();
  }

  cancel(): void {
    this.takeItem = undefined;
    this.cursor.hide();
    if (this.outline) { this.outline.instance.remove(); this.outline.display.dispose(); }
    this.outline = undefined; this.anchor = undefined;
  }

  private center(point: Pick<THREE.Vector3, 'x' | 'z'>): THREE.Vector3 {
    const center = snapToTileCenter(point);
    return new THREE.Vector3(center.x, 0, center.z);
  }

  private cell(point: Pick<THREE.Vector3, 'x' | 'z'>): [number, number] {
    return [Math.floor(point.x / TILE_SIZE), Math.floor(point.z / TILE_SIZE)];
  }

  /**
   * CLIENT_CanDeployDockKit followed by Map:CanDeployDockAtPoint: an ocean tile touching permanent land or a dock,
   * with no dockjammer on it and nothing standing in the water within the dock's footprint.
   */
  canDeploy(point: THREE.Vector3): boolean {
    const [col, row] = this.cell(point), center = this.center(point);
    if (this.turf.tileIdAtCell(col, row) !== WORLD_TILES.OCEAN_COASTAL) return false;
    const map = dockMapOf(this.turf);
    let adjacent = false;
    for (let dx = -1; dx <= 1 && !adjacent; dx++) for (let dz = -1; dz <= 1; dz++) {
      if ((dx !== 0 || dz !== 0) && map.isLandTile(map.getTile(col + dx, row + dz))) { adjacent = true; break; }
    }
    if (!adjacent) return false;
    if (this.blockers.someOnTile(center, blocker => hasPlacementTag(blocker, 'dockjammer'))) return false;
    return !this.blockers.someNear(center, MIN_DISTANCE_FROM_ENTITIES, blocker => {
      if (blocker.visible === false || ignoresPlacement(blocker, DEPLOY_IGNORE_TAGS)) return false;
      // IsDockNearOtherOnOcean only considers entities standing on ocean tiles.
      const [bc, br] = this.cell(blocker.position);
      if (map.isLandTile(map.getTile(bc, br))) return false;
      return isNearOther(blocker, center, MIN_DISTANCE_FROM_ENTITIES);
    });
  }

  /** deployable:Deploy → on_deploy. The kit is consumed only when the dock is created. */
  deploy(point: THREE.Vector3, takeItem: () => ItemEntity | undefined): boolean {
    if (this.disposed || !this.canDeploy(point)) return false;
    const [col, row] = this.cell(point);
    const item = takeItem();
    if (!item) return false;
    if (item.prefab !== DOCK_KIT_ID || item.isRemoved || item.components.inventoryitem.owner || item.components.stackable.count !== 1) {
      throw new Error('Deployment requires one detached dock_kit');
    }
    // PlaySoundWithParams("turnoftides/common/together/boat/damage", { intensity = 0.8 }) on the deployer.
    PlaySound(DOCK_DEPLOY_SOUND, this.world.player.position).setParameter?.('intensity', .8);
    this.dockmanager.CreateDockAtTile(col, row);
    // A dock that cannot reach land would break; deployable tiles always touch land or a connected dock.
    this.dockmanager.ResolveDockSafetyAtTile(col, row);
    item.remove();
    return true;
  }

  update(): void {
    if (this.disposed) return;
    this.cursor.update();
    if (!this.outline || !this.anchor) return;
    const outline = this.outline, { sprite } = outline.instance;
    if (outline.visible !== this.anchor.visible) sprite.setVisible(outline.visible = this.anchor.visible);
    outline.instance.position.copy(this.anchor.position).setY(.05);
    const valid = outline.visible && this.canDeploy(outline.instance.position);
    if (valid !== outline.valid) sprite.setColour((outline.valid = valid) ? VALID_TINT : BLOCKED_TINT);
  }

  get renderEntities() {
    const outline = this.outline;
    return outline?.visible ? [{ object: outline.display.model, footPosition: outline.instance.position.clone().setY(0), cameraDepth: 0 }] : [];
  }

  dispose(): void {
    this.stopActionEvents();
    if (this.disposed) return;
    this.disposed = true; this.cancel(); this.pointer.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.sprites.dispose();
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.takeItem || event.defaultPrevented) return;
    if (event.button === 0) { event.preventDefault(); this.cancel(); return; }
    if (event.button !== 2) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.pointer.trackPointer(event);
    const point = this.pointer.groundPoint(), takeItem = this.takeItem;
    if (!point || !this.outline) return;
    if (this.deploy(point, takeItem)) this.cancel();
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => { if (event.code === 'Escape') this.cancel(); };
}

/** map.lua IsNearOther (min_spacing form) with deploy_smart_radius and inventoryitem physics radius. */
function isNearOther(other: DockBlocker, pt: THREE.Vector3, minSpacing: number): boolean {
  let spacing = minSpacing;
  if (other.smartRadius !== undefined) spacing = other.smartRadius + minSpacing / 2;
  else if (other.inventoryRadius !== undefined) spacing = Math.min(other.inventoryRadius + minSpacing / 2, minSpacing);
  return other.position.distanceToSquared(pt) < spacing ** 2;
}
