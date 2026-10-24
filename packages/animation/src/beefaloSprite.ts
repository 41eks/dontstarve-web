import type * as THREE from 'three';
import { createMaterials, loadAnim, loadBuild, smallHash, type Animation, type ParsedBuild } from './animationAssets';
import { createSpriteFactory, SpriteController, type AnimatedSpriteFactory } from './sprite';

/** AnimState:SetBuild names; the shaved build replaces the whole hairy build while hair regrows. */
export const BEEFALO_BUILD = 'beefalo_build.zip';
export const BEEFALO_SHAVED_BUILD = 'beefalo_shaved_build.zip';

/** Six-faced art that a prefab turns with a FACING_* bit, mirroring the left-hand facings. */
export interface FacingSpriteController {
  setFacing(facing: number, mirrored?: boolean): void;
  setBuildArchive(archive: string): void;
}

/** Shared beefalo atlases and each clip's length, for the logical AnimState that times the stategraph. */
export interface BeefaloSpriteFactory extends AnimatedSpriteFactory {
  readonly lengths: ReadonlyMap<string, number>;
}

const HEAT_LAYER = smallHash('HEAT');

interface BeefaloBuild { build: ParsedBuild; materials: THREE.MeshBasicMaterial[] }

/** Six-faced beefalo art; the source prefab hides its HEAT layer. */
class BeefaloSpriteController extends SpriteController implements FacingSpriteController {
  private facing?: number;
  private readonly hairy: BeefaloBuild;
  protected shaved?: BeefaloBuild;

  constructor(...args: ConstructorParameters<typeof SpriteController>) {
    super(...args);
    this.hairy = { build: args[1], materials: args[3] };
  }

  setBuildArchive(archive: string): void {
    const choice = archive === BEEFALO_SHAVED_BUILD ? this.shaved : archive === BEEFALO_BUILD ? this.hairy : undefined;
    if (!choice) throw new Error(`Beefalo has no build ${archive}`);
    this.setBuild(choice.build, choice.materials);
  }

  /** A single FACING_* bit; changing art preserves playback and one-shot callbacks. */
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
export async function createBeefaloSpriteFactory(assetBaseUrl: string): Promise<BeefaloSpriteFactory> {
  const [buildPackage, shavedPackage, banks] = await Promise.all([
    loadBuild(BEEFALO_BUILD, assetBaseUrl),
    loadBuild(BEEFALO_SHAVED_BUILD, assetBaseUrl),
    Promise.all(['beefalo_basic.zip', 'beefalo_actions.zip', 'beefalo_actions_domestic.zip']
      .map((archive) => loadAnim(archive, assetBaseUrl))),
  ]);
  const shaved: BeefaloBuild = { build: shavedPackage.build, materials: createMaterials(shavedPackage) };
  const animations = banks.flatMap((bank) => bank.animations);
  const factory = createSpriteFactory(buildPackage, { animations },
    class extends BeefaloSpriteController { protected override shaved = shaved; });
  // Facings of one clip share its length.
  const lengths = new Map<string, number>();
  for (const clip of animations) if (!lengths.has(clip.name)) lengths.set(clip.name, clip.frames.length / clip.frameRate);
  const dispose = factory.dispose;
  return { ...factory, lengths, dispose() {
    dispose();
    for (const material of shaved.materials) { material.map?.dispose(); material.dispose(); }
  } };
}
