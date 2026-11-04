import { SpriteState } from '@dontstarve-web/display';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { ComponentTimer, Timer } from '../../componets/src/timer';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { actionEntity } from './actionEntity';
import { addComponent } from './components';
import type { SpawnGroundItem } from './groundPrefab';
import catalog from './groundItems.json' with { type: 'json' };
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { ROCK_AVOCADO_BUSH_ID } from './rock_avocado_bush';
import { PlaySound } from './sound';
import { DefaultBurntFn } from './standardcomponents';
import { TILE_SIZE } from './tile';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { Transform } from './transform';
import { BurnableBinding, type FireFxHost } from './treeFire';

export const ROCK_AVOCADO_SAPLING_ID = 'rock_avocado_fruit_sprout_sapling' as const;
/** tuning.lua ROCK_FRUIT_SPROUT_GROWTIME. */
export const ROCK_AVOCADO_SPROUT_GROW_TIME = 1500;
/** seed_growth in rock_avocado_fruit.zip, 23 frames at 30 fps: its animover (grow_anim_over) spawns the bush. */
const SEED_GROWTH_SECONDS = 23 / 30;
/** MakeSmallBurnable(inst, TUNING.SMALL_BURNTIME). */
const BURN_TIME = 7.5;
const BURN_FX_LEVEL = 2;

export interface RockAvocadoSaplingWorld extends ToolMouseTargetWorld {
  scheduler: GameTimeScheduler;
  /** The fire art's owner, injected and disposed by the application. */
  fire: FireFxHost;
  /** grow_anim_over's natural bush. */
  spawnPrefab(prefab: typeof ROCK_AVOCADO_BUSH_ID, position: ReadonlyVector3): unknown;
  /** dig_sprout's loot and DefaultBurntFn's ash; their displays load the art. */
  spawnGroundItem: SpawnGroundItem;
}

/** rock_avocado_fruit.lua rock_avocado_fruit_sprout_sapling: a buried sprout on a named growth timer. */
export class RockAvocadoSaplingInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { timer: Timer };
  readonly world: RockAvocadoSaplingWorld;
  /** Stands in for seed_growth's animover, so a sprout grows while its display sleeps. */
  readonly seedGrowth: ComponentTimer;

  constructor(world: RockAvocadoSaplingWorld) {
    super(ROCK_AVOCADO_SAPLING_ID, new SpriteState({ name: 'idle_buried_seed', billboard: true }), Transform.stationary());
    this.world = world;
    this.sprite.playOnce('idle_buried_seed');
    // seed_growth includes the engine's snow placeholder; this prefab has no MakeSnowCovered.
    this.sprite.setSymbolHidden('snow', true);
    // DEPLOYSPACING_RADIUS[DEPLOYSPACING.DEFAULT] / 2, in world units.
    this.deploySmartRadius = TILE_SIZE / 4;
    const workable = addComponent(this as RockAvocadoSaplingInstance, 'workable');
    workable.SetWorkAction('DIG'); workable.SetWorkLeft(1);
    workable.SetOnFinishCallback(dig_sprout);
    const timer = this.components.timer = new Timer(world.scheduler, name => on_grow_timer_done(this, name), ['grow']);
    this.seedGrowth = new ComponentTimer(world.scheduler, () => grow_anim_over(this));
    // MakeSmallBurnable + MakeSmallPropagator; DefaultBurnFn and DefaultExtinguishFn give way to these callbacks.
    const burn = new BurnableBinding(this, { propagator: 'small', burnTime: BURN_TIME, fxLevel: BURN_FX_LEVEL,
      onIgnite: () => stop_sprout_growing(this), onExtinguish: () => start_sprout_growing(this), onBurnt: () => DefaultBurntFn(this, world) }, world);
    this.onRemove(() => { burn.dispose(); timer.dispose(); this.seedGrowth.stop(); });
    start_sprout_growing(this);
    this.OnSave = (_inst, data) => {
      // The timer's record keeps the name existing saves hold; a stopped timer writes an empty one.
      data.saplingTimer = data.timer ?? { timers: {} }; delete data.timer;
    };
    this.OnLoad = (_inst, data) => { timer.OnLoad(data.saplingTimer); };
  }
}

function dig_sprout(inst: RockAvocadoSaplingInstance): void {
  inst.world.spawnGroundItem({ ...catalog.items.rock_avocado_fruit_sprout, itemId: 'rock_avocado_fruit_sprout', count: 1 }, inst.position);
  inst.remove();
}

function grow_anim_over(inst: RockAvocadoSaplingInstance): void {
  PlaySound('dontstarve/forest/treeGrow', inst.position);
  inst.remove();
  inst.world.spawnPrefab(ROCK_AVOCADO_BUSH_ID, inst.position);
}

function on_grow_timer_done(inst: RockAvocadoSaplingInstance, name: string): void {
  if (name !== 'grow') return;
  inst.seedGrowth.start(SEED_GROWTH_SECONDS);
  inst.sprite.playOnce('seed_growth');
}

function start_sprout_growing(inst: RockAvocadoSaplingInstance): void {
  const { timer } = inst.components;
  if (!timer.TimerExists('grow')) timer.StartTimer('grow', ROCK_AVOCADO_SPROUT_GROW_TIME);
}

function stop_sprout_growing(inst: RockAvocadoSaplingInstance): void {
  inst.components.timer.StopTimer('grow');
}

/** The sapling's entry in the Prefab table rock_avocado_fruit.lua returns; the fruits are inventory items. */
export function rockAvocadoSaplingPrefabs(world: RockAvocadoSaplingWorld): Readonly<Record<typeof ROCK_AVOCADO_SAPLING_ID, PrefabEntityDefinition<RockAvocadoSaplingInstance>>> {
  return {
    [ROCK_AVOCADO_SAPLING_ID]: {
      fn: () => new RockAvocadoSaplingInstance(world),
      assets: { animationArchive: 'rock_avocado_fruit.zip', buildArchives: ['rock_avocado_fruit_build.zip'],
        bank: 'rock_avo_fruit_master', hiddenSymbols: ['snow'] },
      assetOptions: { instancedAnimations: 'all', staticBillboard: true },
      minimapIcon: 'rock_avocado.png',
      onSpawned: inst => { new ToolMouseTarget(actionEntity(inst.transform.model, ROCK_AVOCADO_SAPLING_ID), inst, inst.components.workable, world.handEquipment); },
    },
  };
}
