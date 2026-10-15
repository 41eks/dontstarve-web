import * as THREE from 'three';
import { findImage, smallHash, SpriteFrameRenderer, type Animation, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { GroundItemAssets } from './groundItems';
import { PlaySound, PreloadSounds, type SoundEventPath } from './sound';

/**
 * prefabs/fx.lua entries that play one animation at a world position, optionally play a sound and remove
 * themselves on animover. `opacity` is fx.lua's `tintalpha`.
 */
const FX_PREFABS = {
  fx_book_rain: { archive: 'fx_book_rain.zip', bank: 'fx_book_rain', anim: 'play_fx',
    sound: 'wickerbottom_rework/book_spells/rain' },
  fx_book_moon: { archive: 'fx_book_moon.zip', bank: 'fx_book_moon', anim: 'play_fx',
    sound: 'wickerbottom_rework/book_spells/moon' },
  // explode_small.lua MakeExplosion(): bank/build `explode`, clip `small`, blackpowder_explo sound.
  explode_small: { archive: 'explode.zip', bank: 'explode', anim: 'small', sound: 'dontstarve/common/blackpowder_explo' },
  // fx.lua crab_king_waterspout: bank Bubble_fx, build crab_king_bubble_fx, FinalOffset1.
  crab_king_waterspout: { archive: 'crab_king_bubble_fx.zip', bank: 'Bubble_fx', anim: 'waterspout',
    sound: 'hookline_2/creatures/boss/crabking/waterspout' },
  sanity_raise: { archive: 'blocker_sanity_fx.zip', bank: 'blocker_sanity_fx', anim: 'raise', opacity: .5 },
  sanity_lower: { archive: 'blocker_sanity_fx.zip', bank: 'blocker_sanity_fx', anim: 'lower', opacity: .5 },
} as const satisfies Record<string, { archive: string; bank: string; anim: string; sound?: SoundEventPath; opacity?: number }>;
export type WorldFxPrefab = keyof typeof FX_PREFABS;

type FxBuild = Awaited<ReturnType<GroundItemAssets['loadBuild']>>;
interface FxAssets { animation: Animation; build: FxBuild }
interface FxInstance {
  model: THREE.Group;
  footPosition: THREE.Vector3;
  renderer: SpriteFrameRenderer;
  assets: FxAssets;
  elapsed: number;
  frame: number;
}

export function isWorldFx(prefab: string): prefab is WorldFxPrefab { return Object.hasOwn(FX_PREFABS, prefab); }

/** Transient fx.lua prefabs spawned by components, such as the effect components/book.lua puts at the reader. */
export class WorldFx {
  private readonly scene: THREE.Scene;
  private readonly assets: GroundItemAssets;
  private readonly prepared = new Map<WorldFxPrefab, Promise<FxAssets>>();
  private readonly ready = new Map<WorldFxPrefab, FxAssets>();
  private readonly active = new Set<FxInstance>();
  private disposed = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.assets = new GroundItemAssets();
  }

  /** Load art and sound before the effect is spawned. */
  async prepare(prefab: WorldFxPrefab): Promise<void> {
    if (this.disposed) throw new Error('World fx have been disposed');
    let request = this.prepared.get(prefab);
    if (!request) {
      const definition = FX_PREFABS[prefab];
      request = (async () => {
        const [parsed, build] = await Promise.all([
          this.assets.loadAnimation(definition.archive), this.assets.loadBuild(definition.archive),
          'sound' in definition ? PreloadSounds(definition.sound) : undefined,
        ]);
        if ('opacity' in definition) for (const material of build.materials) {
          material.transparent = true; material.opacity = definition.opacity;
        }
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
    const assets = this.ready.get(prefab);
    if (!assets || this.disposed) throw new Error(`FX prefab ${prefab} has not been prepared`);
    const model = new THREE.Group();
    model.name = prefab;
    Object.assign(model.userData, { prefab, persists: false, tags: ['FX'], billboard: true });
    model.position.set(position.x, 0, position.z);
    const visual = new THREE.Group();
    visual.scale.set(0.02, -0.02, 0.02);
    model.add(visual);
    registerSpriteRenderGroup(model, visual);
    const effect: FxInstance = { model, footPosition: model.position.clone(), renderer: new SpriteFrameRenderer(visual),
      assets, elapsed: 0, frame: -1 };
    this.showFrame(effect, 0);
    this.active.add(effect);
    this.scene.add(model);
    const definition = FX_PREFABS[prefab];
    if ('sound' in definition) PlaySound(definition.sound, effect.footPosition);
  }

  get renderEntities() {
    return [...this.active].map(({ model, footPosition }) => ({ object: model, footPosition, cameraDepth: 0 }));
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    for (const effect of this.active) {
      effect.elapsed += Math.min(dt, 0.1);
      const frame = Math.floor(effect.elapsed * effect.assets.animation.frameRate + 1e-8);
      if (frame >= effect.assets.animation.frames.length) {
        this.remove(effect);
        continue;
      }
      effect.model.quaternion.copy(cameraQuaternion);
      this.showFrame(effect, frame);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const effect of [...this.active]) this.remove(effect);
    const released = new Set<THREE.Material>();
    for (const request of this.prepared.values()) void request.then(({ build }) => {
      for (const material of build.materials) {
        if (released.has(material)) continue;
        released.add(material);
        material.map?.dispose(); material.dispose();
      }
    }, () => {});
    this.prepared.clear(); this.ready.clear();
  }

  private remove(effect: FxInstance): void {
    effect.model.removeFromParent();
    effect.model.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    this.active.delete(effect);
  }

  private showFrame(effect: FxInstance, index: number): void {
    if (effect.frame === index) return;
    const sprites: ResolvedSprite[] = [];
    for (const element of [...effect.assets.animation.frames[index].elements].sort((a, b) => b.z - a.z)) {
      const image = findImage(effect.assets.build.build, element.imageHash, element.imageIndex);
      if (image) sprites.push({ element, image, materials: effect.assets.build.materials });
    }
    effect.renderer.show(sprites);
    effect.frame = index;
  }
}
