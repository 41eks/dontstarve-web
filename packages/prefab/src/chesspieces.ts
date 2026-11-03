import { Transform } from './transform';
import * as THREE from 'three';
import { SpriteResources, SpriteState, type PrefabDisplayGroup } from '@dontstarve-web/display';
import type { TileStateQuery } from '@dontstarve-web/signals';
import type { World } from 'cannon-es';
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
import { bindInstance, PrefabInstance } from './prefabInstance';
import { newEntityId } from './saveRecord';
import { MakeHeavyObstaclePhysics } from './standardcomponents';
import { watchTileActivity } from './tileActivity';
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
export interface ChesspieceRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { chesspiece?: ChesspieceSaveState; submersible?: SubmersibleSaveState };
}
export interface ChesspieceWorld extends ToolMouseTargetWorld {
  scheduler: GameTimeScheduler;
  tickingarea?: TileStateQuery;
  physics?: World;
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
  /** submersible.lua force_no_repositioning, carried for OnSave until the component has behaviour. */
  readonly savedSubmersible: SubmersibleSaveState;

  constructor(position: THREE.Vector3, world: ChesspieceWorld, saved?: ChesspieceRecord) {
    // fn: SetBank("chesspiece"), SetBuild("swap_chesspiece_malbatross_marble"), PlayAnimation("idle") without looping.
    super(CHESSPIECE_MALBATROSS_MARBLE_ID, new SpriteState({ name: 'idle', billboard: true }),
      Transform.stationary());
    this.setPosition(position.x, 0, position.z);
    this.savedSubmersible = saved?.components.submersible ?? { force_no_repositioning: false };
    this.sprite.playOnce('idle');
    MakeHeavyObstaclePhysics(this, PHYSICS_RADIUS);
    this.physicsRadiusOverride = PHYSICS_RADIUS;
    if (world.physics) this.bindPhysics(world.physics);
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

  /** equippable.lua's wetness check; this port has no moisture on the piece. */
  GetIsWet(): boolean { return false; }

  /** onworkfinished without the creature branch: DropLoot, collapse_small with the stone material, Remove. */
  private onworkfinished(): void {
    this.components.lootdropper!.DropLoot();
    this.worldServices?.fx?.collapse?.('small', this.position, 'stone');
    this.remove();
  }
}

/** The world's marble malbatross sculptures: their collection, injected world and shared art. */
export class ChesspieceManager {
  private readonly displays: PrefabDisplayGroup;
  private readonly world: ChesspieceWorld;
  private readonly resources = new SpriteResources();
  private readonly pieces = new Set<ChesspieceInstance>();
  private disposed = false;

  /** `displays` is the display-layer owner of the pieces' scene membership, injected and disposed by the application. */
  constructor(displays: PrefabDisplayGroup, world: ChesspieceWorld) {
    this.displays = displays; this.world = world;
  }

  /** SpawnPrefab, then OnLoad: materialid can only name the marble this prefab already has, so the clip stays `idle`. */
  spawn(position: THREE.Vector3, saved?: ChesspieceRecord): ChesspieceInstance {
    if (this.disposed) throw new Error('Chess pieces have been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid chess piece position');
    const instance = new ChesspieceInstance(position, this.world, saved);
    instance.entityId = saved?.id ?? newEntityId();
    const display = this.displays.add({ root: instance.transform.model, name: CHESSPIECE_MALBATROSS_MARBLE_ID, status: instance.status, sprite: instance.sprite, light: instance.light,
      archive: this.resources.archive({ animationArchive: 'chesspiece.zip', buildArchives: ['swap_chesspiece_malbatross_marble.zip'], bank: 'chesspiece' },
        { instancedAnimations: 'all', staticBillboard: true }) });
    bindInstance(display.model, instance);
    new ToolMouseTarget(actionEntity(display.model, CHESSPIECE_MALBATROSS_MARBLE_ID), instance, instance.components.workable, this.world.handEquipment);
    this.pieces.add(instance);
    const stopActivity = watchTileActivity(display.model, this.world.tickingarea, active => instance.setActive(active));
    instance.onRemove(() => { stopActivity(); this.pieces.delete(instance); });
    return instance;
  }

  update(dt: number): void {
    if (!this.disposed) this.displays.update(dt);
  }

  get renderEntities() { return this.displays.renderEntities; }

  /** onsave writes materialid; submersible:OnSave its flag; workable.savestate is false. */
  exportRecords(): ChesspieceRecord[] {
    return [...this.pieces].map(piece => ({ id: String(piece.entityId),
      transform: { position: [piece.position.x, 0, piece.position.z], rotationY: 0 },
      components: { chesspiece: { materialid: CHESSPIECE_MARBLE_MATERIAL_ID }, submersible: { ...piece.savedSubmersible } },
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const piece of [...this.pieces]) piece.remove();
    // Every piece's display is released above, before the shared resources.
    this.resources.dispose();
  }
}
