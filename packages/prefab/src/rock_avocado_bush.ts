import type * as THREE from 'three';
import { Growable } from '../../componets/src/growable';
import { SimpleMagicGrower } from '../../componets/src/simplemagicgrower';
import { PickablePlantManager, type PickablePlantBehavior, type PickablePlantBehaviorContext,
  type PickablePlantDefinition, type PickablePlantRecord } from './pickablePlant';

export const ROCK_AVOCADO_BUSH_ID = 'rock_avocado_bush' as const;
export const ROCK_AVOCADO_FRUIT_ID = 'rock_avocado_fruit' as const;
// tuning.lua day_time is the ten daytime segments (300s), not total_day_time (480s).
export const ROCK_AVOCADO_STAGE_TIMES = [600, 180, 900, 300] as const;
const GROW_ANIMS = ['crumble', 'grow1', 'grow2', 'grow3'] as const;

/** rock_avocado_bush.lua: Growable owns stage deadlines; Pickable has no regeneration task. */
class RockAvocadoBush implements PickablePlantBehavior {
  readonly growable: Growable;
  private readonly context: PickablePlantBehaviorContext;
  private readonly magicgrower: SimpleMagicGrower;
  constructor(context: PickablePlantBehaviorContext) {
    this.context = context;
    this.growable = new Growable(context.scheduler, ROCK_AVOCADO_STAGE_TIMES.map((base, index) => ({
      time: () => base + (Math.random() * 2 - 1) * 60,
      fn: () => this.setStage(index + 1),
      growfn: () => context.play([GROW_ANIMS[index], `idle${index + 1}`]),
    })), context.growthDuration);
    this.growable.loopstages = true;
    this.growable.springgrowth = true;
    this.growable.magicgrowable = true;
    context.instance.components.growable = this.growable;
    this.magicgrower = new SimpleMagicGrower(context.instance, this.growable, context.scheduler);
    this.magicgrower.SetLastStage(3);
    context.instance.components.simplemagicgrower = this.magicgrower;
  }
  initialize(saved?: PickablePlantRecord): void {
    if (saved?.components.growable) this.growable.OnLoad(saved.components.growable);
    else { this.growable.SetStage(1 + Math.floor(Math.random() * 4)); this.growable.StartGrowing(); }
    if (this.context.pickable.IsBarren() || this.context.instance.hasTag('withered')) this.barren();
  }
  private setStage(stage: number): void {
    const { pickable, play } = this.context;
    pickable.ChangeProduct(stage === 3 ? ROCK_AVOCADO_FRUIT_ID : undefined);
    if (stage < 3) pickable.canBePicked = false;
    else if (stage === 3 || !pickable.canBePicked) pickable.regen();
    play([`idle${stage}`]);
  }
  picked(): void {
    const animation = this.growable.GetStage() === 3 ? 'picked' : 'crumble';
    this.growable.SetStage(1);
    if (this.context.pickable.IsBarren()) {
      this.context.play([animation, 'idle1_to_dead1', 'dead1']);
      this.growable.StopGrowing(); this.growable.magicgrowable = false;
    } else this.context.play([animation, 'idle1']);
    // SetStage leaves the existing growth deadline intact, as in Lua's onpickedfn.
  }
  regen(): void { if (this.growable.GetStage() < 3) this.growable.SetStage(3); }
  empty(): void {
    const wasDead = this.context.animation.currentAnimation === 'dead1';
    this.growable.SetStage(1); this.growable.StartGrowing(); this.growable.magicgrowable = true;
    this.context.play(this.context.instance.hasTag('withered') || wasDead
      ? ['dead1_to_idle1', 'idle1'] : ['idle1']);
  }
  barren(): void {
    this.growable.SetStage(1); this.growable.StopGrowing(); this.growable.magicgrowable = false;
    this.context.play(this.context.instance.hasTag('withered') ? ['idle1_to_dead1', 'dead1'] : ['dead1']);
  }
  burnt(): void {
    if (this.growable.GetStage() === 3) for (let i = 0; i < 3; i++) this.context.spawnLoot(ROCK_AVOCADO_FRUIT_ID);
    this.growable.StopGrowing();
  }
  exportState(): PickablePlantRecord['components'] { return { growable: this.growable.OnSave() }; }
  dispose(): void { this.magicgrower.dispose(); this.growable.dispose(); }
}

export const ROCK_AVOCADO_BUSH_DEFINITION: PickablePlantDefinition = {
  prefab: ROCK_AVOCADO_BUSH_ID, animArchive: 'rock_avocado.zip', buildArchive: 'rock_avocado_build.zip',
  archiveSprite: { bank: 'rock_avocado', instancedAnimations: 'all' },
  tags: ['plant', 'renewable', 'slurtlepickable', 'SnowCovered', 'blocker'],
  product: ROCK_AVOCADO_FRUIT_ID, numToHarvest: 3, noGrowInWinter: false,
  idle: { name: 'idle1', loop: false }, picked: { sound: 'dontstarve/wilson/harvest_berries', clips: ['picked', 'idle1'] }, empty: { name: 'idle1', frame: 'first' },
  grow: 'grow2', barren: 'dead1', maxCycles: () => 3, witherable: true,
  dugLoot: 'dug_rock_avocado_bush', extraLoot: ['twigs', 'twigs', ROCK_AVOCADO_FRUIT_ID, ROCK_AVOCADO_FRUIT_ID],
  physicsRadius: .1, deploySmartRadius: 3, snowCovered: true, propagatorSize: 'medium', persistBurning: true,
  digLoot: (instance, pickable, withered) => withered || pickable.IsBarren()
    ? [{ prefab: 'twigs' }, { prefab: 'twigs' }]
    : [...instance.components.growable!.GetStage() === 3
      ? Array.from({ length: 3 }, () => ({ prefab: ROCK_AVOCADO_FRUIT_ID })) : [], { prefab: 'dug_rock_avocado_bush' }],
  createBehavior: context => new RockAvocadoBush(context),
};

export class RockAvocadoBushManager extends PickablePlantManager {
  /** A sprout's growtree: SpawnPrefab of a natural bush at `position`; the display loads the art. */
  spawnNatural(position: THREE.Vector3): THREE.Group { return this.spawnPlant(ROCK_AVOCADO_BUSH_DEFINITION, position); }
  spawn(position: THREE.Vector3, saved?: PickablePlantRecord): THREE.Group {
    return this.spawnPlant(ROCK_AVOCADO_BUSH_DEFINITION, position, saved);
  }
  /** dug_rock_avocado_bush ondeploy: SpawnPrefab, then OnTransplant; the display loads the art. */
  transplant(position: THREE.Vector3): boolean {
    this.getInstance(this.spawnPlant(ROCK_AVOCADO_BUSH_DEFINITION, position))!.components.pickable.OnTransplant();
    return true;
  }
  exportRecords(): PickablePlantRecord[] { return this.exportPlants().map(({ record }) => record); }
}
