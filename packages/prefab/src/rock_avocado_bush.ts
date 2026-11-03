import type { PrefabEntityDefinition } from './prefabInstance';
import { Pickable } from './components/pickable';
import { Workable } from '../../componets/src/workable';
import { DefaultExtinguishFn, DefaultBurntFn } from './standardcomponents';
import { Growable } from '../../componets/src/growable';
import { SimpleMagicGrower } from '../../componets/src/simplemagicgrower';
import { plantEntityDefinition, PickablePlantInstance, type PickablePlantContext,
  type PickablePlantWorld, type PickablePlantDefinition, type PickablePlantRecord } from './pickablePlant';

export const ROCK_AVOCADO_BUSH_ID = 'rock_avocado_bush' as const;
export const ROCK_AVOCADO_FRUIT_ID = 'rock_avocado_fruit' as const;
// tuning.lua day_time is the ten daytime segments (300s), not total_day_time (480s).
export const ROCK_AVOCADO_STAGE_TIMES = [600, 180, 900, 300] as const;
const GROW_ANIMS = ['crumble', 'grow1', 'grow2', 'grow3'] as const;

/** rock_avocado_bush.lua: Growable owns stage deadlines; Pickable has no regeneration task. */
export class RockAvocadoBushInstance extends PickablePlantInstance {
  readonly growable: Growable;
  private readonly magicgrower: SimpleMagicGrower;
  constructor(context: PickablePlantContext) {
    super(ROCK_AVOCADO_BUSH_DEFINITION, context);
    new Pickable(this, ROCK_AVOCADO_FRUIT_ID, undefined, 3, () => this.picked(), () => this.regen(), context.saved?.components.pickable, {
      scheduler: context.scheduler, growthDuration: context.growthDuration, maxCycles: 3,
      onTransplant: () => this.components.pickable.MakeBarren(), onBarren: () => this.barren(), onEmpty: () => this.empty(),
    });
    this.bindBurnable({ propagator: 'medium', burnTime: 20, fxLevel: 3,
      onIgnite: () => {}, onExtinguish: () => DefaultExtinguishFn(this), onBurnt: () => this.onBushBurnt() });
    const workable = this.components.workable = new Workable(this);
    workable.SetWorkAction('DIG'); workable.SetWorkLeft(1); workable.SetOnFinishCallback(on_dug_up);
    this.growable = new Growable(context.scheduler, ROCK_AVOCADO_STAGE_TIMES.map((base, index) => ({
      time: () => base + (Math.random() * 2 - 1) * 60,
      fn: () => this.setStage(index + 1),
      growfn: () => this.play([GROW_ANIMS[index], `idle${index + 1}`]),
    })), context.growthDuration);
    this.growable.loopstages = true;
    this.growable.springgrowth = true;
    this.growable.magicgrowable = true;
    this.components.growable = this.growable;
    this.magicgrower = new SimpleMagicGrower(this, this.growable, context.scheduler);
    this.magicgrower.SetLastStage(3);
    this.components.simplemagicgrower = this.magicgrower;
    this.bindWitherable();
  }
  override initialize(): void {
    const saved = this.saveRecord as PickablePlantRecord | undefined;
    if (saved?.components.growable) { if (this.context.saved) this.growable.OnLoad(saved.components.growable); }
    else { this.growable.SetStage(1 + Math.floor(Math.random() * 4)); this.growable.StartGrowing(); }
    if (this.components.pickable.IsBarren() || this.hasTag('withered')) this.barren();
    if (saved?.components.burning) this.onBushBurnt();
  }
  private setStage(stage: number): void {
    const { pickable } = this.components;
    pickable.ChangeProduct(stage === 3 ? ROCK_AVOCADO_FRUIT_ID : undefined);
    if (stage < 3) pickable.canBePicked = false;
    else if (stage === 3 || !pickable.canBePicked) pickable.regen();
    this.play([`idle${stage}`]);
  }
  private picked(): void {
    this.playPickSound('dontstarve/wilson/harvest_berries');
    const animation = this.growable.GetStage() === 3 ? 'picked' : 'crumble';
    this.growable.SetStage(1);
    if (this.components.pickable.IsBarren()) {
      this.play([animation, 'idle1_to_dead1', 'dead1']);
      this.growable.StopGrowing(); this.growable.magicgrowable = false;
    } else this.play([animation, 'idle1']);
    // SetStage leaves the existing growth deadline intact, as in Lua's onpickedfn.
  }
  private regen(): void { if (this.growable.GetStage() < 3) this.growable.SetStage(3); }
  private empty(): void {
    const wasDead = this.sprite.currentAnimation === 'dead1';
    this.growable.SetStage(1); this.growable.StartGrowing(); this.growable.magicgrowable = true;
    this.play(this.hasTag('withered') || wasDead
      ? ['dead1_to_idle1', 'idle1'] : ['idle1']);
  }
  private barren(): void {
    this.growable.SetStage(1); this.growable.StopGrowing(); this.growable.magicgrowable = false;
    this.play(this.hasTag('withered') ? ['idle1_to_dead1', 'dead1'] : ['dead1']);
  }
  private onBushBurnt(): void {
    if (this.growable.GetStage() === 3) for (let i = 0; i < 3; i++) this.components.lootdropper.SpawnLootPrefab(ROCK_AVOCADO_FRUIT_ID);
    this.growable.StopGrowing();
    DefaultBurntFn(this, this.context.world);
  }
  override exportState(): PickablePlantRecord['components'] { return { growable: this.growable.OnSave() }; }
}

function on_dug_up(inst: PickablePlantInstance): void {
  const { pickable, witherable, lootdropper, growable } = inst.components;
  if (witherable?.IsWithered() || pickable.IsBarren()) {
    lootdropper.SpawnLootPrefab('twigs', inst.position); lootdropper.SpawnLootPrefab('twigs', inst.position);
  } else {
    if (growable!.GetStage() === 3) for (let i = 0; i < 3; i++) lootdropper.SpawnLootPrefab(ROCK_AVOCADO_FRUIT_ID, inst.position);
    lootdropper.SpawnLootPrefab('dug_rock_avocado_bush', inst.position);
  }
  inst.remove();
}

export const ROCK_AVOCADO_BUSH_DEFINITION: PickablePlantDefinition = {
  prefab: ROCK_AVOCADO_BUSH_ID, animArchive: 'rock_avocado.zip', buildArchive: 'rock_avocado_build.zip',
  archiveSprite: { bank: 'rock_avocado', instancedAnimations: 'all' },
  tags: ['plant', 'renewable', 'slurtlepickable', 'SnowCovered', 'blocker'],
  idle: { name: 'idle1', loop: false }, empty: { name: 'idle1', frame: 'first' },
  barren: 'dead1',
  physicsRadius: .1, deploySmartRadius: 3, snowCovered: true,
  createInstance: context => new RockAvocadoBushInstance(context),
};

export function rockAvocadoBushPrefabs(world: PickablePlantWorld): Readonly<Record<typeof ROCK_AVOCADO_BUSH_ID, PrefabEntityDefinition<PickablePlantInstance>>> {
  return { [ROCK_AVOCADO_BUSH_ID]: plantEntityDefinition(ROCK_AVOCADO_BUSH_DEFINITION, world) };
}
