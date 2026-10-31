import { PrefabDisplayGroup, SpriteResources, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { findImage, smallHash, SpriteFrameRenderer, type Animation, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { GroundItemAssets } from './groundItems';
import { PlaySound, type SoundEventPath } from './sound';
import { createEmptyEntity, createArchiveEntity } from './prefabInstance';

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
} as const satisfies Record<string, { archive: string; bank: string; anim: string; sound?: SoundEventPath; opacity?: number; scale?: number; tint?: readonly [number, number, number]; finalOffset?: number; lingerFrames?: number }>;
export type WorldFxPrefab = keyof typeof FX_PREFABS;

type FxBuild = Awaited<ReturnType<GroundItemAssets['loadBuild']>>;
interface FxAssets { animation: Animation; build: FxBuild }
interface FxInstance {
  /** The fx entity; it draws its frames itself under the display's model. */
  entity: ReturnType<typeof createEmptyEntity>;
  model: THREE.Group;
  footPosition: THREE.Vector3;
  renderer: SpriteFrameRenderer;
  /** Undefined while the art loads: the entity exists and plays from its first frame once drawn. */
  assets?: FxAssets;
  elapsed: number;
  frame: number;
  lingerFrames: number;
}

export function isWorldFx(prefab: string): prefab is WorldFxPrefab { return Object.hasOwn(FX_PREFABS, prefab); }

/** Transient fx.lua prefabs spawned by components, such as the effect components/book.lua puts at the reader. */
export class WorldFx {
  private readonly displays: PrefabDisplayGroup;
  private readonly assets: GroundItemAssets;
  private readonly prepared = new Map<WorldFxPrefab, Promise<FxAssets>>();
  private readonly ready = new Map<WorldFxPrefab, FxAssets>();
  private readonly active = new Set<FxInstance>();
  private readonly collapseSprites = new SpriteResources();
  private readonly collapses = new Set<ReturnType<typeof createArchiveEntity>>();
  private disposed = false;

  constructor(scene: THREE.Scene) {
    this.displays = new PrefabDisplayGroup(scene);
    this.assets = new GroundItemAssets();
  }

  /** structure_collapse_fx.lua: shared art, material sounds and an independent animover lifetime. */
  collapse(size: 'small' | 'big', position: THREE.Vector3, material: 'wood' | 'metal' | 'stone'): void {
    if (this.disposed) return;
    const animation = size === 'big' ? 'collapse_large' : 'collapse_small';
    const source = this.collapseSprites.archive({ animationArchive: 'structure_collapse_fx.zip',
      buildArchives: ['structure_collapse_fx.zip'], bank: 'collapse' }, { scale: .02 });
    const effect = createArchiveEntity(`collapse_${size}`, source, { name: animation, held: true, billboard: true }, `collapse_${size}`, inst => {
      inst.persists = false;
      inst.addTag('NOCLICK'); inst.addTag('FX');
      // Declare before the display binds: the one-shot must wait for its first drawn frame.
      inst.sprite.playOnce(animation, () => inst.remove());
    });
    const { instance, display } = effect;
    instance.position.copy(position);
    this.collapses.add(effect);
    instance.onRemove(() => this.collapses.delete(effect));
    this.displays.mount(display);
    PlaySound('dontstarve/common/destroy_smoke', position);
    PlaySound(`dontstarve/common/destroy_${material}`, position);
  }

  /** Load art ahead of a spawn, so its first frame is drawn at once. */
  async prepare(prefab: WorldFxPrefab): Promise<void> {
    if (this.disposed) throw new Error('World fx have been disposed');
    let request = this.prepared.get(prefab);
    if (!request) {
      const definition = FX_PREFABS[prefab];
      request = (async () => {
        const [parsed, build] = await Promise.all([
          this.assets.loadAnimation(definition.archive), this.assets.loadBuild(definition.archive),
        ]);
        if ('opacity' in definition) for (const material of build.materials) {
          material.transparent = true; material.opacity = definition.opacity;
        }
        if ('tint' in definition) for (const material of build.materials) material.color.setRGB(...definition.tint);
        const animation = parsed.animations.find((clip) => clip.name === definition.anim && clip.bankHash === smallHash(definition.bank));
        if (!animation?.frames.length) throw new Error(`Missing FX animation ${definition.bank}:${definition.anim}`);
        return { animation, build };
      })();
      this.prepared.set(prefab, request);
      void request.catch(() => this.prepared.delete(prefab));
    }
    const resources = await request;
    if (!this.disposed) this.ready.set(prefab, resources);
  }

  spawn(prefab: WorldFxPrefab, position: THREE.Vector3): void {
    if (this.disposed) throw new Error('World fx have been disposed');
    const assets = this.ready.get(prefab);
    const entity = createEmptyEntity(prefab, undefined, { billboard: true }), model = entity.display.model;
    model.userData.billboard = true;
    entity.instance.persists = false;
    entity.instance.addTag('FX');
    entity.instance.position.set(position.x, 0, position.z);
    const visual = new THREE.Group();
    const definition = FX_PREFABS[prefab];
    const scale = 'scale' in definition ? definition.scale : 1;
    visual.scale.set(0.02 * scale, -0.02 * scale, 0.02 * scale);
    model.add(visual);
    registerSpriteRenderGroup(model, visual);
    if ('finalOffset' in definition) visual.position.z = definition.finalOffset * .001;
    const effect: FxInstance = { entity, model, footPosition: model.position.clone(), renderer: new SpriteFrameRenderer(visual),
      assets, elapsed: 0, frame: -1, lingerFrames: 'lingerFrames' in definition ? definition.lingerFrames : 0 };
    if (assets) this.showFrame(effect, 0);
    else void this.prepare(prefab).then(() => {
      if (!this.active.has(effect)) return;
      effect.assets = this.ready.get(prefab);
      this.showFrame(effect, 0);
    }, (error: unknown) => {
      if (this.active.has(effect)) this.remove(effect);
      if (!this.disposed) console.error(`Unable to load FX ${prefab}`, error);
    });
    this.active.add(effect);
    this.displays.mount(prefabDisplay(model)!);
    if ('sound' in definition) PlaySound(definition.sound, effect.footPosition);
  }

  get renderEntities() {
    return [...this.active].map(({ model, footPosition }) => ({ object: model, footPosition, cameraDepth: 0 }))
      .concat([...this.collapses].map(({ display, instance }) => ({ object: display.model, footPosition: instance.position, cameraDepth: 0 })));
  }

  update(dt: number, _cameraQuaternion: THREE.Quaternion): void {
    this.displays.update(dt, _cameraQuaternion);
    for (const effect of this.active) {
      const { assets } = effect;
      if (!assets) continue;
      effect.elapsed += Math.min(dt, 0.1);
      const frame = Math.floor(effect.elapsed * assets.animation.frameRate + 1e-8);
      if (frame >= assets.animation.frames.length + effect.lingerFrames) {
        this.remove(effect);
        continue;
      }
      this.showFrame(effect, Math.min(frame, assets.animation.frames.length - 1));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const effect of [...this.active]) this.remove(effect);
    for (const { instance, display } of this.collapses) { instance.remove(); display.dispose(); }
    this.collapses.clear();
    const released = new Set<THREE.Material>();
    for (const request of this.prepared.values()) void request.then(({ build }) => {
      for (const material of build.materials) {
        if (released.has(material)) continue;
        released.add(material);
        material.map?.dispose(); material.dispose();
      }
    }, () => {});
    this.prepared.clear(); this.ready.clear();
    this.displays.dispose();
    this.collapseSprites.dispose();
  }

  private remove(effect: FxInstance): void {
    effect.model.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    effect.entity.instance.remove(); effect.entity.display.dispose();
    this.active.delete(effect);
  }

  private showFrame(effect: FxInstance, index: number): void {
    const { assets } = effect;
    if (effect.frame === index || !assets) return;
    const sprites: ResolvedSprite[] = [];
    for (const element of [...assets.animation.frames[index].elements].sort((a, b) => b.z - a.z)) {
      const image = findImage(assets.build.build, element.imageHash, element.imageIndex);
      if (image) sprites.push({ element, image, materials: assets.build.materials });
    }
    effect.renderer.show(sprites);
    effect.frame = index;
  }
}
