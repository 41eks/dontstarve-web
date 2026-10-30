import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { SpriteResources, type ArchiveSpriteCommands, type PrefabDisplay } from '@dontstarve-web/display';
import { createArchiveEntity, type PrefabInstance, prefabInstance } from './prefabInstance';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { watchTileActivity } from './tileActivity';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { modelEntries } from './modelRecords';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { MakeSmallObstaclePhysics } from './standardcomponents';
import type { SpawnGroundItem } from './groundPrefab';
import { PlaySound } from './sound';
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

/** Player_SetSkeletonDescription: the fields GetPlayerDeathDescription reads. `cause` is stored lowercased and dropped for a pk. */
export interface SkeletonDescription { char: string; playername?: string; cause?: string; pkname?: string; userid?: string }
/** skeleton.lua OnSave / Player_OnSave: the pose, plus the description on skeleton_player. */
export interface SkeletonSaveState extends Partial<SkeletonDescription> { anim: number }
export interface SkeletonRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { skeleton?: SkeletonSaveState };
}

export interface SkeletonWorld extends ToolMouseTargetWorld {
  tickingarea?: TileStateQuery;
  physics?: CANNON.World;
  /** lootdropper:SpawnLootPrefab when the skeleton is hammered; the loot's display loads its art. */
  spawnGroundItem: SpawnGroundItem;
}

interface Skeleton {
  model: THREE.Group;
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  sprite: ArchiveSpriteCommands;
  stopActivity?: () => void;
  workable: Workable;
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
  private readonly displays: PrefabDisplayGroup;
  private readonly world: SkeletonWorld;
  private readonly resources = new SpriteResources();
  private readonly skeletons = new Map<THREE.Group, Skeleton>();
  private readonly effects = new Set<ReturnType<typeof createArchiveEntity>>();
  private disposed = false;

  constructor(scene: THREE.Scene, world: SkeletonWorld) {
    this.displays = new PrefabDisplayGroup(scene); this.world = world;
  }

  spawn(prefab: SkeletonId, position: THREE.Vector3, saved?: SkeletonRecord): THREE.Group {
    if (this.disposed) throw new Error('Skeletons have been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid skeleton position');
    const state = saved?.components.skeleton;
    // common_fn: animnum = math.random(animnum_min, animnum_max); OnLoad restores the saved one.
    const { min, max } = SKELETON_ANIMS[prefab];
    const anim = state?.anim ?? min + Math.floor(Math.random() * (max - min + 1));
    const clip = { name: `idle${anim}`, loop: false };
    const entity = createArchiveEntity(prefab, this.resources.archive({ animationArchive: 'skeletons.zip',
      buildArchives: ['skeletons.zip'], bank: 'skeleton' }, { instancedAnimations: 'all' }), { name: clip.name, billboard: true }, prefab);
    entity.instance.sprite.playOnce(clip.name);
    return this.create(prefab, entity, position, anim, state, saved);
  }

  private create(prefab: SkeletonId, { instance, display }: ReturnType<typeof createArchiveEntity>, position: THREE.Vector3, anim: number,
    state: SkeletonSaveState | undefined, saved: SkeletonRecord | undefined): THREE.Group {
    const model = display.model;
    const sprite = instance.sprite;
    model.position.set(position.x, 0, position.z);
    instance.entityId = saved?.id ?? newEntityId();
    for (const tag of skeletonTags(prefab)) instance.addTag(tag);
    const inst = actionEntity(model, prefab);
    // workable: HAMMER, SKELETON_WORK; OnHammered drops the table, plays collapse_small with the rock material and removes it.
    const workable = new Workable(inst);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(SKELETON_WORK);
    const skeleton: Skeleton = { model, instance, display, sprite, workable, prefab, anim,
      description: prefab === SKELETON_PLAYER_ID && state?.char ? { char: state.char, playername: state.playername, cause: state.cause, pkname: state.pkname, userid: state.userid } : undefined };
    const lootdropper = new LootDropper(inst, (itemId, point) => this.world.spawnGroundItem(
      { ...catalog.items[itemId as keyof typeof catalog.items], itemId, count: 1 }, new THREE.Vector3(point.x, point.y, point.z), { fling: true }));
    lootdropper.SetChanceLootTable(prefab === SKELETON_PLAYER_ID ? 'skeleton_player' : 'skeleton');
    workable.SetOnFinishCallback(() => {
      lootdropper.DropLoot();
      this.playCollapse(model.position);
      this.remove(model);
    });
    Object.assign(prefabInstance(model)!.components, { workable, lootdropper });
    new ToolMouseTarget(inst, instance, workable, this.world.handEquipment);
    MakeSmallObstaclePhysics(instance, PHYSICS_RADIUS);
    if (this.world.physics) instance.bindPhysics(this.world.physics);
    this.skeletons.set(model, skeleton);
    inst.hammerTarget = {
      get id() { return String(instance.entityId); }, instance, display, entity: inst, position: instance.position,
      isValid: () => this.skeletons.get(model) === skeleton && workable.CanBeWorked(),
      playHit: () => { performToolWork('HAMMER', inst, {}); },
    };
    this.displays.mount(prefabDisplay(model)!);
    skeleton.stopActivity = watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active));
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
    const entity = createArchiveEntity('collapse_small', this.resources.archive({ animationArchive: 'structure_collapse_fx.zip',
      buildArchives: ['structure_collapse_fx.zip'], bank: 'collapse' }), { name: 'collapse_small', billboard: true }, 'collapse_small',
    instance => instance.sprite.playOnce('collapse_small', () => { instance.remove(); this.effects.delete(entity); }));
    entity.instance.position.copy(at); entity.instance.persists = false;
    for (const tag of ['FX', 'NOCLICK']) entity.instance.addTag(tag);
    this.displays.mount(entity.display); this.effects.add(entity);
  }

  update(dt: number, _quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    for (const { sprite } of this.skeletons.values()) if (sprite.loaded) sprite.update(dt);
    for (const { instance } of [...this.effects]) instance.sprite.update(dt);
  }

  get renderEntities() {
    return [...[...this.skeletons].filter(([, { sprite }]) => sprite.loaded).map(([model]) => model), ...[...this.effects].map(({ display }) => display.model)]
      .map(object => ({ object, footPosition: object.position, cameraDepth: 0 }));
  }

  get hammerTargets(): HammerTarget[] { return this.getHammerTargets(); }

  getHammerTargets(model?: THREE.Object3D): HammerTarget[] {
    return modelEntries(this.skeletons, model).filter(([, skeleton]) => skeleton.workable.CanBeWorked())
      .map(([model, skeleton]) => actionEntity(model, skeleton.prefab).hammerTarget)
      .filter((target): target is HammerTarget => target !== undefined);
  }

  /** workable.savestate is false: a surviving skeleton reloads with its full work count. */
  exportRecords(): { prefabId: SkeletonId; record: SkeletonRecord }[] {
    return [...this.skeletons].map(([model, { prefab, anim, description, instance }]) => ({
      prefabId: prefab,
      record: {
        id: String(instance.entityId),
        transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
        components: { skeleton: { anim, ...description } },
      },
    }));
  }

  private remove(model: THREE.Group): void {
    const skeleton = this.skeletons.get(model); if (!skeleton) return;
    this.skeletons.delete(model); model.userData.removed = true;
    skeleton.stopActivity?.();
    skeleton.workable.dispose();
    skeleton.instance.remove();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of [...this.skeletons.keys()]) this.remove(model);
    for (const { instance } of this.effects) instance.remove();
    this.effects.clear();
    this.displays.dispose();
    this.resources.dispose();
  }
}
