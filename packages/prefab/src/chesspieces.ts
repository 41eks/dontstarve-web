import { Transform } from './transform';
import * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { Equippable } from '../../componets/src/equippable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Hauntable } from '../../componets/src/hauntable';
import { HeavyObstaclePhysics } from '../../componets/src/heavyobstaclephysics';
import { InventoryItem } from '../../componets/src/inventoryitem';
import { LootDropper } from '../../componets/src/lootdropper';
import { Submersible } from '../../componets/src/submersible';
import { SymbolSwapData } from '../../componets/src/symbolswapdata';
import { Workable } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import type { SpawnGroundItem } from './groundPrefab';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import { MakeHeavyObstaclePhysics } from './standardcomponents';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import type { WorldContext } from './worldContext';
import catalog from './groundItems.json' with { type: 'json' };

export const CHESSPIECE_MALBATROSS_MARBLE_ID = 'chesspiece_malbatross_marble' as const;
/** chesspieces.lua SetPrefabName: a saved sculpture's source group has no material suffix; data.materialid selects it. */
export const CHESSPIECE_MALBATROSS_SOURCE_PREFAB = 'chesspiece_malbatross' as const;
/** MATERIALS[1] is marble. */
export const CHESSPIECE_MARBLE_MATERIAL_ID = 1 as const;
const PHYSICS_RADIUS = .45;
const TUNING_HAUNT_TINY = 1; // tuning.lua HAUNT_TINY.

export interface ChesspieceSaveState { materialid: typeof CHESSPIECE_MARBLE_MATERIAL_ID }
/** submersible.lua OnSave. */
export interface SubmersibleSaveState { force_no_repositioning: boolean }
export interface ChesspieceWorld extends ToolMouseTargetWorld {
  scheduler: GameTimeScheduler;
  fx?: WorldContext['fx'];
  /** lootdropper:SpawnLootPrefab when the piece is hammered; the loot's display loads its art. */
  spawnGroundItem: SpawnGroundItem;
}

/**
 * chesspieces.lua makepiece(malbatross, marble). PIECES.malbatross has moonevent = false, so it never gets the
 * chess_moonevent tag. Only that tag receives shadowchessroar or a forcebreak, which leaves CheckMorph, the struggle
 * tasks and onworkfinished's creature branch unreachable for this piece. It has no source skin.
 */
export class ChesspieceInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { workable: Workable; lootdropper: LootDropper; submersible: Submersible };

  constructor(world: ChesspieceWorld) {
    // fn: SetBank("chesspiece"), SetBuild("swap_chesspiece_malbatross_marble"), PlayAnimation("idle") without looping.
    super(CHESSPIECE_MALBATROSS_MARBLE_ID, new SpriteState({ name: 'idle', billboard: true }),
      Transform.stationary());
    this.sprite.playOnce('idle');
    this.physicsRadiusOverride = PHYSICS_RADIUS;
    this.addTag('heavy');

    const inventoryitem = new InventoryItem(this);
    inventoryitem.cangoincontainer = false;
    const workable = new Workable(this);
    workable.SetWorkAction('HAMMER'); workable.SetWorkLeft(1);
    workable.SetOnFinishCallback(() => this.onworkfinished());
    // SetMaterial: MATERIALS[marble].prefab.
    const lootdropper = new LootDropper(this, (itemId, point) => world.spawnGroundItem(
      { ...catalog.items[itemId as keyof typeof catalog.items], itemId, count: 1 }, new THREE.Vector3(point.x, point.y, point.z), { fling: true }));
    lootdropper.SetLoot(['marble']);
    const hauntable = new Hauntable({ addTag: tag => this.addTag(tag), removeTag: tag => this.removeTag(tag),
      PushEvent: (name, data) => this.PushEvent(name, data) }, world.scheduler);
    hauntable.SetHauntValue(TUNING_HAUNT_TINY);
    Object.assign(this.components, { workable, lootdropper, inventoryitem, hauntable,
      inspectable: new Inspectable(this),
      equippable: new Equippable(this, 'body'),
      heavyobstaclephysics: new HeavyObstaclePhysics(this),
      submersible: new Submersible(this),
      symbolswapdata: new SymbolSwapData(this) });
    this.worldServices = { fx: world.fx };
    this.onRemove(() => { workable.dispose(); hauntable.dispose(); });
  }

  /** onsave: materialid. workable.savestate is false, so the hammer work is not saved. */
  OnSave(_inst: unknown, data: PlacementSaveRecord['components']): void {
    data.chesspiece = { materialid: CHESSPIECE_MARBLE_MATERIAL_ID };
  }

  /** equippable.lua's wetness check; this port has no moisture on the piece. */
  GetIsWet(): boolean { return false; }

  /** onworkfinished without the creature branch: DropLoot, collapse_small with the stone material, Remove. */
  private onworkfinished(): void {
    this.components.lootdropper.DropLoot();
    this.worldServices?.fx?.collapse?.('small', this.position, 'stone');
    this.remove();
  }
}

/** The chesspiece_malbatross_marble Prefab chesspieces.lua returns; the other pieces and materials are not ported. */
export function chesspiecePrefabs(world: ChesspieceWorld): Readonly<Record<typeof CHESSPIECE_MALBATROSS_MARBLE_ID, PrefabEntityDefinition<ChesspieceInstance>>> {
  return {
    [CHESSPIECE_MALBATROSS_MARBLE_ID]: {
      fn: () => new ChesspieceInstance(world),
      assets: { animationArchive: 'chesspiece.zip', buildArchives: ['swap_chesspiece_malbatross_marble.zip'], bank: 'chesspiece' },
      assetOptions: { instancedAnimations: 'all', staticBillboard: true },
      physics: { make: MakeHeavyObstaclePhysics, radius: PHYSICS_RADIUS },
      onSpawned: inst => {
        new ToolMouseTarget(actionEntity(inst.transform.model, CHESSPIECE_MALBATROSS_MARBLE_ID), inst, inst.components.workable, world.handEquipment);
      },
    },
  };
}
