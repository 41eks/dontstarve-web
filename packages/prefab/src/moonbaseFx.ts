import * as THREE from 'three';
import type { AnimatedSpriteFactory } from '@dontstarve-web/animation/sprite';
import type { PrefabDisplay, SpriteState } from '@dontstarve-web/display';
import { createPrefabEntity, type PrefabInstance, prefabInstance } from './prefabInstance';
import { ComponentTimer } from '../../componets/src/timer';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import { polarLight } from './stafflight';
import type { BuildingRenderEffect } from './animatedBuildingPlacement';

export interface MoonbaseFxResources {
  beamFactory: AnimatedSpriteFactory;
  coldFactory: AnimatedSpriteFactory;
  durations: Readonly<Record<string, number>>;
}
interface Fx extends BuildingRenderEffect {
  instance: PrefabInstance;
  display: PrefabDisplay;
  animation: SpriteState;
  removal: ComponentTimer;
  createdAt: number;
}
const PATH = 'dontstarve/common/together/moonbase/';

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
  private readonly scene: THREE.Scene;
  private readonly scheduler: GameTimeScheduler;
  private readonly resources: MoonbaseFxResources;
  constructor(model: THREE.Group, scene: THREE.Scene, scheduler: GameTimeScheduler, resources: MoonbaseFxResources) {
    this.model = model; this.scene = scene; this.scheduler = scheduler; this.resources = resources;
    this.lightStart = new ComponentTimer(scheduler, () => prefabInstance(model)!.light.set(
      { radius: 6, intensity: .75, falloff: .75, colour: [128 / 255, 128 / 255, 1] }));
    this.lightStop = new ComponentTimer(scheduler, () => prefabInstance(model)!.light.set(null));
  }
  private foot(): THREE.Vector3 { return this.model.userData.getGroundPosition?.() ?? this.model.position.clone(); }
  private create(prefab: string, clip: string, sortLayer: number, cold = false): Fx {
    const factory = cold ? this.resources.coldFactory : this.resources.beamFactory;
    const { instance, display } = createPrefabEntity(prefab, { create: initialAnimation => factory.create({ initialAnimation, name: prefab,
      scale: cold ? .02 * .92 : .02, ...(cold ? { hiddenLayers: ['shadow'] } : {}) }), release: sprite => factory.disposeSprite(sprite) },
      { name: clip }, prefab);
    const object = display.model;
    instance.position.copy(this.foot()); object.quaternion.copy(this.model.quaternion);
    instance.persists = false;
    instance.addTag(cold ? 'HASHEATER' : 'FX');
    instance.sprite.setLightOverride(1);
    let fx!: Fx;
    const removal = new ComponentTimer(this.scheduler, () => this.remove(fx));
    fx = { object, sortLayer, instance, display, removal,
      animation: instance.sprite, createdAt: this.scheduler.now };
    this.effects.add(fx); this.scene.add(object);
    return fx;
  }
  private remove(fx: Fx): void {
    if (!this.effects.delete(fx)) return;
    fx.removal.stop(); fx.instance.remove(); fx.display.dispose();
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
    pulse.removal.start(this.resources.durations.lunar_full_pst + 2 / 30);
  }
  stop(): void {
    if (this.pulse) { this.remove(this.pulse); this.pulse = undefined; }
    this.beamSound?.stop(); this.beamSound = undefined;
    if (this.front || this.back) {
      for (const [fx, layer] of [[this.front, 'front'], [this.back, 'back']] as const) if (fx) {
        if (layer === 'front') this.sound('beam_stop_fail');
        fx.animation.playOnce(`lunar_${layer}_pst`);
        fx.removal.start(this.resources.durations[`lunar_${layer}_pst`] + 1 / 30);
      }
      this.front = undefined; this.back = undefined;
      this.lightStop.start(9 / 30);
    }
    this.lightStart.stop();
  }
  showCold(): void {
    if (this.cold) return;
    const cold = this.cold = this.create('staffcoldlightfx', 'idle_loop', 1, true);
    const idle = () => { if (this.cold === cold) cold.animation.playOnce(['idle_loop', 'idle_loop2', 'idle_loop3'][Math.floor(Math.random() * 3)], idle); };
    cold.animation.playOnce('idle_loop', idle);
    this.coldSound = PlaySound('dontstarve/common/staff_coldlight_LP', this.model.position);
  }
  hideCold(): void {
    if (this.cold) { this.remove(this.cold); this.cold = undefined; }
    this.coldSound?.stop(); this.coldSound = undefined;
  }
  update(dt: number): void {
    const foot = this.foot();
    for (const fx of this.effects) {
      fx.instance.position.copy(foot); fx.object.quaternion.copy(this.model.quaternion); fx.animation.update(dt);
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
