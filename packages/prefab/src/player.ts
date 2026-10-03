import * as CANNON from 'cannon-es';
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
} from '@three-roaming/animation/animationAssets';
import { registerSpriteRenderGroup } from '@three-roaming/animation/renderOrder';
import {
  HatEquipmentAssets, isHatPlayerElementVisible, resolveHatSprites, type HatEquipment,
} from './hats';
import { GroundItemAssets } from './groundItems';
import { LanternLightController, loadLanternEquipment, resolveLanternPlayerSprite, type LanternEquipment } from './lantern';
import { loadYellowStaffEquipment, resolveYellowStaffPlayerSprite, StaffCastingLight, YELLOWSTAFF_CAST_TIME, type YellowStaffEquipment } from './yellowstaff';

export type WilsonFacing = 'up' | 'down' | 'side';
export type WilsonCarryItem = 'torch' | 'lantern' | 'yellowstaff';
type WilsonMovementState = 'idle' | 'walk' | 'run' | 'jump';
type WilsonOneShotState = 'eat' | 'item_in' | 'item_out' | 'pickup' | 'staff_pre' | 'staff';
type WilsonState = WilsonMovementState | 'build' | WilsonOneShotState;
type WilsonAnimations = Record<WilsonState, ParsedAnim>;

export interface WilsonAnimationController {
  readonly isCasting: boolean;
  playStaffCast(onCast: () => void): boolean;
  start(state: WilsonMovementState): void;
  playEat(): void;
  playItemTransition(state: 'item_in' | 'item_out', item?: WilsonCarryItem): void;
  playPickup(): void;
  setCrafting(crafting: boolean): void;
  setFacing(facing: WilsonFacing, mirrored?: boolean): void;
  setCarryItem(item: WilsonCarryItem | null, skinId?: string): Promise<void>;
  setLanternFuelPercent(percent: number): void;
  setHat(itemId: string | null, skinId?: string): Promise<void>;
  update(dt: number, jumpProgress?: number): void;
}

export type PlayerBody = CANNON.Body & { canJump: boolean };

export interface WilsonPlayerPrefab {
  body: PlayerBody;
  model: THREE.Group;
  setNormal(cameraWorldQuaternion: THREE.Quaternion): void;
}

export interface WilsonPlayerPrefabOptions {
  mass?: number;
  shapeRadius?: number;
}

const facingValues: Record<WilsonFacing, number> = { down: 8, side: 5, up: 2 };
const normalArmLayerHash = smallHash('ARM_normal');
const carryArmLayerHash = smallHash('ARM_carry');
const swapObjectHash = smallHash('swap_object');
const swapTorchHash = smallHash('swap_torch');
const lanternOverlayHash = smallHash('lantern_overlay');
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
  private equippedCarryItem: WilsonCarryItem | null = null;
  private carryItem: WilsonCarryItem | null = null;
  private carryKey = '';
  private carryRequest = 0;
  private readonly lanternAssets: GroundItemAssets;
  private readonly lanternLight: LanternLightController;
  private lanternEquipment: LanternEquipment | null = null;
  private staffEquipment: YellowStaffEquipment | null = null;
  private readonly castingLight: StaffCastingLight;
  private castElapsed = 0;
  private castCallback?: () => void;
  private animation!: Animation;
  private elapsed = 0;
  private frameIndex = -1;
  private readonly visual: THREE.Group;
  private readonly build: ParsedBuild;
  private readonly animations: WilsonAnimations;
  private readonly torch: CarryBuild;
  private readonly hatAssets: HatEquipmentAssets;
  private hat: HatEquipment | null = null;
  private hatRequest = 0;
  private hatKey = '';
  private hatElapsed = 0;

  constructor(
    visual: THREE.Group,
    build: ParsedBuild,
    animations: WilsonAnimations,
    materials: THREE.MeshBasicMaterial[],
    torch: CarryBuild,
    assetBaseUrl: string,
  ) {
    this.visual = visual;
    this.build = build;
    this.animations = animations;
    this.materials = materials;
    this.torch = torch;
    this.lanternAssets = new GroundItemAssets(assetBaseUrl);
    this.lanternLight = new LanternLightController(visual.parent!);
    this.castingLight = new StaffCastingLight(visual.parent!);
    this.hatAssets = new HatEquipmentAssets(assetBaseUrl);
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

  get isCasting(): boolean { return this.oneShot === 'staff_pre' || this.oneShot === 'staff'; }

  playStaffCast(onCast: () => void): boolean {
    if (this.oneShot || this.crafting || this.carryItem !== 'yellowstaff' || !this.staffEquipment) return false;
    this.startOneShot('staff_pre');
    this.castElapsed = 0;
    this.castCallback = onCast;
    this.castingLight.start();
    return true;
  }

  private cancelCast(): void {
    this.castCallback = undefined;
    this.castingLight.stop();
    if (!this.isCasting) return;
    this.oneShot = null;
    this.state = this.crafting ? 'build' : this.movementState;
    this.selectAnimation();
  }

  playItemTransition(state: 'item_in' | 'item_out', item: WilsonCarryItem = 'torch') {
    this.startOneShot(state);
    if (state === 'item_in') {
      this.carryItem = item;
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
    if (crafting) this.cancelCast();
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

  async setCarryItem(item: WilsonCarryItem | null, skinId?: string): Promise<void> {
    const key = item === null ? '' : `${item}:${skinId ?? ''}`;
    if (key === this.carryKey) return;
    this.carryKey = key;
    const request = ++this.carryRequest;
    this.cancelCast();
    this.equippedCarryItem = item;
    this.lanternLight.setLit(false);
    if (item === 'lantern') {
      try {
        const equipment = await loadLanternEquipment(this.lanternAssets, skinId);
        if (request !== this.carryRequest) return;
        this.lanternEquipment = equipment;
        this.lanternLight.setLit(true);
      } catch (error) {
        if (request !== this.carryRequest) return;
        this.carryKey = '';
        throw error;
      }
    }
    if (item === 'yellowstaff') {
      try {
        const equipment = await loadYellowStaffEquipment(this.lanternAssets, skinId);
        if (request !== this.carryRequest) return;
        this.staffEquipment = equipment;
      } catch (error) {
        if (request !== this.carryRequest) return;
        this.carryKey = '';
        throw error;
      }
    }
    if (this.oneShot === 'item_in') return;
    this.carryItem = item;
    const currentFrame = Math.max(0, this.frameIndex);
    this.frameIndex = -1;
    this.showFrame(currentFrame);
  }

  async setHat(itemId: string | null, skinId?: string): Promise<void> {
    const key = itemId === null ? '' : `${itemId}\n${skinId ?? ''}`;
    if (key === this.hatKey) return;
    this.hatKey = key;
    const request = ++this.hatRequest;
    this.hat = null;
    this.hatElapsed = 0;
    this.refreshFrame();
    if (itemId === null) return;
    try {
      const hat = await this.hatAssets.load(itemId, skinId);
      if (request !== this.hatRequest) return;
      this.hat = hat;
      this.refreshFrame();
    } catch (error) {
      if (request !== this.hatRequest) return;
      this.hatKey = '';
      throw error;
    }
  }

  setLanternFuelPercent(percent: number): void {
    this.lanternLight.setFuelPercent(percent);
    this.refreshFrame();
  }

  private refreshFrame() {
    const currentFrame = Math.max(0, this.frameIndex);
    this.frameIndex = -1;
    this.showFrame(currentFrame);
  }

  update(dt: number, jumpProgress?: number) {
    const step = Math.min(dt, 0.1);
    this.castingLight.update(step);
    if (this.isCasting) {
      this.castElapsed += step;
      if (this.castCallback && this.castElapsed >= YELLOWSTAFF_CAST_TIME) {
        const callback = this.castCallback;
        this.castCallback = undefined;
        callback();
      }
    }
    this.hatElapsed += Math.min(dt, 0.1);
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
        if (this.oneShot === 'staff_pre') {
          const remainder = this.elapsed - this.animation.frames.length / this.animation.frameRate;
          this.oneShot = 'staff';
          this.state = 'staff';
          this.selectAnimation();
          this.elapsed = remainder;
          return;
        }
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
                : this.state === 'pickup' ? 'pickup'
                  : this.state === 'staff_pre' ? 'staff_pre'
                    : this.state === 'staff' ? 'staff' : 'run_loop';
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
    this.cancelCast();
    this.carryItem = this.equippedCarryItem;
    this.oneShot = state;
    this.state = state;
    this.selectAnimation();
  }

  private showFrame(index: number) {
    if (index === this.frameIndex && !this.hat?.definition.equip.follow) return;
    this.frameIndex = index;
    const sprites = [...this.animation.frames[index].elements]
      .filter((element) => isHatPlayerElementVisible(element, this.hat?.definition.equip.mode ?? null))
      .filter((element) => this.carryItem && this.state !== 'build'
        ? element.layerHash !== normalArmLayerHash
        : element.layerHash !== carryArmLayerHash)
      .filter((element) => element.layerHash !== lanternOverlayHash
        || (this.carryItem === 'lantern' && this.lanternLight.isLit && this.state !== 'build'))
      .sort((a, b) => b.z - a.z)
      .flatMap((element): ResolvedSprite[] => {
        if (this.hat && element.imageHash === smallHash(
          this.hat.definition.equip.mode === 'fullhelm' ? 'headbase_hat' : 'swap_hat',
        )) return resolveHatSprites(this.hat, element, this.hatElapsed);
        if (this.carryItem === 'lantern' && this.lanternEquipment && this.state !== 'build'
          && (element.imageHash === swapObjectHash || element.imageHash === lanternOverlayHash)) {
          return resolveLanternPlayerSprite(this.lanternEquipment, element);
        }
        if (this.carryItem === 'yellowstaff' && this.staffEquipment && this.state !== 'build'
          && element.imageHash === swapObjectHash) {
          return resolveYellowStaffPlayerSprite(this.staffEquipment, element);
        }
        const usesTorch = this.state !== 'build'
          && this.carryItem === 'torch'
          && element.imageHash === swapObjectHash;
        const source = usesTorch ? this.torch : { build: this.build, materials: this.materials };
        const image = findImage(
          source.build,
          usesTorch ? swapTorchHash : element.imageHash,
          element.imageIndex,
        );
        return image ? [{ element, image, materials: source.materials }] : [];
      });
    this.renderer.show(sprites);
  }
}

export async function createWilsonPlayer(assetBaseUrl: string): Promise<THREE.Group> {
  const [buildPackage, torchBuildPackage, torchAnimation, idle, movement, jump, itemActions, eat, staff] = await Promise.all([
    loadBuild('wilson.zip', assetBaseUrl),
    loadBuild('swap_torch.zip', assetBaseUrl),
    loadAnim('torch.zip', assetBaseUrl),
    loadAnim('player_idles.zip', assetBaseUrl),
    loadAnim('player_basic.zip', assetBaseUrl),
    loadAnim('player_jump.zip', assetBaseUrl),
    loadAnim('player_actions_item.zip', assetBaseUrl),
    loadAnim('player_actions_eat.zip', assetBaseUrl),
    loadAnim('player_staff.zip', assetBaseUrl),
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
  registerSpriteRenderGroup(player, visual);

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
    staff_pre: staff,
    staff,
  }, createMaterials(buildPackage), {
    build: torchBuildPackage.build,
    materials: createMaterials(torchBuildPackage),
  }, assetBaseUrl);
  player.userData.animationController = controller;
  return player;
}

export async function createWilsonPlayerPrefab(
  assetBaseUrl: string,
  options: WilsonPlayerPrefabOptions = {},
): Promise<WilsonPlayerPrefab> {
  const model = await createWilsonPlayer(assetBaseUrl);
  const shapeRadius = options.shapeRadius ?? 4.5;
  const material = new CANNON.Material('player');
  const body = new CANNON.Body({
    mass: options.mass ?? 5,
    shape: new CANNON.Sphere(shapeRadius),
    position: new CANNON.Vec3(model.position.x, model.position.y, model.position.z)
      .vadd(new CANNON.Vec3(0, shapeRadius, 0)),
    material,
    fixedRotation: true,
  }) as PlayerBody;
  body.canJump = false;
  body.addEventListener('collide', () => {
    body.canJump = true;
  });

  return {
    body,
    model,
    setNormal(cameraWorldQuaternion) {
      model.quaternion.copy(cameraWorldQuaternion);
    },
  };
}
