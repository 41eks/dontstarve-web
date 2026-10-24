import * as THREE from 'three';
import { findImage, smallHash, type AnimElement, type Animation, type Matrix2D, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import type { ArchiveSpriteBuild } from '@dontstarve-web/animation/archiveSprite';
import type { WilsonFx } from '@dontstarve-web/stategraphs';
import type { GroundItemAssets } from './groundItems';
import { PlaySound, PreloadSounds } from './sound';

/** book_fx.lua MakeBookFX("book_fx") and books.lua MakeFX("fx_roots_under_book"). */
const FX_PREFABS = {
  book_fx: { archive: 'book_fx_wicker.zip', bank: 'book_fx_wicker', anim: 'book_fx_wicker',
    failanim: 'book_fx_fail_wicker', multColour: [1, 1, 1, .4] as const },
  fx_roots_under_book: { archive: 'fx_books.zip', bank: 'fx_books', anim: 'roots' },
} as const;
export type BookFxPrefab = keyof typeof FX_PREFABS;
const BOOK_FX_FAIL_SOUND = 'wickerbottom_rework/book_spells/fail';

interface FxAssets { animations: readonly Animation[]; build: ArchiveSpriteBuild }

class FxInst implements WilsonFx {
  animation: Animation;
  elapsed = 0;
  removed = false;
  /** Ground point and mirroring retained after SetParent(nil). */
  detachedAt?: { position: THREE.Vector3; mirrored: boolean };
  readonly prefab: BookFxPrefab;
  readonly assets: FxAssets;
  readonly followHash?: number;
  private readonly owner: BookFxController;

  constructor(owner: BookFxController, prefab: BookFxPrefab, assets: FxAssets, followSymbol?: string) {
    this.owner = owner; this.prefab = prefab; this.assets = assets;
    this.followHash = followSymbol === undefined ? undefined : smallHash(followSymbol);
    this.animation = this.find(FX_PREFABS[prefab].anim);
  }

  find(name: string): Animation {
    const bank = smallHash(FX_PREFABS[this.prefab].bank);
    const animation = this.assets.animations.find(clip => clip.name === name && clip.bankHash === bank);
    if (!animation) throw new Error(`Missing FX animation ${FX_PREFABS[this.prefab].bank}:${name}`);
    return animation;
  }

  isValid(): boolean { return !this.removed; }
  remove(): void { this.removed = true; }
  detach(): void {
    if (this.removed || this.detachedAt) return;
    this.detachedAt = this.owner.ownerGroundPoint();
  }
  pushEvent(name: 'fail_fx'): void {
    const definition = FX_PREFABS[this.prefab];
    if (name !== 'fail_fx' || this.removed || !('failanim' in definition)) return;
    this.animation = this.find(definition.failanim);
    this.elapsed = 0;
    PlaySound(BOOK_FX_FAIL_SOUND);
  }
}

/** Reader-owned FX insts: parented to the player, following symbols, or left at their detach point. */
export class BookFxController {
  private readonly assets: GroundItemAssets;
  private readonly visual: THREE.Group;
  private readonly loaded = new Map<BookFxPrefab, FxAssets>();
  private readonly requests = new Map<BookFxPrefab, Promise<void>>();
  private fx: FxInst[] = [];
  private readonly point = new THREE.Vector3();

  constructor(assets: GroundItemAssets, visual: THREE.Group) { this.assets = assets; this.visual = visual; }

  get isAnimating(): boolean { return this.fx.length > 0; }

  prepare(...prefabs: BookFxPrefab[]): Promise<void> {
    return Promise.all(prefabs.map(prefab => {
      let request = this.requests.get(prefab);
      if (!request) {
        const definition = FX_PREFABS[prefab];
        request = Promise.all([
          this.assets.loadAnimation(definition.archive),
          this.assets.loadBuild(definition.archive, 'multColour' in definition ? { multColour: definition.multColour } : {}),
          prefab === 'book_fx' ? PreloadSounds(BOOK_FX_FAIL_SOUND) : undefined,
        ]).then(([anim, build]) => { this.loaded.set(prefab, { animations: anim.animations, build }); });
        this.requests.set(prefab, request);
        void request.catch(() => this.requests.delete(prefab));
      }
      return request;
    })).then(() => undefined);
  }

  isPrepared(prefab: string): prefab is BookFxPrefab {
    return Object.hasOwn(FX_PREFABS, prefab) && this.loaded.has(prefab as BookFxPrefab);
  }

  spawn(prefab: string, followSymbol?: string): WilsonFx {
    if (!this.isPrepared(prefab)) throw new Error(`FX prefab ${prefab} has not been prepared`);
    const fx = new FxInst(this, prefab, this.loaded.get(prefab)!, followSymbol);
    this.fx.push(fx);
    return fx;
  }

  ownerGroundPoint(): { position: THREE.Vector3; mirrored: boolean } {
    return { position: this.visual.parent!.getWorldPosition(new THREE.Vector3()), mirrored: this.visual.scale.x < 0 };
  }

  /** Both FX prefabs remove themselves on animover; their anims are padded for that. */
  update(dt: number): void {
    for (const fx of this.fx) {
      fx.elapsed += dt;
      if (fx.elapsed * fx.animation.frameRate + 1e-8 >= fx.animation.frames.length) fx.remove();
    }
    this.fx = this.fx.filter(fx => fx.isValid());
  }

  /** Followers replace their anchor element in layer order; parented FX draw after the body (SetFinalOffset(3)). */
  resolve(frame: readonly AnimElement[]): { followers: Map<AnimElement, ResolvedSprite[]>; front: ResolvedSprite[] } {
    const followers = new Map<AnimElement, ResolvedSprite[]>();
    const front: ResolvedSprite[] = [];
    if (this.fx.length) this.visual.updateWorldMatrix(true, false);
    for (const fx of this.fx) {
      let anchor: Matrix2D = [1, 0, 0, 1, 0, 0];
      let target = front;
      if (fx.followHash !== undefined) {
        const element = frame.find(({ imageHash }) => imageHash === fx.followHash);
        if (!element) continue;
        anchor = element.matrix;
        target = followers.get(element) ?? [];
        followers.set(element, target);
      } else if (fx.detachedAt) {
        this.visual.worldToLocal(this.point.copy(fx.detachedAt.position));
        anchor = [fx.detachedAt.mirrored === this.visual.scale.x < 0 ? 1 : -1, 0, 0, 1, this.point.x, this.point.y];
      }
      const frames = fx.animation.frames;
      const index = Math.min(frames.length - 1, Math.floor((fx.elapsed + 1e-8) * fx.animation.frameRate));
      for (const element of [...frames[index].elements].sort((a, b) => b.z - a.z)) {
        const image = findImage(fx.assets.build.build, element.imageHash, element.imageIndex);
        if (image) target.push({ element: { ...element, matrix: compose(anchor, element.matrix) }, image, materials: fx.assets.build.materials });
      }
    }
    return { followers, front };
  }

  dispose(): void { for (const fx of this.fx) fx.remove(); this.fx = []; }
}

function compose(parent: Matrix2D, child: Matrix2D): Matrix2D {
  const [a, b, c, d, tx, ty] = parent;
  const [e, f, g, h, ux, uy] = child;
  return [a * e + c * f, b * e + d * f, a * g + c * h, b * g + d * h, a * ux + c * uy + tx, b * ux + d * uy + ty];
}
