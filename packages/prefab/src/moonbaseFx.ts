import type { PrefabDisplay, SpriteResources, SpriteState } from '@dontstarve-web/display';
import { createArchiveEntity, type EntityTask, type PrefabInstance } from './prefabInstance';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { AnimState } from '../../componets/src/animstate';
import { animationLengths } from './animationTimings';
import { PlaySound, type SoundHandle } from './sound';
import { polarLight } from './stafflight';
import { SPRITE_SCALE } from '@dontstarve-web/animation/units';
import { createSignal, readonlySignal } from '@dontstarve-web/signals';

interface Fx {
  readonly key: string;
  instance: PrefabInstance;
  display: PrefabDisplay;
  animation: SpriteState;
  /** inst.AnimState's playback: clips end after their source length in game time, whether or not their art is drawn. */
  animstate: AnimState;
  /** The FX's own DoTaskInTime(..., inst.Remove). */
  removaltask?: EntityTask;
  createdAt: number;
}
const PATH = 'dontstarve/common/together/moonbase/';
/** stafflight.lua's DoPeriodicTask(.1, pulse_light). */
const PULSE_PERIOD = 0.1;
const SHOWN = readonlySignal(createSignal(true));
/** The lunar_fx and star_cold clips, from the source anim.bin. */
const BEAM_LENGTHS = animationLengths('moonbase_fx.zip'),
  COLD_LENGTHS = animationLengths('star_cold.zip');
const COLD_IDLES = ['idle_loop', 'idle_loop2', 'idle_loop3'];
let nextId = 0;
/** positronbeam.lua SetBank("lunar_fx"), SetBuild("moonbase_fx"). */
const beamSource = (sprites: SpriteResources) =>
  sprites.archive({ animationArchive: 'moonbase_fx.zip', buildArchives: ['moonbase_fx.zip'], bank: 'lunar_fx' });
/** stafflight.lua SetBank/SetBuild("star_cold"), its shadow layer hidden, at the staff light's scale. */
const coldSource = (sprites: SpriteResources) =>
  sprites.archive(
    {
      animationArchive: 'star_cold.zip',
      buildArchives: ['star_cold.zip'],
      bank: 'star_cold',
      hiddenLayers: ['shadow'],
    },
    { scale: SPRITE_SCALE * 0.92 },
  );

/**
 * positronbeam.lua and stafflight.lua's nonpersistent, parented staffcoldlightfx branch. Each effect is an entity drawn
 * at the moonbase's foot point, declared on the moonbase's sprite in the SetFinalOffset order the sources give it.
 */
export class MoonbaseEffects {
  private readonly effects = new Set<Fx>();
  private front?: Fx;
  private back?: Fx;
  private pulse?: Fx;
  private cold?: Fx;
  private beamSound?: SoundHandle;
  private coldSound?: SoundHandle;
  private readonly oneShots = new Set<SoundHandle>();
  private lightstarttask?: EntityTask;
  private lightstoptask?: EntityTask;
  private readonly owner: PrefabInstance;
  private readonly scheduler: GameTimeScheduler;
  /** The world's shared sources: moonbase_fx for the beam and pulse, star_cold for the staff's cold light. */
  private readonly sprites: SpriteResources;
  constructor(owner: PrefabInstance, scheduler: GameTimeScheduler, sprites: SpriteResources) {
    this.owner = owner;
    this.scheduler = scheduler;
    this.sprites = sprites;
    if (!owner.worldServices?.scheduler) {
      owner.BindScheduler(scheduler);
    }
  }
  private create(prefab: string, clip: string, sortLayer: number, cold = false): Fx {
    const source = cold ? coldSource(this.sprites) : beamSource(this.sprites);
    const { instance, display } = createArchiveEntity(
      prefab,
      source,
      { name: clip, billboard: true },
      prefab,
      entity => {
        entity.persists = false;
        entity.addTag(cold ? 'HASHEATER' : 'FX');
        entity.sprite.setLightOverride(1);
      },
      this.owner.status,
    );
    instance.BindScheduler(this.scheduler);
    const animstate = new AnimState(this.scheduler, cold ? COLD_LENGTHS : BEAM_LENGTHS, event =>
      instance.PushEvent(event),
    );
    instance.onRemove(() => animstate.dispose());
    const fx: Fx = {
      key: `${prefab}:${nextId++}`,
      instance,
      display,
      animation: instance.sprite,
      animstate,
      createdAt: this.scheduler.now,
    };
    this.effects.add(fx);
    this.owner.sprite.attachFx(fx.key, { sprite: instance.sprite, display, active: SHOWN, sortLayer });
    return fx;
  }
  private remove(fx: Fx): void {
    if (!this.effects.delete(fx)) {
      return;
    }
    this.owner.sprite.detachFx(fx.key);
    fx.instance.remove();
    fx.display.dispose();
  }
  /** AnimState:PlayAnimation(name, loop) on the effect's logical clip and its drawn one. */
  private play(fx: Fx, name: string, loop = false): void {
    fx.animstate.PlayAnimation(name, loop);
    if (loop) {
      fx.animation.start(name);
    } else {
      fx.animation.playOnce(name);
    }
  }
  /** AnimState:PushAnimation(name, loop). */
  private push(fx: Fx, name: string, loop: boolean): void {
    fx.animstate.PushAnimation(name, loop);
    fx.animation.pushAnimation(name, loop);
  }
  private removeAfter(fx: Fx, time: number): void {
    fx.removaltask?.Cancel();
    fx.removaltask = fx.instance.DoTaskInTime(time, () => this.remove(fx));
  }
  private startLight(): void {
    this.cancelLight();
    this.lightstarttask = this.owner.DoTaskInTime(3 / 30, owner =>
      owner.light.set({ radius: 6, intensity: 0.75, falloff: 0.75, colour: [128 / 255, 128 / 255, 1] }),
    );
  }
  private stopLight(): void {
    this.cancelLight();
    this.lightstoptask = this.owner.DoTaskInTime(9 / 30, owner => owner.light.set(null));
  }
  private cancelLight(): void {
    this.lightstarttask?.Cancel();
    this.lightstarttask = undefined;
    this.lightstoptask?.Cancel();
    this.lightstoptask = undefined;
  }
  private sound(event: 'beam_level_up' | 'beam_stop' | 'beam_stop_fail'): void {
    for (const sound of this.oneShots) {
      if (!sound.isPlaying()) {
        this.oneShots.delete(sound);
      }
    }
    this.oneShots.add(PlaySound(`${PATH}${event}` as const, this.owner.position));
  }
  start(level: 1 | 2 | 3, restored = false): void {
    if (this.front && this.back) {
      this.setLevel(level, false);
      return;
    }
    this.back = this.create('positronbeam_back', 'lunar_back_pre', 0);
    this.front = this.create('positronbeam_front', 'lunar_front_pre', 2);
    for (const [fx, layer] of [
      [this.back, 'back'],
      [this.front, 'front'],
    ] as const) {
      // PlayAnimation("lunar_"..layer.."_pre"), PushAnimation("lunar_"..layer.."_loop", true).
      if (restored) {
        this.play(fx, `lunar_${layer}_loop`, true);
      } else {
        this.play(fx, `lunar_${layer}_pre`);
        this.push(fx, `lunar_${layer}_loop`, true);
      }
    }
    this.pulse = this.create('positronpulse', 'lunar_2_loop', 3);
    this.play(this.pulse, 'lunar_2_loop', true);
    this.pulse.animation.setVisible(false);
    this.beamSound = PlaySound(`${PATH}beam`, this.owner.position);
    if (!restored) {
      this.sound('beam_level_up');
    }
    this.setLevel(level, false);
    this.startLight();
  }
  setLevel(level: 1 | 2 | 3, playSound = true): void {
    if (!this.pulse) {
      return;
    }
    this.pulse.animation.setVisible(level > 1);
    if (level > 1) {
      if (this.pulse.animstate.animation.peek().name !== `lunar_${level}_loop`) {
        this.play(this.pulse, `lunar_${level}_loop`, true);
      }
      if (playSound) {
        this.sound('beam_level_up');
      }
    }
    this.beamSound?.setParameter?.('intensity', level === 1 ? 0 : level === 2 ? 0.6 : 0.9);
  }
  finish(): void {
    if (!this.pulse) {
      return;
    }
    const pulse = this.pulse;
    this.pulse = undefined;
    this.beamSound?.stop();
    this.beamSound = undefined;
    this.sound('beam_stop');
    pulse.animation.setVisible(true);
    this.play(pulse, 'lunar_full_pst');
    // DoTaskInTime(AnimState:GetCurrentAnimationLength() + 2 * FRAMES, inst.Remove)
    this.removeAfter(pulse, pulse.animstate.length + 2 / 30);
  }
  stop(): void {
    if (this.pulse) {
      this.remove(this.pulse);
      this.pulse = undefined;
    }
    this.beamSound?.stop();
    this.beamSound = undefined;
    if (this.front || this.back) {
      for (const [fx, layer] of [
        [this.front, 'front'],
        [this.back, 'back'],
      ] as const) {
        if (fx) {
          if (layer === 'front') {
            this.sound('beam_stop_fail');
          }
          // PlayAnimation("lunar_"..layer.."_pst"), ListenForEvent("animover", inst.Remove) and
          // DoTaskInTime(GetCurrentAnimationLength() + FRAMES, inst.Remove).
          this.play(fx, `lunar_${layer}_pst`);
          fx.instance.ListenForEvent('animover', () => this.remove(fx));
          this.removeAfter(fx, fx.animstate.length + 1 / 30);
        }
      }
      this.front = undefined;
      this.back = undefined;
      this.stopLight();
    } else {
      this.lightstarttask?.Cancel();
    }
  }
  showCold(): void {
    if (this.cold) {
      return;
    }
    const cold = (this.cold = this.create('staffcoldlightfx', 'appear', 1, true));
    // PlayAnimation("appear"), then ListenForEvent("animover", PlayRandomStarIdle).
    this.play(cold, 'appear');
    cold.instance.ListenForEvent('animover', () =>
      this.play(cold, COLD_IDLES[Math.floor(Math.random() * COLD_IDLES.length)]),
    );
    // DoPeriodicTask(.1, pulse_light): the light is first enabled by the first pulse, a period after spawning.
    cold.instance.DoPeriodicTask(PULSE_PERIOD, inst => inst.light.set(polarLight(this.scheduler.now - cold.createdAt)));
    this.coldSound = PlaySound('dontstarve/common/staff_coldlight_LP', this.owner.position);
  }
  hideCold(): void {
    if (this.cold) {
      this.remove(this.cold);
      this.cold = undefined;
    }
    this.coldSound?.stop();
    this.coldSound = undefined;
  }
  dispose(): void {
    this.cancelLight();
    this.beamSound?.stop();
    this.coldSound?.stop();
    for (const sound of this.oneShots) {
      sound.stop();
    }
    this.oneShots.clear();
    for (const fx of this.effects) {
      this.remove(fx);
    }
    this.front = this.back = this.pulse = this.cold = undefined;
    this.owner.light.set(null);
  }
}
