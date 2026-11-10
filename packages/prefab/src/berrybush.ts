import { addComponent } from './components';
import { POPULATING, type PrefabEntityDefinition } from './prefabInstance';
import { Transform } from './transform';
import { SpriteState, prefabDisplay } from '@dontstarve-web/display';
import { Workable } from '../../componets/src/workable';
import { Witherable } from '../../componets/src/witherable';
import { LootDropper } from '../../componets/src/lootdropper';
import { Pickable } from './components/pickable';
import { BurnableBinding } from './treeFire';
import { reskinTarget } from './reskin_tool';
import { DefaultBurnFn, DefaultExtinguishFn, DefaultBurntFn, MakeNoGrowInWinter, MakeSmallObstaclePhysics, MakeSnowCovered } from './standardcomponents';
import { PickablePlantInstance, plantLootSpawner, SpringGrowthMod, type PickablePlantRecord, type PickablePlantWorld } from './pickablePlant';

export const BERRYBUSH_ID = 'berrybush' as const;
export const BERRYBUSH_ARCHIVE = 'berrybush.zip';
export const BERRYBUSH_REGROW_TIME = 3 * 480;
// Maximum before the fifth (final) transplanted pick: 3 days + 4 half-days + 2 days variance.
export const BERRYBUSH_MAX_REGROW_TIME = BERRYBUSH_REGROW_TIME + 4 * 240 + 960;
export const BERRYBUSH_SKINS = ['berrybush_cawnival', 'berrybush_mystical', 'berrybush_swamp'] as const;
const BERRY_TYPES = ['berries', 'berriesmore', 'berriesmost'] as const;

/** berrybush.lua getregentimefn_normal: evaluate randomness only when starting a new regrowth task. */
export function berrybushRegrowTime(pickable: Pickable): number {
  const maximum = pickable.maximumCycles!;
  return BERRYBUSH_REGROW_TIME + 240 * Math.max(0, maximum - (pickable.cyclesLeft ?? maximum)) + 960 * Math.random();
}

function setberries(inst: PickablePlantInstance, pct?: number): void {
  const berries = pct === undefined ? undefined : pct >= .9 ? 'berriesmost' : pct >= .33 ? 'berriesmore' : 'berries';
  for (const berry_type of BERRY_TYPES) {
    if (berry_type === berries) inst.sprite.showLayer(berry_type); else inst.sprite.hideLayer(berry_type);
  }
}

function makeemptyfn(inst: PickablePlantInstance): void {
  if (POPULATING) {
    inst.AnimState.PlayAnimation('idle', true);
    inst.sprite.setFrameAt(Math.random());
  } else if (inst.hasTag('withered') || inst.sprite.currentAnimation === 'dead') {
    inst.AnimState.PlayAnimation('dead_to_idle');
    inst.AnimState.PushAnimation('idle', false);
  } else inst.AnimState.PlayAnimation('idle', true);
  setberries(inst);
}

/**
 * cancelsetberriesonanimover hides the berries a pending setberriesonanimover would have. Every source path that
 * shows berries before this also plays a clip, so hiding them here keeps the same result.
 */
function makebarrenfn(inst: PickablePlantInstance): void {
  if (!POPULATING && (inst.hasTag('withered') || inst.sprite.currentAnimation === 'idle')) {
    inst.AnimState.PlayAnimation('idle_to_dead');
    inst.AnimState.PushAnimation('dead', false);
  } else inst.AnimState.PlayAnimation('dead');
  setberries(inst);
}

/** The perd spawn is not ported. */
function onpickedfn(inst: PickablePlantInstance): void {
  if (inst.components.pickable.IsBarren()) {
    inst.AnimState.PlayAnimation('idle_to_dead');
    inst.AnimState.PushAnimation('dead', false);
    setberries(inst);
  } else {
    // setberriesonanimover: the picked clip's animover hides the berries. A clip replacing it never sends that
    // animover, as setberries' RemoveEventCallback cancels it.
    inst.sprite.playOnce('picked', () => setberries(inst));
    inst.AnimState.PushAnimation('idle', false);
  }
}

function makefullfn(inst: PickablePlantInstance): void {
  const { pickable } = inst.components;
  let anim = 'idle', berries: number | undefined;
  if (pickable.canBePicked) berries = pickable.cyclesLeft !== undefined ? pickable.cyclesLeft / pickable.maximumCycles! : 1;
  else if (pickable.IsBarren()) anim = 'dead';
  if (anim !== 'idle') inst.AnimState.PlayAnimation(anim);
  else if (POPULATING) {
    inst.AnimState.PlayAnimation('idle', true);
    inst.sprite.setFrameAt(Math.random());
  } else {
    inst.AnimState.PlayAnimation('grow');
    inst.AnimState.PushAnimation('idle', true);
  }
  setberries(inst, berries);
}

function dig_up_normal(inst: PickablePlantInstance): void {
  const { pickable, witherable } = inst.components, lootdropper = inst.components.lootdropper!;
  if (witherable?.IsWithered() || pickable.IsBarren()) {
    lootdropper.SpawnLootPrefab('twigs', inst.position);
    lootdropper.SpawnLootPrefab('twigs', inst.position);
  } else {
    if (pickable.canBePicked) lootdropper.SpawnLootPrefab(pickable.product!, inst.position);
    lootdropper.SpawnLootPrefab(`dug_${inst.prefab}`, inst.position, inst.skinId ? `dug_${inst.skinId}` : undefined);
  }
  inst.remove();
}

function ontransplantfn(inst: PickablePlantInstance): void {
  inst.AnimState.PlayAnimation('dead');
  setberries(inst);
  inst.components.pickable.MakeBarren();
}

/** The save record's skin name, which SpawnSaveRecord applies. */
function OnSave(inst: PickablePlantInstance, data: PickablePlantRecord['components']): void {
  if (inst.skinId) data.plant = { skinId: inst.skinId };
}

function OnLoad(inst: PickablePlantInstance, data: PickablePlantRecord['components']): void {
  const skinId = data.plant?.skinId;
  if (skinId !== undefined && !(BERRYBUSH_SKINS as readonly string[]).includes(skinId)) throw new Error(`Unsupported ${inst.prefab} skin: ${skinId}`);
  inst.skinId = skinId;
}

/**
 * berrybush.lua createbush(name, ...) fn with normal_postinit. Not ported: the perd and its shake, hauntables,
 * MakeWaxablePlant, lunar hail buildup and the lunarthrall herd save.
 */
function fn(world: PickablePlantWorld): PickablePlantInstance {
  const inst = new PickablePlantInstance(BERRYBUSH_ID, new SpriteState({ name: 'idle', billboard: true }), Transform.stationary());
  inst.BindScheduler(world.scheduler);
  inst.deploySmartRadius = 3;
  // MakeSmallObstaclePhysics(inst, .1) is the prefab's `physics`; it adds the blocker tag.
  inst.addTag('blocker');
  inst.addTag('bush');
  inst.addTag('plant');
  inst.addTag('renewable');
  inst.addTag('lunarplant_target');
  inst.addTag('witherable');

  setberries(inst, 1);
  inst.sprite.setFrameAt(Math.random());

  const pickable = addComponent(inst, 'pickable', Pickable, 'berries', BERRYBUSH_REGROW_TIME, 1, () => onpickedfn(inst), undefined, undefined, {
    scheduler: world.scheduler, growthDuration: SpringGrowthMod(inst, world.getWatchWorldContent),
    getRegenTime: berrybushRegrowTime, maxCycles: 4 + Math.floor(Math.random() * 2),
    onEmpty: () => makeemptyfn(inst), onBarren: () => makebarrenfn(inst), onTransplant: () => ontransplantfn(inst),
  });
  pickable.picksound = 'dontstarve/wilson/harvest_berries';
  pickable.makefullfn = () => makefullfn(inst);

  addComponent(inst, 'witherable', Witherable, pickable, world.scheduler, () => world.getLocalTemperature?.(inst.position) ?? 20, world.rain);

  // MakeLargeBurnable + MakeMediumPropagator.
  const burn = new BurnableBinding(inst, { propagator: 'medium', burnTime: 30, fxLevel: 4,
    onIgnite: () => DefaultBurnFn(inst), onExtinguish: () => DefaultExtinguishFn(inst), onBurnt: () => DefaultBurntFn(inst, world) }, world);
  inst.onRemove(() => burn.dispose());

  addComponent(inst, 'lootdropper', LootDropper, plantLootSpawner(world));
  const workable = addComponent(inst, 'workable', Workable);
  workable.SetWorkAction('DIG');
  workable.SetWorkLeft(1);

  MakeSnowCovered(inst, world.getWatchWorldContent);
  MakeNoGrowInWinter(inst, world.getWatchWorldContent);

  // normal_postinit
  workable.SetOnFinishCallback(dig_up_normal);

  inst.OnSave = (_inst, data) => OnSave(inst, data);
  inst.OnLoad = (_inst, data) => OnLoad(inst, data);
  return inst;
}

/** reskin_tool's target, once the bush's display exists. */
function bindReskin(inst: PickablePlantInstance): void {
  inst.reskinTarget = reskinTarget({
    id: String(inst.entityId), prefabId: inst.prefab, instance: inst, display: prefabDisplay(inst.transform.model)!, sprite: inst.sprite,
    position: inst.position, skins: BERRYBUSH_SKINS, isValid: () => !inst.isRemoved, hasTag: tag => inst.hasTag(tag),
  });
}

/** berrybush.lua's createbush("berrybush", ...); berrybush2 and the juicy bush are separate source prefabs. */
export function berrybushPrefabs(world: PickablePlantWorld): Readonly<Record<typeof BERRYBUSH_ID, PrefabEntityDefinition<PickablePlantInstance>>> {
  return {
    [BERRYBUSH_ID]: {
      fn: () => fn(world),
      assets: { animationArchive: BERRYBUSH_ARCHIVE, buildArchives: [BERRYBUSH_ARCHIVE, 'snow.zip'], bank: 'berrybush', hiddenLayers: ['snow'] },
      assetOptions: { instancedAnimations: 'all', staticBillboard: true },
      skins: Object.fromEntries(BERRYBUSH_SKINS.map(skin => [skin, `dynamic/${skin}.zip`])),
      physics: { make: MakeSmallObstaclePhysics, radius: .1 },
      minimapIcon: 'berrybush.png',
      onSpawned: bindReskin,
    },
  };
}
