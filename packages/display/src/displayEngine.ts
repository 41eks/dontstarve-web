import type * as THREE from 'three';
import type { ReadonlySignal } from '@dontstarve-web/signals';
import type { ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { InstancedSprite } from '@dontstarve-web/animation/instancedArchiveSprites';
import { ResidentSprite } from '@dontstarve-web/animation/residentSprite';
import type { ResolvedAnimState } from '@dontstarve-web/animation/animState';
import type { ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import type { SpriteArtSource, SpriteTint, CompositeSpriteFrame } from '@dontstarve-web/animation/sprite';

type SymbolOverrides = Parameters<import('@dontstarve-web/animation/sprite').SpriteController['setSymbolOverrides']>[0];
type SymbolOverride = Parameters<import('@dontstarve-web/animation/sprite').SpriteController['overrideSymbol']>[1];
type BuildOverride = Parameters<import('@dontstarve-web/animation/sprite').SpriteController['addOverrideBuild']>[1];

/**
 * What a display draws with: a resident sprite that is built and released with its tile. `ResidentSpriteController`
 * is the engine for factory sprites; `ArchiveEngine` is the one for shared archive sprites.
 */
export interface DisplayEngine {
  readonly model: THREE.Group;
  /** Changes whenever the drawn sprite is attached or released. */
  readonly art: ReadonlySignal<number>;
  readonly loaded: boolean;
  /** The sprite being built from a source that is still loading, if any. */
  readonly pending?: Promise<void>;
  /** The drawn sprite's shared-batch instance, which the display lists for its pass. */
  readonly instanced?: InstancedSprite;
  readonly currentAnimation: string;
  readonly numFrames: number;
  readonly currentAnimationLength: number;
  readonly pose: string | undefined;
  setActive(active: boolean): void;
  update(dt: number): void;
  start(name: string): void;
  playOnce(name: string, complete?: () => void): void;
  holdLastFrame(name: string): void;
  /** AnimState with no animation playing: the drawn sprite is released until a clip is played. Archive sprites only. */
  clearAnimation?(): void;
  setPose(name: string | undefined): void;
  setPercent(name: string, percent: number): void;
  pushAnimation(name: string, loop?: boolean): void;
  playTransient(name: string): void;
  setFrame(frame: number): void;
  setPaused?(paused: boolean): void;
  setArtSource?(source: SpriteArtSource): void;
  setAnimState?(state: ResolvedAnimState): void;
  setTint?(tint: SpriteTint): void;
  setComposites?(frames: readonly CompositeSpriteFrame[]): void;
  getResolvedFrame?(): readonly ResolvedSprite[];
  getSymbolPosition?(symbol: string, x: number, y: number, target: THREE.Vector3): boolean;
  /** AnimState:SetAnimation-like change of the current clip's name, keeping whether it loops. */
  setAnimation?(name: string): void;
  showImage(image: number): void;
  setFacing(facing: number, mirrored?: boolean): void;
  setColour(colour: readonly number[]): void;
  setOpacity(opacity: number): void;
  setErosion?(amount: number): void;
  setDepthOffset?(enabled: boolean): void;
  setSymbolOverride?(symbol: string, archive?: string, sourceSymbol?: string): void;
  setSymbolHidden?(symbol: string, hidden: boolean): void;
  setBuildArchive?(archive: string): void;
  setGround?(renderOrder: number, flat: boolean): void;
  setMeshOrder?(order: number): void;
  /** Turns the drawn sprite to the camera; without it the display turns the model. */
  faceCamera?(rotation: THREE.Quaternion): void;
  hideLayer(layer: string): void;
  showLayer(layer: string): void;
  setSymbolOverrides(overrides: SymbolOverrides, hiddenLayers?: readonly string[]): void;
  overrideSymbol(symbol: string, override: SymbolOverride): void;
  addOverrideBuild(name: string, override: BuildOverride): void;
  clearOverrideBuild(name: string): void;
  adopt(other: DisplayEngine): void;
  dispose(): void;
}

const unsupported = (what: string): never => { throw new Error(`${what} is not supported by an archive sprite`); };

/** A shared archive sprite, resident while its tile is active. It plays clips, frames and pausing only. */
export class ArchiveEngine implements DisplayEngine {
  private readonly resident: ResidentSprite;

  constructor(resident: ResidentSprite) { this.resident = resident; }

  get model(): THREE.Group { return this.resident.model; }
  get art(): ReadonlySignal<number> { return this.resident.art; }
  get loaded(): boolean { return this.resident.loaded; }
  get pending(): Promise<void> | undefined { return this.resident.pending; }
  get instanced(): InstancedSprite | undefined { return this.resident.instanced; }
  get currentAnimation(): string { return this.resident.currentAnimation; }
  get numFrames(): number { return this.resident.frameCount; }
  get currentAnimationLength(): number { return 0; }
  get pose(): string | undefined { return undefined; }
  setActive(active: boolean): void { this.resident.setActive(active); }
  update(dt: number): void { this.resident.update(dt); }
  start(name: string): void { this.resident.start(name); }
  playOnce(name: string, complete?: () => void): void { this.resident.playOnce(name, complete); }
  holdLastFrame(name: string): void { this.resident.holdLastFrame(name); }
  clearAnimation(): void { this.resident.clearAnimation(); }
  setFrame(frame: number): void { this.resident.setFrame(frame); }
  setPaused(paused: boolean): void { this.resident.setPaused(paused); }
  setAnimation(name: string): void { this.resident.setAnimation(name); }
  setColour(colour: readonly number[]): void { this.resident.setColour([colour[0], colour[1], colour[2]]); }
  setOpacity(opacity: number): void { this.resident.setOpacity(opacity); }
  setErosion(amount: number): void { this.resident.setErosion(amount); }
  setDepthOffset(enabled: boolean): void { this.resident.setDepthOffset(enabled); }
  setSymbolOverride(symbol: string, archive?: string, sourceSymbol?: string): void { this.resident.setSymbolOverride(symbol, archive, sourceSymbol); }
  setSymbolHidden(symbol: string, hidden: boolean): void { this.resident.setSymbolHidden(symbol, hidden); }
  setBuildArchive(archive: string): void { this.resident.setBuildArchive(archive); }
  setGround(renderOrder: number, flat: boolean): void { this.resident.setGround(renderOrder, flat); }
  setMeshOrder(order: number): void { this.resident.setMeshOrder(order); }
  setFacing(facing: number): void { this.resident.setFacing(facing); }
  // A static billboard ignores its root's rotation, so the drawn sprite itself is turned.
  faceCamera(rotation: THREE.Quaternion): void { this.resident.faceCamera(rotation); }
  adopt(other: DisplayEngine): void {
    if (other instanceof ArchiveEngine) this.resident.adopt(other.resident);
    else unsupported('Adopting another kind of sprite');
  }
  dispose(): void { this.resident.dispose(); }

  setPose(): void { unsupported('A static pose'); }
  setPercent(): void { unsupported('A percent pose'); }
  pushAnimation(name: string, loop = false): void { this.resident.pushAnimation(name, loop); }
  playTransient(): void { unsupported('A transient animation'); }
  showImage(): void { unsupported('A static image'); }
  hideLayer(layer: string): void { this.resident.setLayerHidden(layer, true); }
  showLayer(layer: string): void { this.resident.setLayerHidden(layer, false); }
  setSymbolOverrides(): void { unsupported('Symbol overrides'); }
  overrideSymbol(): void { unsupported('A symbol override'); }
  addOverrideBuild(): void { unsupported('An override build'); }
  clearOverrideBuild(): void { unsupported('An override build'); }
}

/** Creates an archive sprite in the clip an entity is logically in; `initial` is already built in the first clip. */
export interface ArchiveSpriteSource {
  create(clip: { name: string; loop: boolean }): ArchiveSprite | Promise<ArchiveSprite>;
  initial?: ArchiveSprite;
  /** Preserve artwork that rests its lowest point on the entity's ground origin. */
  alignBottom?: boolean;
}
