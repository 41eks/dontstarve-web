import { loadAnim, loadBuild, smallHash, type Animation } from './animationAssets';
import { createSpriteFactory, SpriteController, type AnimatedSpriteFactory,
  type SpriteAnimationController } from './sprite';

export interface FacingSpriteAnimationController extends SpriteAnimationController {
  /** A single FACING_* bit; changing art preserves playback and one-shot callbacks. */
  setFacing(facing: number, mirrored?: boolean): void;
}

const HEAT_LAYER = smallHash('HEAT');

/** Six-faced beefalo art; the source prefab hides its HEAT layer. */
class BeefaloSpriteController extends SpriteController implements FacingSpriteAnimationController {
  private facing?: number;

  setFacing(facing: number, mirrored = false) {
    this.visual.scale.x = Math.abs(this.visual.scale.x) * (mirrored ? -1 : 1);
    if (this.facing === facing) return;
    this.facing = facing;
    this.animation = this.findAnimation(this.animationName);
    this.frameKey = '';
    const frame = Math.floor(this.elapsed * this.animation.frameRate);
    this.showFrame(this.loop ? frame % this.animation.frames.length : Math.min(frame, this.animation.frames.length - 1));
  }

  protected findAnimation(name: string): Animation {
    const candidates = this.animations.animations.filter((candidate) => candidate.name === name);
    const animation = candidates.find((candidate) => candidate.facing === this.facing)
      ?? candidates.find((candidate) => this.facing !== undefined && (candidate.facing & this.facing) !== 0)
      ?? candidates[0];
    if (!animation) throw new Error(`Sprite animation ${name} is unavailable`);
    return animation;
  }

  protected isLayerVisible(layerHash: number): boolean { return layerHash !== HEAT_LAYER; }
}

/** Beefalo's build and actions ship in separate source archives. */
export async function createBeefaloSpriteFactory(assetBaseUrl: string): Promise<AnimatedSpriteFactory> {
  const [buildPackage, banks] = await Promise.all([
    loadBuild('beefalo_build.zip', assetBaseUrl),
    Promise.all(['beefalo_basic.zip', 'beefalo_actions.zip', 'beefalo_actions_domestic.zip']
      .map((archive) => loadAnim(archive, assetBaseUrl))),
  ]);
  return createSpriteFactory(buildPackage, { animations: banks.flatMap((bank) => bank.animations) }, BeefaloSpriteController);
}
