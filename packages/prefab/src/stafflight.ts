import * as THREE from 'three';
import { createEffect, type GetWatchWorldContent, type TileStateQuery } from '@dontstarve-web/signals';
import { SpriteResources, SpriteState, type PrefabDisplayGroup } from '@dontstarve-web/display';
import { bindInstance, PrefabInstance } from './prefabInstance';
import { type PrefabLocalLight } from './localLight';
import { WORLD_SCALE } from './tile';
import { OPALSTAFF_COLOUR, YELLOWSTAFF_COLOUR } from './staff';
import { newEntityId } from './saveRecord';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import { actionEntity, FindEntities } from './actionEntity';
import { watchTileActivity } from './tileActivity';
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

export interface DwarfStarRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { timer: { remainingSeconds: number } };
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
  private loopSound?: SoundHandle;
  private createSound?: SoundHandle;
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
      this.kill_sound();
      this.createSound?.stop();
    });
  }

  /** The SoundEmitter's PlaySound calls in fn(); they follow the transform, which exists once the display is attached. */
  playSpawnSounds(): void {
    this.loopSound = PlaySound(this.settings.loopSound, this.position);
    this.createSound = PlaySound('dontstarve/common/staff_star_create', this.position);
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
    this.loopSound?.stop();
    this.loopSound = undefined;
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

/** The stars of one prefab: their collection, injected world and shared DST textures. */
export class DwarfStarManager {
  private readonly resources: SpriteResources;
  private readonly stars = new Set<StaffLightInstance>();
  private disposed = false;
  private readonly displays: PrefabDisplayGroup;
  private readonly world: StaffLightWorld;
  readonly prefabId: StaffLightId;

  /** `displays` is the display-layer owner of the stars' scene membership, injected and disposed by the application. */
  constructor(displays: PrefabDisplayGroup, animationBaseUrl: string, world: StaffLightWorld, prefabId: StaffLightId = DWARF_STAR_ID) {
    this.displays = displays;
    this.resources = new SpriteResources(animationBaseUrl);
    this.world = world;
    this.prefabId = prefabId;
  }

  /** SpawnPrefab at CASTSPELL's source stategraph frame: the star exists now and its display loads the art. */
  spawn(position: THREE.Vector3, saved?: { id: string; remainingSeconds: number }): StaffLightInstance {
    if (this.disposed) throw new Error('Dwarf star manager has been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError(`Invalid ${this.prefabId} position`);
    const instance = new StaffLightInstance(this.prefabId, this.world);
    const { anim, duration } = STAFF_LIGHTS[this.prefabId], archive = `${anim}.zip`;
    // A shared archive holds a first one-shot clip while its art loads, so a new star is drawn from its first `appear` frame.
    const display = this.displays.add({ root: instance.transform.model, name: this.prefabId, status: instance.status, sprite: instance.sprite, light: instance.light,
      archive: this.resources.archive({ animationArchive: archive, buildArchives: [archive], bank: anim }) });
    bindInstance(display.model, instance);
    instance.setPosition(position.x, 0, position.z);
    instance.entityId = saved?.id ?? newEntityId();
    if (saved) instance.components.timer!.OnLoad({ timers: { [EXTINGUISH]: { timeleft: saved.remainingSeconds, paused: false, initial_time: duration } } });
    instance.playSpawnSounds();
    actionEntity(display.model, this.prefabId);
    this.stars.add(instance);
    const stopActivity = watchTileActivity(display.model, this.world.tickingarea, active => instance.setActive(active));
    instance.onRemove(() => { stopActivity(); this.stars.delete(instance); });
    return instance;
  }

  /** The awake stars' displays, as the display group lists those in the scene. */
  get renderEntities() { return this.displays.renderEntities; }

  /** The display group advances the awake stars' clips; timers and tasks run on the world's scheduler. */
  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    if (!this.disposed) this.displays.update(dt, cameraQuaternion);
  }

  exportRecords(): DwarfStarRecord[] {
    return [...this.stars].filter(star => star.persists).map(star => ({
      id: String(star.entityId),
      transform: { position: [star.position.x, 0, star.position.z], rotationY: 0 },
      components: { timer: { remainingSeconds: star.components.timer!.GetTimeLeft(EXTINGUISH)! } },
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const star of [...this.stars]) star.remove();
    // Every star's display is released above, before the shared resources.
    this.resources.dispose();
  }
}
