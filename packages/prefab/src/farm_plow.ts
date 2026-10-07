import type { FarmSoilTarget, PreparedSeedPlant, PreparedFarmTill, FarmActionWorld } from '@dontstarve-web/stategraphs/farmActions';
import * as THREE from 'three';
import { ArchiveSpriteAssets, createArchiveSprite, type ArchiveSprite, type ArchiveSpriteDefinition } from '@dontstarve-web/animation/archiveSprite';
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

export const FARM_PLOW_ITEM_ID = 'farm_plow_item';
export const FARM_PLOW_ID = 'farm_plow';
export const PLANTED_SEED_ID = 'farm_plant_randomseed';
export const FARM_PLOW_USES = 4;
export const FARM_PLOW_DRILLING_DURATION = 15;
export const FARM_DECOR_IDS = ['farm_soil', 'farm_soil_debris'] as const;
type FarmDecorId = typeof FARM_DECOR_IDS[number];
export interface FarmPlowSaveState {
  phase: 'drill_pre' | 'drill_loop' | 'collapse';
  remainingSeconds: number;
  returnUses: number;
}
export interface FarmSoilSaveState { broken: boolean; plowId?: string }
export interface FarmDebrisSaveState { animation: 'f1' | 'f2' | 'f3' | 'f4' }
export interface FarmPlowBlocker { position: Pick<THREE.Vector3, 'x' | 'z'>; tags?: readonly string[] }
interface Plow extends FarmPlowSaveState {
  id: string; sprite: ArchiveSprite; loopSound?: SoundHandle;
  dirtTasks: { quad: number; remaining: number }[];
  finished?: boolean;
}
interface Decor {
  id: string; prefabId: FarmDecorId; sprite: ArchiveSprite;
  broken: boolean; plowId?: string; animation: FarmDebrisSaveState['animation'];
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
  private readonly assets: ArchiveSpriteAssets;
  private readonly pointer: PointerRaycaster;
  private readonly cursor: BuildCursor;
  private readonly plows = new Map<string, Plow>();
  private readonly decor = new Map<string, Decor>();
  private readonly plantedSeeds = new Map<string, ArchiveSprite>();
  private debrisLoot?: (itemId: string, position: THREE.Vector3) => Promise<void>;
  private readonly effects = new Set<ArchiveSprite>();
  private readonly pendingTiles = new Set<string>();
  private preview?: ArchiveSprite;
  private previewOutline?: ArchiveSprite;
  private previewMaterials: THREE.Material[] = [];
  private takeItem?: () => number | undefined;
  private previewVersion = 0;
  private prepareRequest?: Promise<void>;
  private disposed = false;
  private readonly removeDigListener: () => void;
  private readonly world: WorldContext;
  private readonly turf: TurfMap;
  private readonly returnItem: (position: THREE.Vector3, remainingUses: number) => Promise<void>;
  private readonly blockers: () => readonly FarmPlowBlocker[];
  private readonly random: () => number;

  constructor(world: WorldContext, turf: TurfMap, assetBaseUrl: string,
    returnItem: (position: THREE.Vector3, remainingUses: number) => Promise<void>,
    blockers: () => readonly FarmPlowBlocker[] = () => [], random = Math.random) {
    this.world = world; this.turf = turf; this.returnItem = returnItem; this.blockers = blockers; this.random = random;
    this.assets = new ArchiveSpriteAssets(`${assetBaseUrl.replace(/\/$/, '')}/anim`, 'farm');
    this.pointer = new PointerRaycaster(world);
    this.cursor = new BuildCursor(world, this.pointer);
    this.removeDigListener = turf.onDig((point) => {
      for (const soil of [...this.decor.values()]) {
        if (soil.prefabId === 'farm_soil' && this.tileKey(soil.sprite.model.position) === this.tileKey(point)) this.removeSoil(soil);
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

  async begin(takeItem: () => number | undefined): Promise<void> {
    this.cancel();
    const version = this.previewVersion;
    this.takeItem = takeItem;
    this.cursor.show('鼠标右键：布署', 'right');
    try {
      await this.prepare();
      const preview = await this.create('farm_plow.zip', 'farm_plow', 'idle_place', 'FarmPlowPlacer');
      const outline = await this.create('gridplacer.zip', 'gridplacer', 'anim', 'FarmPlowTileOutline');
      if (version !== this.previewVersion || this.disposed) { preview.dispose(); outline.dispose(); return; }
      for (const root of [preview.model, outline.model]) root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const clone = (material: THREE.Material) => {
          const copy = material.clone(); copy.opacity = 0.65; this.previewMaterials.push(copy); return copy;
        };
        object.material = Array.isArray(object.material) ? object.material.map(clone) : clone(object.material);
      });
      this.preview = preview;
      this.previewOutline = outline;
      outline.model.rotation.x = -Math.PI / 2;
      outline.model.userData.billboard = false;
      setPrefabLightOverride(outline.model, 1);
      this.world.scene.add(preview.model, outline.model);
      this.cursor.setPreview(preview.model, 0, (point) => this.center(point));
      this.cursor.update();
    } catch (error) { if (version === this.previewVersion) this.cancel(); throw error; }
  }

  cancel(): void {
    this.previewVersion++;
    this.takeItem = undefined;
    this.cursor.hide();
    this.preview?.dispose(); this.preview = undefined;
    this.previewOutline?.dispose(); this.previewOutline = undefined;
    for (const material of this.previewMaterials) material.dispose();
    this.previewMaterials = [];
  }

  canDeploy(point: Pick<THREE.Vector3, 'x' | 'z'>): boolean {
    const center = this.center(point), key = this.tileKey(center);
    if (!this.turf.canPlow(point) || this.turf.getTileAtWorld(center) === WORLD_TILES.INVALID
      || this.pendingTiles.has(key) || [...this.plows.values()].some((plow) => this.tileKey(plow.sprite.model.position) === key)) return false;
    return !this.blockers().some(({ position, tags }) => !tags?.some((tag) => IGNORE_BLOCKERS.has(tag)) && this.tileKey(position) === key)
      && ![...this.decor.values()].some((item) => !item.broken && this.tileKey(item.sprite.model.position) === key);
  }

  async deploy(point: THREE.Vector3, takeItem: () => number | undefined): Promise<boolean> {
    if (!this.canDeploy(point)) return false;
    const center = this.center(point), key = this.tileKey(center);
    const version = this.previewVersion;
    this.pendingTiles.add(key);
    let sprite: ArchiveSprite | undefined;
    try {
      await this.prepare();
      sprite = await this.create('farm_plow.zip', 'farm_plow', 'idle_place', FARM_PLOW_ID);
      if (this.disposed || version !== this.previewVersion || !this.turf.canPlow(center)) { sprite.dispose(); return false; }
      // Recheck external blockers after asset loading, before spending the item.
      if (this.blockers().some(({ position, tags }) => !tags?.some((tag) => IGNORE_BLOCKERS.has(tag)) && this.tileKey(position) === key)) {
        sprite.dispose(); return false;
      }
      const returnUses = takeItem();
      if (returnUses === undefined) { sprite.dispose(); return false; }
      this.addPlow(sprite, newEntityId(), center, { phase: 'drill_pre', remainingSeconds: FARM_PLOW_DRILLING_DURATION, returnUses });
      this.cancel();
      return true;
    } catch (error) { sprite?.dispose(); throw error; }
    finally { this.pendingTiles.delete(key); }
  }

  async spawn(point: THREE.Vector3, saved?: { id: string; state: FarmPlowSaveState }): Promise<THREE.Group> {
    await this.prepare();
    const sprite = await this.create('farm_plow.zip', 'farm_plow', 'idle_place', FARM_PLOW_ID);
    if (this.disposed) { sprite.dispose(); throw new Error('Farm plow has been disposed'); }
    this.addPlow(sprite, saved?.id ?? newEntityId(), this.center(point), saved?.state
      ?? { phase: 'drill_pre', remainingSeconds: FARM_PLOW_DRILLING_DURATION, returnUses: 0 });
    return sprite.model;
  }

  private addPlow(sprite: ArchiveSprite, id: string, position: THREE.Vector3, state: FarmPlowSaveState): void {
    const plow: Plow = { ...state, id, sprite, dirtTasks: [] };
    sprite.model.position.copy(position);
    Object.assign(sprite.model.userData, { entityId: id, prefab: FARM_PLOW_ID, tags: ['scarytoprey'] });
    this.plows.set(id, plow); this.world.scene.add(sprite.model);
    if (state.phase === 'drill_loop') this.startDrilling(plow);
    else if (state.phase === 'collapse') this.fold(plow);
    else {
      sprite.playOnce('drill_pre', () => this.startDrilling(plow));
      PlaySound('farming/common/farm/plow/drill_pre', position);
    }
  }

  private startDrilling(plow: Plow): void {
    if (!this.plows.has(plow.id)) return;
    plow.phase = 'drill_loop'; plow.sprite.start('drill_loop');
    plow.loopSound = PlaySound('farming/common/farm/plow/LP', plow.sprite.model.position);
    plow.dirtTasks = [{ quad: 1, remaining: this.random() * 0.2 }, { quad: 2, remaining: 0.2 + this.random() * 0.3 },
      { quad: 3, remaining: 1 + this.random() * 0.5 }, { quad: 4, remaining: 0.5 + this.random() * 0.3 }];
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    const step = Math.max(0, Math.min(dt, 0.1));
    this.cursor.update();
    if (this.previewOutline) {
      this.previewOutline.model.visible = this.preview?.model.visible ?? false;
      if (this.preview) this.previewOutline.model.position.copy(this.preview.model.position).setY(0.05);
    }
    if (this.preview?.model.visible) {
      const valid = this.canDeploy(this.preview.model.position);
      for (const material of this.previewMaterials) if (material instanceof THREE.MeshBasicMaterial) material.color.set(valid ? 0xffffff : 0xff5555);
    }
    for (const plow of [...this.plows.values()]) {
      const drilling = plow.phase === 'drill_loop';
      plow.sprite.model.quaternion.copy(cameraQuaternion); plow.sprite.update(step);
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
      item.sprite.model.quaternion.copy(cameraQuaternion); item.sprite.update(step);
    }
    for (const effect of this.effects) { effect.model.quaternion.copy(cameraQuaternion); effect.update(step); }
    for (const sprite of this.plantedSeeds.values()) { sprite.model.quaternion.copy(cameraQuaternion); sprite.update(step); }
  }

  get soilTargets(): readonly FarmSoilTarget[] {
    return [...this.decor.values()].filter((soil) => this.isPlantableSoil(soil)).map((soil) => ({
      id: soil.id, model: soil.sprite.model, position: soil.sprite.model.position,
      isValid: () => this.isPlantableSoil(soil),
    }));
  }

  setDebrisLootHandler(handler: (itemId: string, position: THREE.Vector3) => Promise<void>): void {
    this.debrisLoot = handler;
  }

  /** farm_soil_debris.lua: one successful DIG removes only that debris entity. */
  get digTargets(): readonly ShovelTarget[] {
    return [...this.decor.values()].filter(({ prefabId }) => prefabId === 'farm_soil_debris').map((item) => {
      const position = item.sprite.model.position;
      const isValid = () => !this.disposed && this.decor.get(item.id) === item
        && this.turf.getTileAtWorld(position) === WORLD_TILES.FARMING_SOIL;
      return { id: item.id, model: item.sprite.model, position, isValid, dig: () => {
        if (!isValid()) return false;
        const origin = position.clone();
        this.decor.delete(item.id); item.sprite.dispose(); this.puff(origin);
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
  canTill(point: Pick<THREE.Vector3, 'x' | 'z'>): boolean {
    if (this.disposed || this.turf.getTileAtWorld(point) !== WORLD_TILES.FARMING_SOIL) return false;
    const distanceSq = (position: Pick<THREE.Vector3, 'x' | 'z'>) => (position.x - point.x) ** 2 + (position.z - point.z) ** 2;
    const plantSpacing = 0.5 * SCALE + TILL_SPACING / 2; // plant SetDeploySmartRadius(0.5).
    return ![...this.plows.values()].some(({ sprite }) => distanceSq(sprite.model.position) < TILL_SPACING ** 2)
      && ![...this.decor.values()].some(({ prefabId, sprite }) => prefabId === 'farm_soil_debris'
        && distanceSq(sprite.model.position) < TILL_SPACING ** 2)
      && ![...this.plantedSeeds.values()].some(({ model }) => distanceSq(model.position) < plantSpacing ** 2)
      && !this.blockers().some(({ position, tags }) => !tags?.some((tag) => TILL_IGNORE_BLOCKERS.has(tag))
        && distanceSq(position) < (tags?.includes('farm_plant') ? plantSpacing : TILL_SPACING) ** 2);
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
        sprite.model.position.copy(position);
        sprite.playOnce('till_rise', () => sprite.playOnce('till_idle'));
        return true;
      },
      dispose: () => { if (!used) { used = true; sprite.dispose(); } },
    };
  }

  private isPlantableSoil(soil: Decor): boolean {
    return !this.disposed && this.decor.get(soil.id) === soil && soil.prefabId === 'farm_soil'
      && !soil.broken && !soil.plowId && this.turf.getTileAtWorld(soil.sprite.model.position) === WORLD_TILES.FARMING_SOIL;
  }

  /** Prepare art before the player's PLANT timeline; commit the seed and hole together. */
  async prepareSeedPlant(id: string): Promise<PreparedSeedPlant | undefined> {
    const soil = this.decor.get(id);
    if (!soil || !this.isPlantableSoil(soil)) return undefined;
    await this.prepare();
    const sprite = await this.create('farm_soil.zip', 'farm_soil', 'sow_idle', PLANTED_SEED_ID);
    let used = false;
    return {
      apply: (takeSeed) => {
        if (used || !this.isPlantableSoil(soil) || !takeSeed()) return false;
        used = true;
        const position = soil.sprite.model.position.clone();
        this.decor.delete(soil.id); soil.sprite.dispose();
        this.addPlantedSeed(sprite, newEntityId(), position);
        sprite.playOnce('sow', () => sprite.start('sow_idle'));
        PlaySound('dontstarve/common/plant', position);
        return true;
      },
      dispose: () => { if (!used) { used = true; sprite.dispose(); } },
    };
  }

  async spawnPlantedSeed(position: THREE.Vector3, id = newEntityId()): Promise<THREE.Group> {
    await this.prepare();
    const sprite = await this.create('farm_soil.zip', 'farm_soil', 'sow_idle', PLANTED_SEED_ID);
    if (this.disposed) { sprite.dispose(); throw new Error('Farm plow has been disposed'); }
    this.addPlantedSeed(sprite, id, position);
    sprite.start('sow_idle');
    return sprite.model;
  }

  private addPlantedSeed(sprite: ArchiveSprite, id: string, position: THREE.Vector3): void {
    sprite.model.position.copy(position).setY(0);
    Object.assign(sprite.model.userData, { entityId: id, prefab: PLANTED_SEED_ID, tags: ['plantedsoil', 'farm_plant', 'planted_seed'] });
    this.plantedSeeds.set(id, sprite); this.world.scene.add(sprite.model);
  }

  exportPlantedSeedRecords() {
    return [...this.plantedSeeds].map(([id, sprite]) => ({ prefabId: PLANTED_SEED_ID, record: {
      id, transform: { position: sprite.model.position.toArray(), rotationY: 0 }, components: {},
    } }));
  }

  private dirt(plow: Plow, quad: number): void {
    let x = (1 - this.random() ** 2) * 2, z = (1 - this.random() ** 2) * 2;
    if (quad === 1 || quad === 3) x = -x;
    if (quad === 1 || quad === 2) z = -z;
    if (x * x + z * z <= 0.75 ** 2) return;
    const position = plow.sprite.model.position.clone().add(new THREE.Vector3(x * SCALE, 0, z * SCALE));
    if (!this.turf.canPlant(position) || this.blockers().some((blocker) =>
      !blocker.tags?.some((tag) => IGNORE_BLOCKERS.has(tag)) && Math.hypot(blocker.position.x - position.x, blocker.position.z - position.z) < SCALE)) return;
    this.collapseSoil(position);
    void this.spawnDecor('farm_soil', position, { broken: false, plowId: plow.id }, plow)
      .catch((error: unknown) => { if (!this.disposed) console.error('Unable to create plowed soil', error); });
  }

  private finish(plow: Plow): void {
    const center = plow.sprite.model.position;
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
    if (plow.returnUses > 0) this.fold(plow);
    else { this.collapseEffect(center); this.removePlow(plow); }
  }

  private fold(plow: Plow): void {
    plow.phase = 'collapse'; plow.remainingSeconds = 0;
    plow.loopSound?.stop(); plow.loopSound = undefined;
    this.puff(plow.sprite.model.position);
    PlaySound('farming/common/farm/plow/collapse', plow.sprite.model.position);
    PlaySound('farming/common/farm/plow/dirt_puff', plow.sprite.model.position);
    plow.sprite.playOnce('collapse', () => {
      const position = plow.sprite.model.position.clone();
      this.removePlow(plow);
      void this.returnItem(position, plow.returnUses).catch((error: unknown) => { if (!this.disposed) console.error('Unable to return farm plow item', error); });
    });
  }

  get hammerTargets(): readonly HammerTarget[] {
    return [...this.plows.values()].filter((plow) => plow.phase !== 'collapse').map((plow) => ({
      id: plow.id, model: plow.sprite.model, position: plow.sprite.model.position,
      isValid: () => !this.disposed && this.plows.get(plow.id) === plow && plow.phase !== 'collapse',
      playHit: () => {
        if (this.plows.get(plow.id) !== plow || plow.phase === 'collapse') return;
        plow.finished = false;
        const position = plow.sprite.model.position.clone();
        this.collapseEffect(position);
        for (const soil of [...this.decor.values()]) if (soil.plowId === plow.id) this.removeSoil(soil);
        this.removePlow(plow);
        if (plow.returnUses > 0) void this.returnItem(position, plow.returnUses)
          .catch((error: unknown) => { if (!this.disposed) console.error('Unable to recover hammered farm plow', error); });
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
    if (this.disposed || owner?.finished === false) { sprite.dispose(); return sprite.model; }
    sprite.model.position.copy(position).setY(0);
    const item: Decor = { id, prefabId, sprite, broken, animation,
      ...(saved && 'plowId' in saved && owner?.finished !== true ? { plowId: saved.plowId } : {}) };
    this.addDecor(sprite, item);
    if (!saved || owner) sprite.playOnce(prefabId === 'farm_soil' ? 'till_rise' : `${animation}_pre`, () => sprite.playOnce(clip));
    return sprite.model;
  }

  private addDecor(sprite: ArchiveSprite, item: Decor): void {
    Object.assign(sprite.model.userData, { entityId: item.id, prefab: item.prefabId,
      tags: [item.prefabId === 'farm_soil' ? 'soil' : 'farm_debris'] });
    this.decor.set(item.id, item); this.world.scene.add(sprite.model);
  }

  private collapseSoil(position: THREE.Vector3): void {
    for (const soil of [...this.decor.values()]) {
      if (soil.prefabId !== 'farm_soil') continue;
      const distance = soil.sprite.model.position.distanceTo(position);
      if (distance < SCALE * 1.25 * 0.5) this.removeSoil(soil);
      else if (distance < SCALE * 1.25 && !soil.broken) {
        soil.broken = true;
        soil.sprite.playOnce('collapse', () => soil.sprite.playOnce('collapse_idle'));
      }
    }
  }

  private removeSoil(soil: Decor): void {
    this.decor.delete(soil.id); this.effects.add(soil.sprite);
    soil.sprite.playOnce(soil.broken ? 'collapse_remove' : 'till_remove', () => {
      this.effects.delete(soil.sprite); soil.sprite.dispose();
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
      if (this.disposed) { sprite.dispose(); return; }
      sprite.model.position.copy(origin); this.world.scene.add(sprite.model); this.effects.add(sprite);
      sprite.playOnce(animation, () => { this.effects.delete(sprite); sprite.dispose(); });
    }).catch((error: unknown) => { if (!this.disposed) console.error('Unable to create farm plow effect', error); });
  }
  private removePlow(plow: Plow): void {
    plow.loopSound?.stop(); this.plows.delete(plow.id); plow.sprite.dispose();
  }
  private async create(archive: string, bank: string, animation: string, name: string): Promise<ArchiveSprite> {
    const sprite = await createArchiveSprite(this.assets, spriteDefinition(archive, bank, animation), { name });
    sprite.model.userData.animationController = sprite;
    // Placer and temporary FX are returned for rendering too. They must never
    // count as tile occupants; persistent plows/decor replace these tags on add.
    sprite.model.userData.tags = ['FX', 'NOCLICK'];
    return sprite;
  }
  private center(point: Pick<THREE.Vector3, 'x' | 'z'>): THREE.Vector3 {
    const center = snapToTileCenter(point); return new THREE.Vector3(center.x, 0, center.z);
  }
  private tileKey(point: Pick<THREE.Vector3, 'x' | 'z'>): string { return `${Math.floor(point.x / TILE_SIZE)},${Math.floor(point.z / TILE_SIZE)}`; }

  exportRecords() {
    return [...this.plows.values()].map(({ id, sprite, phase, remainingSeconds, returnUses }) => ({
      id, transform: { position: sprite.model.position.toArray(), rotationY: 0 },
      components: { farmPlow: { phase, remainingSeconds, returnUses } },
    }));
  }
  exportDecorRecords() {
    return [...this.decor.values()].map(({ id, prefabId, sprite, animation, broken, plowId }) => ({ prefabId, record: {
      id, transform: { position: sprite.model.position.toArray(), rotationY: 0 },
      components: prefabId === 'farm_soil' ? { farmSoil: { broken, ...(plowId ? { plowId } : {}) } } : { farmDebris: { animation } },
    } }));
  }
  get renderEntities() {
    const sprites = [...this.plows.values()].map((plow) => plow.sprite)
      .concat([...this.decor.values()].map((item) => item.sprite), [...this.plantedSeeds.values()], [...this.effects], this.preview?.model.visible ? [this.preview] : [],
        this.previewOutline?.model.visible ? [this.previewOutline] : []);
    return sprites.map(({ model: object }) => ({ object, footPosition: object.position.clone().setY(0), cameraDepth: 0 }));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.cancel(); this.pointer.dispose(); this.removeDigListener();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
    for (const plow of this.plows.values()) this.removePlow(plow);
    for (const item of this.decor.values()) item.sprite.dispose();
    for (const effect of this.effects) effect.dispose();
    for (const sprite of this.plantedSeeds.values()) sprite.dispose();
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
