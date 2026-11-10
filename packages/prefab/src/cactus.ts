import { addComponent } from './components';
import type { PrefabEntityDefinition } from './prefabInstance';
import { Transform } from './transform';
import { SpriteState } from '@dontstarve-web/display';
import { Pickable } from './components/pickable';
import { BurnableBinding } from './treeFire';
import { DefaultBurnFn, DefaultExtinguishFn, DefaultBurntFn, MakeObstaclePhysics } from './standardcomponents';
import { WorldContentKey, type SeasonState, type WorldContentSignal } from '@dontstarve-web/signals';
import type { PickDoer } from '@dontstarve-web/stategraphs/pick';
import { PickablePlantInstance, SpringGrowthMod, type PickablePlantRecord, type PickablePlantWorld } from './pickablePlant';

export const CACTUS_ID = 'cactus' as const;
export const OASIS_CACTUS_ID = 'oasis_cactus' as const;
export const CACTUS_IDS = [CACTUS_ID, OASIS_CACTUS_ID] as const;
export type CactusId = typeof CACTUS_IDS[number];
export const CACTUS_FLOWER_ID = 'cactus_flower';
/** tuning.lua CACTUS_DAMAGE = wilson_health * .04. */
export const CACTUS_DAMAGE = 150 * .04;
/** tuning.lua CACTUS_REGROW_TIME = total_day_time * 4. */
export const CACTUS_REGROW_TIME = 4 * 480;

export type CactusRecord = PickablePlantRecord;

/** cactus.lua's fields on the inst. */
export class CactusInstance extends PickablePlantInstance {
  /** inst.has_flower: not saved; OnEntityWake sets it from the season. */
  has_flower = false;
  /** TheWorld.state.season, as this cactus's callbacks read it. */
  season?: WorldContentSignal<SeasonState>;
  /** SpawnPrefab and DoDropPhysics for the flower. */
  world!: PickablePlantWorld;
}

const issummer = (inst: CactusInstance) => inst.season?.peek().season === 'summer';

function ontransplantfn(inst: CactusInstance): void {
  inst.components.pickable.MakeEmpty();
}

function onpickedfn(inst: CactusInstance, doer?: PickDoer): void {
  inst.physics.SetActive(false);
  inst.AnimState.PlayAnimation(inst.has_flower ? 'picked_flower' : 'picked');
  inst.AnimState.PushAnimation('empty', true);
  const picker = doer?.picker;
  if (picker) {
    const { combat, inventory } = picker.components;
    if (combat && !inventory?.EquipHasTag('bramble_resistant') && !picker.hasTag('shadowminion')) {
      combat.GetAttacked(inst, CACTUS_DAMAGE);
      picker.PushEvent?.('thorns');
    }
    if (inst.has_flower) {
      // You get a cactus flower, yay.
      const loot = inst.world.spawnItem?.({ itemId: CACTUS_FLOWER_ID, count: 1 });
      if (loot) {
        if (inventory?.GiveItem) inventory.GiveItem(loot, inst.position.clone());
        else inst.world.dropItem?.(loot, inst.position.clone());
      }
    }
  }
  inst.has_flower = false;
}

function onregenfn(inst: CactusInstance): void {
  if (issummer(inst)) {
    inst.AnimState.PlayAnimation('grow_flower');
    inst.AnimState.PushAnimation('idle_flower', true);
    inst.has_flower = true;
  } else {
    inst.AnimState.PlayAnimation('grow');
    inst.AnimState.PushAnimation('idle', true);
    inst.has_flower = false;
  }
  inst.physics.SetActive(true);
}

function makeemptyfn(inst: CactusInstance): void {
  inst.physics.SetActive(false);
  inst.AnimState.PlayAnimation('empty', true);
  inst.has_flower = false;
}

function OnEntityWake(inst: CactusInstance): void {
  if (inst.components.pickable.canBePicked) {
    inst.has_flower = issummer(inst);
    inst.AnimState.PlayAnimation(inst.has_flower ? 'idle_flower' : 'idle', true);
  } else {
    inst.AnimState.PlayAnimation('empty', true);
    inst.has_flower = false;
  }
}

/**
 * cactus.lua MakeCactus(name) cactusfn: picking hurts a picker without bramble_resistant equipment, and a summer cactus
 * also gives its flower. MakeObstaclePhysics(.3) is the prefab's `physics`. Not ported: AddToRegrowthManager and
 * MakeHauntableIgnite.
 */
function cactusfn(prefab: CactusId, world: PickablePlantWorld): CactusInstance {
  const inst = new CactusInstance(prefab, new SpriteState({ name: 'idle', billboard: true }), Transform.stationary());
  inst.BindScheduler(world.scheduler);
  inst.world = world;
  inst.season = world.getWatchWorldContent?.(WorldContentKey.Season, stop => inst.onRemove(stop));
  inst.addTag('plant');
  inst.addTag('thorny');

  inst.sprite.setFrameAt(Math.random());

  const pickable = addComponent(inst, 'pickable', Pickable, 'cactus_meat', CACTUS_REGROW_TIME, 1, doer => onpickedfn(inst, doer), () => onregenfn(inst), undefined, {
    scheduler: world.scheduler, growthDuration: SpringGrowthMod(inst, world.getWatchWorldContent),
    onEmpty: () => makeemptyfn(inst), onTransplant: () => ontransplantfn(inst),
  });
  pickable.picksound = 'dontstarve/wilson/harvest_sticks';

  // MakeLargeBurnable + MakeMediumPropagator.
  const burn = new BurnableBinding(inst, { propagator: 'medium', burnTime: 30, fxLevel: 4,
    onIgnite: () => DefaultBurnFn(inst), onExtinguish: () => DefaultExtinguishFn(inst), onBurnt: () => DefaultBurntFn(inst, world) }, world);
  inst.onRemove(() => burn.dispose());
  return inst;
}

/** cactus.lua: MakeCactus("cactus") and MakeCactus("oasis_cactus"); bank and build share the name. */
export function cactusPrefabs(world: PickablePlantWorld): Readonly<Record<CactusId, PrefabEntityDefinition<CactusInstance>>> {
  const prefab = (id: CactusId): PrefabEntityDefinition<CactusInstance> => ({
    fn: () => cactusfn(id, world),
    assets: { animationArchive: `${id}.zip`, buildArchives: [`${id}.zip`], bank: id },
    assetOptions: { instancedAnimations: 'all', staticBillboard: true },
    physics: { make: MakeObstaclePhysics, radius: .3 },
    minimapIcon: `${id}.png`,
    // inst.OnEntityWake: a spawned or loaded cactus wakes with the season's flower.
    onSpawned: OnEntityWake,
  });
  return { cactus: prefab(CACTUS_ID), oasis_cactus: prefab(OASIS_CACTUS_ID) };
}
