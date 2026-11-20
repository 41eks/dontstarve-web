import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { SpriteState } from '@dontstarve-web/display';
import { Pickable } from './components/pickable';
import { BurnableBinding } from './treeFire';
import { DefaultBurnFn, DefaultExtinguishFn, DefaultBurntFn, MakeNoGrowInWinter } from './standardcomponents';
import { SpringGrowthMod } from './simutil';
import type { PlantPrefabWorld } from './worldContext';
import type { Propagator } from '../../componets/src/propagator';
import type { Burnable } from '../../componets/src/burnable';

export const LICHEN_ID = 'lichen' as const;
/** TUNING.LICHEN_REGROW_TIME: total_day_time * 5. */
export const LICHEN_REGROW_TIME = 5 * 480;
/** AnimState:SetBank / SetBuild("algae_bush"). */
export const LICHEN_ARCHIVE = 'algae_bush.zip';

/** lichen.lua's inst, with the components its fn adds. */
export class LichenInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    pickable: Pickable;
    burnable: Burnable;
    propagator: Propagator;
  };
}

function onpickedfn(inst: LichenInstance): void {
  inst.SoundEmitter!.PlaySound('dontstarve/wilson/pickup_lichen');
  inst.AnimState.PlayAnimation('picking');
  inst.AnimState.PushAnimation('picked', false);
}

function onregenfn(inst: LichenInstance): void {
  inst.AnimState.PlayAnimation('grow');
  inst.AnimState.PushAnimation('idle', true);
}

function makeemptyfn(inst: LichenInstance): void {
  inst.AnimState.PlayAnimation('picked');
}

/**
 * lichen.lua fn: PICK cutlichen, small burnable and propagator, MakeNoGrowInWinter. No workable, so it cannot be dug.
 * MakeHauntableIgnite is not ported.
 */
function fn(world: PlantPrefabWorld): LichenInstance {
  const inst = new LichenInstance(LICHEN_ID, new SpriteState({ name: 'idle', billboard: true }));
  inst.AddSoundEmitter();
  inst.BindScheduler(world.scheduler);
  inst.addTag('lichen');

  inst.sprite.setFrameAt(Math.random());
  const color = 0.75 + Math.random() * 0.25;
  inst.sprite.setColour([color, color, color]);

  const pickable = addComponent(
    inst,
    'pickable',
    Pickable,
    'cutlichen',
    LICHEN_REGROW_TIME,
    1,
    () => onpickedfn(inst),
    () => onregenfn(inst),
    undefined,
    {
      scheduler: world.scheduler,
      growthDuration: SpringGrowthMod(inst, world.getWatchWorldContent),
      onEmpty: () => makeemptyfn(inst),
    },
  );
  pickable.picksound = 'dontstarve/wilson/pickup_reeds';

  // MakeSmallBurnable + MakeSmallPropagator.
  const burn = new BurnableBinding(
    inst,
    {
      propagator: 'small',
      burnTime: 10,
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

/** lichen.lua's Prefab("lichen", fn, assets). */
export function lichenPrefabs(
  world: PlantPrefabWorld,
): Readonly<Record<typeof LICHEN_ID, PrefabEntityDefinition<LichenInstance>>> {
  return {
    [LICHEN_ID]: {
      fn: () => fn(world),
      assets: { animationArchive: LICHEN_ARCHIVE, buildArchives: [LICHEN_ARCHIVE], bank: 'algae_bush' },
      // SetMultColour needs the instanced batch's colour attribute.
      assetOptions: { instancedAnimations: 'all', staticBillboard: true, colour: [1, 1, 1] },
      minimapIcon: 'lichen.png',
    },
  };
}
