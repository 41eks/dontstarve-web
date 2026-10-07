import * as THREE from 'three';
import {
  createMaterials, findImage, loadAnim, loadBuild, smallHash, SpriteFrameRenderer,
  type ParsedAnim, type ParsedBuild, type ResolvedSprite,
} from './animationAssets';
import { registerSpriteRenderGroup } from './renderOrder';

/** Animation/build sources supplied by callers; no prefab or inventory metadata. */
export interface ArchiveSpriteDefinition {
  readonly animationArchive: string;
  readonly buildArchives: readonly string[];
  readonly bank: string;
  readonly animation: string;
  readonly loop: boolean;
  readonly symbolOverrides?: Readonly<Record<string, { archive: string; symbol: string }>>;
  /** Source animation placeholders supplied by runtime systems such as snow. */
  readonly hiddenSymbols?: readonly string[];
}

export interface ArchiveSpriteOptions {
  skinArchive?: string;
  name?: string;
  scale?: number;
}

export interface ArchiveSpriteBuild {
  readonly build: ParsedBuild;
  readonly materials: THREE.MeshBasicMaterial[];
}

/** Separate caches support animation-only banks and build-only swap archives. */
export class ArchiveSpriteAssets {
  private readonly animations = new Map<string, Promise<ParsedAnim>>();
  private readonly builds = new Map<string, Promise<ArchiveSpriteBuild>>();
  private readonly animationBaseUrl: string;
  private disposed = false;

  private readonly materialNamePrefix: string;

  constructor(animationBaseUrl: string, materialNamePrefix = 'sprite') {
    this.animationBaseUrl = animationBaseUrl;
    this.materialNamePrefix = materialNamePrefix;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const build of this.builds.values()) void build.then(({ materials }) => {
      for (const material of materials) { material.map?.dispose(); material.dispose(); }
    }, () => undefined);
    this.builds.clear();
    this.animations.clear();
  }

  loadAnimation(archive: string): Promise<ParsedAnim> {
    if (this.disposed) return Promise.reject(new Error('Sprite assets have been disposed'));
    let request = this.animations.get(archive);
    if (!request) {
      request = loadAnim(archive, this.animationBaseUrl);
      this.animations.set(archive, request);
      void request.catch(() => this.animations.delete(archive));
    }
    return request;
  }

  loadBuild(archive: string): Promise<ArchiveSpriteBuild> {
    if (this.disposed) return Promise.reject(new Error('Sprite assets have been disposed'));
    let request = this.builds.get(archive);
    if (!request) {
      request = loadBuild(archive, this.animationBaseUrl).then((asset) => {
        const materials = createMaterials(asset);
        for (const material of materials) material.name = `${this.materialNamePrefix}:${asset.build.name}`;
        return { build: asset.build, materials };
      });
      this.builds.set(archive, request);
      void request.catch(() => this.builds.delete(archive));
    }
    return request;
  }
}

export interface ArchiveSprite {
  readonly model: THREE.Group;
  readonly currentAnimation: string;
  update(dt: number): void;
  start(name: string): void;
  playOnce(name: string, onComplete?: () => void): void;
  setAnimation(name: string): void;
  setPaused(paused: boolean): void;
  /** Geometry belongs to the entity; shared materials belong to its asset cache. */
  dispose(): void;
}

/** Load split archives and compose each DST frame in its original layer order. */
export async function createArchiveSprite(
  assets: ArchiveSpriteAssets,
  definition: ArchiveSpriteDefinition,
  options: ArchiveSpriteOptions = {},
): Promise<ArchiveSprite> {
  const [parsed, builds, skin] = await Promise.all([
    assets.loadAnimation(definition.animationArchive),
    Promise.all(definition.buildArchives.map((archive) => assets.loadBuild(archive))),
    options.skinArchive ? assets.loadBuild(options.skinArchive) : undefined,
  ]);
  const initialAnimation = parsed.animations.find(({ name, bankHash }) =>
    name === definition.animation && bankHash === smallHash(definition.bank));
  if (!initialAnimation?.frames.length) throw new Error(`Missing sprite animation ${definition.bank}:${definition.animation}`);
  let animation = initialAnimation;
  const overrides = new Map(Object.entries(definition.symbolOverrides ?? {}).map(([symbol, override]) =>
    [smallHash(symbol), { hash: smallHash(override.symbol), source: builds[definition.buildArchives.indexOf(override.archive)] }]));
  const hidden = new Set((definition.hiddenSymbols ?? []).map(smallHash));
  const model = new THREE.Group();
  model.name = options.name ?? `${definition.bank}:${definition.animation}`;
  model.userData.billboard = true;
  const visual = new THREE.Group();
  const scale = options.scale ?? 0.02;
  visual.scale.set(scale, -scale, scale);
  model.add(visual);
  registerSpriteRenderGroup(model, visual);
  const renderer = new SpriteFrameRenderer(visual);
  let elapsed = 0;
  let previousFrame = -1;
  let paused = false;
  let disposed = false;
  let loop = definition.loop;
  let onComplete: (() => void) | undefined;
  const update = (dt: number) => {
    if (paused || disposed) return;
    elapsed += Math.max(0, Math.min(dt, 0.1));
    const rawFrame = Math.floor(elapsed * animation.frameRate);
    if (!loop && elapsed * animation.frameRate + 1e-8 >= animation.frames.length && onComplete) {
      const complete = onComplete;
      onComplete = undefined;
      complete();
      if (disposed || paused) return;
      update(0);
      return;
    }
    const index = loop ? rawFrame % animation.frames.length
      : Math.min(rawFrame, animation.frames.length - 1);
    if (index === previousFrame) return;
    const sprites: ResolvedSprite[] = [...animation.frames[index].elements]
      // These banks include a bounding-only symbol with no build art.
      .filter((element) => element.imageHash !== smallHash('bounding') && !hidden.has(element.imageHash))
      .sort((a, b) => b.z - a.z).map((element) => {
        const override = overrides.get(element.imageHash);
        const hash = override?.hash ?? element.imageHash;
        const candidates = [...(skin ? [skin] : []), ...(override ? [override.source] : builds)];
        for (const source of candidates) {
          const image = findImage(source.build, hash, element.imageIndex);
          if (image) return { element, image, materials: source.materials };
        }
        throw new Error(`Missing sprite part ${model.name}:${hash}:${element.imageIndex}`);
      });
    // Preserve genuinely empty source frames rather than inventing replacement art.
    renderer.show(sprites);
    previousFrame = index;
  };
  const selectAnimation = (name: string, shouldLoop: boolean, complete?: () => void) => {
    if (disposed) return;
    const next = parsed.animations.find((clip) => clip.name === name && clip.bankHash === smallHash(definition.bank));
    if (!next?.frames.length) throw new Error(`Missing sprite animation ${definition.bank}:${name}`);
    animation = next;
    loop = shouldLoop;
    onComplete = complete;
    elapsed = 0;
    previousFrame = -1;
    update(0);
  };
  try { update(0); } catch (error) {
    visual.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    throw error;
  }
  return {
    model, update,
    get currentAnimation() { return animation.name; },
    start(name: string) {
      if (animation.name !== name || !loop) selectAnimation(name, true);
    },
    playOnce(name: string, complete?: () => void) { selectAnimation(name, false, complete); },
    setPaused(value: boolean) {
      if (disposed) return;
      paused = value;
      if (!paused) update(0);
    },
    setAnimation(name: string) {
      if (animation.name !== name) selectAnimation(name, definition.loop);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      model.removeFromParent();
      visual.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    },
  };
}
