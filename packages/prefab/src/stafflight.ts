import { createEffect, type GetWatchWorldContent, type TileStateQuery } from '@dontstarve-web/signals';
import { SpriteState } from '@dontstarve-web/display';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { type PrefabLocalLight } from './localLight';
import { WORLD_SCALE } from './tile';
import { OPALSTAFF_COLOUR, YELLOWSTAFF_COLOUR } from './staff';
import type { SoundEventPath } from './sound';
import type { SoundEmitter } from './soundEmitter';
import { FindEntities } from './actionEntity';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ComponentTimer, Timer } from '../../componets/src/timer';
import { Propagator } from '../../componets/src/propagator';
import { Heater } from '../../componets/src/heater';
import { Hauntable, HAUNT_SMALL } from '../../componets/src/hauntable';
import { SanityAura, SANITYAURA_SMALL } from '../../componets/src/sanityaura';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import type { BurnableInst } from '../../componets/src/burnable';

export const DWARF_STAR_ID = 'stafflight';
// Gameplay duration requested for this project: 24 minutes.
export const DWARF_STAR_DURATION = 24 * 60;
export const POLAR_LIGHT_ID = 'staffcoldlight';
// tuning.lua: OPALSTAFF_STAR_DURATION = total_day_time * 2 (480 seconds per day).
export const POLAR_LIGHT_DURATION = 16 * 60;
export type StaffLightId = typeof DWARF_STAR_ID | typeof POLAR_LIGHT_ID;

const EXTINGUISH = 'extinguish';
const PULSE_PERIOD = .1;

/** stafflight.lua's makestafflight arguments for the two world stars. */
const STAFF_LIGHTS: Record<StaffLightId, {
  readonly is_hot: boolean;
  readonly anim: string;
  readonly colour: PrefabLocalLight['colour'];
  readonly idles: readonly string[];
  readonly duration: number;
  readonly loopSound: SoundEventPath;
}> = {
  [DWARF_STAR_ID]: { is_hot: true, anim: 'star_hot', colour: YELLOWSTAFF_COLOUR, idles: ['idle_loop'],
    duration: DWARF_STAR_DURATION, loopSound: 'dontstarve/common/staff_star_LP' },
  [POLAR_LIGHT_ID]: { is_hot: false, anim: 'star_cold', colour: OPALSTAFF_COLOUR, idles: ['idle_loop', 'idle_loop2', 'idle_loop3'],
    duration: POLAR_LIGHT_DURATION, loopSound: 'dontstarve/common/staff_coldlight_LP' },
};

/** stafflight.lua pulse_light: abs(sin(pi * timeAlive * .05)), using the scene's world scale. */
export function dwarfStarLight(ageSeconds: number): PrefabLocalLight {
  const pulse = Math.abs(Math.sin(Math.PI * ageSeconds * 0.05));
  return {
    radius: (11 + pulse) * WORLD_SCALE,
    intensity: 0.8 - 0.1 * pulse,
    falloff: 0.8 - 0.1 * pulse,
    colour: YELLOWSTAFF_COLOUR,
  };
}

export function polarLight(ageSeconds: number): PrefabLocalLight {
  return { ...dwarfStarLight(ageSeconds), colour: OPALSTAFF_COLOUR };
}

/** What the scene injects into every star. */
export interface StaffLightWorld {
  scheduler: GameTimeScheduler;
  tickingarea?: TileStateQuery;
  getWatchWorldContent?: GetWatchWorldContent;
}

/**
 * stafflight.lua's fn() for `stafflight` and `staffcoldlight`. Like the source, a load runs the same constructor and
 * then the timer's OnLoad, and nothing here depends on the entity being awake: sleep only stops the sprite being drawn.
 */
export class StaffLightInstance extends PrefabInstance {
  readonly no_wet_prefix = true;
  _killed = false;
  private readonly scheduler: GameTimeScheduler;
  private readonly settings: typeof STAFF_LIGHTS[StaffLightId];
  private readonly spawnedAt: number;
  private readonly pulseTask: ComponentTimer;
  private cancelRemoval?: () => void;
  private readonly soundEmitter: SoundEmitter = this.AddSoundEmitter();
  /** A random idle waits here for its art: a clip nothing draws would complete at once. */
  private idleAwaitsArt = false;

  constructor(prefab: StaffLightId, world: StaffLightWorld) {
    super(prefab, new SpriteState({ name: 'appear', billboard: true }));
    const { scheduler } = world, settings = STAFF_LIGHTS[prefab];
    this.scheduler = scheduler; this.settings = settings; this.spawnedAt = scheduler.now;

    // DoPeriodicTask(.1, pulse_light): the light is first enabled by the first pulse, a period after spawning.
    this.pulseTask = new ComponentTimer(scheduler, () => { this.pulse_light(); this.pulseTask.start(PULSE_PERIOD); });
    this.pulseTask.start(PULSE_PERIOD);

    this.sprite.playOnce('appear', () => this.PushEvent('animover'));
    if (settings.idles.length === 1) this.sprite.pushAnimation(settings.idles[0], true);

    this.addTag('ignorewalkableplatforms');
    this.physicsRadiusOverride = .5;
    if (settings.is_hot) for (const tag of ['cooker', 'daylight', 'heatstar']) this.addTag(tag);

    const heater = new Heater(this);
    heater.SetHeat(settings.is_hot ? 100 : -100);
    if (!settings.is_hot) heater.SetThermics(false, true);

    const sanityaura = new SanityAura(this);
    sanityaura.aura = SANITYAURA_SMALL;

    const hauntable = new Hauntable(this, scheduler);
    hauntable.SetHauntValue(HAUNT_SMALL);
    hauntable.SetOnHauntFn(() => this.onhaunt());

    const timer = new Timer(scheduler, name => this.PushEvent('timerdone', { name }));
    timer.StartTimer(EXTINGUISH, settings.duration);
    this.ListenForEvent('timerdone', data => { if ((data as { name: string }).name === EXTINGUISH) this.kill_light(); });

    Object.assign(this.components, { heater, sanityaura, hauntable, timer, inspectable: new Inspectable(this) });
    this.addTag('inspectable');

    let propagator: Propagator | undefined;
    if (settings.is_hot) {
      propagator = this.components.propagator = new Propagator(this, 'default', radius =>
        FindEntities(this.position, radius, [], ['INLIMBO']) as BurnableInst[], WORLD_SCALE, scheduler, world.getWatchWorldContent);
      propagator.heatoutput = 15;
      propagator.spreading.set(true);
    }

    let stopIdleResume: (() => void) | undefined;
    if (settings.idles.length > 1) {
      this.ListenForEvent('animover', () => this.PlayRandomStarIdle());
      stopIdleResume = createEffect(() => {
        this.sprite.art.get();
        if (!this.idleAwaitsArt || !this.sprite.loaded) return;
        this.idleAwaitsArt = false;
        this.PlayRandomStarIdle();
      });
    }

    this.onRemove(() => {
      this.pulseTask.stop();
      this.cancelRemoval?.();
      stopIdleResume?.();
      timer.dispose(); hauntable.dispose(); heater.dispose(); sanityaura.OnRemoveFromEntity(); propagator?.dispose();
    });
  }

  /** The SoundEmitter's PlaySound calls in fn(); they follow the transform, which exists once the display is attached. */
  playSpawnSounds(): void {
    this.soundEmitter.PlaySound(this.settings.loopSound, 'staff_star_loop');
    this.soundEmitter.PlaySound('dontstarve/common/staff_star_create');
  }

  private pulse_light(): void {
    const timealive = this.scheduler.now - this.spawnedAt;
    this.light.set({ ...dwarfStarLight(timealive), colour: this.settings.colour });
  }

  private PlayRandomStarIdle(): void {
    // Don't if we're extinguished
    if (this._killed) return;
    const { idles } = this.settings, idle = idles[Math.floor(Math.random() * idles.length)];
    if (this.sprite.loaded) this.sprite.playOnce(idle, () => this.PushEvent('animover'));
    else { this.sprite.start(idle); this.idleAwaitsArt = true; }
  }

  private kill_sound(): void {
    this.soundEmitter.KillSound('staff_star_loop');
  }

  private kill_light(): void {
    // Set first: a clip nothing draws completes, and sends animover, inside playOnce.
    this._killed = true;
    this.persists = false;
    this.ListenForEvent('animover', () => this.kill_sound());
    this.sprite.playOnce('disappear', () => this.PushEvent('animover'));
    this.cancelRemoval = this.scheduler.schedule(1, () => this.remove()); // originally 0.6, padded for network
  }

  private onhaunt(): boolean {
    const timer = this.components.timer!;
    if (timer.TimerExists(EXTINGUISH)) {
      timer.StopTimer(EXTINGUISH);
      this.kill_light();
    }
    return true;
  }
}

/** The Prefab table stafflight.lua returns for the two world stars. */
export function staffLightPrefabs(world: StaffLightWorld): Readonly<Record<StaffLightId, PrefabEntityDefinition<StaffLightInstance>>> {
  const define = (prefabId: StaffLightId): PrefabEntityDefinition<StaffLightInstance> => {
    const { anim } = STAFF_LIGHTS[prefabId], archive = `${anim}.zip`;
    return {
      fn: () => new StaffLightInstance(prefabId, world),
      assets: { animationArchive: archive, buildArchives: [archive], bank: anim },
      onSpawned: star => star.playSpawnSounds(),
    };
  };
  return { [DWARF_STAR_ID]: define(DWARF_STAR_ID), [POLAR_LIGHT_ID]: define(POLAR_LIGHT_ID) };
}
