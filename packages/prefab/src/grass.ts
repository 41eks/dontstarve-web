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
import { groundLootSpawner } from './groundPrefab';
import { SpringGrowthMod } from './simutil';
import type { PlantPrefabWorld } from './worldContext';
import type { Propagator } from '../../componets/src/propagator';
import type { Burnable } from '../../componets/src/burnable';

export const GRASS_ID = 'grass' as const;
export const GRASS_REGROW_TIME = 3 * 480;
/** TUNING.GRASS_CYCLES: picks a transplanted tuft gives before it goes barren. */
export const GRASS_CYCLES = 20;
export const GRASS_ANIM_ARCHIVE = 'grass.zip';
export const GRASS_BUILD_ARCHIVE = 'grass1.zip';

/** grass.lua's inst, with the components its fn adds. */
export class GrassInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    pickable: Pickable;
    burnable: Burnable;
    propagator: Propagator;
    lootdropper: LootDropper;
    witherable: Witherable;
  };
}

function dig_up(inst: GrassInstance): void {
  const { pickable, witherable } = inst.components,
    lootdropper = inst.components.lootdropper!;
  if (pickable.canBePicked) {
    lootdropper.SpawnLootPrefab(pickable.product!);
  }
  lootdropper.SpawnLootPrefab(witherable?.IsWithered() ? 'cutgrass' : 'dug_grass');
  inst.remove();
}

function onregenfn(inst: GrassInstance): void {
  inst.AnimState.PlayAnimation('grow');
  inst.AnimState.PushAnimation('idle', true);
}

function makeemptyfn(inst: GrassInstance): void {
  if (!POPULATING && (inst.components.witherable?.IsWithered() || inst.sprite.currentAnimation === 'idle_dead')) {
    inst.AnimState.PlayAnimation('dead_to_empty');
    inst.AnimState.PushAnimation('picked', false);
  } else {
    inst.AnimState.PlayAnimation('picked');
  }
}

function makebarrenfn(inst: GrassInstance, wasempty: boolean): void {
  if (!POPULATING && inst.components.witherable?.IsWithered()) {
    inst.AnimState.PlayAnimation(wasempty ? 'empty_to_dead' : 'full_to_dead');
    inst.AnimState.PushAnimation('idle_dead', false);
  } else {
    inst.AnimState.PlayAnimation('idle_dead');
  }
}

function onpickedfn(inst: GrassInstance): void {
  inst.SoundEmitter!.PlaySound('dontstarve/wilson/pickup_reeds');
  inst.AnimState.PlayAnimation('picking');
  if (inst.components.pickable.IsBarren()) {
    inst.AnimState.PushAnimation('empty_to_dead', false);
    inst.AnimState.PushAnimation('idle_dead', false);
  } else {
    inst.AnimState.PushAnimation('picked', false);
  }
}

/** The grass gekko morph timers are not ported. */
function ontransplantfn(inst: GrassInstance): void {
  inst.components.pickable.MakeBarren();
}

/**
 * grass.lua grass(name, stage) fn. Not ported: SetFrame / SetMultColour, the gekko morph, MakeHauntableIgnite,
 * MakeWaxablePlant and the lunarthrall herd save.
 */
function fn(world: PlantPrefabWorld): GrassInstance {
  const inst = new GrassInstance(GRASS_ID, new SpriteState({ name: 'idle', billboard: true }));
  inst.AddSoundEmitter();
  inst.BindScheduler(world.scheduler);
  inst.addTag('plant');
  inst.addTag('renewable');
  inst.addTag('silviculture');
  inst.addTag('lunarplant_target');

  const pickable = addComponent(
    inst,
    'pickable',
    Pickable,
    'cutgrass',
    GRASS_REGROW_TIME,
    1,
    () => onpickedfn(inst),
    () => onregenfn(inst),
    undefined,
    {
      scheduler: world.scheduler,
      growthDuration: SpringGrowthMod(inst, world.getWatchWorldContent),
      maxCycles: GRASS_CYCLES,
      onEmpty: () => makeemptyfn(inst),
      onBarren: wasempty => makebarrenfn(inst, wasempty),
      onTransplant: () => ontransplantfn(inst),
    },
  );
  pickable.picksound = 'dontstarve/wilson/pickup_reeds';

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

/** grass.lua's Prefab("grass", fn, assets). */
export function grassPrefabs(
  world: PlantPrefabWorld,
): Readonly<Record<typeof GRASS_ID, PrefabEntityDefinition<GrassInstance>>> {
  return {
    [GRASS_ID]: {
      fn: () => fn(world),
      assets: { animationArchive: GRASS_ANIM_ARCHIVE, buildArchives: [GRASS_BUILD_ARCHIVE], bank: 'grass' },
      assetOptions: { instancedAnimations: 'all', staticBillboard: true },
      minimapIcon: 'grass.png',
    },
  };
}

export const grassRegistration = {
  create: grassPrefabs,
  families: { grasses: definePrefabIds([GRASS_ID], true) },
};
