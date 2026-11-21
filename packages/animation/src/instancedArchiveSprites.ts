import * as THREE from 'three';
import type { Animation, ResolvedSprite } from './animationAssets';
import { compileSceneAsync } from './compileScene';
import { InstancedSpriteAtlases, appearanceLocation, type Appearance } from './instancedSpriteAtlases';
import { InstancedSpriteBatches, type PageKey } from './instancedSpriteBatches';
import {
  SpriteCameraView,
  createSpriteSpatial,
  rankSprites,
  type FootOrder,
  type SpriteSpatial,
} from './instancedSpriteOrder';
import { watchWorldMatrixChanges } from './matrixUpdates';
import { NO_OCEAN_SHADING, type SpriteOceanShading } from './oceanShading';
import type { RgbaSpriteAtlasFrame } from './rgbaSpriteAtlas';
import { registerSceneRenderPass, type SceneRenderPass } from './sceneRenderPass';
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
   * Drawn towards the camera after the ordinary batches, as an effect drawn after its owner on the owner's plane
   * (fire.lua's SetFinalOffset): the depth its owner's batch wrote must not hide it.
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
  /** The last appearance with a composed atlas, drawn while a newly shown one is still being composed. */
  ready?: Appearance;
  frame: number;
  disposed: boolean;
  draw?: DrawEntry;
  spatial?: SpriteSpatial;
}
interface DrawEntry extends FootOrder {
  entry: Entry;
  member: InstancedSpriteMember;
  frame: RgbaSpriteAtlasFrame;
  page: DrawPage;
  /** Clip-space depth towards the camera, resolving coplanar overlaps in draw order (see `rankSprites`). */
  bias: number;
}
interface DrawPage {
  source: THREE.MeshBasicMaterial;
  members: DrawEntry[];
  entries: DrawEntry[];
  count: number;
  sortDirty: boolean;
}

/** Main-thread time per rendered frame spent composing atlases for appearances shown for the first time. */
const COMPOSE_BUDGET_MS = 4;

/** Render-only batching. Entity nodes, source geometry and alpha picking remain independently owned. */
export class InstancedArchiveSprites implements SceneRenderPass {
  private readonly atlases = new InstancedSpriteAtlases();
  private readonly batches = new InstancedSpriteBatches(this);
  private readonly view = new SpriteCameraView();
  /** Every retained instance, for atlas invalidation, prewarming and disposal; drawing walks the display's members. */
  private readonly retained = new Set<Entry>();
  private members: ReadonlySet<InstancedSpriteMember> = new Set();
  private readonly draws = new Map<THREE.Scene, Map<PageKey, DrawPage>>();
  /** Scratch for `rankSprites`. */
  private readonly ranked: DrawEntry[] = [];
  private renderer?: THREE.WebGLRenderer;
  private contextLost = false;

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

  /** Spread atlas composition over frames: an appearance is drawn once its pages exist, never composed inside the draw loop. */
  private composeAtlases(renderer: THREE.WebGLRenderer, budgetMs: number, phase?: string): void {
    this.bindRenderer(renderer);
    if (!this.contextLost) {
      this.atlases.step(renderer, budgetMs, phase);
    }
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
      if (entry.appearance?.pages) {
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
      const { atlas, frame } = appearanceLocation(appearance, entry.frame);
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
      const key = this.batches.pageKey(atlas, entry.depthOffset);
      let page = pages.get(key);
      if (!page) {
        const first = appearance.frames[0][0];
        pages.set(
          key,
          (page = {
            source: first.materials[first.image.sampler ?? 0],
            members: [],
            entries: [],
            count: 0,
            sortDirty: false,
          }),
        );
      }
      const draw = (entry.draw ??= {
        entry,
        member,
        frame,
        page,
        x: 0,
        y: 0,
        z: 0,
        key: 0,
        lateral: 0,
        bias: 0,
        camera: -1,
      });
      // The ordinary sprites' foot key, so batched and ordinary sprites follow one rule.
      if (view.placeFoot(draw, entry.foot.matrixWorld)) {
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
    for (const pages of draws.values()) {
      let dirty = false;
      for (const page of pages.values()) {
        if (page.members.length !== page.count) {
          page.members.length = page.count;
          page.sortDirty = true;
        }
        dirty ||= page.sortDirty;
      }
      if (dirty) {
        rankSprites(pages.values(), this.ranked);
      }
    }
    this.batches.submit(draws);
  }

  async prewarm(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    signal: AbortSignal | undefined,
    scene: THREE.Scene,
  ): Promise<void> {
    signal?.throwIfAborted();
    this.renderPass(renderer, camera, scene, Infinity, 'compose:prewarm');
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
