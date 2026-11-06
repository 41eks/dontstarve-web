import * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { MakeHeavyObstaclePhysics } from './standardcomponents';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { actionEntity } from './actionEntity';
import { addComponent } from './components';
import { Transform } from './transform';
import type { SpawnGroundItem } from './groundPrefab';
import catalog from './groundItems.json' with { type: 'json' };
import { PlaySound } from './sound';

export const CAVEIN_BOULDER_ID = 'cavein_boulder' as const;
/** cavein_boulder.lua OnSave: symbol variation and the ground/raised formation pose. */
export interface CaveinBoulderSave { variation: number; raised?: true; formed?: true }

const NUM_VARIATIONS = 8;
const PHYSICS_RADIUS = .75;
/** tuning.lua CAVEIN_BOULDER_MINE. */
const CAVEIN_BOULDER_MINE = 3;

SetSharedLootTable(CAVEIN_BOULDER_ID, [['rocks', 1], ['rocks', 1], ['rocks', .4], ['flint', .1]]);

export interface CaveinBoulderWorld extends ToolMouseTargetWorld {
  /** lootdropper:SpawnLootPrefab; the loot's display loads its art. */
  spawnGroundItem: SpawnGroundItem;
}

interface Worker { sg?: { HasStateTag(tag: string): boolean }; getPosition?(): { x: number; z: number } }

/**
 * cavein_boulder.lua fn, for a boulder standing in the world: carrying, falling, wobbling and the formation's
 * entity tracking are not ported.
 */
export class CaveinBoulderInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { lootdropper: LootDropper };
  variation = 1;
  raised?: true;
  formed?: true;

  constructor(world: CaveinBoulderWorld) {
    super(CAVEIN_BOULDER_ID, new SpriteState({ name: 'idle', billboard: true }), Transform.stationary());
    this.sprite.playOnce('idle');
    this.addTag('heavy');
    this.addTag('boulder');
    this.addTag('caveindebris');
    const lootdropper = new LootDropper(this, (loot, position) => world.spawnGroundItem(
      { ...catalog.items[loot as keyof typeof catalog.items], itemId: loot, count: 1 },
      new THREE.Vector3(position.x, position.y, position.z), { fling: true }));
    lootdropper.SetChanceLootTable(CAVEIN_BOULDER_ID);
    Object.assign(this.components, { lootdropper });
    const workable = addComponent(this as CaveinBoulderInstance, 'workable');
    workable.SetWorkAction('MINE');
    workable.SetWorkLeft(CAVEIN_BOULDER_MINE);
    workable.SetOnFinishCallback(OnWorked);
    SetVariation(this, 1 + Math.floor(Math.random() * NUM_VARIATIONS));
    // The variation is saved as rolled, 1 included; the save format checks it is within 1..8.
    this.OnSave = (_inst, data) => {
      data.caveinBoulder = { variation: this.variation, ...this.raised && { raised: true },
        ...this.formed && !this.raised && { formed: true } } satisfies CaveinBoulderSave;
    };
    this.OnLoad = (_inst, data) => OnPreLoad(this, data.caveinBoulder);
  }
}

/** cavein_boulder.lua OnWorked: rock_break_fx has no art, so its local proxy only plays this sound. */
function OnWorked(inst: CaveinBoulderInstance, worker: Worker): void {
  PlaySound('dontstarve/wilson/rock_break', inst.position);
  const { lootdropper } = inst.components;
  if (inst.raised) lootdropper.DropLoot(new THREE.Vector3(inst.position.x, 2, inst.position.z));
  else if (inst.formed && worker.sg?.HasStateTag('working') && worker.getPosition) {
    const target = worker.getPosition();
    // LaunchAt(loot, inst, worker, 1, 1).
    for (const loot of lootdropper.GenerateLoot()) lootdropper.SpawnLootPrefab(loot)?.PushEvent('launch', {
      angle: Math.atan2(target.z - inst.position.z, target.x - inst.position.x) + (Math.random() * 2 - 1) * Math.PI / 6,
      height: 1, speed: { min: 1, range: 2 }, ySpeed: { min: 6, range: 2 },
    });
  } else lootdropper.DropLoot(inst.position);
  inst.remove();
}

/** cavein_boulder.lua SetVariation: variation 1 is the build's own swap_boulder symbol. */
function SetVariation(inst: CaveinBoulderInstance, variation: number): void {
  const overridden = inst.variation > 1;
  inst.variation = variation;
  if (variation > 1) inst.sprite.setSymbolOverride('swap_boulder', 'swap_cavein_boulder.zip', `swap_boulder${variation}`);
  // ClearOverrideSymbol: back to the build's own symbol.
  else if (overridden) inst.sprite.setSymbolOverride('swap_boulder', 'swap_cavein_boulder.zip', 'swap_boulder');
}

/** cavein_boulder.lua SetRaised(inst, true) for a boulder in the world, and its UpdateActions. */
function SetRaised(inst: CaveinBoulderInstance): void {
  if (inst.raised) return;
  inst.raised = true;
  inst.sprite.playOnce('idle_raised');
  inst.components.workable!.SetWorkable(false);
}

/** cavein_boulder.lua OnPreLoad; the falling position is not ported. */
function OnPreLoad(inst: CaveinBoulderInstance, data: CaveinBoulderSave | undefined): void {
  SetVariation(inst, Math.floor(data?.variation ?? 1 + Math.random() * NUM_VARIATIONS));
  if (data?.raised) SetRaised(inst);
  if (data?.formed || data?.raised) inst.formed = true;
}

/** The cavein_boulder Prefab; its dust FX prefabs are not ported. */
export function caveinBoulderPrefabs(world: CaveinBoulderWorld): Readonly<Record<typeof CAVEIN_BOULDER_ID, PrefabEntityDefinition<CaveinBoulderInstance>>> {
  return {
    [CAVEIN_BOULDER_ID]: {
      fn: () => new CaveinBoulderInstance(world),
      assets: { animationArchive: 'cavein_boulder.zip', buildArchives: ['swap_cavein_boulder.zip'], bank: 'cavein_boulder' },
      assetOptions: { instancedAnimations: 'all' },
      physics: { make: MakeHeavyObstaclePhysics, radius: PHYSICS_RADIUS },
      onSpawned: inst => { new ToolMouseTarget(actionEntity(inst.transform.model, CAVEIN_BOULDER_ID), inst, inst.components.workable!, world.handEquipment); },
    },
  };
}
