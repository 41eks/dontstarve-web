import { SpriteState } from '@dontstarve-web/display';
import { createEffect, watchSignal } from '@dontstarve-web/signals';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { BathBombable } from '../../componets/src/bathbombable';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Heater } from '../../componets/src/heater';
import { ComponentTimer } from '../../componets/src/timer';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakePondPhysics, WORLD_SCALE } from './standardcomponents';
import { Transform } from './transform';
import type { WorldFx } from './world_fx';

export const HOTSPRING_ID = 'hotspring' as const;
/** tuning.lua HOTSPRING_HEAT. */
export const HOTSPRING_HEAT = { ACTIVE: 90, PASSIVE: 45 } as const;
/** tuning.lua HOTSPRING_GLOW with prefabs/hotspring.lua's colour, radius in scene units. */
export const HOTSPRING_LIGHT = { radius: 2 * WORLD_SCALE, intensity: .75, falloff: .75,
  colour: [.1, 1.6, 2] as const };
/** hotspring.lua MakePondPhysics(inst, 1), in scene units. */
export const HOTSPRING_RADIUS = WORLD_SCALE;
/** tuning.lua HOTSPRING_IDLE: steam period and the random range of the first delay. */
export const HOTSPRING_IDLE = { BASE: 3, DELAY: 4 } as const;
/** LAYER_BACKGROUND (sort order 2): drawn below the world entities, still facing the camera. */
const BACKGROUND_RENDER_ORDER = -.5;

/** hotspring.lua OnSave: the non-glass branch. */
export interface HotspringSaveState { isbathbombed?: true }

export interface HotspringWorld {
  scheduler: GameTimeScheduler;
  /** SpawnPrefab for fx.lua's crater_steam_fx1..4 and slow_steam_fx1..5. */
  fx: Pick<WorldFx, 'spawn'>;
  random?: () => number;
}

/**
 * hotspring.lua hotspring(): heat, light, bathbombable and the steam task. The full-moon glassing, the MINE workable and
 * its loot, the bathing pool, its sounds and inspectable's status are separate Lua branches that are not ported.
 */
export class HotspringInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { heater: Heater; bathbombable: BathBombable };
  readonly no_wet_prefix = true;
  /** _fx_task: DoPeriodicTask(HOTSPRING_IDLE.BASE, push_special_idle, delay). */
  readonly fxTask: ComponentTimer;
  readonly world: HotspringWorld;
  readonly random: () => number;
  /** The global POPULATING while OnLoad runs. */
  populating = false;

  constructor(world: HotspringWorld, position: ReadonlyVector3) {
    super(HOTSPRING_ID, new SpriteState({ name: 'idle', billboard: true }), Transform.stationary());
    this.world = world; this.random = world.random ?? Math.random;
    this.setPosition(position.x, 0, position.z);
    this.sprite.setGround(BACKGROUND_RENDER_ORDER, false);
    for (const tag of ['watersource', 'antlion_sinkhole_blocker', 'birdblocker', 'inspectable']) this.addTag(tag);
    this.deploySmartRadius = 1.5 * WORLD_SCALE;
    this.light.set(null); // Light:Enable(false)

    const heater = new Heater(this);
    heater.SetHeatFn(() => GetHeat(this));
    const bathbombable = new BathBombable(this);
    bathbombable.SetOnBathBombedFn(() => OnBathBombed(this));
    Object.assign(this.components, { inspectable: new Inspectable(this), heater, bathbombable });

    this.fxTask = new ComponentTimer(world.scheduler, () => push_special_idle(this));
    StartFx(this);

    this.OnSave = (_inst, data) => { data.hotspring = bathbombable.is_bathbombed ? { isbathbombed: true } : {}; };
    this.OnLoad = (_inst, data) => {
      if (!data.hotspring?.isbathbombed) return;
      this.populating = true;
      try { bathbombable.OnBathBombed(); } finally { this.populating = false; }
    };

    // OnEntitySleep / OnEntityWake.
    const cleanups: (() => void)[] = [];
    const status = watchSignal(this.status, stop => cleanups.push(stop));
    cleanups.push(createEffect(() => {
      const value = status.get();
      if (value === 'asleep') StopFx(this);
      else if (value === 'active') OnWake(this);
    }));
    this.onRemove(() => {
      cleanups.splice(0).forEach(stop => stop());
      StopFx(this);
      heater.dispose(); bathbombable.dispose();
      this.light.set(null);
    });
  }
}

/** push_special_idle, non-glass branches. */
function push_special_idle(inst: HotspringInstance): void {
  inst.fxTask.start(HOTSPRING_IDLE.BASE);
  if (inst.components.bathbombable.is_bathbombed) inst.world.fx.spawn(`crater_steam_fx${1 + Math.floor(inst.random() * 4) as 1 | 2 | 3 | 4}`, inst.position);
  else inst.world.fx.spawn(`slow_steam_fx${1 + Math.floor(inst.random() * 5) as 1 | 2 | 3 | 4 | 5}`, inst.position);
}

function StartFx(inst: HotspringInstance, delay = inst.random() * HOTSPRING_IDLE.DELAY): void { inst.fxTask.start(delay); }

function StopFx(inst: HotspringInstance): void { inst.fxTask.stop(); }

function OnWake(inst: HotspringInstance): void {
  const { is_bathbombed, can_be_bathbombed } = inst.components.bathbombable;
  if (inst.fxTask.snapshot.peek().status !== 'scheduled' && (is_bathbombed || can_be_bathbombed)) StartFx(inst);
}

function GetHeat(inst: HotspringInstance): number {
  const { heater, bathbombable } = inst.components;
  if (bathbombable.is_bathbombed) { heater.SetThermics(true, false); return HOTSPRING_HEAT.ACTIVE; }
  if (bathbombable.can_be_bathbombed) { heater.SetThermics(true, false); return HOTSPRING_HEAT.PASSIVE; }
  heater.SetThermics(false, false);
  return 0;
}

/** OnBathBombed outside a full moon; EnableBathingPool and the glass layering are not ported. */
function OnBathBombed(inst: HotspringInstance): void {
  inst.light.set(HOTSPRING_LIGHT);
  if (inst.populating) { inst.sprite.start('glow_loop'); return; }
  inst.sprite.playOnce('bath_bomb');
  inst.sprite.pushAnimation('glow_pre', false);
  inst.sprite.pushAnimation('glow_loop', true);
}

/** The Prefab hotspring.lua returns. */
export function hotspringPrefabs(world: HotspringWorld): Readonly<Record<typeof HOTSPRING_ID, PrefabEntityDefinition<HotspringInstance>>> {
  return {
    [HOTSPRING_ID]: {
      fn: position => new HotspringInstance(world, position),
      assets: { animationArchive: 'crater_pool.zip', buildArchives: ['crater_pool.zip'], bank: 'crater_pool' },
      physics: { make: MakePondPhysics, radius: HOTSPRING_RADIUS / WORLD_SCALE },
      minimapIcon: 'hotspring.png',
    },
  };
}
