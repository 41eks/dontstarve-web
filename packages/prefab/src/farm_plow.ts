import { MakeObstaclePhysics } from './standardcomponents';
import { SpatialIndex } from './spatialIndex';
import { placementEntities, registerPlacementEntity, ignoresPlacement, hasPlacementTag, type PlacementQuery, type PlacementBlocker } from './placementEntities';
import { ModelRecords } from './modelRecords';
import type { ItemEntity, InventoryStack } from '@dontstarve-web/inventory';
import type { FarmSoilTarget, PreparedSeedPlant, PreparedFarmTill, FarmActionWorld } from '@dontstarve-web/stategraphs/farmActions';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import * as THREE from 'three';
import { ArchiveSpriteAssets, createSharedArchiveSprite, type ArchiveSpriteDefinition, type ArchiveSpriteOptions } from '@dontstarve-web/animation/archiveSprite';
import { createArchiveEntity } from './prefabInstance';
import { BuildCursor } from './buildCursor';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { newEntityId } from './saveRecord';
import { snapToTileCenter, TILE_SIZE } from './tile';
import { TurfMap, WORLD_TILES } from './turfMap';
import { PlaySound, PreloadSounds, type SoundHandle } from './sound';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import type { ShovelTarget } from '@dontstarve-web/stategraphs/shovel';
import type { WorldContext } from './worldContext';
import { setPrefabLightOverride } from './localLight';
import { FARM_PLANT_ART, VEGGIE_SEED_IDS } from './veggies';
import { actionEntity, disposeActionEntity } from './actionEntity';
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
const release = ({ instance, display }: FarmEntity) => { instance.remove(); display.dispose(); };
const TEMPORARY_TAGS = ['FX', 'NOCLICK'] as const;
// The placer tints: blocked cells.
const BLOCKED_TINT = new THREE.Color(0xff5555).toArray() as [number, number, number];
interface Plow extends FarmPlowSaveState {
  id: string; sprite: FarmEntity; loopSound?: SoundHandle;
  dirtTasks: { quad: number; remaining: number }[];
  finished?: boolean;
  returning?: boolean;
}
interface Decor {
  id: string; prefabId: FarmDecorId; sprite: FarmEntity;
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

function spriteDefinition(archive: string, bank: string, animation: string): ArchiveSpriteDefinition {
  const plow = archive === 'farm_plow.zip' || archive === 'farm_soil_debris.zip';
  return { animationArchive: archive, buildArchives: plow ? [archive, 'farm_soil.zip'] : [archive],
    bank, animation, loop: false, ...(plow ? { symbolOverrides: soilOverride } : {}) };
}

/** farm_plow.lua's deployment, timer, terraform and fold-up lifecycle. */
export class FarmPlowPlacement implements FarmActionWorld {
  private readonly stopActionEvents: () => void;
  private readonly assets: ArchiveSpriteAssets;
  private readonly pointer: PointerRaycaster;
  private readonly cursor: BuildCursor;
  private readonly mousePlows = new ModelRecords<Plow>();
  private readonly plows = new Map<string, Plow>();
  private readonly plowPositions = new SpatialIndex<Plow>(plow => plow.sprite.display.model.position);
  private readonly decorPositions = new SpatialIndex<Decor>(decor => decor.sprite.display.model.position);
  private readonly seedPositions = new SpatialIndex<FarmEntity>(sprite => sprite.display.model.position);
  private readonly stopSeeds = new Map<FarmEntity, () => void>();
  private readonly mouseDecor = new ModelRecords<Decor>();
  private readonly decor = new Map<string, Decor>();
  private readonly plantedSeeds = new Map<string, FarmEntity>();
  private debrisLoot?: (itemId: string, position: THREE.Vector3) => Promise<void>;
  private readonly effects = new Set<FarmEntity>();
  private readonly pendingTiles = new Set<string>();
  private preview?: FarmEntity;
  private previewOutline?: FarmEntity;
  /** What the placers' sprite json was last told. */
  private previewVisible?: boolean;
  private previewValid?: boolean;
  private takeItem?: () => ItemEntity | undefined;
  private previewVersion = 0;
  private prepareRequest?: Promise<void>;
  private disposed = false;
  private readonly removeDigListener: () => void;
  private readonly world: WorldContext;
  private readonly turf: TurfMap;
  private readonly returnItem: (position: THREE.Vector3, item: InventoryStack) => Promise<void>;
  private readonly blockers: PlacementQuery;
  private readonly random: () => number;

  constructor(world: WorldContext, turf: TurfMap,
    returnItem: (position: THREE.Vector3, item: InventoryStack) => Promise<void>,
    blockers: PlacementQuery = placementEntities(world.scene), random = Math.random) {
    this.world = world; this.turf = turf; this.returnItem = returnItem; this.blockers = blockers; this.random = random;
    this.stopActionEvents = bindActionCancellation(world, this, 'deploy', () => this.cancel());
    this.assets = new ArchiveSpriteAssets('farm');
    this.pointer = new PointerRaycaster(world);
    this.cursor = new BuildCursor(world, this.pointer);
    this.removeDigListener = turf.onDig((point) => {
      for (const soil of [...this.decor.values()]) {
        if (soil.prefabId === 'farm_soil' && this.tileKey(soil.sprite.display.model.position) === this.tileKey(point)) this.removeSoil(soil);
      }
    });
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  async prepare(): Promise<void> {
    if (this.disposed) throw new Error('Farm plow has been disposed');
    if (!this.prepareRequest) {
      this.prepareRequest = Promise.all([
        ...['farm_plow.zip', 'farm_soil.zip', 'farm_soil_debris.zip', 'smoke_puff_small.zip', 'structure_collapse_fx.zip', 'gridplacer.zip']
          .flatMap((archive) => [this.assets.loadAnimation(archive), this.assets.loadBuild(archive)]),
        PreloadSounds('farming/common/farm/plow/drill_pre', 'farming/common/farm/plow/LP',
          'farming/common/farm/plow/collapse', 'farming/common/farm/plow/dirt_puff', 'dontstarve/common/destroy_smoke',
          'dontstarve/common/plant'),
      ]).then(() => undefined);
      void this.prepareRequest.catch(() => { this.prepareRequest = undefined; });
    }
    await this.prepareRequest;
  }

  async begin(takeItem: () => ItemEntity | undefined): Promise<void> {
    if (this.disposed) throw new Error('Farm plow has been disposed');
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'DEPLOY' });
    const version = this.previewVersion;
    this.takeItem = takeItem;
    this.cursor.show('鼠标右键：布署', 'right');
    try {
      await this.prepare();
      // Placers own private translucent material copies, tinted only for themselves.
      const appearance = { opacity: .65, colour: [1, 1, 1] as [number, number, number] };
      const preview = await this.create('farm_plow.zip', 'farm_plow', 'idle_place', 'FarmPlowPlacer', appearance);
      const outline = await this.create('gridplacer.zip', 'gridplacer', 'anim', 'FarmPlowTileOutline', appearance);
      if (version !== this.previewVersion || this.disposed) { release(preview); release(outline); return; }
      this.previewVisible = undefined; this.previewValid = undefined;
      this.preview = preview;
      this.previewOutline = outline;
      outline.display.model.rotation.x = -Math.PI / 2;
      outline.display.model.userData.billboard = false;
      setPrefabLightOverride(outline.display.model, 1);
      this.world.scene.add(preview.display.model, outline.display.model);
      this.cursor.setPreview(preview.display.model, 0, (point) => this.center(point));
      this.cursor.update();
    } catch (error) { if (version === this.previewVersion) this.cancel(); throw error; }
  }

  cancel(): void {
    this.previewVersion++;
    this.takeItem = undefined;
    this.cursor.hide();
    if (this.preview) release(this.preview); this.preview = undefined;
    if (this.previewOutline) release(this.previewOutline); this.previewOutline = undefined;
  }

  canDeploy(point: THREE.Vector3): boolean {
    const center = this.center(point), key = this.tileKey(center);
    if (!this.turf.canPlow(point) || this.turf.getTileAtWorld(center) === WORLD_TILES.INVALID
      || this.pendingTiles.has(key) || this.plowPositions.someOnTile(center, () => true)) return false;
    return !this.blockers.someOnTile(center, blocker => this.blocksExternal(blocker, IGNORE_BLOCKERS))
      && !this.decorPositions.someOnTile(center, item => !item.broken);
  }

  async deploy(point: THREE.Vector3, takeItem: () => ItemEntity | undefined): Promise<boolean> {
    if (!this.canDeploy(point)) return false;
    const center = this.center(point), key = this.tileKey(center);
    const version = this.previewVersion;
    this.pendingTiles.add(key);
    let sprite: FarmEntity | undefined;
    try {
      await this.prepare();
      sprite = await this.create('farm_plow.zip', 'farm_plow', 'idle_place', FARM_PLOW_ID);
      if (this.disposed || version !== this.previewVersion || !this.turf.canPlow(center)) { release(sprite); return false; }
      // Recheck external blockers after asset loading, before spending the item.
      if (this.blockers.someOnTile(center, blocker => this.blocksExternal(blocker, IGNORE_BLOCKERS))) {
        release(sprite); return false;
      }
      const item = takeItem();
      if (!item) { release(sprite); return false; }
      if (item.prefab !== FARM_PLOW_ITEM_ID || item.isRemoved || item.components.inventoryitem.owner
        || item.components.stackable.count !== 1) throw new Error('Deployment requires one detached farm_plow_item');
      item.components.finiteuses.setMaxUses(FARM_PLOW_USES);
      if (!item.components.finiteuses.use(1)) { release(sprite); return false; }
      const deployItem = item.isRemoved ? null : item.snapshot();
      if (!item.isRemoved) item.remove();
      this.addPlow(sprite, newEntityId(), center, { phase: 'drill_pre', remainingSeconds: FARM_PLOW_DRILLING_DURATION, deployItem });
      this.cancel();
      return true;
    } catch (error) { if (sprite) release(sprite); throw error; }
    finally { this.pendingTiles.delete(key); }
  }

  async spawn(point: THREE.Vector3, saved?: { id: string; state: FarmPlowSaveState }): Promise<THREE.Group> {
    await this.prepare();
    const sprite = await this.create('farm_plow.zip', 'farm_plow', 'idle_place', FARM_PLOW_ID);
    if (this.disposed) { release(sprite); throw new Error('Farm plow has been disposed'); }
    this.addPlow(sprite, saved?.id ?? newEntityId(), this.center(point), saved?.state
      ?? { phase: 'drill_pre', remainingSeconds: FARM_PLOW_DRILLING_DURATION, deployItem: null });
    return sprite.display.model;
  }

  private addPlow(sprite: FarmEntity, id: string, position: THREE.Vector3, state: FarmPlowSaveState): void {
    const plow: Plow = { ...state, deployItem: state.deployItem ? { ...state.deployItem } : null, id, sprite, dirtTasks: [] };
    sprite.display.model.position.copy(position);
    MakeObstaclePhysics(sprite.instance, .5);
    if (this.world.physics) sprite.instance.bindPhysics(this.world.physics);
    Object.assign(sprite.display.model.userData, { entityId: id, prefab: FARM_PLOW_ID });
    this.persist(sprite, ['scarytoprey']);
    this.plowPositions.add(plow);
    this.plows.set(id, plow); this.mousePlows.set(plow.sprite.display.model, plow); this.world.scene.add(sprite.display.model);
    const entity = actionEntity(sprite.display.model, FARM_PLOW_ID);
    const workable = new Workable(entity);
    entity.components.workable = workable;
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(1);
    workable.SetWorkable(state.phase !== 'collapse');
    workable.SetOnFinishCallback(() => {
      if (this.plows.get(plow.id) !== plow || plow.phase === 'collapse') return;
      plow.finished = false;
      const position = plow.sprite.display.model.position.clone();
      this.collapseEffect(position);
      for (const soil of [...this.decor.values()]) if (soil.plowId === plow.id) this.removeSoil(soil);
      if (plow.deployItem !== null) void this.returnSavedItem(plow);
      else this.removePlow(plow);
    });
    if (state.phase === 'drill_loop') this.startDrilling(plow);
    else if (state.phase === 'collapse') this.fold(plow);
    else {
      sprite.instance.sprite.playOnce('drill_pre', () => this.startDrilling(plow));
      PlaySound('farming/common/farm/plow/drill_pre', position);
    }
  }

  private startDrilling(plow: Plow): void {
    if (!this.plows.has(plow.id) || plow.phase === 'collapse') return;
    plow.phase = 'drill_loop'; plow.sprite.instance.sprite.start('drill_loop');
    plow.loopSound = PlaySound('farming/common/farm/plow/LP', plow.sprite.display.model.position);
    plow.dirtTasks = [{ quad: 1, remaining: this.random() * 0.2 }, { quad: 2, remaining: 0.2 + this.random() * 0.3 },
      { quad: 3, remaining: 1 + this.random() * 0.5 }, { quad: 4, remaining: 0.5 + this.random() * 0.3 }];
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    const step = Math.max(0, Math.min(dt, 0.1));
    this.cursor.update();
    // BuildCursor shows and hides the plow placer; its tile outline follows it.
    const previewVisible = this.preview?.display.model.visible ?? false;
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
      const drilling = plow.phase === 'drill_loop';
      plow.sprite.display.model.quaternion.copy(cameraQuaternion); plow.sprite.instance.sprite.update(step);
      if (!drilling || plow.phase !== 'drill_loop') continue;
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
    for (const item of [...this.decor.values()]) {
      if (item.plowId && !this.plows.has(item.plowId)) { this.removeSoil(item); continue; }
      item.sprite.display.model.quaternion.copy(cameraQuaternion); item.sprite.instance.sprite.update(step);
    }
    for (const effect of this.effects) { effect.display.model.quaternion.copy(cameraQuaternion); effect.instance.sprite.update(step); }
    for (const sprite of this.plantedSeeds.values()) { sprite.display.model.quaternion.copy(cameraQuaternion); sprite.instance.sprite.update(step); }
  }

  get soilTargets(): readonly FarmSoilTarget[] {
    return [...this.decor.values()].filter((soil) => this.isPlantableSoil(soil)).map((soil) => ({
      id: soil.id, model: soil.sprite.display.model, position: soil.sprite.display.model.position,
      isValid: () => this.isPlantableSoil(soil),
    }));
  }

  setDebrisLootHandler(handler: (itemId: string, position: THREE.Vector3) => Promise<void>): void {
    this.debrisLoot = handler;
  }

  /** farm_soil_debris.lua: one successful DIG removes only that debris entity. */
  get digTargets(): readonly ShovelTarget[] { return this.getDigTargets(); }

  getDigTargets(model?: THREE.Object3D): readonly ShovelTarget[] {
    return this.mouseDecor.select(model, this.decor.values()).filter(({ prefabId }) => prefabId === 'farm_soil_debris').map((item) => {
      const position = item.sprite.display.model.position;
      const isValid = () => !this.disposed && this.decor.get(item.id) === item
        && this.turf.getTileAtWorld(position) === WORLD_TILES.FARMING_SOIL;
      return { id: item.id, model: item.sprite.display.model, position, isValid, dig: () => {
        if (!isValid()) return false;
        const origin = position.clone();
        this.decor.delete(item.id); item.stopTracking?.(); release(item.sprite); this.puff(origin);
        // Base FARM_SOIL_DEBRIS_LOOT_CHANCE, without porting unrelated luck skills.
        if (this.random() < 0.25 && this.debrisLoot) {
          let roll = this.random() * 100;
          const loot = DEBRIS_LOOT.find(([, weight]) => { roll -= weight; return roll < 0; })?.[0] ?? 'goldnugget';
          void this.debrisLoot(loot, origin).catch((error: unknown) => {
            if (!this.disposed) console.error('Unable to drop farm debris loot', error);
          });
        }
        return true;
      } };
    });
  }

  /** map.lua: soil can be retilled; debris and planted crops still block the point. */
  canTill(point: THREE.Vector3): boolean {
    if (this.disposed || this.turf.getTileAtWorld(point) !== WORLD_TILES.FARMING_SOIL) return false;
    const plantSpacing = 0.5 * SCALE + TILL_SPACING / 2;
    return !this.plowPositions.someNear(point, TILL_SPACING, plow => plow.sprite.display.model.position.distanceToSquared(point) < TILL_SPACING ** 2)
      && !this.decorPositions.someNear(point, TILL_SPACING, item => item.prefabId === 'farm_soil_debris'
        && item.sprite.display.model.position.distanceToSquared(point) < TILL_SPACING ** 2)
      && !this.seedPositions.someNear(point, plantSpacing, sprite => sprite.display.model.position.distanceToSquared(point) < plantSpacing ** 2)
      && !this.blockers.someNear(point, Math.max(plantSpacing, TILL_SPACING), blocker => this.blocksExternal(blocker, TILL_IGNORE_BLOCKERS)
        && blocker.position.distanceToSquared(point) < (hasPlacementTag(blocker, 'farm_plant') ? plantSpacing : TILL_SPACING) ** 2);
  }

  private blocksExternal(blocker: PlacementBlocker, ignored: ReadonlySet<string>): boolean {
    // Local plows and decor have their own indexes and Lua-specific checks above.
    return blocker.prefab !== FARM_PLOW_ID && !FARM_DECOR_IDS.includes(blocker.prefab as FarmDecorId)
      && (blocker.logicalTree === true || !ignoresPlacement(blocker, ignored));
  }

  /** Prepare before TILL's hit frame, then synchronously replace nearby soil. */
  async prepareTill(point: THREE.Vector3): Promise<PreparedFarmTill | undefined> {
    const position = point.clone().setY(0);
    if (!this.canTill(position)) return undefined;
    await this.prepare();
    const sprite = await this.create('farm_soil.zip', 'farm_soil', 'till_idle', 'farm_soil');
    let used = false;
    return {
      apply: () => {
        if (used || !this.canTill(position)) return false;
        used = true;
        this.collapseSoil(position);
        this.addDecor(sprite, { id: newEntityId(), prefabId: 'farm_soil', sprite, broken: false, animation: 'f1' });
        sprite.display.model.position.copy(position);
        sprite.instance.sprite.playOnce('till_rise', () => sprite.instance.sprite.playOnce('till_idle'));
        return true;
      },
      dispose: () => { if (!used) { used = true; release(sprite); } },
    };
  }

  private isPlantableSoil(soil: Decor): boolean {
    return !this.disposed && this.decor.get(soil.id) === soil && soil.prefabId === 'farm_soil'
      && !soil.broken && !soil.plowId && this.turf.getTileAtWorld(soil.sprite.display.model.position) === WORLD_TILES.FARMING_SOIL;
  }

  /** Prepare art before the player's PLANT timeline; commit the seed and hole together. */
  async prepareSeedPlant(id: string, seedItemId = 'seeds'): Promise<PreparedSeedPlant | undefined> {
    const soil = this.decor.get(id), plantId = Object.hasOwn(SEED_PLANTS, seedItemId) ? SEED_PLANTS[seedItemId] : undefined;
    if (!soil || !plantId || !this.isPlantableSoil(soil)) return undefined;
    await this.prepare();
    const art = PLANTED_SEED_ART[plantId];
    const sprite = await this.createPlant(plantId, art.idle);
    let used = false;
    return {
      apply: (takeSeed) => {
        if (used || !this.isPlantableSoil(soil) || !takeSeed()) return false;
        used = true;
        const position = soil.sprite.display.model.position.clone();
        this.decor.delete(soil.id); soil.stopTracking?.(); release(soil.sprite);
        this.addPlantedSeed(sprite, newEntityId(), position, plantId);
        sprite.instance.sprite.playOnce(art.pre, () => sprite.instance.sprite.start(art.idle));
        PlaySound('dontstarve/common/plant', position);
        return true;
      },
      dispose: () => { if (!used) { used = true; release(sprite); } },
    };
  }

  async spawnPlantedSeed(position: THREE.Vector3, id = newEntityId(), plantId = PLANTED_SEED_ID): Promise<THREE.Group> {
    if (!Object.hasOwn(PLANTED_SEED_ART, plantId)) throw new Error(`Unknown planted seed ${plantId}`);
    await this.prepare();
    const art = PLANTED_SEED_ART[plantId];
    const sprite = await this.createPlant(plantId, art.idle);
    if (this.disposed) { release(sprite); throw new Error('Farm plow has been disposed'); }
    this.addPlantedSeed(sprite, id, position, plantId);
    sprite.instance.sprite.start(art.idle);
    return sprite.display.model;
  }

  private addPlantedSeed(sprite: FarmEntity, id: string, position: THREE.Vector3, plantId: string): void {
    sprite.display.model.position.copy(position).setY(0);
    Object.assign(sprite.display.model.userData, { entityId: id, prefab: plantId });
    this.persist(sprite, ['plantedsoil', 'farm_plant', 'planted_seed']);
    this.seedPositions.add(sprite);
    this.stopSeeds.set(sprite, registerPlacementEntity(sprite.display.model, () => sprite.display.model.position));
    this.plantedSeeds.set(id, sprite); this.world.scene.add(sprite.display.model);
  }

  exportPlantedSeedRecords() {
    return [...this.plantedSeeds].map(([id, sprite]) => ({ prefabId: sprite.display.model.userData.prefab as string, record: {
      id, transform: { position: sprite.display.model.position.toArray(), rotationY: 0 }, components: {},
    } }));
  }

  private dirt(plow: Plow, quad: number): void {
    let x = (1 - this.random() ** 2) * 2, z = (1 - this.random() ** 2) * 2;
    if (quad === 1 || quad === 3) x = -x;
    if (quad === 1 || quad === 2) z = -z;
    if (x * x + z * z <= 0.75 ** 2) return;
    const position = plow.sprite.display.model.position.clone().add(new THREE.Vector3(x * SCALE, 0, z * SCALE));
    if (!this.turf.canPlant(position) || this.blockers.someNear(position, SCALE, blocker => this.blocksExternal(blocker, IGNORE_BLOCKERS)
      && blocker.position.distanceToSquared(position) < SCALE ** 2)) return;
    this.collapseSoil(position);
    void this.spawnDecor('farm_soil', position, { broken: false, plowId: plow.id }, plow)
      .catch((error: unknown) => { if (!this.disposed) console.error('Unable to create plowed soil', error); });
  }

  private finish(plow: Plow): void {
    const center = plow.sprite.display.model.position;
    if (this.turf.plow(center)) {
      const positions: THREE.Vector3[] = [];
      const count = 2 + Math.floor(this.random() * 3);
      for (let i = 0; i < count; i++) {
        const position = center.clone().add(new THREE.Vector3((this.random() - 0.5) * TILE_SIZE * 0.9, 0, (this.random() - 0.5) * TILE_SIZE * 0.9));
        if (positions.some((previous) => previous.distanceToSquared(position) < SCALE ** 2)) continue;
        positions.push(position); this.collapseSoil(position);
        void this.spawnDecor('farm_soil_debris', position).catch((error: unknown) => { if (!this.disposed) console.error('Unable to create farm debris', error); });
      }
      for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        this.puff(center.clone().add(new THREE.Vector3(dx * (1 + this.random()) * SCALE, 0, dz * (1 + this.random()) * SCALE)));
      }
    }
    plow.finished = true;
    for (const soil of this.decor.values()) if (soil.plowId === plow.id) soil.plowId = undefined;
    plow.loopSound?.stop(); plow.loopSound = undefined;
    if (plow.deployItem !== null) this.fold(plow);
    else { this.collapseEffect(center); this.removePlow(plow); }
  }

  private fold(plow: Plow): void {
    actionEntity(plow.sprite.display.model, FARM_PLOW_ID).components.workable?.SetWorkable(false);
    plow.phase = 'collapse'; plow.remainingSeconds = 0;
    plow.loopSound?.stop(); plow.loopSound = undefined;
    this.puff(plow.sprite.display.model.position);
    PlaySound('farming/common/farm/plow/collapse', plow.sprite.display.model.position);
    PlaySound('farming/common/farm/plow/dirt_puff', plow.sprite.display.model.position);
    plow.sprite.instance.sprite.playOnce('collapse', () => {
      void this.returnSavedItem(plow);
    });
  }

  private async returnSavedItem(plow: Plow): Promise<void> {
    if (!plow.deployItem || plow.returning || this.plows.get(plow.id) !== plow) return;
    plow.returning = true;
    plow.phase = 'collapse'; plow.remainingSeconds = 0;
    plow.loopSound?.stop(); plow.loopSound = undefined;
    try {
      await this.returnItem(plow.sprite.display.model.position.clone(), { ...plow.deployItem });
      if (this.plows.get(plow.id) === plow) this.removePlow(plow);
    } catch (error) {
      plow.returning = false;
      if (!this.disposed) console.error('Unable to return farm plow item', error);
    }
  }

  get hammerTargets(): readonly HammerTarget[] { return this.getHammerTargets(); }

  getHammerTargets(model?: THREE.Object3D): readonly HammerTarget[] {
    return this.mousePlows.select(model, this.plows.values()).filter((plow) => plow.phase !== 'collapse').map((plow) => ({
      id: plow.id, entity: actionEntity(plow.sprite.display.model, FARM_PLOW_ID), model: plow.sprite.display.model, position: plow.sprite.display.model.position,
      isValid: () => !this.disposed && this.plows.get(plow.id) === plow && plow.phase !== 'collapse',
      playHit: () => {
        if (this.plows.get(plow.id) !== plow || plow.phase === 'collapse') return;
        performToolWork('HAMMER', actionEntity(plow.sprite.display.model, FARM_PLOW_ID), {});
      },
    }));
  }

  async spawnDecor(prefabId: FarmDecorId, position: THREE.Vector3,
    saved?: FarmSoilSaveState | FarmDebrisSaveState, owner?: Plow, id = newEntityId()): Promise<THREE.Group> {
    await this.prepare();
    const animation = saved && 'animation' in saved ? saved.animation : `f${1 + Math.floor(this.random() * 4)}` as FarmDebrisSaveState['animation'];
    const broken = saved && 'broken' in saved ? saved.broken : false;
    const clip = prefabId === 'farm_soil' ? broken ? 'collapse_idle' : 'till_idle' : animation;
    const sprite = await this.create(`${prefabId}.zip`, prefabId, clip, prefabId);
    if (this.disposed || owner?.finished === false) { release(sprite); return sprite.display.model; }
    sprite.display.model.position.copy(position).setY(0);
    const item: Decor = { id, prefabId, sprite, broken, animation,
      ...(saved && 'plowId' in saved && owner?.finished !== true ? { plowId: saved.plowId } : {}) };
    this.addDecor(sprite, item);
    if (!saved || owner) sprite.instance.sprite.playOnce(prefabId === 'farm_soil' ? 'till_rise' : `${animation}_pre`, () => sprite.instance.sprite.playOnce(clip));
    return sprite.display.model;
  }

  private addDecor(sprite: FarmEntity, item: Decor): void {
    Object.assign(sprite.display.model.userData, { entityId: item.id, prefab: item.prefabId });
    this.persist(sprite, [item.prefabId === 'farm_soil' ? 'soil' : 'farm_debris']);
    this.decor.set(item.id, item); this.mouseDecor.set(item.sprite.display.model, item);
    this.decorPositions.add(item);
    actionEntity(sprite.display.model, item.prefabId);
    item.stopTracking = () => { disposeActionEntity(sprite.display.model); this.decorPositions.delete(item); };
    this.world.scene.add(sprite.display.model);
  }

  private collapseSoil(position: THREE.Vector3): void {
    for (const soil of [...this.decor.values()]) {
      if (soil.prefabId !== 'farm_soil') continue;
      const distance = soil.sprite.display.model.position.distanceTo(position);
      if (distance < SCALE * 1.25 * 0.5) this.removeSoil(soil);
      else if (distance < SCALE * 1.25 && !soil.broken) {
        soil.broken = true;
        soil.sprite.instance.sprite.playOnce('collapse', () => soil.sprite.instance.sprite.playOnce('collapse_idle'));
      }
    }
  }

  private removeSoil(soil: Decor): void {
    this.decor.delete(soil.id); soil.stopTracking?.(); this.effects.add(soil.sprite);
    soil.sprite.instance.sprite.playOnce(soil.broken ? 'collapse_remove' : 'till_remove', () => {
      this.effects.delete(soil.sprite); release(soil.sprite);
    });
  }

  private puff(position: THREE.Vector3): void { this.effect('smoke_puff_small.zip', 'small_puff', 'puff', position); }
  private collapseEffect(position: THREE.Vector3): void {
    this.effect('structure_collapse_fx.zip', 'collapse', 'collapse_small', position);
    PlaySound('dontstarve/common/destroy_smoke', position);
  }
  private effect(archive: string, bank: string, animation: string, position: THREE.Vector3): void {
    const origin = position.clone();
    void this.create(archive, bank, animation, animation).then((sprite) => {
      if (this.disposed) { release(sprite); return; }
      sprite.display.model.position.copy(origin); this.world.scene.add(sprite.display.model); this.effects.add(sprite);
      sprite.instance.sprite.playOnce(animation, () => { this.effects.delete(sprite); release(sprite); });
    }).catch((error: unknown) => { if (!this.disposed) console.error('Unable to create farm plow effect', error); });
  }
  private removePlow(plow: Plow): void {
    plow.sprite.display.model.userData.actionEntity?.components.workable?.dispose();
    plow.sprite.display.model.userData.removed = true;
    this.plowPositions.delete(plow);
    plow.loopSound?.stop(); this.plows.delete(plow.id); release(plow.sprite);
  }
  private create(archive: string, bank: string, animation: string, name: string,
    appearance?: Pick<ArchiveSpriteOptions, 'opacity' | 'colour'>): Promise<FarmEntity> {
    return this.createEntity(name, animation, clip => createSharedArchiveSprite(this.assets,
      { ...spriteDefinition(archive, bank, clip.name), loop: clip.loop }, { name, ...appearance }));
  }
  private createPlant(plantId: string, animation: string): Promise<FarmEntity> {
    const { animationArchive, buildArchives, bank } = PLANTED_SEED_ART[plantId];
    return this.createEntity(plantId, animation, clip => createSharedArchiveSprite(this.assets, { animationArchive, buildArchives, bank,
      animation: clip.name, loop: clip.loop, symbolOverrides: soilOverride }, { name: plantId }));
  }
  /** The entity starts in PlayAnimation(animation) without loop. */
  private async createEntity(prefab: string, animation: string,
    create: Parameters<typeof createArchiveEntity>[1]['create']): Promise<FarmEntity> {
    const entity = createArchiveEntity(prefab, { create, initial: await create({ name: animation, loop: false }) }, { name: animation }, prefab);
    entity.instance.sprite.playOnce(animation);
    // Placer and temporary FX are returned for rendering too. They must never
    // count as tile occupants; persistent plows/decor replace these tags on add.
    for (const tag of TEMPORARY_TAGS) entity.instance.addTag(tag);
    return entity;
  }
  /** A placed plow, soil, debris or seed is no longer a temporary placer or fx. */
  private persist({ instance }: FarmEntity, tags: readonly string[]): void {
    for (const tag of TEMPORARY_TAGS) instance.removeTag(tag);
    for (const tag of tags) instance.addTag(tag);
  }
  private center(point: Pick<THREE.Vector3, 'x' | 'z'>): THREE.Vector3 {
    const center = snapToTileCenter(point); return new THREE.Vector3(center.x, 0, center.z);
  }
  private tileKey(point: Pick<THREE.Vector3, 'x' | 'z'>): string { return `${Math.floor(point.x / TILE_SIZE)},${Math.floor(point.z / TILE_SIZE)}`; }

  exportRecords() {
    return [...this.plows.values()].map(({ id, sprite, phase, remainingSeconds, deployItem }) => ({
      id, transform: { position: sprite.display.model.position.toArray(), rotationY: 0 },
      components: { farmPlow: { phase, remainingSeconds, deployItem: deployItem ? { ...deployItem } : null } },
    }));
  }
  exportDecorRecords() {
    return [...this.decor.values()].map(({ id, prefabId, sprite, animation, broken, plowId }) => ({ prefabId, record: {
      id, transform: { position: sprite.display.model.position.toArray(), rotationY: 0 },
      components: prefabId === 'farm_soil' ? { farmSoil: { broken, ...(plowId ? { plowId } : {}) } } : { farmDebris: { animation } },
    } }));
  }
  get renderEntities() {
    const sprites = [...this.plows.values()].map((plow) => plow.sprite)
      .concat([...this.decor.values()].map((item) => item.sprite), [...this.plantedSeeds.values()], [...this.effects], this.preview?.display.model.visible ? [this.preview] : [],
        this.previewOutline?.display.model.visible ? [this.previewOutline] : []);
    return sprites.map(({ display: { model: object } }) => ({ object, footPosition: object.position.clone().setY(0), cameraDepth: 0 }));
  }
  dispose(): void {
    this.stopActionEvents();
    if (this.disposed) return;
    this.disposed = true; this.cancel(); this.pointer.dispose(); this.removeDigListener();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
    for (const plow of this.plows.values()) this.removePlow(plow);
    for (const item of this.decor.values()) { item.stopTracking?.(); release(item.sprite); }
    for (const effect of this.effects) release(effect);
    for (const sprite of this.plantedSeeds.values()) { this.stopSeeds.get(sprite)?.(); release(sprite); }
    this.stopSeeds.clear(); this.seedPositions.clear();
    this.decor.clear(); this.plantedSeeds.clear(); this.effects.clear(); this.assets.dispose();
  }
  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.takeItem || event.defaultPrevented) return;
    if (event.button === 0) { event.preventDefault(); this.cancel(); return; }
    if (event.button !== 2) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.pointer.trackPointer(event);
    const point = this.pointer.groundPoint();
    if (!point || !this.preview) return;
    void this.deploy(point, this.takeItem).catch((error: unknown) => console.error('Unable to deploy farm plow', error));
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => { if (event.code === 'Escape') this.cancel(); };
}
