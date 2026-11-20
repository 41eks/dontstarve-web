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

export const MONKEYTAIL_ID = 'monkeytail' as const;
export const MONKEYTAIL_REGROW_TIME = 3 * 480;

/** monkeytail.lua's inst, with the components its fn adds. */
export class MonkeytailInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    pickable: Pickable;
    burnable: Burnable;
    propagator: Propagator;
    lootdropper: LootDropper;
    witherable: Witherable;
  };
}

function dig_up(inst: MonkeytailInstance): void {
  const { pickable, witherable } = inst.components,
    lootdropper = inst.components.lootdropper!;
  if (pickable.canBePicked) {
    lootdropper.SpawnLootPrefab(pickable.product!);
  }
  lootdropper.SpawnLootPrefab(witherable?.IsWithered() ? 'cutreeds' : 'dug_monkeytail');
  inst.remove();
}

function onregenfn(inst: MonkeytailInstance): void {
  inst.AnimState.PlayAnimation('grow');
  inst.AnimState.PushAnimation('idle', true);
}

function makeemptyfn(inst: MonkeytailInstance): void {
  if (!POPULATING && (inst.components.witherable?.IsWithered() || inst.sprite.currentAnimation === 'idle_dead')) {
    inst.AnimState.PlayAnimation('dead_to_empty');
    inst.AnimState.PushAnimation('picked', false);
  } else {
    inst.AnimState.PlayAnimation('picked');
  }
}

function makebarrenfn(inst: MonkeytailInstance, wasempty: boolean): void {
  if (!POPULATING && inst.components.witherable?.IsWithered()) {
    inst.AnimState.PlayAnimation(wasempty ? 'empty_to_dead' : 'full_to_dead');
    inst.AnimState.PushAnimation('idle_dead', false);
  } else {
    inst.AnimState.PlayAnimation('idle_dead');
  }
}

function onpickedfn(inst: MonkeytailInstance): void {
  inst.SoundEmitter!.PlaySound('dontstarve/wilson/pickup_reeds');
  inst.AnimState.PlayAnimation('picking');
  if (inst.components.pickable.IsBarren()) {
    inst.AnimState.PushAnimation('empty_to_dead', false);
    inst.AnimState.PushAnimation('idle_dead', false);
  } else {
    inst.AnimState.PushAnimation('picked', false);
  }
}

function ontransplantfn(inst: MonkeytailInstance): void {
  inst.components.pickable.MakeBarren();
}

/**
 * monkeytail.lua fn: wild reeds regrow indefinitely; transplanted ones go barren and need fertilizer. Not ported:
 * SetMultColour, fuel, MakeWaxablePlant and MakeHauntableIgnite.
 */
function fn(world: PlantPrefabWorld): MonkeytailInstance {
  const inst = new MonkeytailInstance(MONKEYTAIL_ID, new SpriteState({ name: 'idle', billboard: true }));
  inst.AddSoundEmitter();
  inst.BindScheduler(world.scheduler);
  inst.deploySmartRadius = 1.5;
  inst.addTag('plant');
  inst.addTag('silviculture');
  inst.addTag('witherable');

  inst.sprite.setFrameAt(Math.random());

  // TUNING.MONKEYTAIL_CYCLES + math.random(TUNING.MONKEYTAIL_CYCLES_VAR).
  const pickable = addComponent(
    inst,
    'pickable',
    Pickable,
    'cutreeds',
    MONKEYTAIL_REGROW_TIME,
    1,
    () => onpickedfn(inst),
    () => onregenfn(inst),
    undefined,
    {
      scheduler: world.scheduler,
      growthDuration: SpringGrowthMod(inst, world.getWatchWorldContent),
      maxCycles: 5 + Math.floor(Math.random() * 3),
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

  // MakeSmallBurnable(inst, TUNING.SMALL_FUEL) + MakeSmallPropagator.
  const burn = new BurnableBinding(
    inst,
    {
      propagator: 'small',
      burnTime: 15,
      fxLevel: 2,
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

/** monkeytail.lua's Prefab("monkeytail", fn, assets). */
export function monkeytailPrefabs(
  world: PlantPrefabWorld,
): Readonly<Record<typeof MONKEYTAIL_ID, PrefabEntityDefinition<MonkeytailInstance>>> {
  return {
    [MONKEYTAIL_ID]: {
      fn: () => fn(world),
      assets: { animationArchive: 'grass.zip', buildArchives: ['reeds_monkeytails.zip'], bank: 'grass' },
      assetOptions: { instancedAnimations: 'all', staticBillboard: true },
    },
  };
}
