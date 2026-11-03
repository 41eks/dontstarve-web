import type { PrefabEntityDefinition } from './prefabInstance';
import { Workable } from '../../componets/src/workable';
import { DefaultBurnFn, DefaultExtinguishFn, DefaultBurntFn, MakeNoGrowInWinter } from './standardcomponents';
import { Pickable } from './components/pickable';
import { plantEntityDefinition, PickablePlantInstance, type PickablePlantContext, type PickablePlantWorld, type PickablePlantDefinition } from './pickablePlant';

export const BERRYBUSH_ID = 'berrybush' as const;
export const BERRYBUSH_REGROW_TIME = 3 * 480;
// Maximum before the fifth (final) transplanted pick: 3 days + 4 half-days + 2 days variance.
export const BERRYBUSH_MAX_REGROW_TIME = BERRYBUSH_REGROW_TIME + 4 * 240 + 960;
export const BERRYBUSH_SKINS = ['berrybush_cawnival', 'berrybush_mystical', 'berrybush_swamp'] as const;
const BERRY_LAYERS = ['berries', 'berriesmore', 'berriesmost'] as const;

/** berrybush.lua getregentimefn_normal: evaluate randomness only when starting a new regrowth task. */
export function berrybushRegrowTime(pickable: Pickable): number {
  const maximum = pickable.maximumCycles!;
  return BERRYBUSH_REGROW_TIME + 240 * Math.max(0, maximum - (pickable.cyclesLeft ?? maximum)) + 960 * Math.random();
}

/** berrybush.lua normal_postinit and its source callbacks. */
export class BerrybushInstance extends PickablePlantInstance {
  constructor(context: PickablePlantContext) {
    super(BERRYBUSH_DEFINITION, context);
    new Pickable(this, 'berries', BERRYBUSH_REGROW_TIME, 1, () => onpickedfn(this), () => makefullfn(this), context.saved?.components.pickable, {
      scheduler: context.scheduler, growthDuration: context.growthDuration, maxCycles: 4 + Math.floor(Math.random() * 2),
      getRegenTime: berrybushRegrowTime, onTransplant: () => ontransplantfn(this),
      onBarren: () => makebarrenfn(this), onEmpty: () => makeemptyfn(this),
    });
    this.bindBurnable({ propagator: 'medium', burnTime: 30, fxLevel: 4,
      onIgnite: () => DefaultBurnFn(this), onExtinguish: () => DefaultExtinguishFn(this), onBurnt: () => DefaultBurntFn(this, context.world) });
    const workable = this.components.workable = new Workable(this);
    workable.SetWorkAction('DIG'); workable.SetWorkLeft(1); workable.SetOnFinishCallback(dig_up_normal);
    this.bindWitherable();
    MakeNoGrowInWinter(this, context.getWatchWorldContent);
  }
  override initialize(): void { setberries(this, berryPercent(this)); }
}

function berryPercent(inst: PickablePlantInstance): number | undefined {
  const pickable = inst.components.pickable;
  return pickable.canBePicked ? (pickable.cyclesLeft ?? pickable.maximumCycles!) / pickable.maximumCycles! : undefined;
}
function setberries(inst: PickablePlantInstance, percent?: number): void {
  const layer = percent === undefined ? undefined : percent >= .9 ? 'berriesmost' : percent >= .33 ? 'berriesmore' : 'berries';
  for (const name of BERRY_LAYERS) {
    if (name === layer) inst.sprite.showLayer(name); else inst.sprite.hideLayer(name);
  }
}
function onpickedfn(inst: PickablePlantInstance): void {
  if (inst.components.pickable.IsBarren()) { inst.play(['idle_to_dead', 'dead']); setberries(inst); }
  else inst.play(['picked', 'idle'], false, () => setberries(inst));
}
function makefullfn(inst: PickablePlantInstance): void {
  inst.play(['grow', 'idle'], true); setberries(inst, berryPercent(inst));
}
function makeemptyfn(inst: PickablePlantInstance): void {
  if (inst.hasTag('withered') || inst.sprite.currentAnimation === 'dead') inst.play(['dead_to_idle', 'idle']);
  else inst.play(['idle'], true);
  setberries(inst);
}
function makebarrenfn(inst: PickablePlantInstance): void {
  inst.play(inst.hasTag('withered') || inst.sprite.currentAnimation === 'idle' ? ['idle_to_dead', 'dead'] : ['dead']);
  setberries(inst);
}
function ontransplantfn(inst: PickablePlantInstance): void {
  inst.play(['dead']); setberries(inst); inst.components.pickable.MakeBarren();
}
function dig_up_normal(inst: PickablePlantInstance): void {
  const { pickable, witherable, lootdropper } = inst.components;
  if (witherable?.IsWithered() || pickable.IsBarren()) {
    lootdropper.SpawnLootPrefab('twigs', inst.position); lootdropper.SpawnLootPrefab('twigs', inst.position);
  } else {
    if (pickable.canBePicked) lootdropper.SpawnLootPrefab('berries', inst.position);
    lootdropper.SpawnLootPrefab('dug_berrybush', inst.position, inst.skinId ? `dug_${inst.skinId}` : undefined);
  }
  inst.remove();
}

export const BERRYBUSH_DEFINITION: PickablePlantDefinition = {
  createInstance: context => new BerrybushInstance(context),
  prefab: BERRYBUSH_ID, animArchive: 'berrybush.zip', buildArchive: 'berrybush.zip',
  minimapIcon: 'berrybush.png',
  archiveSprite: { bank: 'berrybush', instancedAnimations: 'all' },
  tags: ['bush', 'plant', 'renewable', 'lunarplant_target', 'witherable', 'SnowCovered', 'blocker'],
  idle: { name: 'idle', randomFrame: true },
  empty: { name: 'idle', frame: 'first' }, barren: 'dead', deploySmartRadius: 3,
  physicsRadius: .1, snowCovered: true,
  skins: BERRYBUSH_SKINS,
};

/** The normal berrybush branch; berrybush2 and juicy bushes are separate source prefabs. */
export function berrybushPrefabs(world: PickablePlantWorld): Readonly<Record<typeof BERRYBUSH_ID, PrefabEntityDefinition<PickablePlantInstance>>> {
  return { [BERRYBUSH_ID]: plantEntityDefinition(BERRYBUSH_DEFINITION, world) };
}
