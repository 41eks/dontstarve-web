import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createSharedArchiveSprite, preloadSharedArchiveSprite, ArchiveSpriteAssets, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { ResidentSprite } from '@dontstarve-web/animation/residentSprite';
import { createEffect, type TileStateQuery } from '@dontstarve-web/signals';
import { watchTileActivity } from './tileActivity';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { modelEntries } from './modelRecords';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';
import type { GroundItemDefinition, PreparedGroundSpawn } from './groundPrefab';
import { PlaySound, PreloadSounds } from './sound';
import catalog from './groundItems.json' with { type: 'json' };

export const SKELETON_PLAYER_ID = 'skeleton_player' as const;
export const SKELETON_IDS = [SKELETON_PLAYER_ID, 'skeleton', 'skeleton_notplayer', 'skeleton_notplayer_1', 'skeleton_notplayer_2'] as const;
export type SkeletonId = typeof SKELETON_IDS[number];

/** tuning.lua SKELETON_WORK. */
export const SKELETON_WORK = 3;
const PHYSICS_RADIUS = .25;
/** skeleton.lua regular_fn / creature_fn / creature_1_fn / creature_2_fn / player_fn: the common_fn animnum_min..animnum_max range. */
export const SKELETON_ANIMS: Record<SkeletonId, { min: number; max: number }> = {
  skeleton: { min: 1, max: 6 }, skeleton_player: { min: 1, max: 6 },
  skeleton_notplayer: { min: 7, max: 8 }, skeleton_notplayer_1: { min: 7, max: 7 }, skeleton_notplayer_2: { min: 8, max: 8 },
};
// skeleton.lua SetSharedLootTable('skeleton', ...) and ('skeleton_player', ...)
SetSharedLootTable('skeleton', [['boneshard', 1], ['boneshard', 1], ['scrapbook_page', .1]]);
SetSharedLootTable('skeleton_player', [['boneshard', 1], ['boneshard', 1]]);
const LOOT_TABLES: Record<SkeletonId, readonly (keyof typeof catalog.items)[]> = {
  skeleton: ['boneshard', 'boneshard', 'scrapbook_page'], skeleton_notplayer: ['boneshard', 'boneshard', 'scrapbook_page'],
  skeleton_notplayer_1: ['boneshard', 'boneshard', 'scrapbook_page'], skeleton_notplayer_2: ['boneshard', 'boneshard', 'scrapbook_page'],
  skeleton_player: ['boneshard', 'boneshard'],
};

/** Player_SetSkeletonDescription: the fields GetPlayerDeathDescription reads. `cause` is stored lowercased and dropped for a pk. */
export interface SkeletonDescription { char: string; playername?: string; cause?: string; pkname?: string; userid?: string }
/** skeleton.lua OnSave / Player_OnSave: the pose, plus the description on skeleton_player. */
export interface SkeletonSaveState extends Partial<SkeletonDescription> { anim: number }
export interface SkeletonRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { skeleton?: SkeletonSaveState };
}

export interface SkeletonWorld {
  tickingarea?: TileStateQuery;
  physics?: CANNON.World;
  prepareSpawn(definition: GroundItemDefinition, fling?: boolean): Promise<PreparedGroundSpawn>;
}

interface Skeleton {
  model: THREE.Group;
  sprite: ResidentSprite;
  stopActivity?: () => void;
  stopArt?: () => void;
  body?: CANNON.Body;
  workable: Workable;
  loot: { itemId: string; output: PreparedGroundSpawn }[];
  prefab: SkeletonId;
  anim: number;
  description?: SkeletonDescription;
}

/** common_fn adds `skeleton`; player_custominit adds `playerskeleton`. */
function skeletonTags(prefab: SkeletonId): string[] {
  return prefab === SKELETON_PLAYER_ID ? ['skeleton', 'playerskeleton'] : ['skeleton'];
}

export function isSkeletonId(value: string): value is SkeletonId {
  return (SKELETON_IDS as readonly string[]).includes(value);
}

/** prefabs/skeleton.lua: `skeleton`, `skeleton_player` and the `skeleton_notplayer*` creature bones, hammered into boneshards. */
export class SkeletonManager {
  private readonly scene: THREE.Scene;
  private readonly world: SkeletonWorld;
  private readonly assets = new ArchiveSpriteAssets();
  private readonly skeletons = new Map<THREE.Group, Skeleton>();
  private readonly effects = new Set<ArchiveSprite>();
  private source?: ReturnType<typeof preloadSharedArchiveSprite>;
  private readonly cameraQuaternion = new THREE.Quaternion();
  private disposed = false;

  constructor(scene: THREE.Scene, world: SkeletonWorld) {
    this.scene = scene; this.world = world;
  }

  /** Decode the bones and the hammer's collapse effect ahead of the death that leaves them. */
  async prepare(): Promise<void> {
    if (this.disposed) throw new Error('Skeletons have been disposed');
    await Promise.all([this.getSource(),
      this.assets.loadAnimation('structure_collapse_fx.zip'), this.assets.loadBuild('structure_collapse_fx.zip'),
      PreloadSounds('dontstarve/common/destroy_smoke', 'dontstarve/wilson/rock_break')]);
  }

  private getSource() {
    return this.source ??= preloadSharedArchiveSprite(this.assets, { animationArchive: 'skeletons.zip', buildArchives: ['skeletons.zip'],
      bank: 'skeleton' }, { instancedAnimations: 'all' }).catch((error: unknown) => { this.source = undefined; throw error; });
  }

  async spawn(prefab: SkeletonId, position: THREE.Vector3, saved?: SkeletonRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Skeletons have been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid skeleton position');
    const state = saved?.components.skeleton;
    // common_fn: animnum = math.random(animnum_min, animnum_max); OnLoad restores the saved one.
    const { min, max } = SKELETON_ANIMS[prefab];
    const anim = state?.anim ?? min + Math.floor(Math.random() * (max - min + 1));
    const resources = await Promise.allSettled([
      this.getSource(),
      this.prepareHammered(prefab),
    ] as const);
    const create = resources[0].status === 'fulfilled' ? resources[0].value : undefined;
    const loot = resources[1].status === 'fulfilled' ? resources[1].value : [];
    if (resources.some(result => result.status === 'rejected') || this.disposed || !create) {
      loot.forEach(({ output }) => output.dispose());
      const failed = resources.find(result => result.status === 'rejected');
      throw failed?.status === 'rejected' ? failed.reason : new Error('Skeletons have been disposed');
    }
    const build = (clip: { name: string; loop: boolean }) => create(clip.name, clip.loop, prefab);
    const clip = { name: `idle${anim}`, loop: false };
    return this.create(prefab, new ResidentSprite(build, clip, build(clip), prefab), loot, position, anim, state, saved);
  }

  /** The collapse effect, rock_break sound and every item of the prefab's loot table, ready before the hit. */
  private async prepareHammered(prefab: SkeletonId): Promise<Skeleton['loot']> {
    const settled = await Promise.allSettled([
      this.assets.loadAnimation('structure_collapse_fx.zip'), this.assets.loadBuild('structure_collapse_fx.zip'),
      PreloadSounds('dontstarve/common/destroy_smoke', 'dontstarve/wilson/rock_break'),
      ...LOOT_TABLES[prefab].map(itemId => this.world.prepareSpawn({ ...catalog.items[itemId], itemId, count: 1 }, true)),
    ] as const);
    const loot = settled.slice(3).flatMap((result, index) => result.status === 'fulfilled'
      ? [{ itemId: LOOT_TABLES[prefab][index], output: result.value as PreparedGroundSpawn }] : []);
    const failed = settled.find(result => result.status === 'rejected');
    if (failed) {
      loot.forEach(({ output }) => output.dispose());
      throw failed.status === 'rejected' ? failed.reason : undefined;
    }
    return loot;
  }

  private create(prefab: SkeletonId, sprite: ResidentSprite, loot: Skeleton['loot'], position: THREE.Vector3, anim: number,
    state: SkeletonSaveState | undefined, saved: SkeletonRecord | undefined): THREE.Group {
    const model = sprite.model;
    model.position.set(position.x, 0, position.z);
    Object.assign(model.userData, { entityId: saved?.id ?? newEntityId(), prefab, tags: skeletonTags(prefab), animationController: sprite });
    const inst = actionEntity(model, prefab);
    for (const tag of skeletonTags(prefab)) inst.addTag(tag);
    // workable: HAMMER, SKELETON_WORK; OnHammered drops the table, plays collapse_small with the rock material and removes it.
    const workable = new Workable(inst);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(SKELETON_WORK);
    const skeleton: Skeleton = { model, sprite, workable, loot, prefab, anim,
      description: prefab === SKELETON_PLAYER_ID && state?.char ? { char: state.char, playername: state.playername, cause: state.cause, pkname: state.pkname, userid: state.userid } : undefined };
    const lootdropper = new LootDropper(inst, (itemId, point) => {
      // Only the rolled items are consumed; the rest are disposed with the skeleton.
      const index = skeleton.loot.findIndex(entry => entry.itemId === itemId);
      const [prepared] = index < 0 ? [] : skeleton.loot.splice(index, 1).map(entry => entry.output);
      if (!prepared) return undefined;
      const spawned = prepared.spawn(new THREE.Vector3(point.x, point.y, point.z));
      if (!spawned) prepared.dispose();
      return spawned ? prepared.spawnedEntity : undefined;
    });
    lootdropper.SetChanceLootTable(prefab === SKELETON_PLAYER_ID ? 'skeleton_player' : 'skeleton');
    workable.SetOnFinishCallback(() => {
      lootdropper.DropLoot();
      this.playCollapse(model.position);
      this.remove(model);
    });
    Object.assign(model.userData.components, { workable, lootdropper });
    // MakeSmallObstaclePhysics(inst, .25)
    if (this.world.physics) {
      skeleton.body = MakeObstaclePhysics(model.position, PHYSICS_RADIUS);
      model.userData.physicsBody = skeleton.body; model.userData.physicsRadius = PHYSICS_RADIUS;
      this.world.physics.addBody(skeleton.body);
    }
    skeleton.stopArt = createEffect(() => { sprite.art.get(); sprite.faceCamera(this.cameraQuaternion); });
    this.skeletons.set(model, skeleton);
    this.scene.add(model);
    skeleton.stopActivity = watchTileActivity(model, this.world.tickingarea, active => sprite.setActive(active));
    return model;
  }

  /** Player_SetSkeletonDescription: char, display name, lowercased cause (unless killed by a player) and user id. */
  setSkeletonDescription(model: THREE.Object3D, char: string, playername: string | undefined, cause: string | undefined,
    pkname?: string, userid?: string): void {
    const skeleton = this.skeletons.get(model as THREE.Group);
    if (skeleton?.prefab !== SKELETON_PLAYER_ID) return;
    skeleton.description = { char, playername, userid, pkname, cause: pkname === undefined ? cause?.toLowerCase() : undefined };
    model.userData.skeleton = skeleton.description;
  }

  /** structure_collapse_fx.lua: smoke plus the `rock` material sound over the collapse_small animation. */
  private playCollapse(position: THREE.Vector3): void {
    const at = position.clone();
    PlaySound('dontstarve/common/destroy_smoke', at);
    PlaySound('dontstarve/wilson/rock_break', at);
    void createSharedArchiveSprite(this.assets, { animationArchive: 'structure_collapse_fx.zip', buildArchives: ['structure_collapse_fx.zip'],
      bank: 'collapse', animation: 'collapse_small', loop: false }).then(effect => {
      if (this.disposed) { effect.dispose(); return; }
      effect.model.position.copy(at); effect.model.userData.tags = ['FX', 'NOCLICK']; effect.model.userData.persists = false;
      this.scene.add(effect.model); this.effects.add(effect);
      effect.playOnce('collapse_small', () => { effect.dispose(); this.effects.delete(effect); });
    }).catch((error: unknown) => console.error('Unable to play collapse effect', error));
  }

  update(dt: number, quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    this.cameraQuaternion.copy(quaternion);
    for (const { sprite } of this.skeletons.values()) if (sprite.loaded) { sprite.faceCamera(quaternion); sprite.update(dt); }
    for (const effect of [...this.effects]) { effect.model.quaternion.copy(quaternion); effect.update(dt); }
  }

  get renderEntities() {
    return [...[...this.skeletons].filter(([, { sprite }]) => sprite.loaded).map(([model]) => model), ...[...this.effects].map(({ model }) => model)]
      .map(object => ({ object, footPosition: object.position, cameraDepth: 0 }));
  }

  get hammerTargets(): HammerTarget[] { return this.getHammerTargets(); }

  getHammerTargets(model?: THREE.Object3D): HammerTarget[] {
    return modelEntries(this.skeletons, model).filter(([, skeleton]) => skeleton.workable.CanBeWorked()).map(([model, skeleton]) => ({
      id: String(model.userData.entityId), model, position: model.position, entity: actionEntity(model, skeleton.prefab),
      isValid: () => this.skeletons.get(model) === skeleton && skeleton.workable.CanBeWorked(),
      playHit: () => { performToolWork('HAMMER', actionEntity(model, skeleton.prefab), {}); },
    }));
  }

  /** workable.savestate is false: a surviving skeleton reloads with its full work count. */
  exportRecords(): { prefabId: SkeletonId; record: SkeletonRecord }[] {
    return [...this.skeletons].map(([model, { prefab, anim, description }]) => ({
      prefabId: prefab,
      record: {
        id: String(model.userData.entityId),
        transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
        components: { skeleton: { anim, ...description } },
      },
    }));
  }

  private remove(model: THREE.Group): void {
    const skeleton = this.skeletons.get(model); if (!skeleton) return;
    this.skeletons.delete(model); model.userData.removed = true;
    if (skeleton.body) this.world.physics?.removeBody(skeleton.body);
    skeleton.stopActivity?.(); skeleton.stopArt?.();
    skeleton.workable.dispose();
    skeleton.loot.forEach(({ output }) => output.dispose()); skeleton.loot.length = 0;
    skeleton.sprite.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of [...this.skeletons.keys()]) this.remove(model);
    for (const effect of this.effects) effect.dispose();
    this.effects.clear();
    this.assets.dispose();
  }
}
