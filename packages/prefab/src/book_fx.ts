import type * as THREE from 'three';
import { smallHash } from '@dontstarve-web/animation/animationAssets';
import type { SpriteResources } from '@dontstarve-web/display';
import type { WilsonFx } from '@dontstarve-web/stategraphs';
import { createSignal } from '@dontstarve-web/signals';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createArchiveEntity, type EntityTask, type PrefabInstance } from './prefabInstance';
import { PlaySound } from './sound';
import { animationTiming } from './animationTimings';

/** book_fx.lua MakeBookFX and books.lua MakeFX, plus brokentool.lua's non-networked visual. */
const FX_PREFABS = {
  book_fx: { archive: 'book_fx_wicker.zip', bank: 'book_fx_wicker', anim: 'book_fx_wicker',
    failanim: 'book_fx_fail_wicker', opacity: .4 },
  fx_roots_under_book: { archive: 'fx_books.zip', bank: 'fx_books', anim: 'roots' },
  brokentool: { archive: 'broken_tool.zip', bank: 'broketool', anim: 'used', ground: true },
} as const;
export type BookFxPrefab = keyof typeof FX_PREFABS;
const BOOK_FX_FAIL_SOUND = 'wickerbottom_rework/book_spells/fail';
const ACTIVE = createSignal(true);

class FxInst implements WilsonFx {
  readonly instance: PrefabInstance;
  readonly prefab: BookFxPrefab;
  private readonly owner: BookFxController;
  private readonly symbol?: string;
  /** The clip's animover, which removes the FX, as a game-time task. */
  private task?: EntityTask;
  private detached?: { position: THREE.Vector3; mirrored: boolean };
  private readonly key: string;

  constructor(owner: BookFxController, prefab: BookFxPrefab, symbol?: string) {
    this.owner = owner; this.prefab = prefab; this.symbol = symbol;
    this.key = `book-fx:${owner.nextId++}`;
    const definition = FX_PREFABS[prefab];
    // SetBank / SetBuild from the FX's archive; book_fx's SetMultColour alpha needs its own translucent materials.
    const source = owner.resources.archive({ animationArchive: definition.archive, buildArchives: [definition.archive], bank: definition.bank },
      'opacity' in definition ? { opacity: definition.opacity } : {});
    const { instance, display } = createArchiveEntity(prefab, source, { name: definition.anim }, prefab, instance => {
      instance.addTag('FX');
      instance.persists = false;
      instance.sprite.playOnce(definition.anim);
      instance.sprite.setFacing(owner.instance.sprite.sprite.peek().facing ?? 8);
      if ('opacity' in definition) { instance.sprite.setOpacity(definition.opacity); }
    }, owner.instance.status);
    this.instance = instance;
    instance.BindScheduler(owner.scheduler);
    instance.onRemove(() => {
      owner.instance.sprite.detachFx(this.key);
      owner.forget(this);
    });
    if ('ground' in definition) { this.detached = owner.groundPoint(); }
    this.declare(display);
    this.removeAfter(definition.anim);
  }

  private removeAfter(name: string): void {
    const definition = FX_PREFABS[this.prefab], clip = animationTiming(definition.archive, name, smallHash(definition.bank));
    this.task?.Cancel();
    this.task = this.instance.DoTaskInTime(clip.frames / clip.frameRate, inst => inst.remove());
  }

  private declare(display: import('@dontstarve-web/display').PrefabDisplay): void {
    this.owner.instance.sprite.attachFx(this.key, { sprite: this.instance.sprite, display, active: ACTIVE, sortLayer: 2,
      composite: { symbol: this.symbol, detached: this.detached } });
  }

  private play(name: string): void {
    this.instance.sprite.playOnce(name);
    this.removeAfter(name);
  }

  isValid(): boolean { return this.instance.status.peek() !== 'removed'; }
  remove(): void { this.instance.remove(); }
  detach(): void {
    if (!this.isValid() || this.detached) { return; }
    this.detached = this.owner.groundPoint();
    const fx = this.owner.instance.sprite.fx.peek().get(this.key);
    if (!fx) { throw new Error(`${this.owner.instance.prefab} no longer declares the book fx ${this.key}`); }
    this.owner.instance.sprite.attachFx(this.key, { ...fx, composite: { symbol: this.symbol, detached: this.detached } });
  }
  pushEvent(name: 'fail_fx'): void {
    const definition = FX_PREFABS[this.prefab];
    if (name !== 'fail_fx' || !this.isValid() || !('failanim' in definition)) { return; }
    this.play(definition.failanim);
    PlaySound(BOOK_FX_FAIL_SOUND);
  }
}

/** Logical FX entities. Their timers own removal; the owner's display merges their declared frames. */
export class BookFxController {
  readonly instance: PrefabInstance;
  readonly scheduler: GameTimeScheduler;
  readonly resources: SpriteResources;
  private readonly fx = new Set<FxInst>();
  private disposed = false;
  nextId = 0;

  constructor(instance: PrefabInstance, scheduler: GameTimeScheduler, resources: SpriteResources) {
    this.instance = instance; this.scheduler = scheduler; this.resources = resources;
  }

  spawn(prefab: string, followSymbol?: string): WilsonFx {
    if (this.disposed || !Object.hasOwn(FX_PREFABS, prefab)) { throw new Error(`Invalid FX prefab ${prefab}`); }
    const fx = new FxInst(this, prefab as BookFxPrefab, followSymbol);
    this.fx.add(fx);
    return fx;
  }

  groundPoint(): { position: THREE.Vector3; mirrored: boolean } {
    return { position: this.instance.position.clone(), mirrored: this.instance.sprite.sprite.peek().mirrored === true };
  }
  forget(fx: FxInst): void { this.fx.delete(fx); }
  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    for (const fx of this.fx) { fx.remove(); }
  }
}
