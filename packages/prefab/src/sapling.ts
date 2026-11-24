import { definePrefabIds } from './prefabRegistration';
import { addComponent } from './components';
import { PrefabInstance, POPULATING, type PrefabEntityDefinition } from './prefabInstance';
import { SpriteState } from '@dontstarve-web/display';
import { Pickable } from './components/pickable';
import { Workable } from '../../componets/src/workable';
import { Witherable } from '../../componets/src/witherable';
import { LootDropper } from '../../componets/src/lootdropper';
import { BurnableBinding } from './treeFire';
import { DefaultBurnFn, DefaultExtinguishFn, DefaultBurntFn, MakeNoGrowInWinter } from './standardcomponents';
import { TILE_SIZE } from './tile';
import { groundLootSpawner } from './groundPrefab';
import { SpringGrowthMod } from './simutil';
import type { PlantPrefabWorld } from './worldContext';
import type { Propagator } from '../../componets/src/propagator';
import type { Burnable } from '../../componets/src/burnable';

export const SAPLING_PREFABS = ['sapling', 'sapling_moon'] as const;
export type SaplingPrefabId = (typeof SAPLING_PREFABS)[number];
/** TUNING.SAPLING_REGROW_TIME = total_day_time * 4. */
export const SAPLING_REGROW_TIME = 4 * 480;

/** sapling.lua's inst, with the components its fn adds. */
export class SaplingInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    pickable: Pickable;
    burnable: Burnable;
    propagator: Propagator;
    lootdropper: LootDropper;
    witherable: Witherable;
  };
}

function ontransplantfn(inst: SaplingInstance): void {
  inst.components.pickable.MakeEmpty();
}

function dig_up(inst: SaplingInstance): void {
  const { pickable, witherable } = inst.components,
    lootdropper = inst.components.lootdropper!;
  if (pickable.canBePicked) {
    lootdropper.SpawnLootPrefab(pickable.product!);
  }
  lootdropper.SpawnLootPrefab(witherable?.IsWithered() ? 'twigs' : `dug_${inst.prefab}`);
  inst.remove();
}

function onpickedfn(inst: SaplingInstance): void {
  inst.AnimState.PlayAnimation('picked', false);
}

function onregenfn(inst: SaplingInstance): void {
  inst.AnimState.PlayAnimation('grow');
  inst.AnimState.PushAnimation('sway', true);
}

function makeemptyfn(inst: SaplingInstance): void {
  if (!POPULATING && (inst.components.witherable?.IsWithered() || inst.sprite.currentAnimation === 'idle_dead')) {
    inst.AnimState.PlayAnimation('dead_to_empty');
    inst.AnimState.PushAnimation('empty', false);
  } else {
    inst.AnimState.PlayAnimation('empty');
  }
}

function makebarrenfn(inst: SaplingInstance, wasempty: boolean): void {
  if (!POPULATING && inst.components.witherable?.IsWithered()) {
    inst.AnimState.PlayAnimation(wasempty ? 'empty_to_dead' : 'full_to_dead');
    inst.AnimState.PushAnimation('idle_dead', false);
  } else {
    inst.AnimState.PlayAnimation('idle_dead');
  }
}

/**
 * sapling.lua sapling_common(inst, is_moon): bank and build are sapling_moon for the moon sapling; dig_up gives
 * dug_<prefab>. Not ported: MakeHauntableIgnite, MakeWaxablePlant, halloweenmoonmutable and the lunarthrall herd save.
 */
function sapling_common(prefab: SaplingPrefabId, world: PlantPrefabWorld): SaplingInstance {
  const inst = new SaplingInstance(prefab, new SpriteState({ name: 'sway', billboard: true }));
  inst.BindScheduler(world.scheduler);
  // DEPLOYSPACING_RADIUS[DEPLOYSPACING.MEDIUM] / 2.
  inst.deploySmartRadius = 0.5 * (TILE_SIZE / 4);
  inst.addTag('plant');
  inst.addTag('renewable');
  inst.addTag('silviculture');
  inst.addTag('lunarplant_target');

  inst.sprite.setFrameAt(Math.random());

  const pickable = addComponent(
    inst,
    'pickable',
    Pickable,
    'twigs',
    SAPLING_REGROW_TIME,
    1,
    () => onpickedfn(inst),
    () => onregenfn(inst),
    undefined,
    {
      scheduler: world.scheduler,
      growthDuration: SpringGrowthMod(inst, world.getWatchWorldContent),
      onEmpty: () => makeemptyfn(inst),
      onTransplant: () => ontransplantfn(inst),
      onBarren: wasempty => makebarrenfn(inst, wasempty),
    },
  );
  pickable.picksound = 'dontstarve/wilson/harvest_sticks';

  addComponent(
    inst,
    'witherable',
    Witherable,
    pickable,
    world.scheduler,
    () => world.getLocalTemperature?.(inst.position) ?? 20,
    world.rain,
  );
  addComponent(inst, 'lootdropper', LootDropper, groundLootSpawner(world));

  const workable = addComponent(inst, 'workable', Workable);
  workable.SetWorkAction('DIG');
  workable.SetOnFinishCallback(dig_up);
  workable.SetWorkLeft(1);

  // MakeMediumBurnable + MakeSmallPropagator.
  const burn = new BurnableBinding(
    inst,
    {
      propagator: 'small',
      burnTime: 20,
      fxLevel: 3,
      onIgnite: () => DefaultBurnFn(inst),
      onExtinguish: () => DefaultExtinguishFn(inst),
      onBurnt: () => DefaultBurntFn(inst, world),
    },
    world,
  );
  inst.onRemove(() => burn.dispose());
  MakeNoGrowInWinter(inst, world.getWatchWorldContent);
  return inst;
}

/** sapling.lua: Prefab("sapling", fn) and Prefab("sapling_moon", moon_fn). */
export function saplingPrefabs(
  world: PlantPrefabWorld,
): Readonly<Record<SaplingPrefabId, PrefabEntityDefinition<SaplingInstance>>> {
  const prefab = (id: SaplingPrefabId): PrefabEntityDefinition<SaplingInstance> => ({
    fn: () => sapling_common(id, world),
    assets: { animationArchive: `${id}.zip`, buildArchives: [`${id}.zip`], bank: id },
    assetOptions: { instancedAnimations: 'all', staticBillboard: true },
    rayTestOnBB: true,
    minimapIcon: 'sapling.png',
  });
  return { sapling: prefab('sapling'), sapling_moon: prefab('sapling_moon') };
}

export const saplingRegistration = {
  create: saplingPrefabs,
  families: { saplings: definePrefabIds(SAPLING_PREFABS, true) },
};
