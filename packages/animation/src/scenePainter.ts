import type * as THREE from 'three';

/** One batched page's sprites this frame, in draw order (ascending foot key). */
export interface PainterPage {
  /** A stable tie-break between pages whose sprites share a key. */
  readonly id: number;
  /** Bumped whenever `entries` or their keys change. */
  readonly version: number;
  readonly entries: readonly { readonly key: number }[];
}

/** A run of one page's entries, `[start, end)`, drawn at the painter position of its first key. */
export interface PainterSegment {
  readonly start: number;
  readonly end: number;
  readonly key: number;
}

/** A batching pass that hands its pages to the painter and draws the segments it is given back. */
export interface PainterPass {
  drawSegments(scene: THREE.Scene, segments: ReadonlyMap<PainterPage, readonly PainterSegment[]>): void;
}

interface Item {
  page: PainterPage;
  index: number;
  key: number;
}

/**
 * DST draws every AnimState of a layer by depth and then final offset, one after another. Three sorts what it draws by
 * group order, which every foot-ordered sprite takes from its key: an ordinary billboard alone, a batch for the whole
 * run of sprites it draws. A run is cut wherever another page's sprite or an ordinary billboard comes between two of
 * its sprites in key order, so each batch occupies one interval of the key order and the whole scene is drawn back to
 * front.
 */
export class ScenePainter {
  private readonly scene: THREE.Scene;
  private readonly collected = new Map<PainterPass, readonly PainterPage[]>();
  /** The ordinary billboards' keys this frame, ascending, and as last given. */
  private ordinary: readonly number[] = [];
  private readonly given: number[] = [];
  private ordinaryChanged = true;
  /** What the last order was made from, and the segments it gave each pass. */
  private readonly ordered = new Map<
    PainterPass,
    {
      pages: { page: PainterPage; version: number }[];
      segments: ReadonlyMap<PainterPage, readonly PainterSegment[]>;
    }
  >();
  private readonly items: Item[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** A pass's pages this frame; it draws nothing until `order` hands back its segments. */
  collect(pass: PainterPass, pages: readonly PainterPage[]): void {
    this.collected.set(pass, pages);
  }

  /** The keys the ordinary billboards were given this frame, in any order. */
  setOrdinaryKeys(keys: readonly number[]): void {
    const given = this.given;
    if (given.length === keys.length && given.every((key, index) => key === keys[index])) {
      return;
    }
    given.length = 0;
    given.push(...keys);
    this.ordinary = [...keys].sort((a, b) => a - b);
    this.ordinaryChanged = true;
  }

  /** Whether every pass collected the same pages, unchanged, and the ordinary keys are as before. */
  private unchanged(): boolean {
    if (this.ordinaryChanged || this.collected.size !== this.ordered.size) {
      return false;
    }
    for (const [pass, pages] of this.collected) {
      const previous = this.ordered.get(pass)?.pages;
      if (!previous || previous.length !== pages.length) {
        return false;
      }
      for (let index = 0; index < pages.length; index++) {
        if (previous[index].page !== pages[index] || previous[index].version !== pages[index].version) {
          return false;
        }
      }
    }
    return true;
  }

  /** Cuts every collected page into its key-order runs and hands each pass its segments. */
  order(): void {
    if (this.collected.size === 0) {
      return;
    }
    // A frame that moved no sprite, camera or billboard keeps the last cut; only the batches' contents are uploaded.
    if (this.unchanged()) {
      for (const [pass, { segments }] of this.ordered) {
        pass.drawSegments(this.scene, segments);
      }
      this.collected.clear();
      return;
    }
    const items = this.items;
    let used = 0;
    for (const pages of this.collected.values()) {
      for (const page of pages) {
        for (let index = 0; index < page.entries.length; index++) {
          const item = (items[used++] ??= { page, index, key: 0 });
          item.page = page;
          item.index = index;
          item.key = page.entries[index].key;
        }
      }
    }
    items.length = used;
    items.sort((a, b) => a.key - b.key || a.page.id - b.page.id || a.index - b.index);
    const segments = new Map<PainterPage, PainterSegment[]>();
    const ordinary = this.ordinary;
    let barrier = 0;
    let current: { page: PainterPage; start: number; end: number; key: number } | undefined;
    const close = () => {
      if (current) {
        let list = segments.get(current.page);
        if (!list) {
          segments.set(current.page, (list = []));
        }
        list.push({ start: current.start, end: current.end, key: current.key });
      }
    };
    let previousKey = -Infinity;
    for (const item of items) {
      // The first ordinary key above the previous sprite's: an ordinary billboard drawn between the two cuts the run.
      while (barrier < ordinary.length && ordinary[barrier] <= previousKey) {
        barrier++;
      }
      const cut = barrier < ordinary.length && ordinary[barrier] < item.key;
      if (current && !cut && current.page === item.page && current.end === item.index) {
        current.end++;
      } else {
        close();
        current = { page: item.page, start: item.index, end: item.index + 1, key: item.key };
      }
      previousKey = item.key;
    }
    close();
    this.ordered.clear();
    for (const [pass, pages] of this.collected) {
      const own = new Map<PainterPage, readonly PainterSegment[]>();
      for (const page of pages) {
        const list = segments.get(page);
        if (list) {
          own.set(page, list);
        }
      }
      this.ordered.set(pass, { pages: pages.map(page => ({ page, version: page.version })), segments: own });
      pass.drawSegments(this.scene, own);
    }
    this.ordinaryChanged = false;
    this.collected.clear();
  }
}

const painters = new WeakMap<THREE.Scene, ScenePainter>();

export function scenePainter(scene: THREE.Scene): ScenePainter {
  let painter = painters.get(scene);
  if (!painter) {
    painters.set(scene, (painter = new ScenePainter(scene)));
  }
  return painter;
}

/** The ordinary billboards' keys `updateSpriteRenderOrders` wrote this frame, which cut the batches they fall inside. */
export function setOrdinarySpriteKeys(scene: THREE.Scene, keys: readonly number[]): void {
  scenePainter(scene).setOrdinaryKeys(keys);
}

/** After every pass has collected its pages: draws each batch at its place in the scene's key order. */
export function orderScenePainter(scene: THREE.Scene): void {
  painters.get(scene)?.order();
}
