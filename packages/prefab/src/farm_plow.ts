import { ToolMouseTarget } from './toolMouseTarget';
import { MakeObstaclePhysics } from './standardcomponents';
import { SpatialIndex } from './spatialIndex';
import { placementEntities, registerPlacementEntity, ignoresPlacement, hasPlacementTag, type PlacementQuery, type PlacementBlocker } from './placementEntities';
import { ModelRecords } from './modelRecords';
import type { ItemEntity, InventoryStack } from '@dontstarve-web/inventory';
import type { FarmSoilTarget, FarmActionWorld } from '@dontstarve-web/stategraphs/farmActions';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import * as THREE from 'three';
import { PrefabDisplayGroup, SpriteResources, type ArchiveSpriteSource } from '@dontstarve-web/display';
import { createArchiveEntity } from './prefabInstance';
import { BuildCursor, entityPlacer } from './buildCursor';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { newEntityId } from './saveRecord';
import { snapToTileCenter, TILE_SIZE } from './tile';
import { TurfMap, WORLD_TILES } from './turfMap';
import { PlaySound, type SoundHandle } from './sound';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import type { ShovelTarget } from '@dontstarve-web/stategraphs/dig';
import type { WorldContext } from './worldContext';
import { FARM_PLANT_ART, VEGGIE_SEED_IDS } from './veggies';
import { actionEntity, disposeActionEntity, findActionEntity } from './actionEntity';
import { Workable } from '../../componets/src/workable';
import { performToolWork } from '../../stategraphs/src/componentactions';

export const FARM_PLOW_ITEM_ID = 'farm_plow_item';
export const FARM_PLOW_ID = 'farm_plow';
export const PLANTED_SEED_ID = 'farm_plant_randomseed';
/** farmplantable.plant: raw seeds sow randomseed; veggies.lua fn_seeds sows farm_plant_<name>. */
const SEED_PLANTS: Readonly<Record<string, string>> = {
  seeds: PLANTED_SEED_ID, ...Object.fromEntries(VEGGIE_SEED_IDS.map((id) => [id, `farm_plant_${id.slice(0, -'_seeds'.length)}`])),
};
export const SEED_ITEM_IDS: readonly string[] = Object.keys(SEED_PLANTS);
interface PlantedSeedArt { animationArchive: string; buildArchives: string[]; bank: string; pre: string; idle: string }
/** farm_plants.lua: randomseed plays sow → sow_idle; stage "seed" plays grow_seed → crop_seed over farm_soil's soil01. */
const PLANTED_SEED_ART: Readonly<Record<string, PlantedSeedArt>> = {
  [PLANTED_SEED_ID]: { animationArchive: 'farm_soil.zip', buildArchives: ['farm_soil.zip'], bank: 'farm_soil', pre: 'sow', idle: 'sow_idle' },
  ...Object.fromEntries(Object.entries(FARM_PLANT_ART).map(([id, { bank, build }]) => [id, {
    animationArchive: `${bank}.zip`, buildArchives: [`${build}.zip`, 'farm_soil.zip'], bank, pre: 'grow_seed', idle: 'crop_seed',
  }])),
};
export const PLANTED_SEED_IDS = Object.keys(PLANTED_SEED_ART);
export const FARM_PLOW_USES = 4;
export const FARM_PLOW_DRILLING_DURATION = 15;
export const FARM_DECOR_IDS = ['farm_soil', 'farm_soil_debris'] as const;
type FarmDecorId = typeof FARM_DECOR_IDS[number];
export interface FarmPlowSaveState {
  phase: 'drill_pre' | 'drill_loop' | 'collapse';
  remainingSeconds: number;
  /** Lua deploy_item_save_record, captured after finiteuses:Use(1); null on depletion/debug spawn. */
  deployItem: InventoryStack | null;
}
export interface FarmSoilSaveState { broken: boolean; plowId?: string }
export interface FarmDebrisSaveState { animation: 'f1' | 'f2' | 'f3' | 'f4' }
export type FarmPlowBlocker = PlacementBlocker;
/** A farm entity drawn by its own display: plows, soil, debris, planted seeds, placers and fx. */
type FarmEntity = ReturnType<typeof createArchiveEntity>;
type FarmSprite = FarmEntity['instance']['sprite'];
type ArchiveOptions = Parameters<SpriteResources['archive']>[1];
const TEMPORARY_TAGS = ['FX', 'NOCLICK'] as const;
// The placer tints: blocked cells.
const BLOCKED_TINT = new THREE.Color(0xff5555).toArray() as [number, number, number];
interface Plow extends FarmPlowSaveState {
  id: string; entity: FarmEntity; loopSound?: SoundHandle;
  dirtTasks: { quad: number; remaining: number }[];
}
interface Decor {
  id: string; prefabId: FarmDecorId; entity: FarmEntity;
  broken: boolean; plowId?: string; animation: FarmDebrisSaveState['animation'];
  stopTracking?: () => void;
}
const SCALE = TILE_SIZE / 4;
const TILL_SPACING = 1.25 * SCALE;
const TILL_IGNORE_BLOCKERS = new Set(['NOBLOCK', 'player', 'FX', 'INLIMBO', 'DECOR',
  'walkableplatform', 'walkableperipheral', 'isdead', 'soil', 'merm']);
const IGNORE_BLOCKERS = new Set(['NOBLOCK', 'locomotor', 'NOCLICK', 'FX', 'DECOR', 'player']);
const soilOverride = { soil01: { archive: 'farm_soil.zip', symbol: 'soil01' } };
const DEBRIS_LOOT = [['twigs', 40], ['rocks', 25], ['flint', 20], ['nitre', 10], ['goldnugget', 5]] as const;

/** farm_plow.lua's deployment, timer, terraform and fold-up lifecycle; displays load the declared art. */
export class FarmPlowPlacement implements FarmActionWorld {
  private readonly stopActionEvents: () => void;
  private readonly resources: SpriteResources;
  private readonly displays: PrefabDisplayGroup;
  private readonly pointer: PointerRaycaster;
  private readonly cursor: BuildCursor;
  private readonly mousePlows = new ModelRecords<Plow>();
  private readonly plows = new Map<string, Plow>();
  private readonly plowPositions = new SpatialIndex<Plow>(plow => plow.entity.instance.position);
  private readonly decorPositions = new SpatialIndex<Decor>(decor => decor.entity.instance.position);
  private readonly seedPositions = new SpatialIndex<FarmEntity>(seed => seed.instance.position);
  private readonly stopSeeds = new Map<FarmEntity, () => void>();
  private readonly mouseDecor = new ModelRecords<Decor>();
  private readonly decor = new Map<string, Decor>();
  private readonly plantedSeeds = new Map<string, FarmEntity>();
  private debrisLoot?: (itemId: string, position: THREE.Vector3) => void;
  private readonly effects = new Set<FarmEntity>();
  private preview?: FarmEntity;
  private previewOutline?: FarmEntity;
  /** What the placers' sprite json was last told. */
  private previewVisible?: boolean;
  private previewValid?: boolean;
  private takeItem?: () => ItemEntity | undefined;
  private disposed = false;
  private readonly removeDigListener: () => void;
  private readonly world: WorldContext;
  private readonly turf: TurfMap;
  private readonly returnItem: (position: THREE.Vector3, item: InventoryStack) => void;
  private readonly blockers: PlacementQuery;
  private readonly random: () => number;

  constructor(world: WorldContext, turf: TurfMap,
    returnItem: (position: THREE.Vector3, item: InventoryStack) => void,
    blockers: PlacementQuery = placementEntities(world.scene), random = Math.random) {
    this.world = world; this.turf = turf; this.returnItem = returnItem; this.blockers = blockers; this.random = random;
    this.stopActionEvents = bindActionCancellation(world, this, 'deploy', () => this.cancel());
    this.resources = new SpriteResources(undefined, 'farm');
    this.displays = new PrefabDisplayGroup(world.scene);
    this.pointer = new PointerRaycaster(world);
    this.cursor = new BuildCursor(world, this.pointer);
    this.removeDigListener = turf.onDig((point) => {
      for (const soil of [...this.decor.values()]) {
        if (soil.prefabId === 'farm_soil' && this.tileKey(soil.entity.instance.position) === this.tileKey(point)) this.removeSoil(soil);
      }
    });
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  begin(takeItem: () => ItemEntity | undefined): void {
    if (this.disposed) throw new Error('Farm plow has been disposed');
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'DEPLOY' });
    this.takeItem = takeItem;
    this.cursor.show('鼠标右键：布署', 'right');
    // Placers own private translucent material copies, tinted only for themselves.
    const appearance = { opacity: .65, colour: [1, 1, 1] as [number, number, number] };
    const preview = this.create('FarmPlowPlacer', this.archive('farm_plow.zip', 'farm_plow', appearance), 'idle_place', TEMPORARY_TAGS);
    const outline = this.create('FarmPlowTileOutline', this.archive('gridplacer.zip', 'gridplacer', appearance), 'anim', TEMPORARY_TAGS,
      undefined, false);
    this.previewVisible = undefined; this.previewValid = undefined;
    this.preview = preview;
    this.previewOutline = outline;
    outline.display.model.rotation.x = -Math.PI / 2;
    outline.display.model.userData.billboard = false;
    // MakePlacer: AnimState:SetLightOverride(1) on each placer entity.
    for (const placer of [preview, outline]) placer.instance.sprite.setLightOverride(1);
    this.cursor.setPreview(entityPlacer(preview.instance), 0, (point) => this.center(point));
    this.cursor.update();
  }

  cancel(): void {
    this.takeItem = undefined;
    this.cursor.hide();
    this.preview?.instance.remove(); this.preview = undefined;
    this.previewOutline?.instance.remove(); this.previewOutline = undefined;
  }

  canDeploy(point: THREE.Vector3): boolean {
    const center = this.center(point);
    if (!this.turf.canPlow(point) || this.turf.getTileAtWorld(center) === WORLD_TILES.INVALID
      || this.plowPositions.someOnTile(center, () => true)) return false;
    return !this.blockers.someOnTile(center, blocker => this.blocksExternal(blocker, IGNORE_BLOCKERS))
      && !this.decorPositions.someOnTile(center, item => !item.broken);
  }

  deploy(point: THREE.Vector3, takeItem: () => ItemEntity | undefined): boolean {
    if (this.disposed || !this.canDeploy(point)) return false;
    const center = this.center(point);
    const item = takeItem();
    if (!item) return false;
    if (item.prefab !== FARM_PLOW_ITEM_ID || item.isRemoved || item.components.inventoryitem.owner
      || item.components.stackable.count !== 1) throw new Error('Deployment requires one detached farm_plow_item');
    item.components.finiteuses.setMaxUses(FARM_PLOW_USES);
    if (!item.components.finiteuses.use(1)) return false;
    const deployItem = item.isRemoved ? null : item.snapshot();
    if (!item.isRemoved) item.remove();
    this.addPlow(newEntityId(), center, { phase: 'drill_pre', remainingSeconds: FARM_PLOW_DRILLING_DURATION, deployItem });
    this.cancel();
    return true;
  }

  spawn(point: THREE.Vector3, saved?: { id: string; state: FarmPlowSaveState }): THREE.Group {
    if (this.disposed) throw new Error('Farm plow has been disposed');
    return this.addPlow(saved?.id ?? newEntityId(), this.center(point), saved?.state
      ?? { phase: 'drill_pre', remainingSeconds: FARM_PLOW_DRILLING_DURATION, deployItem: null }).entity.display.model;
  }

  private addPlow(id: string, position: THREE.Vector3, state: FarmPlowSaveState): Plow {
    let plow!: Plow;
    // farm_plow.lua StartUp: drill_pre, then animover starts drilling; a restored plow resumes its phase.
    const entity = this.create(FARM_PLOW_ID, this.archive('farm_plow.zip', 'farm_plow'), 'idle_place', ['scarytoprey'], sprite => {
      if (state.phase === 'drill_pre') sprite.playOnce('drill_pre', () => this.startDrilling(plow));
      else if (state.phase === 'drill_loop') sprite.start('drill_loop');
      else sprite.playOnce('collapse', () => this.returnSavedItem(plow));
    });
    plow = { ...state, deployItem: state.deployItem ? { ...state.deployItem } : null, id, entity, dirtTasks: [] };
    const { instance, display } = entity;
    instance.position.copy(position);
    MakeObstaclePhysics(instance, .5);
    if (this.world.physics) instance.bindPhysics(this.world.physics);
    instance.entityId = id;
    this.plowPositions.add(plow);
    this.plows.set(id, plow); this.mousePlows.set(display.model, plow);
    const inst = actionEntity(display.model, FARM_PLOW_ID);
    const workable = new Workable(inst);
    inst.components.workable = workable;
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(1);
    workable.SetWorkable(state.phase !== 'collapse');
    inst.hammerTarget = {
      id: plow.id, entity: inst, instance, display, position: instance.position,
      isValid: () => !this.disposed && this.plows.get(plow.id) === plow && plow.phase !== 'collapse',
      playHit: () => {
        if (this.plows.get(plow.id) === plow && plow.phase !== 'collapse') performToolWork('HAMMER', inst, {});
      },
    };
    new ToolMouseTarget(inst, instance, workable, this.world.handEquipment);
    workable.SetOnFinishCallback(() => {
      if (this.plows.get(plow.id) !== plow || plow.phase === 'collapse') return;
      this.collapseEffect(instance.position);
      for (const soil of [...this.decor.values()]) if (soil.plowId === plow.id) this.removeSoil(soil);
      if (plow.deployItem !== null) this.returnSavedItem(plow);
      else this.removePlow(plow);
    });
    if (state.phase === 'drill_pre') PlaySound('farming/common/farm/plow/drill_pre', position);
    else if (state.phase === 'drill_loop') this.startDrilling(plow);
    else this.fold(plow, false);
    return plow;
  }

  private startDrilling(plow: Plow): void {
    if (this.plows.get(plow.id) !== plow || plow.phase === 'collapse') return;
    const { sprite, position } = plow.entity.instance;
    if (plow.phase !== 'drill_loop') { plow.phase = 'drill_loop'; sprite.start('drill_loop'); }
    plow.loopSound = PlaySound('farming/common/farm/plow/LP', position);
    plow.dirtTasks = [{ quad: 1, remaining: this.random() * 0.2 }, { quad: 2, remaining: 0.2 + this.random() * 0.3 },
      { quad: 3, remaining: 1 + this.random() * 0.5 }, { quad: 4, remaining: 0.5 + this.random() * 0.3 }];
  }

  update(dt: number, _cameraQuaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    const step = Math.max(0, Math.min(dt, 0.1));
    this.cursor.update();
    // BuildCursor shows and hides the plow placer; its tile outline follows it.
    const previewVisible = this.preview !== undefined && this.cursor.previewVisible;
    if (this.previewOutline) {
      if (previewVisible !== this.previewVisible) this.previewOutline.instance.sprite.setVisible(this.previewVisible = previewVisible);
      if (this.preview) this.previewOutline.instance.position.copy(this.preview.instance.position).setY(0.05);
    }
    if (this.preview && previewVisible) {
      const valid = this.canDeploy(this.preview.instance.position);
      if (valid !== this.previewValid) {
        this.previewValid = valid;
        for (const placer of [this.preview, this.previewOutline]) placer?.instance.sprite.setColour(valid ? [1, 1, 1] : BLOCKED_TINT);
      }
    }
    for (const plow of [...this.plows.values()]) {
      if (plow.phase !== 'drill_loop') continue;
      plow.remainingSeconds = Math.max(0, plow.remainingSeconds - step);
      for (const task of plow.dirtTasks) {
        task.remaining -= step;
        if (task.remaining > 0) continue;
        this.dirt(plow, task.quad);
        const t = 1 - plow.remainingSeconds / FARM_PLOW_DRILLING_DURATION;
        task.remaining += 1.5 + (0.2 - 1.5) * t + this.random() * 0.3;
      }
      if (plow.remainingSeconds < 1e-8) this.finish(plow);
    }
    for (const item of [...this.decor.values()]) if (item.plowId && !this.plows.has(item.plowId)) this.removeSoil(item);
    this.displays.update(step);
  }

  get soilTargets(): readonly FarmSoilTarget[] {
    return [...this.decor.values()].filter((soil) => this.isPlantableSoil(soil)).map((soil) => ({
      id: soil.id, model: soil.entity.display.model, position: soil.entity.instance.position,
      isValid: () => this.isPlantableSoil(soil),
    }));
  }

  setDebrisLootHandler(handler: (itemId: string, position: THREE.Vector3) => void): void {
    this.debrisLoot = handler;
  }

  /** farm_soil_debris.lua: one successful DIG removes only that debris entity. */
  get digTargets(): readonly ShovelTarget[] { return this.getDigTargets(); }

  getDigTargets(model?: THREE.Object3D): readonly ShovelTarget[] {
    return this.mouseDecor.select(model, this.decor.values()).filter(({ prefabId }) => prefabId === 'farm_soil_debris').map((item) => {
      const position = item.entity.instance.position;
      const isValid = () => !this.disposed && this.decor.get(item.id) === item
        && this.turf.getTileAtWorld(position) === WORLD_TILES.FARMING_SOIL;
      return { id: item.id, model: item.entity.display.model, position, isValid, dig: () => {
        if (!isValid()) return false;
        const origin = position.clone();
        this.decor.delete(item.id); item.stopTracking?.(); item.entity.instance.remove(); this.puff(origin);
        // Base FARM_SOIL_DEBRIS_LOOT_CHANCE, without porting unrelated luck skills.
        if (this.random() < 0.25 && this.debrisLoot) {
          let roll = this.random() * 100;
          const loot = DEBRIS_LOOT.find(([, weight]) => { roll -= weight; return roll < 0; })?.[0] ?? 'goldnugget';
          this.debrisLoot(loot, origin);
        }
        return true;
      } };
    });
  }

  /** map.lua: soil can be retilled; debris and planted crops still block the point. */
  canTill(point: THREE.Vector3): boolean {
    if (this.disposed || this.turf.getTileAtWorld(point) !== WORLD_TILES.FARMING_SOIL) return false;
    const plantSpacing = 0.5 * SCALE + TILL_SPACING / 2;
    return !this.plowPositions.someNear(point, TILL_SPACING, plow => plow.entity.instance.position.distanceToSquared(point) < TILL_SPACING ** 2)
      && !this.decorPositions.someNear(point, TILL_SPACING, item => item.prefabId === 'farm_soil_debris'
        && item.entity.instance.position.distanceToSquared(point) < TILL_SPACING ** 2)
      && !this.seedPositions.someNear(point, plantSpacing, seed => seed.instance.position.distanceToSquared(point) < plantSpacing ** 2)
      && !this.blockers.someNear(point, Math.max(plantSpacing, TILL_SPACING), blocker => this.blocksExternal(blocker, TILL_IGNORE_BLOCKERS)
        && blocker.position.distanceToSquared(point) < (hasPlacementTag(blocker, 'farm_plant') ? plantSpacing : TILL_SPACING) ** 2);
  }

  private blocksExternal(blocker: PlacementBlocker, ignored: ReadonlySet<string>): boolean {
    // Local plows and decor have their own indexes and Lua-specific checks above.
    return blocker.prefab !== FARM_PLOW_ID && !FARM_DECOR_IDS.includes(blocker.prefab as FarmDecorId)
      && (blocker.logicalTree === true || !ignoresPlacement(blocker, ignored));
  }

  /** TILL's hit frame: collapse nearby soil and spawn farm_soil, which rises then idles. */
  till(point: THREE.Vector3): boolean {
    const position = point.clone().setY(0);
    if (!this.canTill(position)) return false;
    this.collapseSoil(position);
    this.addDecor('farm_soil', position, newEntityId(), { broken: false, animation: 'f1', fresh: true });
    return true;
  }

  private isPlantableSoil(soil: Decor): boolean {
    return !this.disposed && this.decor.get(soil.id) === soil && soil.prefabId === 'farm_soil'
      && !soil.broken && !soil.plowId && this.turf.getTileAtWorld(soil.entity.instance.position) === WORLD_TILES.FARMING_SOIL;
  }

  /** PLANT's hit frame: farmplantable.plant takes the seed and replaces the hole with its plant. */
  plantSeed(id: string, seedItemId = 'seeds', takeSeed: () => boolean): boolean {
    const soil = this.decor.get(id), plantId = Object.hasOwn(SEED_PLANTS, seedItemId) ? SEED_PLANTS[seedItemId] : undefined;
    if (!soil || !plantId || !this.isPlantableSoil(soil) || !takeSeed()) return false;
    const position = soil.entity.instance.position.clone();
    this.decor.delete(soil.id); soil.stopTracking?.(); soil.entity.instance.remove();
    this.addPlantedSeed(plantId, newEntityId(), position, true);
    PlaySound('dontstarve/common/plant', position);
    return true;
  }

  spawnPlantedSeed(position: THREE.Vector3, id = newEntityId(), plantId = PLANTED_SEED_ID): THREE.Group {
    if (!Object.hasOwn(PLANTED_SEED_ART, plantId)) throw new Error(`Unknown planted seed ${plantId}`);
    if (this.disposed) throw new Error('Farm plow has been disposed');
    return this.addPlantedSeed(plantId, id, position, false).display.model;
  }

  private addPlantedSeed(plantId: string, id: string, position: THREE.Vector3, fresh: boolean): FarmEntity {
    const { animationArchive, buildArchives, bank, pre, idle } = PLANTED_SEED_ART[plantId];
    const source = this.resources.archive({ animationArchive, buildArchives, bank, symbolOverrides: soilOverride });
    // farm_plants.lua: a sown seed plays its pre clip, then loops its idle.
    const entity = this.create(plantId, source, idle, ['plantedsoil', 'farm_plant', 'planted_seed'], sprite => {
      if (fresh) { sprite.playOnce(pre); sprite.pushAnimation(idle, true); } else sprite.start(idle);
    });
    entity.instance.position.copy(position).setY(0);
    entity.instance.entityId = id;
    this.seedPositions.add(entity);
    this.stopSeeds.set(entity, registerPlacementEntity(entity.display.model, () => entity.instance.position));
    this.plantedSeeds.set(id, entity);
    return entity;
  }

  exportPlantedSeedRecords() {
    return [...this.plantedSeeds].map(([id, { instance }]) => ({ prefabId: instance.prefab, record: {
      id, transform: { position: instance.position.toArray(), rotationY: 0 }, components: {},
    } }));
  }

  private dirt(plow: Plow, quad: number): void {
    let x = (1 - this.random() ** 2) * 2, z = (1 - this.random() ** 2) * 2;
    if (quad === 1 || quad === 3) x = -x;
    if (quad === 1 || quad === 2) z = -z;
    if (x * x + z * z <= 0.75 ** 2) return;
    const position = plow.entity.instance.position.clone().add(new THREE.Vector3(x * SCALE, 0, z * SCALE));
    if (!this.turf.canPlant(position) || this.blockers.someNear(position, SCALE, blocker => this.blocksExternal(blocker, IGNORE_BLOCKERS)
      && blocker.position.distanceToSquared(position) < SCALE ** 2)) return;
    this.collapseSoil(position);
    this.addDecor('farm_soil', position, newEntityId(), { broken: false, animation: 'f1', plowId: plow.id, fresh: true });
  }

  private finish(plow: Plow): void {
    const center = plow.entity.instance.position;
    if (this.turf.plow(center)) {
      const positions: THREE.Vector3[] = [];
      const count = 2 + Math.floor(this.random() * 3);
      for (let i = 0; i < count; i++) {
        const position = center.clone().add(new THREE.Vector3((this.random() - 0.5) * TILE_SIZE * 0.9, 0, (this.random() - 0.5) * TILE_SIZE * 0.9));
        if (positions.some((previous) => previous.distanceToSquared(position) < SCALE ** 2)) continue;
        positions.push(position); this.collapseSoil(position);
        this.addDecor('farm_soil_debris', position, newEntityId(), { broken: false, animation: this.debrisAnimation(), fresh: true });
      }
      for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        this.puff(center.clone().add(new THREE.Vector3(dx * (1 + this.random()) * SCALE, 0, dz * (1 + this.random()) * SCALE)));
      }
    }
    for (const soil of this.decor.values()) if (soil.plowId === plow.id) soil.plowId = undefined;
    plow.loopSound?.stop(); plow.loopSound = undefined;
    if (plow.deployItem !== null) this.fold(plow, true);
    else { this.collapseEffect(center); this.removePlow(plow); }
  }

  /** The collapse clip's animover returns the saved item; a restored folding plow already declared it. */
  private fold(plow: Plow, play: boolean): void {
    actionEntity(plow.entity.display.model, FARM_PLOW_ID).components.workable?.SetWorkable(false);
    plow.phase = 'collapse'; plow.remainingSeconds = 0;
    plow.loopSound?.stop(); plow.loopSound = undefined;
    const { position, sprite } = plow.entity.instance;
    this.puff(position);
    PlaySound('farming/common/farm/plow/collapse', position);
    PlaySound('farming/common/farm/plow/dirt_puff', position);
    if (play) sprite.playOnce('collapse', () => this.returnSavedItem(plow));
  }

  /** farm_plow.lua SpawnSaveRecord(deploy_item_save_record) at the plow, then inst:Remove(). */
  private returnSavedItem(plow: Plow): void {
    if (!plow.deployItem || this.plows.get(plow.id) !== plow) return;
    plow.phase = 'collapse'; plow.remainingSeconds = 0;
    plow.loopSound?.stop(); plow.loopSound = undefined;
    this.returnItem(plow.entity.instance.position.clone(), { ...plow.deployItem });
    this.removePlow(plow);
  }

  get hammerTargets(): readonly HammerTarget[] { return this.getHammerTargets(); }

  getHammerTargets(model?: THREE.Object3D): readonly HammerTarget[] {
    return this.mousePlows.select(model, this.plows.values()).filter(plow => plow.phase !== 'collapse')
      .map(plow => actionEntity(plow.entity.display.model, FARM_PLOW_ID).hammerTarget)
      .filter((target): target is HammerTarget => target !== undefined);
  }

  spawnDecor(prefabId: FarmDecorId, position: THREE.Vector3,
    saved?: FarmSoilSaveState | FarmDebrisSaveState, id = newEntityId()): THREE.Group {
    if (this.disposed) throw new Error('Farm plow has been disposed');
    const animation = saved && 'animation' in saved ? saved.animation : this.debrisAnimation();
    const broken = saved && 'broken' in saved ? saved.broken : false;
    const plowId = saved && 'plowId' in saved ? saved.plowId : undefined;
    return this.addDecor(prefabId, position, id, { broken, animation, plowId, fresh: !saved }).entity.display.model;
  }

  private debrisAnimation(): FarmDebrisSaveState['animation'] {
    return `f${1 + Math.floor(this.random() * 4)}` as FarmDebrisSaveState['animation'];
  }

  private addDecor(prefabId: FarmDecorId, position: THREE.Vector3, id: string,
    { broken, animation, plowId, fresh }: Pick<Decor, 'broken' | 'animation' | 'plowId'> & { fresh: boolean }): Decor {
    const clip = prefabId === 'farm_soil' ? broken ? 'collapse_idle' : 'till_idle' : animation;
    // farm_soil.lua till_rise → till_idle; farm_soil_debris.lua <anim>_pre → <anim>; loaded ones play only their idle.
    const entity = this.create(prefabId, this.archive(`${prefabId}.zip`, prefabId), clip,
      [prefabId === 'farm_soil' ? 'soil' : 'farm_debris'], sprite => {
        if (!fresh) { sprite.playOnce(clip); return; }
        sprite.playOnce(prefabId === 'farm_soil' ? 'till_rise' : `${animation}_pre`);
        sprite.pushAnimation(clip, false);
      });
    entity.instance.position.copy(position).setY(0);
    entity.instance.entityId = id;
    const item: Decor = { id, prefabId, entity, broken, animation, ...(plowId ? { plowId } : {}) };
    this.decor.set(id, item); this.mouseDecor.set(entity.display.model, item);
    this.decorPositions.add(item);
    actionEntity(entity.display.model, prefabId);
    item.stopTracking = () => { disposeActionEntity(entity.display.model); this.decorPositions.delete(item); };
    return item;
  }

  private collapseSoil(position: THREE.Vector3): void {
    for (const soil of [...this.decor.values()]) {
      if (soil.prefabId !== 'farm_soil') continue;
      const distance = soil.entity.instance.position.distanceTo(position);
      if (distance < SCALE * 1.25 * 0.5) this.removeSoil(soil);
      else if (distance < SCALE * 1.25 && !soil.broken) {
        soil.broken = true;
        soil.entity.instance.sprite.playOnce('collapse');
        soil.entity.instance.sprite.pushAnimation('collapse_idle', false);
      }
    }
  }

  /** farm_soil.lua: the remove clip's animover removes the soil. */
  private removeSoil(soil: Decor): void {
    this.decor.delete(soil.id); soil.stopTracking?.(); this.effects.add(soil.entity);
    soil.entity.instance.sprite.playOnce(soil.broken ? 'collapse_remove' : 'till_remove', () => {
      this.effects.delete(soil.entity); soil.entity.instance.remove();
    });
  }

  private puff(position: THREE.Vector3): void { this.effect('smoke_puff_small.zip', 'small_puff', 'puff', position); }
  private collapseEffect(position: THREE.Vector3): void {
    this.effect('structure_collapse_fx.zip', 'collapse', 'collapse_small', position);
    PlaySound('dontstarve/common/destroy_smoke', position);
  }
  private effect(archive: string, bank: string, animation: string, position: THREE.Vector3): void {
    if (this.disposed) return;
    const fx: FarmEntity = this.create(animation, this.archive(archive, bank), animation, TEMPORARY_TAGS, sprite => sprite.playOnce(animation, () => {
      this.effects.delete(fx); fx.instance.remove();
    }));
    fx.instance.position.copy(position); fx.instance.persists = false;
    this.effects.add(fx);
  }
  private removePlow(plow: Plow): void {
    findActionEntity(plow.entity.display.model)?.components.workable?.dispose();
    this.plowPositions.delete(plow);
    plow.loopSound?.stop(); this.plows.delete(plow.id); plow.entity.instance.remove();
  }
  /** Declares the archive; the display loads it. farm_plow and debris override soil01 from farm_soil. */
  private archive(archive: string, bank: string, options?: ArchiveOptions) {
    const soil = archive === 'farm_plow.zip' || archive === 'farm_soil_debris.zip';
    return this.resources.archive({ animationArchive: archive, buildArchives: soil ? [archive, 'farm_soil.zip'] : [archive],
      bank, ...(soil ? { symbolOverrides: soilOverride } : {}) }, options);
  }
  /**
   * A new entity mounted for drawing. Its first clips are declared before the display binds, so a one-shot waits for its
   * art as AnimState:PlayAnimation does; by default it plays `clip` once.
   */
  private create(prefab: string, source: ArchiveSpriteSource, clip: string, tags: readonly string[],
    initialize: (sprite: FarmSprite) => void = sprite => sprite.playOnce(clip), billboard = true): FarmEntity {
    const entity = createArchiveEntity(prefab, source, { name: clip, billboard }, prefab, instance => {
      for (const tag of tags) instance.addTag(tag);
      initialize(instance.sprite);
    });
    this.displays.mount(entity.display);
    return entity;
  }
  private center(point: Pick<THREE.Vector3, 'x' | 'z'>): THREE.Vector3 {
    const center = snapToTileCenter(point); return new THREE.Vector3(center.x, 0, center.z);
  }
  private tileKey(point: Pick<THREE.Vector3, 'x' | 'z'>): string { return `${Math.floor(point.x / TILE_SIZE)},${Math.floor(point.z / TILE_SIZE)}`; }

  exportRecords() {
    return [...this.plows.values()].map(({ id, entity, phase, remainingSeconds, deployItem }) => ({
      id, transform: { position: entity.instance.position.toArray(), rotationY: 0 },
      components: { farmPlow: { phase, remainingSeconds, deployItem: deployItem ? { ...deployItem } : null } },
    }));
  }
  exportDecorRecords() {
    return [...this.decor.values()].map(({ id, prefabId, entity, animation, broken, plowId }) => ({ prefabId, record: {
      id, transform: { position: entity.instance.position.toArray(), rotationY: 0 },
      components: prefabId === 'farm_soil' ? { farmSoil: { broken, ...(plowId ? { plowId } : {}) } } : { farmDebris: { animation } },
    } }));
  }
  get renderEntities() { return this.displays.renderEntities; }
  dispose(): void {
    this.stopActionEvents();
    if (this.disposed) return;
    this.disposed = true; this.cancel(); this.pointer.dispose(); this.removeDigListener();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
    for (const plow of [...this.plows.values()]) this.removePlow(plow);
    for (const item of this.decor.values()) { item.stopTracking?.(); item.entity.instance.remove(); }
    for (const effect of this.effects) effect.instance.remove();
    for (const seed of this.plantedSeeds.values()) { this.stopSeeds.get(seed)?.(); seed.instance.remove(); }
    this.stopSeeds.clear(); this.seedPositions.clear();
    this.decor.clear(); this.plantedSeeds.clear(); this.effects.clear();
    this.displays.dispose(); this.resources.dispose();
  }
  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.takeItem || event.defaultPrevented) return;
    if (event.button === 0) { event.preventDefault(); this.cancel(); return; }
    if (event.button !== 2) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.pointer.trackPointer(event);
    const point = this.pointer.groundPoint();
    if (!point || !this.preview) return;
    this.deploy(point, this.takeItem);
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => { if (event.code === 'Escape') this.cancel(); };
}
