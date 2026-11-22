import { atlasCompressionEnabled } from './atlasFormat';
import type * as THREE from 'three';
import {
  createMaterials,
  loadSpriteSkinArchive,
  smallHash,
  type ParsedAnim,
  type ParsedBuild,
} from './animationAssets';
import type { SymbolBuild } from './animState';
import type { SymbolOverride } from './spriteDressing';

export type { CompositeSpriteFrame, SpriteTint } from './spriteDressing';

export interface SpriteAnimationController {
  start(name: string): void;
  playOnce(name: string, onComplete?: () => void): void;
  update(dt: number): void;
}

export interface TransientSpriteAnimationController extends SpriteAnimationController {
  readonly currentAnimation: string;
  /** Brief feedback, then restore the interrupted clip, pose and callback. */
  playTransient(name: string): void;
}

/** AnimState:Hide / Show: toggle a named layer of the current build. */
export interface LayerAnimationController {
  hideLayer(layer: string): void;
  showLayer(layer: string): void;
}

/** AnimState:SetPercent: show a clip at a fixed fraction of its length without advancing it. */
export interface PercentAnimationController {
  setPercent(name: string, percent: number): void;
}

/** AnimState:GetCurrentAnimationNumFrames / SetFrame on the current clip. */
export interface FrameSeekableAnimationController {
  readonly numFrames: number;
  setFrame(frame: number): void;
}

export interface SpriteSkin {
  build: ParsedBuild;
  materials: THREE.MeshBasicMaterial[];
  animations?: ParsedAnim;
  symbols?: ReadonlySet<number>;
  baseSymbols: ReadonlySet<number>;
  animationBanks: ReadonlySet<number>;
}

/** Prepared animation bank and builds. The resource owner retains the shared atlases. */
export interface SpriteArtSource {
  readonly animations: ParsedAnim;
  readonly bank: number;
  readonly build: SymbolBuild;
  readonly fallbackBuilds?: readonly SymbolBuild[];
}

/** A build symbol that can replace another symbol at runtime, with its own atlas materials. */
export interface LoadedSymbolOverride extends SymbolOverride {
  dispose(): void;
}

export async function loadSymbolOverride(
  assetBaseUrl: string,
  archive: string,
  symbol: string,
): Promise<LoadedSymbolOverride> {
  const loaded = await loadSpriteSkinArchive(archive, assetBaseUrl, atlasCompressionEnabled());
  const materials = createMaterials(loaded.buildPackage);
  return {
    build: loaded.buildPackage.build,
    materials,
    symbolHash: smallHash(symbol),
    dispose() {
      for (const material of materials) {
        material.map?.dispose();
        material.dispose();
      }
    },
  };
}

/** A whole build used as an override build; its atlases belong to the caller. */
export interface LoadedBuildOverride {
  readonly build: ParsedBuild;
  readonly materials: THREE.MeshBasicMaterial[];
  dispose(): void;
}

export async function loadBuildOverride(assetBaseUrl: string, archive: string): Promise<LoadedBuildOverride> {
  const loaded = await loadSpriteSkinArchive(archive, assetBaseUrl, atlasCompressionEnabled());
  const materials = createMaterials(loaded.buildPackage);
  return {
    build: loaded.buildPackage.build,
    materials,
    dispose() {
      for (const material of materials) {
        material.map?.dispose();
        material.dispose();
      }
    },
  };
}
