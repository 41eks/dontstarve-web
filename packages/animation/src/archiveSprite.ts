import * as THREE from 'three';
import {
  createMaterials, findImage, loadAnim, loadBuild, smallHash, SpriteFrameRenderer,
  type ParsedAnim, type ParsedBuild, type ResolvedSprite, type SpriteMaterialOptions,
} from './animationAssets';
import { registerSpriteRenderGroup } from './renderOrder';
import { selectsFacing } from './facing';

/** Animation/build sources supplied by callers; no prefab or inventory metadata. */
export interface ArchiveSpriteDefinition extends SpriteMaterialOptions {
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
  /** Give this sprite private material copies at this opacity, adjustable later with `setOpacity()`. */
  opacity?: number;
  /** Per-instance AnimState:SetMultColour RGB, multiplied onto private material copies. */
  colour?: readonly [number, number, number];
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
  private disposed = false;

  private readonly materialNamePrefix: string;

  constructor(materialNamePrefix = 'sprite') {
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
      request = loadAnim(archive, `${import.meta.env.BASE_URL}dst/data/anim`);
      this.animations.set(archive, request);
      void request.catch(() => this.animations.delete(archive));
    }
    return request;
  }

  loadBuild(archive: string, options: SpriteMaterialOptions = {}): Promise<ArchiveSpriteBuild> {
    if (this.disposed) return Promise.reject(new Error('Sprite assets have been disposed'));
    // Sampling and colour belong to this source appearance. Sharing only by
    // archive would let an opaque caller overwrite a translucent prefab's art.
    const key = JSON.stringify([archive, options.multColour ?? [1, 1, 1, 1], options.pointFiltering ?? false]);
    let request = this.builds.get(key);
    if (!request) {
      request = loadBuild(archive, `${import.meta.env.BASE_URL}dst/data/anim`).then((asset) => {
        const materials = createMaterials(asset, options);
        for (const material of materials) material.name = `${this.materialNamePrefix}:${asset.build.name}`;
        return { build: asset.build, materials };
      });
      this.builds.set(key, request);
      void request.catch(() => this.builds.delete(key));
    }
    return request;
  }
}

export interface ArchiveSprite {
  readonly model: THREE.Group;
  readonly currentAnimation: string;
  /** AnimState:GetCurrentAnimationNumFrames. */
  readonly frameCount: number;
  update(dt: number): void;
  /** AnimState:SetFrame within the current clip. */
  setFrame(frame: number): void;
  start(name: string): void;
  playOnce(name: string, onComplete?: () => void): void;
  setAnimation(name: string): void;
  setPaused(paused: boolean): void;
  /** Only for sprites created with `options.opacity`, whose materials are private. */
  setOpacity(opacity: number): void;
  /**
   * Eight-faced insts select, among clips of the same name, the one whose `facing` mask contains this FACING bit,
   * mirrored horizontally when the clip lists both a facing and its left-hand mirror.
   */
  setFacing(facing: number): void;
  /** AnimState:SetBuild among the definition's `buildArchives`; the clip and frame are kept. */
  setBuildArchive(archive: string): void;
  /** AnimState:Hide / Show for a named symbol layer, such as MakeSnowCovered's `snow`. */
  setSymbolHidden(symbol: string, hidden: boolean): void;
  /** Geometry belongs to the entity; shared materials belong to its asset cache. */
  dispose(): void;
}

/** Load split archives and compose each DST frame in its original layer order. */
export async function createArchiveSprite(
  assets: ArchiveSpriteAssets,
  definition: ArchiveSpriteDefinition,
  options: ArchiveSpriteOptions = {},
): Promise<ArchiveSprite> {
  const [parsed, sharedBuilds, sharedSkin] = await Promise.all([
    assets.loadAnimation(definition.animationArchive),
    Promise.all(definition.buildArchives.map((archive) => assets.loadBuild(archive, definition))),
    options.skinArchive ? assets.loadBuild(options.skinArchive, definition) : undefined,
  ]);
  // Translucent previews cannot share the asset cache's materials with opaque insts.
  const ownedMaterials: THREE.MeshBasicMaterial[] = [];
  const own = <T extends ArchiveSpriteBuild | undefined>(source: T): T => {
    if (!source || (options.opacity === undefined && !options.colour)) return source;
    const materials = source.materials.map(material => {
      const copy = material.clone(); ownedMaterials.push(copy);
      if (options.colour) copy.color.multiply(new THREE.Color().setRGB(...options.colour));
      return copy;
    });
    return { build: source.build, materials } as T;
  };
  const builds = sharedBuilds.map(own);
  let activeBuilds = builds;
  const skin = own(sharedSkin);
  const applyOpacity = (opacity: number) => {
    for (const material of ownedMaterials) {
      material.transparent = opacity < 1; material.opacity = opacity; material.needsUpdate = true;
    }
  };
  if (options.opacity !== undefined) applyOpacity(options.opacity);
  const bankHash = smallHash(definition.bank);
  let facing: number | undefined;
  let flipped = false;
  const findClip = (name: string) => {
    const candidates = parsed.animations.filter(clip => clip.name === name && clip.bankHash === bankHash);
    const selected = facing === undefined ? undefined
      : candidates.map(clip => ({ clip, ...selectsFacing(clip.facing, facing!) })).find(({ matches }) => matches);
    flipped = selected?.flipped ?? false;
    return selected?.clip ?? candidates[0];
  };
  const initialAnimation = findClip(definition.animation);
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
        const candidates = [...(skin ? [skin] : []), ...(override ? [override.source] : activeBuilds)];
        for (const source of candidates) {
          const image = findImage(source.build, hash, element.imageIndex);
          if (image) return { element, image, materials: source.materials };
        }
        throw new Error(`Missing sprite part ${model.name}:${hash}:${element.imageIndex}`);
      });
    // Preserve genuinely empty source frames rather than inventing replacement art.
    renderer.show(sprites);
    visual.scale.x = flipped ? -scale : scale;
    previousFrame = index;
  };
  const selectAnimation = (name: string, shouldLoop: boolean, complete?: () => void) => {
    if (disposed) return;
    const next = findClip(name);
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
    get frameCount() { return animation.frames.length; },
    setFrame(frame: number) {
      if (disposed) return;
      elapsed = Math.max(0, Math.floor(frame)) / animation.frameRate;
      previousFrame = -1;
      update(0);
    },
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
    setOpacity(opacity: number) {
      if (options.opacity === undefined) throw new Error(`Sprite ${model.name} does not own its materials`);
      applyOpacity(opacity);
    },
    setBuildArchive(archive: string) {
      const index = definition.buildArchives.indexOf(archive);
      if (index < 0) throw new Error(`Sprite ${model.name} has no build archive ${archive}`);
      if (disposed || activeBuilds[0] === builds[index]) return;
      activeBuilds = [builds[index]];
      previousFrame = -1;
      update(0);
    },
    setSymbolHidden(symbol: string, isHidden: boolean) {
      const hash = smallHash(symbol);
      if (disposed || hidden.has(hash) === isHidden) return;
      if (isHidden) hidden.add(hash); else hidden.delete(hash);
      previousFrame = -1;
      update(0);
    },
    setFacing(value: number) {
      if (disposed || facing === value) return;
      facing = value;
      const next = findClip(animation.name);
      if (!next?.frames.length) return;
      animation = next;
      previousFrame = -1;
      update(0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ownedMaterials.forEach(material => material.dispose());
      model.removeFromParent();
      visual.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    },
  };
}
