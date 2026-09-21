import * as THREE from 'three';
import {
  createMaterials,
  findImage,
  loadAnim,
  loadBuild,
  smallHash,
  SpriteFrameRenderer,
  type Animation,
  type ParsedAnim,
  type ParsedBuild,
  type ResolvedSprite,
} from './animationAssets';

export type WilsonFacing = 'up' | 'down' | 'side';
type WilsonMovementState = 'idle' | 'walk' | 'run' | 'jump';
type WilsonOneShotState = 'eat' | 'item_in' | 'item_out' | 'pickup';
type WilsonState = WilsonMovementState | 'build' | WilsonOneShotState;
type WilsonAnimations = Record<WilsonState, ParsedAnim>;

export interface WilsonAnimationController {
  start(state: WilsonMovementState): void;
  playEat(): void;
  playItemTransition(state: 'item_in' | 'item_out'): void;
  playPickup(): void;
  setCrafting(crafting: boolean): void;
  setFacing(facing: WilsonFacing, mirrored?: boolean): void;
  setCarryItem(item: 'torch' | null): void;
  update(dt: number, jumpProgress?: number): void;
}

const facingValues: Record<WilsonFacing, number> = { down: 8, side: 5, up: 2 };
const normalArmLayerHash = smallHash('ARM_normal');
const carryArmLayerHash = smallHash('ARM_carry');
const swapObjectHash = smallHash('swap_object');
const swapTorchHash = smallHash('swap_torch');
const pickupPlaybackRate = 0.5;

interface CarryBuild {
  build: ParsedBuild;
  materials: THREE.MeshBasicMaterial[];
}

class WilsonController implements WilsonAnimationController {
  private readonly renderer: SpriteFrameRenderer;
  private readonly materials: THREE.MeshBasicMaterial[];
  private state: WilsonState = 'idle';
  private movementState: WilsonMovementState = 'idle';
  private crafting = false;
  private oneShot: WilsonOneShotState | null = null;
  private facing: WilsonFacing = 'down';
  private mirrored = false;
  private equippedCarryItem: 'torch' | null = null;
  private carryItem: 'torch' | null = null;
  private animation!: Animation;
  private elapsed = 0;
  private frameIndex = -1;
  private readonly visual: THREE.Group;
  private readonly build: ParsedBuild;
  private readonly animations: WilsonAnimations;
  private readonly torch: CarryBuild;

  constructor(
    visual: THREE.Group,
    build: ParsedBuild,
    animations: WilsonAnimations,
    materials: THREE.MeshBasicMaterial[],
    torch: CarryBuild,
  ) {
    this.visual = visual;
    this.build = build;
    this.animations = animations;
    this.materials = materials;
    this.torch = torch;
    this.renderer = new SpriteFrameRenderer(visual);
    this.selectAnimation();
  }

  start(state: WilsonMovementState) {
    if (state === this.movementState) return;
    this.movementState = state;
    if (this.crafting || this.oneShot) return;
    this.state = this.movementState;
    this.selectAnimation();
  }

  playEat() {
    this.startOneShot('eat');
  }

  playItemTransition(state: 'item_in' | 'item_out') {
    this.startOneShot(state);
    if (state === 'item_in') {
      this.carryItem = 'torch';
      this.frameIndex = -1;
      this.showFrame(0);
    }
  }

  playPickup() {
    this.startOneShot('pickup');
  }

  setCrafting(crafting: boolean) {
    if (crafting === this.crafting) return;
    this.crafting = crafting;
    if (this.oneShot) return;
    this.state = crafting ? 'build' : this.movementState;
    this.selectAnimation();
  }

  setFacing(facing: WilsonFacing, mirrored = false) {
    if (facing === this.facing && mirrored === this.mirrored) return;
    this.facing = facing;
    this.mirrored = mirrored;
    this.visual.scale.x = Math.abs(this.visual.scale.x) * (mirrored ? -1 : 1);
    this.selectAnimation();
  }

  setCarryItem(item: 'torch' | null) {
    this.equippedCarryItem = item;
    if (this.oneShot === 'item_in' || item === this.carryItem) return;
    this.carryItem = item;
    const currentFrame = Math.max(0, this.frameIndex);
    this.frameIndex = -1;
    this.showFrame(currentFrame);
  }

  update(dt: number, jumpProgress?: number) {
    if (this.state === 'jump' && jumpProgress !== undefined) {
      const progress = THREE.MathUtils.clamp(jumpProgress, 0, 1);
      const nextFrame = Math.min(
        this.animation.frames.length - 1,
        Math.floor(progress * this.animation.frames.length),
      );
      this.showFrame(nextFrame);
      return;
    }
    this.elapsed += Math.min(dt, 0.1);
    if (this.oneShot) {
      const playbackRate = this.oneShot === 'pickup' ? pickupPlaybackRate : 1;
      const nextFrame = Math.floor(this.elapsed * this.animation.frameRate * playbackRate);
      if (nextFrame >= this.animation.frames.length) {
        this.oneShot = null;
        this.carryItem = this.equippedCarryItem;
        this.state = this.crafting ? 'build' : this.movementState;
        this.selectAnimation();
      } else {
        this.showFrame(nextFrame);
      }
      return;
    }
    const speed = this.state === 'walk' ? 16 : this.animation.frameRate;
    const nextFrame = Math.floor(this.elapsed * speed) % this.animation.frames.length;
    this.showFrame(nextFrame);
  }

  private selectAnimation() {
    const name = this.state === 'idle' ? 'idle_loop'
      : this.state === 'jump' ? 'jump'
        : this.state === 'build' ? 'build_loop'
          : this.state === 'eat' ? 'eat'
            : this.state === 'item_in' ? 'item_in'
              : this.state === 'item_out' ? 'item_out'
                : this.state === 'pickup' ? 'pickup' : 'run_loop';
    const parsed = this.animations[this.state];
    const bankHash = smallHash('wilson');
    const facing = facingValues[this.facing];
    const candidates = parsed.animations.filter((animation) =>
      animation.name === name && animation.bankHash === bankHash);
    this.animation = candidates.find((animation) => animation.facing === facing) ??
      candidates.find((animation) => (animation.facing & facing) !== 0) ?? candidates[0];
    if (!this.animation) throw new Error(`Wilson animation ${name} is unavailable`);
    this.elapsed = 0;
    this.frameIndex = -1;
    this.showFrame(0);
  }

  private startOneShot(state: WilsonOneShotState) {
    this.carryItem = this.equippedCarryItem;
    this.oneShot = state;
    this.state = state;
    this.selectAnimation();
  }

  private showFrame(index: number) {
    if (index === this.frameIndex) return;
    this.frameIndex = index;
    const sprites = [...this.animation.frames[index].elements]
      .filter((element) => this.carryItem && this.state !== 'build'
        ? element.layerHash !== normalArmLayerHash
        : element.layerHash !== carryArmLayerHash)
      .sort((a, b) => b.z - a.z)
      .map((element) => {
        const usesTorch = this.state !== 'build'
          && this.carryItem === 'torch'
          && element.imageHash === swapObjectHash;
        const source = usesTorch ? this.torch : { build: this.build, materials: this.materials };
        const image = findImage(
          source.build,
          usesTorch ? swapTorchHash : element.imageHash,
          element.imageIndex,
        );
        return image ? { element, image, materials: source.materials } : undefined;
      })
      .filter((sprite): sprite is ResolvedSprite => Boolean(sprite));
    this.renderer.show(sprites);
  }
}

export async function createWilsonPlayer(assetBaseUrl: string): Promise<THREE.Group> {
  const [buildPackage, torchBuildPackage, torchAnimation, idle, movement, jump, itemActions, eat] = await Promise.all([
    loadBuild('wilson.zip', assetBaseUrl),
    loadBuild('swap_torch.zip', assetBaseUrl),
    loadAnim('torch.zip', assetBaseUrl),
    loadAnim('player_idles.zip', assetBaseUrl),
    loadAnim('player_basic.zip', assetBaseUrl),
    loadAnim('player_jump.zip', assetBaseUrl),
    loadAnim('player_actions_item.zip', assetBaseUrl),
    loadAnim('player_actions_eat.zip', assetBaseUrl),
  ]);
  if (buildPackage.build.name.toLowerCase() !== 'wilson') {
    throw new Error(`Expected Wilson build, received ${buildPackage.build.name}`);
  }
  if (torchBuildPackage.build.name.toLowerCase() !== 'swap_torch'
    || !torchAnimation.animations.some((animation) => animation.bankHash === smallHash('torch'))) {
    throw new Error('Expected the torch animation and swap_torch build');
  }

  const player = new THREE.Group();
  player.name = 'Wilson';
  player.position.set(0, 30, 0);
  player.userData.billboard = true;

  const visual = new THREE.Group();
  const assetToWorldScale = 0.02;
  visual.scale.set(assetToWorldScale, -assetToWorldScale, assetToWorldScale);
  player.add(visual);

  const controller = new WilsonController(visual, buildPackage.build, {
    idle,
    walk: movement,
    run: movement,
    jump,
    build: itemActions,
    eat,
    item_in: itemActions,
    item_out: itemActions,
    pickup: itemActions,
  }, createMaterials(buildPackage), {
    build: torchBuildPackage.build,
    materials: createMaterials(torchBuildPackage),
  });
  player.userData.animationController = controller;
  return player;
}
