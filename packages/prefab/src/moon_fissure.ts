import { definePrefabIds } from './prefabRegistration';
import { SpriteState } from '@dontstarve-web/display';
import {
  createEffect,
  watchSignal,
  WorldContentKey,
  type GameTimeScheduler,
  type GetWatchWorldContent,
  type WorldContentSignal,
  type WorldMoonPhase,
  type WorldMoonState,
  type WorldPhase,
} from '@dontstarve-web/signals';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { FRAMES } from '../../stategraphs/src/stategraph';
import { addComponent } from './components';
import { PrefabInstance, type EntityTask, type PrefabEntityDefinition } from './prefabInstance';
import { Inspectable } from '../../componets/src/inspectable';
import { Workable } from '../../componets/src/workable';
import { SanityAura } from '../../componets/src/sanityaura';
import { Repairable } from '../../componets/src/repairable';
import type { SoundEmitter } from './soundEmitter';
import { WORLD_SCALE } from './tile';

export const MOON_FISSURE_ID = 'moon_fissure' as const;
export const MOON_FISSURE_FX_ID = 'moon_fissure_fx' as const;
/** MATERIALS.MOON_ALTAR. */
const MOON_ALTAR = 'moon_altar';
/** moon_fissure.lua delayed_transition's crack_open. */
const CRACK_OPEN_SOUND = 'turnoftides/common/together/moon_fissure/crack_open' as const;

export interface MoonFissureWorld {
  readonly scheduler: GameTimeScheduler;
  readonly getWatchWorldContent?: GetWatchWorldContent;
  /** SpawnPrefab("moon_fissure_fx"), parented to the fissure with entity:SetParent. */
  spawnPrefab(prefab: typeof MOON_FISSURE_FX_ID, position: ReadonlyVector3): PrefabInstance;
}

/** inst.Light:SetColour's r, g, b, as OnUpdateLight tints them. */
const r = 130 / 255;
const g = 160 / 255;
const b = 170 / 255;
/** moon_fissure.lua LIGHT_RADIUS_RATE: each frame moves this fraction of the remaining gap toward the target. */
const LIGHT_RADIUS_RATE = 1 / (12 * FRAMES);

/** The glow layers lightstate_data's rows show on inst.fx, keyed as the source `layers` table. */
type MoonLayer = 'low' | 'med' | 'high' | 'full';

/** lightstate_data's rows: the light's target, the sanity aura and the layers each row drives. */
interface MoonLightState {
  readonly enabled: boolean;
  readonly radius: number;
  readonly intensity: number;
  readonly falloff: number;
  readonly sanityaura: number;
  readonly layers: Readonly<Record<MoonLayer, boolean>>;
}

const lightstate_data: readonly MoonLightState[] = [
  {
    enabled: false,
    radius: 0,
    intensity: 1.0,
    falloff: 1.0,
    sanityaura: 0,
    layers: { low: false, med: false, high: false, full: false },
  },
  {
    enabled: true,
    radius: 3,
    intensity: 0.3,
    falloff: 2.25,
    sanityaura: 100 / (30 * 8),
    layers: { low: true, med: false, high: false, full: false },
  },
  {
    enabled: true,
    radius: 6,
    intensity: 0.4,
    falloff: 2.0,
    sanityaura: 100 / (30 * 4),
    layers: { low: true, med: true, high: false, full: false },
  },
  {
    enabled: true,
    radius: 11,
    intensity: 0.5,
    falloff: 1.9,
    sanityaura: 100 / (30 * 2),
    layers: { low: true, med: true, high: true, full: false },
  },
  {
    enabled: true,
    radius: 11,
    intensity: 0.5,
    falloff: 1.9,
    sanityaura: 100 / (30 * 2),
    layers: { low: true, med: true, high: true, full: true },
  },
];

/** The keys of every row's `layers`. */
const LAYERS = ['low', 'med', 'high', 'full'] as const;

const MOON_STATES: Readonly<Record<WorldMoonPhase, number>> = { new: 1, quarter: 2, half: 3, threequarter: 4, full: 5 };

/**
 * ambientlighting.lua GetVisualAmbientValue's phase averages, without weather dimming: the ambient colour's mean, which
 * OnUpdateLight reads to dim the light in daylight. The project has no continuous ambient signal, so the Cycle phase
 * stands in for it; full-moon night is approximated as ordinary night.
 */
const VISUAL_AMBIENT: Readonly<Record<WorldPhase, number>> = { day: 0.84, dusk: 0.59, night: 0 };

export class MoonFissureInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    inspectable: Inspectable;
    workable: Workable;
    sanityaura: SanityAura;
    repairable: Repairable;
  };
  /** inst._level: net_tinybyte, the MOON_STATES index of the phase the fissure shows; 0 while a transition plays. */
  declare _level: number;
  /** The Moon content signal UpdateState and WatchMoonPhase read for the current phase. */
  _moonphase?: WorldContentSignal<WorldMoonState>;
  /** The Cycle content signal OnUpdateLight reads for the ambient brightness. */
  _cycle?: WorldContentSignal<WorldPhase>;
  /** inst._lighttask: OnUpdateLight's periodic task, cancelled while the entity sleeps. */
  _lighttask?: EntityTask;
  /** inst._transition_task: the delayed transition, then the UpdateState it schedules. */
  _transition_task?: EntityTask;
  /** inst.fx: the moon_fissure_fx child, parented with entity:SetParent and dressed by UpdateState. */
  declare fx: PrefabInstance;
  /** inst.SoundEmitter, once AddSoundEmitter made it. */
  declare SoundEmitter: SoundEmitter;
}

function visualAmbient(phase: WorldPhase | undefined): number {
  return phase === undefined ? 0 : VISUAL_AMBIENT[phase];
}

/** OnUpdateLight: interpolate the light toward its phase's target, or turn it off on a new moon. */
function OnUpdateLight(inst: MoonFissureInstance): void {
  const lightstate = lightstate_data[inst._level - 1] ?? lightstate_data[0]!;
  if (!lightstate.enabled) {
    inst.light.set(null);
    return;
  }
  const rate = FRAMES * LIGHT_RADIUS_RATE;
  const current = inst.light.peek();
  const radius = (current?.radius ?? 0) / WORLD_SCALE;
  const intensity = current?.intensity ?? 0;
  const falloff = current?.falloff ?? 1;
  const cs = 1 - visualAmbient(inst._cycle?.peek()) * 0.25;
  inst.light.set({
    radius: (radius + (lightstate.radius - radius) * rate) * WORLD_SCALE,
    intensity: intensity + (lightstate.intensity - intensity) * rate,
    falloff: falloff + (lightstate.falloff - falloff) * rate,
    colour: [r * cs, g * cs, b * cs],
  });
}

function OnEntitySleep(inst: MoonFissureInstance): void {
  inst._lighttask?.Cancel();
  inst._lighttask = undefined;
  inst.SoundEmitter.KillSound('loop');
}

function OnEntityWake(inst: MoonFissureInstance): void {
  if (inst._lighttask === undefined) {
    inst._lighttask = inst.DoPeriodicTask(FRAMES, OnUpdateLight);
  }
}

/**
 * UpdateState, for the fissure's own AnimState, components and Light: every glow layer is hidden on the fissure itself
 * and shown on inst.fx where the phase lights it, and `backing` moves between the two. The light's on/off and its
 * radius / intensity / falloff are OnUpdateLight's, not this function's.
 */
function UpdateState(inst: MoonFissureInstance): void {
  const moonphase = inst._moonphase?.peek().phase ?? 'new';
  const level = MOON_STATES[moonphase];
  const lightstate = lightstate_data[level - 1]!;
  for (const layer of LAYERS) {
    inst.sprite.hideLayer(layer);
    if (lightstate.layers[layer]) {
      inst.fx.sprite.showLayer(layer);
    } else {
      inst.fx.sprite.hideLayer(layer);
    }
  }
  if (lightstate.enabled) {
    inst.fx.sprite.showLayer('backing');
    inst.sprite.hideLayer('backing');
  } else {
    inst.fx.sprite.hideLayer('backing');
    inst.sprite.showLayer('backing');
  }
  inst.components.sanityaura.max_distsq = lightstate.radius * lightstate.radius * 1.25 * 1.25;
  inst._level = level;
}

function delayed_transition(inst: MoonFissureInstance): void {
  inst._level = 0;
  inst.sprite.playOnce('transition');
  inst.sprite.pushAnimation('crack_idle', true);
  inst.fx.sprite.playOnce('transition');
  inst.fx.sprite.pushAnimation('crack_idle', true);
  inst.SoundEmitter.PlaySound(CRACK_OPEN_SOUND);
  inst._transition_task = inst.DoTaskInTime(5 * FRAMES, UpdateState);
}

function onmoonphasechagned(inst: MoonFissureInstance): void {
  inst._transition_task?.Cancel();
  inst._transition_task = inst.DoTaskInTime(Math.random(), delayed_transition);
}

/** WatchWorldState("moonphase", onmoonphasechagned): each change after construction schedules a transition. */
function WatchMoonPhase(inst: MoonFissureInstance): void {
  const moon = inst._moonphase;
  if (!moon) {
    return;
  }
  let phase = moon.peek().phase;
  const stop = createEffect(() => {
    const next = moon.get().phase;
    if (next !== phase) {
      phase = next;
      onmoonphasechagned(inst);
    }
  });
  inst.onRemove(stop);
}

/** OnEntitySleep / OnEntityWake: the light task stops while asleep and starts again on waking. */
function WatchStatus(inst: MoonFissureInstance): void {
  let stopStatus: (() => void) | undefined;
  const status = watchSignal(inst.status, stop => {
    stopStatus = stop;
  });
  const stopTask = createEffect(() => {
    const value = status.get();
    if (value === 'asleep') {
      OnEntitySleep(inst);
    } else if (value === 'active') {
      OnEntityWake(inst);
    }
  });
  inst.onRemove(() => {
    stopStatus?.();
    stopTask();
  });
}

/** inspectable.getstatus: a new moon reports NOLIGHT. */
function getstatus(inst: MoonFissureInstance): string | undefined {
  return inst._level === 1 ? 'NOLIGHT' : undefined;
}

/** sanityaura.aurafn: the phase's sanity value. */
function aurafn(inst: unknown): number {
  return (lightstate_data[(inst as MoonFissureInstance)._level - 1] ?? lightstate_data[0]!).sanityaura;
}

/** sanityaura.fallofffn: fade by the aura's own value plus the square root of the distance. */
function aurafallofffn(inst: unknown, _observer: unknown, distsq: number): number {
  return aurafn(inst) + Math.sqrt(Math.max(1, distsq));
}

/**
 * moon_fissure.lua fn, for loading, drawing and saving. Not ported: repairable's onrepaired / checkmaterialfn, which
 * embed the unported moon_altar pieces.
 */
function fn(world: MoonFissureWorld, position: ReadonlyVector3): MoonFissureInstance {
  // SetBank / SetBuild("moon_fissure"), PlayAnimation("crack_idle", true).
  const inst = new MoonFissureInstance(MOON_FISSURE_ID, new SpriteState({ name: 'crack_idle', billboard: true }));
  inst.physicsRadiusOverride = 0.4;
  // SetFinalOffset(3)
  inst.sprite.setDepthOffset(true);
  // The tasks, the moon watch and the sounds run on the world's game-time scheduler.
  inst.BindScheduler(world.scheduler);
  inst.AddSoundEmitter();
  // TheWorld.state.moonphase / isnight, as the world's Moon and Cycle content.
  inst._moonphase = world.getWatchWorldContent?.(WorldContentKey.Moon, stop => inst.onRemove(stop));
  inst._cycle = world.getWatchWorldContent?.(WorldContentKey.Cycle, stop => inst.onRemove(stop));
  inst._level = MOON_STATES[inst._moonphase?.peek().phase ?? 'new'];
  // inst._lighttask = inst:DoPeriodicTask(0, OnUpdateLight), then OnUpdateLight once at the set level.
  inst._lighttask = inst.DoPeriodicTask(FRAMES, OnUpdateLight);
  OnUpdateLight(inst);
  inst.addTag('antlion_sinkhole_blocker');
  const inspectable = addComponent(inst, 'inspectable', Inspectable);
  inspectable.getstatus = () => getstatus(inst);
  // here for repairable
  const workable = addComponent(inst, 'workable', Workable);
  workable.SetMaxWork(1);
  workable.WriteWorkLeft(0);
  const sanityaura = addComponent(inst, 'sanityaura', SanityAura);
  sanityaura.max_distsq = 1;
  sanityaura.aurafn = aurafn;
  sanityaura.fallofffn = aurafallofffn;
  const repairable = addComponent(inst, 'repairable', Repairable, workable, MOON_ALTAR);
  repairable.noannounce = true;
  // SpawnPrefab("moon_fissure_fx") and entity:SetParent(inst.entity).
  inst.fx = world.spawnPrefab(MOON_FISSURE_FX_ID, position);
  inst.fx.entityParent = inst;
  WatchMoonPhase(inst);
  UpdateState(inst);
  WatchStatus(inst);
  return inst;
}

/** fx_fn: SetBank / SetBuild("moon_fissure_fx"), PlayAnimation("crack_idle", true); DECOR | NOCLICK, not saved. */
function fx_fn(): PrefabInstance {
  const inst = new PrefabInstance(MOON_FISSURE_FX_ID, new SpriteState({ name: 'crack_idle', billboard: true }));
  inst.addTag('DECOR');
  inst.addTag('NOCLICK');
  inst.persists = false;
  return inst;
}

/** The moon_fissure and moon_fissure_fx Prefabs moon_fissure.lua returns; moon_fissure_plugged is not ported. */
export function moonFissurePrefabs(world: MoonFissureWorld): Readonly<{
  [MOON_FISSURE_ID]: PrefabEntityDefinition<MoonFissureInstance>;
  [MOON_FISSURE_FX_ID]: PrefabEntityDefinition<PrefabInstance>;
}> {
  return {
    [MOON_FISSURE_ID]: {
      fn: position => fn(world, position),
      assets: { animationArchive: 'moon_fissure.zip', buildArchives: ['moon_fissure.zip'], bank: 'moon_fissure' },
      // The 70 fissures of an imported world share one batch for their loop.
      assetOptions: { instancedAnimations: ['crack_idle'] },
    },
    [MOON_FISSURE_FX_ID]: {
      fn: () => fx_fn(),
      assets: {
        animationArchive: 'moon_fissure_fx.zip',
        buildArchives: ['moon_fissure_fx.zip'],
        bank: 'moon_fissure_fx',
      },
      assetOptions: { instancedAnimations: ['crack_idle'] },
      targetable: false,
    },
  };
}

export const moonFissureRegistration = {
  create: moonFissurePrefabs,
  families: { moonFissures: definePrefabIds([MOON_FISSURE_ID], [MOON_FISSURE_ID, MOON_FISSURE_FX_ID]) },
};
