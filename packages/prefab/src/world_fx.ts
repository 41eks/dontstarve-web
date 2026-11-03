import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { PrefabDisplayGroup, SpriteResources, type ArchiveSpriteSource } from '@dontstarve-web/display';
import type * as THREE from 'three';
import { PlaySound, type SoundEventPath } from './sound';
import { createArchiveEntity } from './prefabInstance';

interface FxDefinition {
  readonly archive: string;
  readonly bank: string;
  readonly anim: string;
  readonly sound?: SoundEventPath;
  readonly opacity?: number;
  readonly scale?: number;
  readonly tint?: readonly [number, number, number];
  /** AnimState:SetFinalOffset above the entity's layer: drawn a few depth steps towards the camera. */
  readonly finalOffset?: number;
  /** Frames between animover and Remove, as wortox_portal_fx.lua's DoTaskInTime(2 * FRAMES). */
  readonly lingerFrames?: number;
}

/**
 * prefabs/fx.lua entries that play one animation at a world position, optionally play a sound and remove
 * themselves on animover. `opacity` is fx.lua's `tintalpha`.
 */
const FX_PREFABS = {
  // wortox_portal_fx.lua: wilson bank, wortox_portal build, animover + 2 FRAMES.
  wortox_portal_jumpin_fx: { archive: 'wortox_portal.zip', bank: 'wilson', anim: 'wortox_portal_jumpin', finalOffset: 3, lingerFrames: 2 },
  wortox_portal_jumpout_fx: { archive: 'wortox_portal.zip', bank: 'wilson', anim: 'wortox_portal_jumpout', finalOffset: 3, lingerFrames: 2 },
  fx_book_rain: { archive: 'fx_book_rain.zip', bank: 'fx_book_rain', anim: 'play_fx',
    sound: 'wickerbottom_rework/book_spells/rain' },
  fx_book_moon: { archive: 'fx_book_moon.zip', bank: 'fx_book_moon', anim: 'play_fx',
    sound: 'wickerbottom_rework/book_spells/moon' },
  // explode_small.lua MakeExplosion(): bank/build `explode`, clip `small`, blackpowder_explo sound.
  explode_small: { archive: 'explode.zip', bank: 'explode', anim: 'small', sound: 'dontstarve/common/blackpowder_explo' },
  // fx.lua crab_king_waterspout: bank Bubble_fx, build crab_king_bubble_fx, FinalOffset1.
  crab_king_waterspout: { archive: 'crab_king_bubble_fx.zip', bank: 'Bubble_fx', anim: 'waterspout',
    sound: 'hookline_2/creatures/boss/crabking/waterspout' },
  // fx.lua die_fx: bank die_fx, build die, clip small, deathpoof sound, brown mult colour.
  die_fx: { archive: 'die.zip', bank: 'die_fx', anim: 'small', sound: 'dontstarve/common/deathpoof',
    tint: [90 / 255, 66 / 255, 41 / 255] },
  // staff_projectile.lua OnHitFire → fx.lua fire_fail_fx: bank/build fire_fail_fx, clip fx, fireOut sound.
  fire_fail_fx: { archive: 'fire_fail_fx.zip', bank: 'fire_fail_fx', anim: 'fx', sound: 'dontstarve/common/fireOut' },
  // fx.lua lightning_rod_fx: bank/build lightning_rod_fx, clip idle.
  lightning_rod_fx: { archive: 'lightning_rod_fx.zip', bank: 'lightning_rod_fx', anim: 'idle' },
  // lightning.lua: bank/build lightning, clip anim, Transform:SetScale(2, 2, 2), thunder_close.
  lightning: { archive: 'lightning.zip', bank: 'lightning', anim: 'anim', sound: 'dontstarve/rain/thunder_close', scale: 2 },
  // fx.lua halloween_moonpuff: bank fx_moon_tea, build moon_tea_fx, clip puff, FinalOffset3, fireAddFuel (bloom is not rendered).
  halloween_moonpuff: { archive: 'moon_tea_fx.zip', bank: 'fx_moon_tea', anim: 'puff', sound: 'dontstarve/common/fireAddFuel', finalOffset: 3 },
  sanity_raise: { archive: 'blocker_sanity_fx.zip', bank: 'blocker_sanity_fx', anim: 'raise', opacity: .5 },
  sanity_lower: { archive: 'blocker_sanity_fx.zip', bank: 'blocker_sanity_fx', anim: 'lower', opacity: .5 },
} as const satisfies Record<string, FxDefinition>;
export type WorldFxPrefab = keyof typeof FX_PREFABS;

const FRAMES = 1 / 30;

export function isWorldFx(prefab: string): prefab is WorldFxPrefab { return Object.hasOwn(FX_PREFABS, prefab); }

type Effect = ReturnType<typeof createArchiveEntity>;

/** Transient fx.lua prefabs spawned by components, such as the effect components/book.lua puts at the reader. */
export class WorldFx {
  private readonly displays: PrefabDisplayGroup;
  private readonly sprites = new SpriteResources();
  private readonly effects = new Set<Effect>();
  /** Effects past their animover, waiting out the source's delay before Remove, with the seconds left. */
  private readonly lingering = new Map<Effect, number>();
  private disposed = false;

  constructor(scene: THREE.Scene) {
    this.displays = new PrefabDisplayGroup(scene);
  }

  /** An entity that plays one clip from its first drawn frame; its display loads the art, then it ends itself. */
  private play(prefab: string, source: ArchiveSpriteSource, animation: string, lingerFrames: number, initialize: (inst: Effect['instance']) => void): Effect {
    const effect: Effect = createArchiveEntity(prefab, source, { name: animation, held: true, billboard: true }, prefab, inst => {
      inst.persists = false;
      initialize(inst);
      // Declare before the display binds: the one-shot must wait for its first drawn frame.
      inst.sprite.playOnce(animation, () => {
        if (lingerFrames > 0) this.lingering.set(effect, lingerFrames * FRAMES);
        else inst.remove();
      });
    });
    this.effects.add(effect);
    effect.instance.onRemove(() => { this.effects.delete(effect); this.lingering.delete(effect); });
    this.displays.mount(effect.display);
    return effect;
  }

  /** structure_collapse_fx.lua: shared art, material sounds and an independent animover lifetime. */
  collapse(size: 'small' | 'big', position: ReadonlyVector3, material?: 'wood' | 'metal' | 'stone' | 'rock' | 'straw' | 'pot'): void {
    if (this.disposed) return;
    const source = this.sprites.archive({ animationArchive: 'structure_collapse_fx.zip',
      buildArchives: ['structure_collapse_fx.zip'], bank: 'collapse' }, { scale: .02 });
    const { instance } = this.play(`collapse_${size}`, source, size === 'big' ? 'collapse_large' : 'collapse_small', 0, inst => {
      inst.addTag('NOCLICK'); inst.addTag('FX');
    });
    instance.copyPosition(position);
    PlaySound('dontstarve/common/destroy_smoke', position);
    if (material) PlaySound(material === 'rock' ? 'dontstarve/wilson/rock_break' : `dontstarve/common/destroy_${material}`, position);
  }

  spawn(prefab: WorldFxPrefab, position: ReadonlyVector3): void {
    if (this.disposed) throw new Error('World fx have been disposed');
    const definition: FxDefinition = FX_PREFABS[prefab];
    const [red, green, blue] = definition.tint ?? [1, 1, 1];
    const source = this.sprites.archive({ animationArchive: definition.archive, buildArchives: [definition.archive], bank: definition.bank,
      multColour: [red, green, blue, definition.opacity ?? 1] }, { scale: .02 * (definition.scale ?? 1) });
    const { instance } = this.play(prefab, source, definition.anim, definition.lingerFrames ?? 0, inst => {
      inst.addTag('FX');
      if (definition.finalOffset) inst.sprite.setDepthOffset(true);
    });
    instance.setPosition(position.x, 0, position.z);
    if (definition.sound) PlaySound(definition.sound, instance.position);
  }

  get renderEntities() {
    return [...this.effects].map(({ display, instance }) => ({ object: display.model, footPosition: instance.position, cameraDepth: 0 }));
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    // The removal is taken up by the displays' update below.
    for (const [effect, seconds] of [...this.lingering]) {
      if (seconds <= dt) effect.instance.remove();
      else this.lingering.set(effect, seconds - dt);
    }
    this.displays.update(dt, cameraQuaternion);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { instance, display } of [...this.effects]) { instance.remove(); display.dispose(); }
    this.effects.clear();
    this.lingering.clear();
    this.displays.dispose();
    this.sprites.dispose();
  }
}
