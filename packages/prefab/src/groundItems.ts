import * as THREE from 'three';
import {
  createMaterials, findImage, loadAnim, loadBuild, smallHash, SpriteFrameRenderer,
  type ParsedAnim, type ParsedBuild, type ResolvedSprite,
} from '@dontstarve-web/animation/animationAssets';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import type { InventorySkinSpec } from '@dontstarve-web/inventory';
import catalog from './groundItems.json' with { type: 'json' };

export interface GroundItemAssetDefinition {
  readonly source: string;
  readonly name: string;
  readonly icon: string;
  readonly atlas: string;
  readonly animationArchive: string;
  readonly buildArchives: readonly string[];
  readonly bank: string;
  readonly animation: string;
  readonly loop: boolean;
  readonly symbolOverrides: Readonly<Record<string, { archive: string; symbol: string }>>;
  readonly skinArchives: Readonly<Record<string, string>>;
}

export const GROUND_ITEM_DEFINITIONS: Readonly<Record<string, GroundItemAssetDefinition>> = catalog.items;
export const GROUND_ITEM_DISPLAY_SPECS = Object.fromEntries(Object.entries(GROUND_ITEM_DEFINITIONS)
  .map(([id, { name, icon, atlas }]) => [id, { name, icon, atlas }]));
export const GROUND_ITEM_SKIN_SPECS: Readonly<Record<string, InventorySkinSpec>> = catalog.skinSpecs;

interface GroundBuild {
  readonly build: ParsedBuild;
  readonly materials: THREE.MeshBasicMaterial[];
}

/** Separate caches support animation-only banks and build-only swap archives. */
export class GroundItemAssets {
  private readonly animations = new Map<string, Promise<ParsedAnim>>();
  private readonly builds = new Map<string, Promise<GroundBuild>>();
  private readonly animationBaseUrl: string;
  private disposed = false;

  constructor(animationBaseUrl: string) {
    this.animationBaseUrl = animationBaseUrl;
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
    if (this.disposed) return Promise.reject(new Error('Ground assets have been disposed'));
    let request = this.animations.get(archive);
    if (!request) {
      request = loadAnim(archive, this.animationBaseUrl);
      this.animations.set(archive, request);
      void request.catch(() => this.animations.delete(archive));
    }
    return request;
  }

  loadBuild(archive: string): Promise<GroundBuild> {
    if (this.disposed) return Promise.reject(new Error('Ground assets have been disposed'));
    let request = this.builds.get(archive);
    if (!request) {
      request = loadBuild(archive, this.animationBaseUrl).then((asset) => {
        const materials = createMaterials(asset);
        for (const material of materials) material.name = `ground:${asset.build.name}`;
        return { build: asset.build, materials };
      });
      this.builds.set(archive, request);
      void request.catch(() => this.builds.delete(archive));
    }
    return request;
  }
}

export interface GroundItemSprite {
  readonly model: THREE.Group;
  update(dt: number): void;
  setAnimation(name: string): void;
  /** Geometry belongs to the entity; shared materials belong to its asset cache. */
  dispose(): void;
}

export async function createGroundItemSprite(
  assets: GroundItemAssets,
  itemId: string,
  skinId?: string,
): Promise<GroundItemSprite> {
  const definition = GROUND_ITEM_DEFINITIONS[itemId];
  if (!definition) throw new Error(`Unknown ground item: ${itemId}`);
  const skinArchive = skinId === undefined ? undefined : definition.skinArchives[skinId];
  if (skinId !== undefined && !skinArchive) throw new Error(`Unknown ground skin ${skinId} for ${itemId}`);
  const [parsed, builds, skin] = await Promise.all([
    assets.loadAnimation(definition.animationArchive),
    Promise.all(definition.buildArchives.map((archive) => assets.loadBuild(archive))),
    skinArchive ? assets.loadBuild(skinArchive) : undefined,
  ]);
  const initialAnimation = parsed.animations.find(({ name, bankHash }) =>
    name === definition.animation && bankHash === smallHash(definition.bank));
  if (!initialAnimation?.frames.length) throw new Error(`Missing ground animation ${definition.bank}:${definition.animation}`);
  let animation = initialAnimation;
  const overrides = new Map(Object.entries(definition.symbolOverrides).map(([symbol, override]) =>
    [smallHash(symbol), { hash: smallHash(override.symbol), source: builds[definition.buildArchives.indexOf(override.archive)] }]));
  const model = new THREE.Group();
  model.name = `GroundItem:${itemId}`;
  Object.assign(model.userData, { billboard: true, itemId, skinId });
  const visual = new THREE.Group();
  visual.scale.set(0.02, -0.02, 0.02);
  model.add(visual);
  registerSpriteRenderGroup(model, visual);
  const renderer = new SpriteFrameRenderer(visual);
  let elapsed = 0;
  let previousFrame = -1;
  const update = (dt: number) => {
    elapsed += Math.min(dt, 0.1);
    const rawFrame = Math.floor(elapsed * animation.frameRate);
    const index = definition.loop ? rawFrame % animation.frames.length
      : Math.min(rawFrame, animation.frames.length - 1);
    if (index === previousFrame) return;
    const sprites: ResolvedSprite[] = [...animation.frames[index].elements]
      // These banks include a bounding-only symbol with no build art.
      .filter((element) => element.imageHash !== smallHash('bounding'))
      .sort((a, b) => b.z - a.z).map((element) => {
        const override = overrides.get(element.imageHash);
        const hash = override?.hash ?? element.imageHash;
        const candidates = [...(skin ? [skin] : []), ...(override ? [override.source] : builds)];
        for (const source of candidates) {
          const image = findImage(source.build, hash, element.imageIndex);
          if (image) return { element, image, materials: source.materials };
        }
        throw new Error(`Missing ground part ${itemId}:${hash}:${element.imageIndex}`);
      });
    // Preserve genuinely empty source frames rather than inventing replacement art.
    renderer.show(sprites);
    previousFrame = index;
  };
  update(0);
  return {
    model, update,
    setAnimation(name: string) {
      const next = parsed.animations.find((clip) => clip.name === name && clip.bankHash === smallHash(definition.bank));
      if (!next?.frames.length) throw new Error(`Missing ground animation ${definition.bank}:${name}`);
      if (next === animation) return;
      animation = next;
      elapsed = 0;
      previousFrame = -1;
      update(0);
    },
    dispose() {
      model.removeFromParent();
      visual.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    },
  };
}
