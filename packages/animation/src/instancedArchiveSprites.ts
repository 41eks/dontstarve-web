import * as THREE from 'three';
import type { Animation, ResolvedSprite } from './animationAssets';
import { compileSceneAsync } from './compileScene';
import { InstancedSpriteAtlases, appearanceLocation, type Appearance } from './instancedSpriteAtlases';
import { InstancedSpriteBatches, type BatchPage, type BatchedSegment, type SegmentKey } from './instancedSpriteBatches';
import { SpriteCameraView, createSpriteSpatial, type FootOrder, type SpriteSpatial } from './instancedSpriteOrder';
import { watchWorldMatrixChanges } from './matrixUpdates';
import { NO_OCEAN_SHADING, type SpriteOceanShading } from './oceanShading';
import type { InstancedPartFrame } from './instancedPartTable';
import type { RgbaSpriteAtlasFrame } from './rgbaSpriteAtlas';
import { registerSceneRenderPass, type SceneRenderPass } from './sceneRenderPass';
import {
  orderScenePainter,
  scenePainter,
  type PainterPage,
  type PainterPass,
  type PainterSegment,
} from './scenePainter';
import { spritePerf } from './spritePerf';

/** One entity's retained instance. The pass draws it only while the display layer lists it as a member. */
export interface InstancedSprite {
  readonly pass: InstancedArchiveSprites;
  show(key: string, animation: Animation, resolve: () => (frameIndex: number) => ResolvedSprite[], frame: number): void;
  hide(): void;
  setOpacity(value: number): void;
  setColour(value: readonly [number, number, number]): void;
  /** AnimState:SetErosionParams's amount, independent for each entity in a shared batch. */
  setErosion(value: number): void;
  /** AnimState:SetFloatParams and SetOceanBlendParams, independent for each entity in a shared batch. */
  setOceanShading(value: SpriteOceanShading): void;
  /**
   * Drawn after the others on its foot (a positive SetFinalOffset, as fire.lua's effect after its owner): its foot key
   * takes sort layer 2, as an ordinary billboard's does.
   */
  setDepthOffset(enabled: boolean): void;
  dispose(): void;
}
/** A drawn sprite as the display layer lists it: its instance and its entity's AnimState light override. */
export interface InstancedSpriteMember {
  readonly sprite: InstancedSprite | undefined;
  readonly lightOverride: number;
}
interface Entry extends InstancedSprite {
  model: THREE.Object3D;
  foot: THREE.Object3D;
  visual: THREE.Group;
  colour: THREE.Color;
  opacity: number;
  erosion: number;
  ocean: SpriteOceanShading;
  depthOffset: boolean;
  styleVersion: number;
  transformVersion: number;
  appearance?: Appearance;
  /** The last drawable appearance, drawn while a newly shown one still waits for its pages or part table. */
  ready?: Appearance;
  frame: number;
  disposed: boolean;
  draw?: DrawEntry;
  spatial?: SpriteSpatial;
}
interface DrawEntry extends FootOrder {
  entry: Entry;
  member: InstancedSpriteMember;
  frame: RgbaSpriteAtlasFrame | InstancedPartFrame;
  page: DrawPage;
}
interface DrawPage extends PainterPage {
  /** A composed atlas page, or a part table drawing each entity as one instance per part slot. */
  readonly page: BatchPage;
  source: THREE.MeshBasicMaterial;
  /** This frame's drawn sprites in collection order; only the first `count` are current. */
  members: DrawEntry[];
  /** The current members in draw order: by foot key, then entity. */
  entries: DrawEntry[];
  count: number;
  sortDirty: boolean;
  version: number;
}

let nextPageId = 0;

const byFoot = (a: DrawEntry, b: DrawEntry) => a.key - b.key || a.entry.foot.id - b.entry.foot.id;

/** Main-thread time per rendered frame spent composing atlases for appearances shown for the first time. */
const COMPOSE_BUDGET_MS = 4;
/** How often the pass looks for appearances no entity uses (`InstancedSpriteAtlases.releaseUnused`). */
const RELEASE_SWEEP_MS = 1000;

/** The loading page's composition time per frame: prewarm finishes every atlas, but never in one task. */
const PREWARM_COMPOSE_BUDGET_MS = 8;

const nextFrame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));

/** Render-only batching. Entity nodes, source geometry and alpha picking remain independently owned. */
export class InstancedArchiveSprites implements SceneRenderPass, PainterPass {
  private readonly atlases = new InstancedSpriteAtlases();
  private readonly batches = new InstancedSpriteBatches(this);
  private readonly view = new SpriteCameraView();
  /** Every retained instance, for atlas invalidation, prewarming and disposal; drawing walks the display's members. */
  private readonly retained = new Set<Entry>();
  private members: ReadonlySet<InstancedSpriteMember> = new Set();
  private readonly draws = new Map<THREE.Scene, Map<BatchPage, DrawPage>>();
  private renderer?: THREE.WebGLRenderer;
  private contextLost = false;
  private lastReleaseSweep = -Infinity;

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.invalidateAtlases();
  };
  private readonly onContextRestored = (): void => {
    this.contextLost = false;
  };

  private bindRenderer(renderer: THREE.WebGLRenderer): void {
    if (this.renderer === renderer) {
      return;
    }
    if (this.renderer) {
      this.unbindRenderer();
      this.invalidateAtlases();
    }
    this.renderer = renderer;
    this.contextLost = renderer.getContext().isContextLost();
    renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  private unbindRenderer(): void {
    this.renderer?.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer?.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.renderer = undefined;
  }

  /** Only rendering resources are invalidated; entities retain their current clip, frame, tint and component state. */
  private invalidateAtlases(): void {
    this.batches.invalidate();
    this.atlases.invalidate();
    this.draws.clear();
    for (const entry of this.retained) {
      entry.ready = undefined;
      if (entry.appearance) {
        this.atlases.enqueue(entry.appearance);
      }
    }
  }

  retain(
    model: THREE.Object3D,
    visual: THREE.Group,
    colour: readonly [number, number, number] = [1, 1, 1],
    opacity = 1,
    foot: THREE.Object3D = model,
  ): InstancedSprite {
    const stopPass = registerSceneRenderPass(model, this);
    const entry: Entry = {
      pass: this,
      model,
      foot,
      visual,
      colour: new THREE.Color().setRGB(...colour),
      opacity,
      erosion: 0,
      ocean: NO_OCEAN_SHADING,
      depthOffset: false,
      styleVersion: 0,
      transformVersion: 0,
      frame: 0,
      disposed: false,
      show: (key, animation, resolve, frame) => {
        entry.appearance = this.atlases.request(key, animation, resolve);
        entry.frame = frame;
      },
      hide: () => {
        entry.appearance = entry.ready = undefined;
      },
      setOpacity: value => {
        if (entry.opacity !== value) {
          entry.opacity = value;
          entry.styleVersion++;
        }
      },
      setColour: value => {
        if (entry.colour.r !== value[0] || entry.colour.g !== value[1] || entry.colour.b !== value[2]) {
          entry.colour.setRGB(...value);
          entry.styleVersion++;
        }
      },
      setErosion: value => {
        const amount = Math.max(0, Math.min(1, value));
        if (entry.erosion !== amount) {
          entry.erosion = amount;
          entry.styleVersion++;
        }
      },
      setOceanShading: value => {
        if (entry.ocean !== value) {
          entry.ocean = value;
          entry.styleVersion++;
        }
      },
      setDepthOffset: enabled => {
        entry.depthOffset = enabled;
      },
      dispose: () => {
        if (entry.disposed) {
          return;
        }
        // A display may still list it until its art changes; it draws nothing from now on.
        entry.disposed = true;
        entry.appearance = entry.ready = undefined;
        stopPass();
        stopMatrix();
        this.retained.delete(entry);
      },
    };
    const stopMatrix = watchWorldMatrixChanges(visual, () => {
      entry.transformVersion++;
    });
    this.retained.add(entry);
    return entry;
  }

  /** The display layer's list of drawn sprites of this pass; it adds and removes members as their art is drawn and released. */
  bindMembers(members: ReadonlySet<InstancedSpriteMember>): void {
    this.members = members;
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, _lighting: unknown, scene: THREE.Scene): void {
    spritePerf('render', `${this.members.size} members`, () =>
      this.renderPass(renderer, camera, scene, COMPOSE_BUDGET_MS),
    );
  }

  /** Every appearance a retained entity shows, or still draws while the one it shows is composed. */
  private usedAppearances(): Set<Appearance> {
    const used = new Set<Appearance>();
    for (const entry of this.retained) {
      if (entry.appearance) {
        used.add(entry.appearance);
      }
      if (entry.ready) {
        used.add(entry.ready);
      }
    }
    return used;
  }

  /**
   * Spread atlas composition over frames: an appearance is drawn once its pages exist, never composed inside the draw
   * loop. Once a second it releases what no entity uses, so composed pages follow the appearances actually shown.
   */
  private composeAtlases(renderer: THREE.WebGLRenderer, budgetMs: number, phase?: string): void {
    this.bindRenderer(renderer);
    if (this.contextLost) {
      return;
    }
    const now = performance.now();
    const sweep = now - this.lastReleaseSweep >= RELEASE_SWEEP_MS;
    const used = this.atlases.pending || sweep ? this.usedAppearances() : undefined;
    if (sweep) {
      this.lastReleaseSweep = now;
      const released = this.atlases.releaseUnused(used!, now);
      if (released.length) {
        // No entity draws them: their draw pages hold no members and their batches are recycled at the next submit.
        for (const pages of this.draws.values()) {
          for (const page of released) {
            pages.delete(page);
          }
        }
      }
    }
    this.atlases.step(renderer, budgetMs, phase, used);
  }

  /** Composes every pending appearance now, for callers that need the next draw to be complete. */
  flush(renderer: THREE.WebGLRenderer): void {
    this.composeAtlases(renderer, Infinity, 'compose:flush');
  }

  /** The world has one scene: every entity is drawn into the batches of the scene being rendered. */
  private renderPass(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    scene: THREE.Scene,
    composeBudgetMs: number,
    composePhase?: string,
  ): void {
    this.composeAtlases(renderer, composeBudgetMs, composePhase);
    if (this.contextLost) {
      return;
    }
    const view = this.view;
    view.update(camera);
    const draws = this.draws;
    for (const pages of draws.values()) {
      for (const page of pages.values()) {
        page.count = 0;
        page.sortDirty = false;
      }
    }
    for (const member of this.members) {
      const entry = member.sprite as Entry | undefined;
      if (!entry || entry.disposed) {
        continue;
      }
      if (entry.appearance?.locations) {
        entry.ready = entry.appearance;
      }
      const appearance = entry.ready;
      if (!appearance) {
        continue;
      }
      // Whether an entity is drawn follows the tickingarea: a sleeping entity has released its entry.
      if (!entry.visual.visible) {
        continue;
      }
      const { page: drawn, frame } = appearanceLocation(appearance, entry.frame);
      // Cull the whole assembled frame before sorting or uploading instances, retaining logical
      // playback and the cached atlas while the entity is outside the camera.
      const spatial = (entry.spatial ??= createSpriteSpatial(frame));
      if (!view.isVisible(spatial, frame, entry.visual.matrixWorld, entry.transformVersion)) {
        continue;
      }
      let pages = draws.get(scene);
      if (!pages) {
        draws.set(scene, (pages = new Map()));
      }
      let page = pages.get(drawn);
      if (!page) {
        const first = appearance.frames[0][0];
        pages.set(
          drawn,
          (page = {
            id: nextPageId++,
            page: drawn,
            source: first.materials[first.image.sampler ?? 0],
            members: [],
            entries: [],
            count: 0,
            sortDirty: false,
            version: 0,
          }),
        );
      }
      const draw = (entry.draw ??= { entry, member, frame, page, x: 0, y: 0, z: 0, sortLayer: -1, key: 0, camera: -1 });
      // The ordinary sprites' foot key, so batched and ordinary sprites follow one rule.
      if (view.placeFoot(draw, entry.foot.matrixWorld, entry.depthOffset ? 2 : 1)) {
        page.sortDirty = true;
      }
      draw.member = member;
      draw.frame = frame;
      draw.page = page;
      if (page.members[page.count] !== draw) {
        page.members[page.count] = draw;
        page.sortDirty = true;
      }
      page.count++;
    }
    for (const [drawn, pages] of draws) {
      const current: DrawPage[] = [];
      for (const page of pages.values()) {
        if (page.members.length !== page.count) {
          page.members.length = page.count;
          page.sortDirty = true;
        }
        if (page.sortDirty) {
          page.entries.length = 0;
          page.entries.push(...page.members);
          page.entries.sort(byFoot);
          page.version++;
        }
        if (page.count > 0) {
          current.push(page);
        }
      }
      // Drawn once the scene's painter has every pass's pages and cuts them into its key order.
      scenePainter(drawn).collect(this, current);
    }
  }

  /** The painter's runs of this pass's pages in `scene`: each run is one batch, at its first sprite's key. */
  drawSegments(scene: THREE.Scene, segments: ReadonlyMap<PainterPage, readonly PainterSegment[]>): void {
    const batched = new Map<SegmentKey, BatchedSegment>();
    for (const [painted, runs] of segments) {
      const page = painted as DrawPage;
      for (let index = 0; index < runs.length; index++) {
        const { start, end, key } = runs[index];
        batched.set(this.batches.segmentKey(page.page, index), {
          source: page.source,
          entries: page.entries,
          start,
          end,
          order: key,
        });
      }
    }
    this.batches.submit(scene, batched);
  }

  async prewarm(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    signal: AbortSignal | undefined,
    scene: THREE.Scene,
  ): Promise<void> {
    signal?.throwIfAborted();
    // Every visible appearance is composed before the game starts, spread over loading frames: submitting all
    // their uploads, targets and draws from one task queued the whole load's atlas work on the GPU at once.
    this.composeAtlases(renderer, PREWARM_COMPOSE_BUDGET_MS, 'compose:prewarm');
    while (this.atlases.pending && !this.contextLost) {
      await nextFrame();
      signal?.throwIfAborted();
      this.composeAtlases(renderer, PREWARM_COMPOSE_BUDGET_MS, 'compose:prewarm');
    }
    this.renderPass(renderer, camera, scene, 0, 'compose:prewarm');
    orderScenePainter(scene);
    await this.batches.compile(renderer, camera, signal);
    // Prepare the ordinary shared-frame material variant used when an entity starts working.
    const proxies = new Set<THREE.Mesh>();
    for (const entry of this.retained) {
      const proxy = entry.visual.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
      if (proxy && !proxy.visible) {
        proxies.add(proxy);
      }
    }
    const staging = new THREE.Scene();
    staging.children = [...proxies];
    for (const proxy of proxies) {
      proxy.visible = true;
    }
    try {
      await compileSceneAsync(renderer, staging, camera);
    } finally {
      for (const proxy of proxies) {
        proxy.visible = false;
      }
    }
  }

  dispose(): void {
    this.unbindRenderer();
    for (const entry of [...this.retained]) {
      entry.dispose();
    }
    this.batches.dispose();
    this.draws.clear();
    this.atlases.dispose();
  }
}
