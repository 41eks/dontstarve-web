import type * as THREE from 'three';
import { createEffect, createSignal, watchSignal } from '@dontstarve-web/signals';
import type { AnimatedSpriteFactory } from '@dontstarve-web/animation/sprite';
import type { BurnFX, BurnFXData } from '../../componets/src/burnable';
import { FireFX, type FireFXInst, type FireFXLevel, type FireFXLight } from '../../componets/src/firefx';
import { spawnLightEntity } from './localLight';
import { createPrefabEntity, type PrefabInstance } from './prefabInstance';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import { TILE_SIZE } from './tile';

export const CAMPFIREFIRE_ID = 'campfirefire';
export const CAMPFIREFIRE_ARCHIVE = 'campfire_fire.zip';
export const CAMPFIREFIRE_SOUNDS = ['dontstarve/common/campfire', 'dontstarve/common/fireBurstSmall',
  'dontstarve/common/fireBurstLarge', 'dontstarve/common/fireOut'] as const satisfies readonly SoundEventPath[];

const LIGHT_COLOUR = [1, 1, 192 / 255] as const;
/** campfirefire.lua firelevels. Its heater (heats 70–115) is not ported; the entity keeps the HASHEATER tag. */
const FIRE_LEVELS: readonly FireFXLevel[] = [.1, .3, .6, 1].map((soundintensity, i) => ({
  anim: `level${i + 1}`, sound: 'dontstarve/common/campfire', radius: i + 2, intensity: .8, falloff: .33,
  colour: LIGHT_COLOUR, soundintensity,
}));

// A follower is shown for as long as it exists; its removal takes the declaration away.
const SHOWN = createSignal(true);
let nextId = 0;

/**
 * campfirefire.lua, spawned by its owner's Burnable:SpawnFX. It follows the owner's symbol (followlayered), so its
 * frame is merged into the owner's at that symbol's layer; SetFinalOffset(3) only orders it among that layer's
 * followers. SetBloomEffectHandle has no renderer here.
 */
export class CampfireFire implements BurnFX, FireFXInst {
  readonly instance: PrefabInstance;
  readonly components: { firefx: FireFX };
  private readonly owner: PrefabInstance;
  private readonly ownerModel: THREE.Object3D;
  private readonly key = `${CAMPFIREFIRE_ID}:${nextId++}`;
  private readonly sounds = new Map<string, SoundHandle>();
  private readonly cleanups: (() => void)[] = [];
  private onAnimOver?: () => void;

  constructor(factory: AnimatedSpriteFactory, owner: PrefabInstance, ownerModel: THREE.Object3D, data: BurnFXData) {
    this.owner = owner;
    this.ownerModel = ownerModel;
    const { instance, display } = createPrefabEntity(CAMPFIREFIRE_ID, {
      create: name => factory.create({ initialAnimation: name, name: CAMPFIREFIRE_ID }),
      release: sprite => factory.disposeSprite(sprite),
    }, { name: FIRE_LEVELS[0].anim }, CAMPFIREFIRE_ID, instance => {
      instance.addTag('FX');
      instance.addTag('HASHEATER');
      instance.persists = false;
    }, owner.status);
    this.instance = instance;
    owner.sprite.attachFx(this.key, { sprite: instance.sprite, display, active: SHOWN, sortLayer: 2,
      composite: { symbol: data.follow, offset: [data.x, data.y] } });
    const firefx = new FireFX(this);
    firefx.levels = FIRE_LEVELS;
    this.components = { firefx };
    firefx.SetLevel(1);
    // OnEntitySleep / OnEntityWake follow the owner's tile with the fx entity.
    const status = watchSignal(instance.status, stop => this.cleanups.push(stop));
    createEffect(() => {
      const value = status.get();
      if (value === 'asleep') firefx.OnEntitySleep();
      else if (value === 'active') firefx.OnEntityWake();
    });
  }

  Remove(): void {
    if (this.instance.status.peek() === 'removed') return;
    this.onAnimOver = undefined;
    this.cleanups.splice(0).forEach(stop => stop());
    this.components.firefx.OnRemoveEntity();
    for (const sound of this.sounds.values()) sound.stop();
    this.sounds.clear();
    this.owner.sprite.detachFx(this.key);
    this.instance.remove();
  }

  RemoveOnAnimOver(): void { this.onAnimOver = () => this.Remove(); }

  PlayAnimation(name: string, loop = false): void {
    if (loop) this.instance.sprite.start(name);
    else this.instance.sprite.playOnce(name, () => this.onAnimOver?.());
  }
  PushAnimation(name: string, loop = false): void { this.instance.sprite.pushAnimation(name, loop); }

  PlaySound(path: string, name?: string): void {
    const sound = PlaySound(path as SoundEventPath, this.ownerModel.position);
    if (name === undefined) return;
    this.sounds.get(name)?.stop();
    this.sounds.set(name, sound);
  }
  KillSound(name: string): void {
    this.sounds.get(name)?.stop();
    this.sounds.delete(name);
  }
  PlayingSound(name: string): boolean { return this.sounds.get(name)?.isPlaying() ?? false; }
  SetSoundParameter(name: string, parameter: string, value: number): void { this.sounds.get(name)?.setParameter?.(parameter, value); }
  IsAsleep(): boolean { return this.instance.status.peek() === 'asleep'; }

  /** SpawnPrefab("firefx_light"): its radius is in DST units. */
  SpawnLight(): FireFXLight {
    const light = spawnLightEntity('firefx_light');
    return {
      set: json => light.instance.light.set(json && { ...json, radius: json.radius * (TILE_SIZE / 4) }),
      // FireFX parents it to this entity, then Burnable:SpawnFX AttachLightTo(inst), the owner that spawned this fire. This
      // entity's frame is merged into the owner's, so its own model is not in the scene: the light stands at the owner either way.
      SetParent: () => light.setParent(this.owner),
      Remove: () => light.remove(),
    };
  }
}
