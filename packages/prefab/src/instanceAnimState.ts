import { AnimState, type AnimStateArt } from '@dontstarve-web/animation/animState';
import { smallHash } from '@dontstarve-web/animation/animationAssets';
import type { ArchiveSpriteCommands, SpriteState } from '@dontstarve-web/display';
import { bankAnimationTiming } from './animationTimings';

/** The sprite commands AnimState playback is written with. */
export type AnimStateSprite = Pick<
  ArchiveSpriteCommands,
  'start' | 'playOnce' | 'pushAnimation' | 'setColour' | 'setAddColour' | 'setFloatParams' | 'setOceanBlendParams'
> &
  /** A factory sprite's state also takes a named bank and build and a playback rate. */
  Partial<Pick<SpriteState, 'setArtSource' | 'setPlaybackRate'>>;

/**
 * inst.AnimState: one AnimState for the entity, as in Lua. Playback writes the entity's sprite json; symbol overrides
 * and layers are the inherited AnimState declaration, which takes effect once the entity declares it with
 * `sprite.setAnimState(inst.AnimState.json, art)`.
 */
export class InstanceAnimState extends AnimState {
  private readonly sprite: AnimStateSprite;
  /** The prefab's Asset("ANIM", ...) archives and the cache its display resolves them from; SetBank picks a bank across them. */
  private assets?: { readonly animationArchives: readonly string[]; readonly art: AnimStateArt };
  private bank?: string;
  private buildArchive?: string;
  private currentAnimation?: string;

  constructor(sprite: AnimStateSprite) {
    super();
    this.sprite = sprite;
  }

  /**
   * The prefab's ANIM assets, for an entity that changes its bank or build at run time: AnimState:PlayAnimation finds a
   * clip of the current bank in whichever of them holds it, as the engine does.
   */
  DeclareAnimationAssets(animationArchives: readonly string[], art: AnimStateArt): void {
    this.assets = { animationArchives, art };
    this.applyArt();
  }

  /** AnimState:SetBank(bank). */
  SetBank(bank: string): void {
    if (bank !== this.bank) {
      this.bank = bank;
      this.applyArt();
    }
  }

  /** AnimState:SetBuild(build), named by its archive. */
  SetBuild(buildArchive: string): void {
    if (buildArchive !== this.buildArchive) {
      this.buildArchive = buildArchive;
      this.applyArt();
    }
  }

  private applyArt(): void {
    if (!this.assets || this.bank === undefined || this.buildArchive === undefined) {
      return;
    }
    if (!this.sprite.setArtSource) {
      throw new Error('This sprite cannot change its bank or build');
    }
    this.sprite.setArtSource({
      animationArchives: this.assets.animationArchives,
      bank: this.bank,
      buildArchive: this.buildArchive,
      art: this.assets.art,
    });
  }

  /** AnimState:PlayAnimation(name, loop): replaces the clip and clears the queue. */
  PlayAnimation(name: string, loop = false): void {
    this.currentAnimation = name;
    if (loop) {
      this.sprite.start(name);
    } else {
      this.sprite.playOnce(name);
    }
  }

  /** AnimState:PushAnimation(name, loop); the loop the source omits is decided by the caller (see lua-api-map). */
  PushAnimation(name: string, loop = false): void {
    this.sprite.pushAnimation(name, loop);
  }

  /** AnimState:GetCurrentAnimationLength(): the played clip's length in seconds at its own frame rate, from the source anim.bin. */
  GetCurrentAnimationLength(): number {
    if (!this.assets || this.bank === undefined || this.currentAnimation === undefined) {
      throw new Error('AnimState has no declared clip playing');
    }
    const timing = bankAnimationTiming(this.assets.animationArchives, this.currentAnimation, smallHash(this.bank));
    return timing.frames / timing.frameRate;
  }

  /** AnimState:SetDeltaTimeMultiplier(multiplier). */
  SetDeltaTimeMultiplier(multiplier: number): void {
    if (!this.sprite.setPlaybackRate) {
      throw new Error('This sprite cannot change its playback rate');
    }
    this.sprite.setPlaybackRate(multiplier);
  }

  /** AnimState:SetFloatParams(offset, enabled, bob): anim.ksh bobs the sprite and cuts it below the waterline. */
  SetFloatParams(offset: number, enabled: number, bob: number): void {
    this.sprite.setFloatParams(offset, enabled, bob);
  }
  /** AnimState:SetOceanBlendParams(amount): anim.ksh multiplies the colour by the ocean's under it by `amount`. */
  SetOceanBlendParams(amount: number): void {
    this.sprite.setOceanBlendParams(amount);
  }
  /** AnimState:SetMultColour(r, g, b, a): the entity's own multiplied colour; the source's callers keep alpha 1. */
  SetMultColour(r: number, g: number, b: number, _a = 1): void {
    this.sprite.setColour([r, g, b]);
  }
  /** AnimState:SetAddColour(r, g, b, a): the entity's added colour; the source's freeze tint keeps alpha 0. */
  SetAddColour(r: number, g: number, b: number, _a = 0): void {
    this.sprite.setAddColour([r, g, b]);
  }
}
