import type * as THREE from 'three';
import { createMaterials, loadAnim, loadBuild, smallHash, type Animation, type ParsedBuild } from './animationAssets';
import { createSpriteFactory, SpriteController, type AnimatedSpriteFactory,
  type SpriteAnimationController } from './sprite';

export interface FacingSpriteAnimationController extends SpriteAnimationController {
  /** A single FACING_* bit; changing art preserves playback and one-shot callbacks. */
  setFacing(facing: number, mirrored?: boolean): void;
  /** AnimState:SetBuild("beefalo_shaved_build"), or back to "beefalo_build". */
  setShaved(shaved: boolean): void;
}

const HEAT_LAYER = smallHash('HEAT');

interface BeefaloBuild { build: ParsedBuild; materials: THREE.MeshBasicMaterial[] }

/** Six-faced beefalo art; the source prefab hides its HEAT layer. */
class BeefaloSpriteController extends SpriteController implements FacingSpriteAnimationController {
  private facing?: number;
  private readonly hairy: BeefaloBuild;
  protected shaved?: BeefaloBuild;

  constructor(...args: ConstructorParameters<typeof SpriteController>) {
    super(...args);
    this.hairy = { build: args[1], materials: args[3] };
  }

  setShaved(shaved: boolean): void {
    const choice = shaved ? this.shaved : this.hairy;
    if (choice) this.setBuild(choice.build, choice.materials);
  }

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

/** Beefalo's builds and actions ship in separate source archives. */
export async function createBeefaloSpriteFactory(assetBaseUrl: string): Promise<AnimatedSpriteFactory> {
  const [buildPackage, shavedPackage, banks] = await Promise.all([
    loadBuild('beefalo_build.zip', assetBaseUrl),
    loadBuild('beefalo_shaved_build.zip', assetBaseUrl),
    Promise.all(['beefalo_basic.zip', 'beefalo_actions.zip', 'beefalo_actions_domestic.zip']
      .map((archive) => loadAnim(archive, assetBaseUrl))),
  ]);
  const shaved: BeefaloBuild = { build: shavedPackage.build, materials: createMaterials(shavedPackage) };
  const factory = createSpriteFactory(buildPackage, { animations: banks.flatMap((bank) => bank.animations) },
    class extends BeefaloSpriteController { protected override shaved = shaved; });
  const dispose = factory.dispose;
  return { ...factory, dispose() {
    dispose();
    for (const material of shaved.materials) { material.map?.dispose(); material.dispose(); }
  } };
}
