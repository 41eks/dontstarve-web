import { SpriteState } from '@dontstarve-web/display';
import * as THREE from 'three';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import type { SpawnGroundItem } from './groundPrefab';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeSmallObstaclePhysics } from './standardcomponents';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { Transform } from './transform';
import type { WorldFx } from './world_fx';
import catalog from './groundItems.json' with { type: 'json' };

export const SKELETON_PLAYER_ID = 'skeleton_player' as const;
export const SKELETON_IDS = [SKELETON_PLAYER_ID, 'skeleton', 'skeleton_notplayer', 'skeleton_notplayer_1', 'skeleton_notplayer_2'] as const;
export type SkeletonId = typeof SKELETON_IDS[number];

/** tuning.lua SKELETON_WORK. */
export const SKELETON_WORK = 3;
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

export interface SkeletonWorld extends ToolMouseTargetWorld {
  /** SpawnPrefab("collapse_small") and SetMaterial("rock") when the skeleton is hammered. */
  fx?: Pick<WorldFx, 'collapse'>;
  /** lootdropper:SpawnLootPrefab when the skeleton is hammered; the loot's display loads its art. */
  spawnGroundItem: SpawnGroundItem;
}

export function isSkeletonId(value: string): value is SkeletonId {
  return (SKELETON_IDS as readonly string[]).includes(value);
}

/**
 * prefabs/skeleton.lua common_fn: `skeleton`, `skeleton_player` and the `skeleton_notplayer*` creature bones, hammered into
 * boneshards. The player skeleton's playeravatardata, spawn age, Decay and the shallow_grave fallback are not ported.
 */
export class SkeletonInstance extends PrefabInstance {
  declare readonly prefab: SkeletonId;
  declare readonly components: PrefabInstance['components'] & { workable: Workable; lootdropper: LootDropper };
  animnum: number;
  /** Player_SetSkeletonDescription's char, playername, userid, pkname and cause; only skeleton_player has them. */
  description?: SkeletonDescription;
  /** SetPrefabNameOverride on the creature bones. */
  readonly prefabNameOverride?: string;

  constructor(prefab: SkeletonId, world: SkeletonWorld, position: ReadonlyVector3) {
    // inst.animnum = math.random(data.animnum_min, data.animnum_max); PlayAnimation("idle"..animnum), never looping.
    const { min, max } = SKELETON_ANIMS[prefab], animnum = min + Math.floor(Math.random() * (max - min + 1));
    super(prefab, new SpriteState({ name: `idle${animnum}`, billboard: true }), Transform.stationary());
    this.animnum = animnum;
    this.setPosition(position.x, 0, position.z);
    this.sprite.playOnce(`idle${animnum}`);
    this.addTag('blocker'); // MakeSmallObstaclePhysics
    this.addTag('skeleton');
    const player = prefab === SKELETON_PLAYER_ID;
    if (player) this.addTag('playerskeleton'); // player_custominit
    else if (prefab !== 'skeleton') this.prefabNameOverride = 'skeleton_notplayer'; // creature_custominit
    this.addTag('inspectable');

    const lootdropper = new LootDropper(this, (itemId, point) => world.spawnGroundItem(
      { ...catalog.items[itemId as keyof typeof catalog.items], itemId, count: 1 }, new THREE.Vector3(point.x, point.y, point.z), { fling: true }));
    lootdropper.SetChanceLootTable(player ? 'skeleton_player' : 'skeleton');
    const workable = new Workable(this);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(SKELETON_WORK);
    workable.SetOnFinishCallback(() => OnHammered(this, world));
    Object.assign(this.components, { inspectable: new Inspectable(this), lootdropper, workable });

    // workable.savestate is false: a surviving skeleton reloads with its full work count.
    this.OnSave = (_inst, data) => { data.skeleton = { anim: this.animnum, ...player ? this.description : {} }; };
    this.OnLoad = (_inst, data) => (player ? Player_OnLoad : OnLoad)(this, data.skeleton);
    this.onRemove(() => workable.dispose());
  }

  /** Player_SetSkeletonDescription. */
  SetSkeletonDescription(char: string, playername: string | undefined, cause: string | undefined, pkname?: string, userid?: string): void {
    if (this.prefab !== SKELETON_PLAYER_ID) return;
    this.description = { char, playername, userid, pkname, cause: pkname === undefined ? cause?.toLowerCase() : undefined };
  }
}

function OnLoad(inst: SkeletonInstance, data: SkeletonSaveState | undefined): void {
  if (data?.anim === undefined) return;
  inst.animnum = data.anim;
  inst.sprite.playOnce(`idle${inst.animnum}`);
}

function Player_OnLoad(inst: SkeletonInstance, data: SkeletonSaveState | undefined): void {
  OnLoad(inst, data);
  if (!data?.char || (!data.cause && !data.pkname)) return;
  inst.description = { char: data.char, playername: data.playername, userid: data.userid, pkname: data.pkname, cause: data.cause };
}

function OnHammered(inst: SkeletonInstance, world: SkeletonWorld): void {
  inst.components.lootdropper.DropLoot();
  world.fx?.collapse('small', inst.position, 'rock');
  inst.remove();
}

/** The five Prefabs skeleton.lua returns. */
export function skeletonPrefabs(world: SkeletonWorld): Readonly<Record<SkeletonId, PrefabEntityDefinition<SkeletonInstance>>> {
  const definition = (id: SkeletonId): PrefabEntityDefinition<SkeletonInstance> => ({
    fn: position => new SkeletonInstance(id, world, position),
    assets: { animationArchive: 'skeletons.zip', buildArchives: ['skeletons.zip'], bank: 'skeleton' },
    assetOptions: { instancedAnimations: 'all' },
    physics: { make: MakeSmallObstaclePhysics, radius: .25 },
    onSpawned: inst => { new ToolMouseTarget(actionEntity(inst.transform.model, id), inst, inst.components.workable, world.handEquipment); },
  });
  return {
    skeleton: definition('skeleton'), skeleton_player: definition('skeleton_player'), skeleton_notplayer: definition('skeleton_notplayer'),
    skeleton_notplayer_1: definition('skeleton_notplayer_1'), skeleton_notplayer_2: definition('skeleton_notplayer_2'),
  };
}
