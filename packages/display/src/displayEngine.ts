import type * as THREE from 'three';
import type { ReadonlySignal } from '@dontstarve-web/signals';
import type { ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { ResidentSprite } from '@dontstarve-web/animation/residentSprite';

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
  readonly currentAnimation: string;
  readonly numFrames: number;
  readonly currentAnimationLength: number;
  readonly pose: string | undefined;
  setActive(active: boolean): void;
  update(dt: number): void;
  start(name: string): void;
  playOnce(name: string, complete?: () => void): void;
  holdLastFrame(name: string): void;
  setPose(name: string | undefined): void;
  setPercent(name: string, percent: number): void;
  pushAnimation(name: string, loop?: boolean): void;
  playTransient(name: string): void;
  setFrame(frame: number): void;
  setPaused?(paused: boolean): void;
  /** AnimState:SetAnimation-like change of the current clip's name, keeping whether it loops. */
  setAnimation?(name: string): void;
  showImage(image: number): void;
  setFacing(facing: number): void;
  setColour(colour: readonly number[]): void;
  setOpacity(opacity: number): void;
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
  get currentAnimation(): string { return this.resident.currentAnimation; }
  get numFrames(): number { return this.resident.frameCount; }
  get currentAnimationLength(): number { return 0; }
  get pose(): string | undefined { return undefined; }
  setActive(active: boolean): void { this.resident.setActive(active); }
  update(dt: number): void { this.resident.update(dt); }
  start(name: string): void { this.resident.start(name); }
  playOnce(name: string, complete?: () => void): void { this.resident.playOnce(name, complete); }
  holdLastFrame(name: string): void {
    this.resident.playOnce(name);
    this.resident.setFrame(this.resident.frameCount - 1);
  }
  setFrame(frame: number): void { this.resident.setFrame(frame); }
  setPaused(paused: boolean): void { this.resident.setPaused(paused); }
  setAnimation(name: string): void { this.resident.setAnimation(name); }
  setColour(colour: readonly number[]): void { this.resident.setColour([colour[0], colour[1], colour[2]]); }
  setOpacity(opacity: number): void { this.resident.setOpacity(opacity); }
  setFacing(facing: number): void { this.resident.setFacing(facing); }
  adopt(other: DisplayEngine): void {
    if (other instanceof ArchiveEngine) this.resident.adopt(other.resident);
    else unsupported('Adopting another kind of sprite');
  }
  dispose(): void { this.resident.dispose(); }

  setPose(): void { unsupported('A static pose'); }
  setPercent(): void { unsupported('A percent pose'); }
  pushAnimation(): void { unsupported('A queued animation'); }
  playTransient(): void { unsupported('A transient animation'); }
  showImage(): void { unsupported('A static image'); }
  hideLayer(): void { unsupported('Hiding a layer'); }
  showLayer(): void { unsupported('Showing a layer'); }
  setSymbolOverrides(): void { unsupported('Symbol overrides'); }
  overrideSymbol(): void { unsupported('A symbol override'); }
  addOverrideBuild(): void { unsupported('An override build'); }
  clearOverrideBuild(): void { unsupported('An override build'); }
}

/** Creates an archive sprite in the clip an entity is logically in; `initial` is already built in the first clip. */
export interface ArchiveSpriteSource {
  create(clip: { name: string; loop: boolean }): ArchiveSprite | Promise<ArchiveSprite>;
  initial: ArchiveSprite;
}
