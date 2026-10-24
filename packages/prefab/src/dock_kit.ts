import { placementEntities, ignoresPlacement, hasPlacementTag, type PlacementQuery, type PlacementBlocker } from './placementEntities';
import * as THREE from 'three';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { ArchiveSpriteAssets, createArchiveSprite, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { BuildCursor } from './buildCursor';
import { setPrefabLightOverride } from './localLight';
import { PlaySound, PreloadSounds } from './sound';
import { snapToTileCenter, TILE_SIZE } from './tile';
import { TurfMap, WORLD_TILES } from './turfMap';
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

/** tilegroups.lua classification for the tiles this map has: ocean is OCEAN_COASTAL, everything else valid is land. */
export const dockMapOf = (turf: TurfMap): DockMap => ({
  getTile: (col, row) => turf.tileIdAtCell(col, row),
  setTile: (col, row, tile, under) => turf.setTile(col, row, tile as never, under as never),
  cellsOfTile: tile => turf.cellsOfTile(tile),
  isLandTile: tile => tile !== WORLD_TILES.INVALID && tile !== WORLD_TILES.OCEAN_COASTAL,
  isTemporaryTile: tile => tile === WORLD_TILES.FARMING_SOIL || tile === WORLD_TILES.MONKEY_DOCK,
});

/** dock_kit.lua: CLIENT_CanDeployDockKit, deployable on_deploy and the gridplacer. */
export class DockKitPlacement {
  readonly dockmanager: DockManager;
  private readonly stopActionEvents: () => void;
  private readonly assets: ArchiveSpriteAssets;
  private readonly pointer: PointerRaycaster;
  private readonly cursor: BuildCursor;
  private readonly world: WorldContext;
  private readonly turf: TurfMap;
  private readonly blockers: PlacementQuery;
  private outline?: ArchiveSprite;
  private anchor?: THREE.Object3D;
  private outlineMaterials: THREE.Material[] = [];
  private takeItem?: () => ItemEntity | undefined;
  private version = 0;
  private prepareRequest?: Promise<void>;
  private disposed = false;

  constructor(world: WorldContext, turf: TurfMap, blockers: PlacementQuery = placementEntities(world.scene)) {
    this.world = world; this.turf = turf; this.blockers = blockers;
    this.dockmanager = new DockManager(dockMapOf(turf), { dock: WORLD_TILES.MONKEY_DOCK, farmingSoil: WORLD_TILES.FARMING_SOIL });
    this.stopActionEvents = bindActionCancellation(world, this, 'deploy', () => this.cancel());
    this.assets = new ArchiveSpriteAssets('dock-kit');
    this.pointer = new PointerRaycaster(world);
    this.cursor = new BuildCursor(world, this.pointer);
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private prepare(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Dock kit placement has been disposed'));
    this.prepareRequest ??= Promise.all([this.assets.loadAnimation('gridplacer.zip'), this.assets.loadBuild('gridplacer.zip'),
      PreloadSounds(DOCK_DEPLOY_SOUND)]).then(() => undefined);
    void this.prepareRequest.catch(() => { this.prepareRequest = undefined; });
    return this.prepareRequest;
  }

  /** The gridplacer snapped to tile centres; `takeItem` detaches one kit when the deploy commits. */
  async begin(takeItem: () => ItemEntity | undefined): Promise<void> {
    if (this.disposed) throw new Error('Dock kit placement has been disposed');
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'DEPLOY' });
    const version = this.version;
    this.takeItem = takeItem;
    this.cursor.show('鼠标右键：布署', 'right');
    try {
      await this.prepare();
      const outline = await createArchiveSprite(this.assets, { animationArchive: 'gridplacer.zip', buildArchives: ['gridplacer.zip'],
        bank: 'gridplacer', animation: 'anim', loop: false }, { name: 'DockKitGridPlacer' });
      if (version !== this.version || this.disposed) { outline.dispose(); return; }
      outline.model.userData.animationController = outline;
      outline.model.userData.tags = ['FX', 'NOCLICK'];
      outline.model.userData.billboard = false;
      outline.model.rotation.x = -Math.PI / 2;
      outline.model.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const clone = (material: THREE.Material) => { const copy = material.clone(); copy.opacity = .65; this.outlineMaterials.push(copy); return copy; };
        object.material = Array.isArray(object.material) ? object.material.map(clone) : clone(object.material);
      });
      this.outline = outline;
      this.world.scene.add(outline.model);
      // BuildCursor copies the camera quaternion onto its preview, which would stand the flat outline up; it drives an anchor instead.
      this.anchor = new THREE.Object3D();
      setPrefabLightOverride(outline.model, 1);
      this.cursor.setPreview(this.anchor, 0, point => this.center(point));
      this.cursor.update();
    } catch (error) { if (version === this.version) this.cancel(); throw error; }
  }

  cancel(): void {
    this.version++;
    this.takeItem = undefined;
    this.cursor.hide();
    this.outline?.dispose(); this.outline = undefined; this.anchor = undefined;
    for (const material of this.outlineMaterials) material.dispose();
    this.outlineMaterials = [];
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
    this.outline.model.visible = this.anchor.visible;
    this.outline.model.position.copy(this.anchor.position).setY(.05);
    const valid = this.outline.model.visible && this.canDeploy(this.outline.model.position);
    for (const material of this.outlineMaterials) {
      if (material instanceof THREE.MeshBasicMaterial) material.color.set(valid ? 0x66ff66 : 0xff5555);
    }
  }

  get renderEntities() {
    return this.outline?.model.visible ? [{ object: this.outline.model, footPosition: this.outline.model.position.clone().setY(0), cameraDepth: 0 }] : [];
  }

  dispose(): void {
    this.stopActionEvents();
    if (this.disposed) return;
    this.disposed = true; this.cancel(); this.pointer.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.assets.dispose();
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
