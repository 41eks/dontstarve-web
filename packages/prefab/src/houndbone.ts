import { SpriteState } from '@dontstarve-web/display';
import * as THREE from 'three';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import type { SpawnGroundItem } from './groundPrefab';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { Transform } from './transform';
import type { WorldFx } from './world_fx';
import catalog from './groundItems.json' with { type: 'json' };

export const HOUNDBONE_ID = 'houndbone' as const;
/** houndbone.lua `names`: bonetype 1..3 selects piece1..piece3. */
export const HOUNDBONE_PIECES = ['piece1', 'piece2', 'piece3'] as const;
// houndbone.lua SetSharedLootTable('houndbone', ...)
SetSharedLootTable('houndbone', [['boneshard', 1]]);

/** houndbone.lua onsave: data.bonetype. */
export interface HoundboneSaveState { bonetype: number }

export interface HoundboneWorld extends ToolMouseTargetWorld {
  /** SpawnPrefab("collapse_small") and SetMaterial("rock") when the bone is hammered. */
  fx?: Pick<WorldFx, 'collapse'>;
  /** lootdropper:SpawnLootPrefab when the bone is hammered; the loot's display loads its art. */
  spawnGroundItem: SpawnGroundItem;
}

/** prefabs/houndbone.lua fn: a piece of hound remains, hammered once into boneshards (and, for piece3, maybe a houndstooth). */
export class HoundboneInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { workable: Workable; lootdropper: LootDropper };
  bonetype = 1;

  constructor(world: HoundboneWorld, position: ReadonlyVector3) {
    super(HOUNDBONE_ID, new SpriteState({ name: 'piece1', billboard: true }), Transform.stationary());
    this.setPosition(position.x, 0, position.z);
    this.sprite.playOnce('piece1');
    this.addTag('bone');

    const workable = new Workable(this);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(1);
    workable.SetOnFinishCallback(() => onhammered(this, world));
    const lootdropper = new LootDropper(this, (itemId, point) => world.spawnGroundItem(
      { ...catalog.items[itemId as keyof typeof catalog.items], itemId, count: 1 }, new THREE.Vector3(point.x, point.y, point.z), { fling: true }));
    lootdropper.SetChanceLootTable('houndbone');
    Object.assign(this.components, { workable, lootdropper });
    SetBoneType(this, 1 + Math.floor(Math.random() * HOUNDBONE_PIECES.length));

    // workable.savestate is false: a surviving bone reloads with its full work count.
    this.OnSave = (_inst, data) => { data.houndbone = { bonetype: this.bonetype }; };
    this.OnLoad = (_inst, data) => { if (data.houndbone?.bonetype !== undefined) SetBoneType(this, data.houndbone.bonetype); };
    this.onRemove(() => workable.dispose());
  }
}

function SetBoneType(inst: HoundboneInstance, bonetype: number): void {
  if (!Number.isInteger(bonetype) || bonetype < 1 || bonetype > HOUNDBONE_PIECES.length) throw new RangeError(`Unsupported houndbone type: ${bonetype}`);
  inst.bonetype = bonetype;
  inst.sprite.playOnce(HOUNDBONE_PIECES[bonetype - 1]);
  inst.components.lootdropper.ClearChanceLoot();
  if (bonetype === 3) inst.components.lootdropper.AddChanceLoot('houndstooth', .5);
}

function onhammered(inst: HoundboneInstance, world: HoundboneWorld): void {
  inst.components.lootdropper.DropLoot();
  world.fx?.collapse('small', inst.position, 'rock');
  inst.remove();
}

/** The Prefab houndbone.lua returns. */
export function houndbonePrefabs(world: HoundboneWorld): Readonly<Record<typeof HOUNDBONE_ID, PrefabEntityDefinition<HoundboneInstance>>> {
  return {
    [HOUNDBONE_ID]: {
      fn: position => new HoundboneInstance(world, position),
      assets: { animationArchive: 'hound_base.zip', buildArchives: ['hound_base.zip'], bank: 'houndbase' },
      assetOptions: { instancedAnimations: 'all' },
      onSpawned: inst => { new ToolMouseTarget(actionEntity(inst.transform.model, HOUNDBONE_ID), inst, inst.components.workable, world.handEquipment); },
    },
  };
}
