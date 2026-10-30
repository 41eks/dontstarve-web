import { createEffect, createSignal, watchSignal } from '@dontstarve-web/signals';
import type { LoadedSpriteSource } from '@dontstarve-web/display';
import type { BurnFX } from '../../componets/src/burnable';
import { FireFX, type FireFXInst, type FireFXLevel, type FireFXLight } from '../../componets/src/firefx';
import { spawnLightEntity } from './localLight';
import { createPrefabEntity, type PrefabInstance } from './prefabInstance';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import { TILE_SIZE } from './tile';

export const FIRE_ID = 'fire';
export const FIRE_ARCHIVE = 'fire.zip';

/** fire.lua firelevels. Its controlled-burn clips, heater (heats 30–240) and extinguishsoundtest are not ported. */
const FIRE_LEVELS: readonly FireFXLevel[] = [
  { anim: 'level1', sound: 'dontstarve/common/campfire', radius: 2, intensity: .75, falloff: .33, colour: [197 / 255, 197 / 255, 170 / 255], soundintensity: .1 },
  { anim: 'level2', sound: 'dontstarve/common/campfire', radius: 3, intensity: .8, falloff: .33, colour: [1, 1, 192 / 255], soundintensity: .3 },
  { anim: 'level3', sound: 'dontstarve/common/campfire', radius: 4, intensity: .8, falloff: .33, colour: [1, 1, 192 / 255], soundintensity: .6 },
  { anim: 'level4', sound: 'dontstarve/common/campfire', radius: 5, intensity: .9, falloff: .25, colour: [1, 190 / 255, 121 / 255], soundintensity: 1 },
  { anim: 'level4', sound: 'dontstarve/common/forestfire', radius: 6, intensity: .9, falloff: .2, colour: [1, 190 / 255, 121 / 255], soundintensity: 1 },
  { anim: 'level5', sound: 'dontstarve/common/forestfire', radius: 7, intensity: .9, falloff: .2, colour: [1, 190 / 255, 121 / 255], soundintensity: 1 },
];

// A child is shown for as long as it exists; its removal takes the declaration away.
const SHOWN = createSignal(true);
let nextId = 0;

/**
 * fire.lua, spawned by its owner's Burnable:SpawnFX. Every burnable here adds it without a follow symbol, so it is the
 * owner's child (AddChild) at the owner's origin and drawn after it; SetBloomEffectHandle has no renderer here.
 */
export class Fire implements BurnFX, FireFXInst {
  readonly instance: PrefabInstance;
  readonly components: { firefx: FireFX };
  private readonly owner: PrefabInstance;
  private readonly key = `${FIRE_ID}:${nextId++}`;
  private readonly sounds = new Map<string, SoundHandle>();
  private readonly cleanups: (() => void)[] = [];

  constructor(source: LoadedSpriteSource, owner: PrefabInstance) {
    this.owner = owner;
    const { instance, display } = createPrefabEntity(FIRE_ID, source, { name: FIRE_LEVELS[0].anim, billboard: true }, FIRE_ID,
      instance => {
        instance.addTag('FX');
        instance.addTag('HASHEATER');
        instance.persists = false;
      }, owner.status);
    this.instance = instance;
    owner.sprite.attachFx(this.key, { sprite: instance.sprite, display, active: SHOWN, sortLayer: 2 });
    const firefx = new FireFX(this);
    firefx.levels = FIRE_LEVELS;
    this.components = { firefx };
    // OnEntitySleep / OnEntityWake follow the owner's tile with the child.
    const status = watchSignal(owner.status, stop => this.cleanups.push(stop));
    createEffect(() => {
      const value = status.get();
      if (value === 'asleep') firefx.OnEntitySleep();
      else if (value === 'active') firefx.OnEntityWake();
    });
  }

  Remove(): void {
    if (this.instance.status.peek() === 'removed') return;
    this.cleanups.splice(0).forEach(stop => stop());
    this.components.firefx.OnRemoveEntity();
    for (const sound of this.sounds.values()) sound.stop();
    this.sounds.clear();
    this.owner.sprite.detachFx(this.key);
    this.instance.remove();
  }

  /** fire.lua's levels have no going-out clip, so Extinguish never asks for this. */
  RemoveOnAnimOver(): void { this.Remove(); }

  PlayAnimation(name: string, loop = false): void {
    if (loop) this.instance.sprite.start(name);
    else this.instance.sprite.playOnce(name);
  }
  PushAnimation(name: string, loop = false): void { this.instance.sprite.pushAnimation(name, loop); }

  PlaySound(path: string, name?: string): void {
    const sound = PlaySound(path as SoundEventPath, this.owner.position);
    if (name === undefined) return;
    this.sounds.get(name)?.stop();
    this.sounds.set(name, sound);
  }
  KillSound(name: string): void {
    this.sounds.get(name)?.stop();
    this.sounds.delete(name);
  }
  PlayingSound(name: string): boolean { return this.sounds.get(name)?.isPlaying?.() ?? false; }
  SetSoundParameter(name: string, parameter: string, value: number): void { this.sounds.get(name)?.setParameter?.(parameter, value); }
  IsAsleep(): boolean { return this.owner.status.peek() === 'asleep'; }

  /** SpawnPrefab("firefx_light"): its radius is in DST units. */
  SpawnLight(): FireFXLight {
    const light = spawnLightEntity('firefx_light');
    return {
      set: json => light.instance.light.set(json && { ...json, radius: json.radius * (TILE_SIZE / 4) }),
      // FireFX parents it to this entity, then Burnable:SpawnFX AttachLightTo(inst), the owner that spawned this fire.
      SetParent: target => light.setParent(target === this ? this.instance : this.owner),
      Remove: () => light.remove(),
    };
  }
}
