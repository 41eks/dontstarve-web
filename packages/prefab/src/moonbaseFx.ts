import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import type { PrefabDisplay, SpriteResources, SpriteState } from '@dontstarve-web/display';
import { createPrefabEntity, type PrefabInstance, prefabInstance } from './prefabInstance';
import { ComponentTimer } from '../../componets/src/timer';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import { polarLight } from './stafflight';
import { createEffect } from '@dontstarve-web/signals';
import type { BuildingRenderEffect } from './animatedBuildingPlacement';

interface Fx extends BuildingRenderEffect {
  instance: PrefabInstance;
  display: PrefabDisplay;
  animation: SpriteState;
  removal: ComponentTimer;
  createdAt: number;
  stop?: () => void;
}
const PATH = 'dontstarve/common/together/moonbase/';
const beamSource = (sprites: SpriteResources, prefab: string) => sprites.animated('moonbase_fx.zip', {}, { name: prefab, scale: .02 });
const coldSource = (sprites: SpriteResources, prefab: string) =>
  sprites.animated('star_cold.zip', {}, { name: prefab, scale: .02 * .92, hiddenLayers: ['shadow'] });
/** positronbeam / positronpulse / staffcoldlightfx, the moonbase's prefab dependencies. */
export const moonbaseFxSources = (sprites: SpriteResources) => [
  ...['positronbeam_back', 'positronbeam_front', 'positronpulse'].map(prefab => beamSource(sprites, prefab)), coldSource(sprites, 'staffcoldlightfx')];

/** positronbeam.lua and stafflight.lua's nonpersistent, parented staffcoldlightfx branch. */
export class MoonbaseEffects {
  private readonly effects = new Set<Fx>();
  private front?: Fx;
  private back?: Fx;
  private pulse?: Fx;
  private cold?: Fx;
  private beamSound?: SoundHandle;
  private coldSound?: SoundHandle;
  private readonly oneShots = new Set<SoundHandle>();
  private readonly lightStart: ComponentTimer;
  private readonly lightStop: ComponentTimer;
  private readonly model: THREE.Group;
  private readonly displays: PrefabDisplayGroup;
  private readonly scheduler: GameTimeScheduler;
  /** The placement's shared sources: moonbase_fx for the beam and pulse, star_cold for the staff's cold light. */
  private readonly sprites: SpriteResources;
  constructor(model: THREE.Group, displays: PrefabDisplayGroup, scheduler: GameTimeScheduler, sprites: SpriteResources) {
    this.model = model; this.displays = displays; this.scheduler = scheduler; this.sprites = sprites;
    this.lightStart = new ComponentTimer(scheduler, () => prefabInstance(model)!.light.set(
      { radius: 6, intensity: .75, falloff: .75, colour: [128 / 255, 128 / 255, 1] }));
    this.lightStop = new ComponentTimer(scheduler, () => prefabInstance(model)!.light.set(null));
  }
  private foot(): THREE.Vector3 { return this.model.position; }
  private create(prefab: string, clip: string, sortLayer: number, cold = false): Fx {
    const source = cold ? coldSource(this.sprites, prefab) : beamSource(this.sprites, prefab);
    const { instance, display } = createPrefabEntity(prefab, source, { name: clip, billboard: true }, prefab);
    const object = display.model;
    instance.position.copy(this.foot());
    instance.persists = false;
    instance.addTag(cold ? 'HASHEATER' : 'FX');
    instance.sprite.setLightOverride(1);
    let fx!: Fx;
    const removal = new ComponentTimer(this.scheduler, () => this.remove(fx));
    fx = { object, sortLayer, instance, display, removal,
      animation: instance.sprite, createdAt: this.scheduler.now };
    this.effects.add(fx); this.displays.mount(prefabDisplay(object)!);
    return fx;
  }
  private remove(fx: Fx): void {
    if (!this.effects.delete(fx)) return;
    fx.stop?.(); fx.removal.stop(); fx.instance.remove(); fx.display.dispose();
  }
  private sound(event: string): void {
    for (const sound of this.oneShots) if (!sound.isPlaying()) this.oneShots.delete(sound);
    this.oneShots.add(PlaySound(`${PATH}${event}` as SoundEventPath, this.model.position));
  }
  start(level: 1 | 2 | 3, restored = false): void {
    if (this.front && this.back) { this.setLevel(level, false); return; }
    this.back = this.create('positronbeam_back', 'lunar_back_pre', 0);
    this.front = this.create('positronbeam_front', 'lunar_front_pre', 2);
    for (const [fx, layer] of [[this.back, 'back'], [this.front, 'front']] as const) {
      if (restored) fx.animation.start(`lunar_${layer}_loop`);
      else fx.animation.playOnce(`lunar_${layer}_pre`, () => fx.animation.start(`lunar_${layer}_loop`));
    }
    this.pulse = this.create('positronpulse', 'lunar_2_loop', 3);
    this.pulse.animation.start('lunar_2_loop'); this.pulse.animation.setVisible(false);
    this.beamSound = PlaySound(`${PATH}beam`, this.model.position);
    if (!restored) this.sound('beam_level_up');
    this.setLevel(level, false);
    this.lightStop.stop(); this.lightStart.start(3 / 30);
  }
  setLevel(level: 1 | 2 | 3, playSound = true): void {
    if (!this.pulse) return;
    this.pulse.animation.setVisible(level > 1);
    if (level > 1) {
      if (this.pulse.animation.currentAnimation !== `lunar_${level}_loop`) this.pulse.animation.start(`lunar_${level}_loop`);
      if (playSound) this.sound('beam_level_up');
    }
    this.beamSound?.setParameter?.('intensity', level === 1 ? 0 : level === 2 ? .6 : .9);
  }
  finish(): void {
    if (!this.pulse) return;
    const pulse = this.pulse; this.pulse = undefined;
    this.beamSound?.stop(); this.beamSound = undefined;
    this.sound('beam_stop'); pulse.animation.setVisible(true);
    pulse.animation.playOnce('lunar_full_pst');
    // DoTaskInTime(AnimState:GetCurrentAnimationLength() + 2 * FRAMES, inst.Remove)
    pulse.removal.start(pulse.animation.currentAnimationLength + 2 / 30);
  }
  stop(): void {
    if (this.pulse) { this.remove(this.pulse); this.pulse = undefined; }
    this.beamSound?.stop(); this.beamSound = undefined;
    if (this.front || this.back) {
      for (const [fx, layer] of [[this.front, 'front'], [this.back, 'back']] as const) if (fx) {
        if (layer === 'front') this.sound('beam_stop_fail');
        // ListenForEvent("animover", inst.Remove) and DoTaskInTime(GetCurrentAnimationLength() + FRAMES, inst.Remove)
        fx.animation.playOnce(`lunar_${layer}_pst`, () => this.remove(fx));
        fx.removal.start(fx.animation.currentAnimationLength + 1 / 30);
      }
      this.front = undefined; this.back = undefined;
      this.lightStop.start(9 / 30);
    }
    this.lightStart.stop();
  }
  showCold(): void {
    if (this.cold) return;
    const cold = this.cold = this.create('staffcoldlightfx', 'idle_loop', 1, true);
    // ListenForEvent("animover", PlayRandomStarIdle): an undrawn sprite has no animover, so it holds idle_loop and the random
    // chain resumes once the display has drawn it again.
    let chaining = false;
    const idle = () => {
      if (this.cold !== cold) return;
      chaining = cold.animation.loaded;
      if (chaining) cold.animation.playOnce(['idle_loop', 'idle_loop2', 'idle_loop3'][Math.floor(Math.random() * 3)], idle);
      else cold.animation.start('idle_loop');
    };
    cold.stop = createEffect(() => { cold.animation.art.get(); if (!chaining) idle(); });
    this.coldSound = PlaySound('dontstarve/common/staff_coldlight_LP', this.model.position);
  }
  hideCold(): void {
    if (this.cold) { this.remove(this.cold); this.cold = undefined; }
    this.coldSound?.stop(); this.coldSound = undefined;
  }
  update(dt: number): void {
    const foot = this.foot();
    for (const fx of this.effects) {
      fx.instance.position.copy(foot); fx.display.update(dt);
    }
    if (this.cold) prefabInstance(this.cold.object)!.light.set(polarLight(this.scheduler.now - this.cold.createdAt));
  }
  get renderEntities(): readonly BuildingRenderEffect[] { return [...this.effects]; }
  dispose(): void {
    this.lightStart.stop(); this.lightStop.stop();
    this.beamSound?.stop(); this.coldSound?.stop();
    for (const sound of this.oneShots) sound.stop(); this.oneShots.clear();
    for (const fx of this.effects) this.remove(fx);
    this.front = this.back = this.pulse = this.cold = undefined;
    prefabInstance(this.model)!.light.set(null);
  }
}
