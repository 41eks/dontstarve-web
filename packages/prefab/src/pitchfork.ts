import { WILSON_ACTION_TIMES } from '@dontstarve-web/stategraphs/SGwilson';
import * as THREE from 'three';
import { findImage, smallHash, type AnimElement, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from './groundItems';
import type { WilsonAnimationController } from './player';
import type { Locomotor } from './locomotor';
import type { WorldContext } from './worldContext';
import type { CursorLabel } from './buildCursor';
import { PointerRaycaster } from './pointerRaycaster';
import { snapToTileCenter } from './tile';
import type { TurfMap } from './turfMap';

// SGwilson: TERRAFORM commits 25 frames after shovel_pre starts.
export const PITCHFORK_DIG_TIME = WILSON_ACTION_TIMES.terraform;
export const PITCHFORK_REACH = 4;
type PitchforkBuild = Awaited<ReturnType<GroundItemAssets['loadBuild']>>;

export type PitchforkTool = 'pitchfork' | 'goldenpitchfork';
export function isPitchforkTool(value: string): value is PitchforkTool {
  return value === 'pitchfork' || value === 'goldenpitchfork';
}

export interface PitchforkEquipment {
  readonly tool: PitchforkTool;
  /** Held symbol swapped over the player's `swap_object`, e.g. `swap_pitchfork`. */
  readonly symbol: string;
  readonly builds: readonly PitchforkBuild[];
}

const PITCHFORK_SWAP: Readonly<Record<PitchforkTool, { archive: string; symbol: string }>> = {
  pitchfork: { archive: 'swap_pitchfork.zip', symbol: 'swap_pitchfork' },
  goldenpitchfork: { archive: 'swap_goldenpitchfork.zip', symbol: 'swap_goldenpitchfork' },
};

/** pitchfork.lua: held swap symbols are distinct from each tool's ground idle. */
export async function loadPitchforkEquipment(
  assets: GroundItemAssets,
  tool: PitchforkTool,
  skinId?: string,
): Promise<PitchforkEquipment> {
  const swap = PITCHFORK_SWAP[tool];
  const skinArchive = skinId ? GROUND_ITEM_DEFINITIONS[tool].skinArchives[skinId] : undefined;
  if (skinId && !skinArchive) throw new Error(`Unknown ${tool} skin: ${skinId}`);
  const [base, skin] = await Promise.all([
    assets.loadBuild(swap.archive),
    skinArchive ? assets.loadBuild(skinArchive) : undefined,
  ]);
  return { tool, symbol: swap.symbol, builds: skin ? [skin, base] : [base] };
}

export function resolvePitchforkPlayerSprite(equipment: PitchforkEquipment, element: AnimElement): ResolvedSprite[] {
  const symbol = smallHash(equipment.symbol);
  for (const source of equipment.builds) {
    const image = findImage(source.build, symbol, element.imageIndex);
    if (image) return [{ element, image, materials: source.materials }];
    // Missing held frames in an explicitly overridden symbol mean hidden art.
    if (source.build.symbols.has(symbol)) return [];
  }
  return [];
}

/** TERRAFORM is a right-click point action, snapped to the source map tile. */
export class PitchforkActionController {
  private readonly pointer: PointerRaycaster;
  private readonly label: CursorLabel;
  private target?: THREE.Vector3;
  private actionVersion = 0;
  private hovering = false;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly world: WorldContext;
  private readonly animation: WilsonAnimationController;
  private readonly locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>;
  private readonly isEquipped: () => boolean;
  private readonly turf: TurfMap;
  private readonly isManualMovement: () => boolean;
  private readonly onRequest: () => void;

  constructor(
    world: WorldContext,
    animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>,
    isEquipped: () => boolean,
    turf: TurfMap,
    isManualMovement = () => false,
    onRequest = () => {},
  ) {
    this.world = world;
    this.animation = animation;
    this.locomotor = locomotor;
    this.isEquipped = isEquipped;
    this.turf = turf;
    this.isManualMovement = isManualMovement;
    this.onRequest = onRequest;
    this.pointer = new PointerRaycaster(world);
    this.label = world.createCursorLabel?.(this.pointer) ?? { show() {}, hide() {}, update() {} };
    // Consume a terraform click before container and placement handlers.
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  request(point: THREE.Vector3): boolean {
    if (!this.isEquipped() || !this.turf.canTerraform(point) || this.animation.isDigging
      || this.animation.isCasting || this.animation.isNetting) return false;
    this.cancel();
    this.animation.cancelEmote();
    const center = snapToTileCenter(point);
    const edge = this.turf.size / 2 - 1e-6;
    this.target = new THREE.Vector3(THREE.MathUtils.clamp(center.x, -edge, edge), 0,
      THREE.MathUtils.clamp(center.z, -edge, edge));
    this.onRequest();
    return true;
  }

  cancel(): void {
    this.actionVersion++;
    // Cancel only this controller's active action.
    const owned = this.isEquipped();
    if (this.target || (owned && this.animation.isDigging)) this.locomotor.stop();
    this.target = undefined;
    if (owned) this.animation.cancelDig();
  }

  update(_dt: number): void {
    this.updateHover();
    if (!this.isEquipped() || this.isManualMovement()) { this.cancel(); return; }
    if (!this.target) return;
    const target = this.target;
    if (!this.turf.canTerraform(target)) { this.cancel(); return; }
    const distance = this.distanceSquared(target);
    if (distance > PITCHFORK_REACH ** 2) {
      // Walk into tool reach of the selected tile's centre.
      const destination = target.clone();
      this.direction.subVectors(this.world.player.position, target).setY(0).normalize();
      destination.addScaledVector(this.direction, PITCHFORK_REACH * 0.8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > 0.01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(target);
    const version = this.actionVersion;
    if (this.animation.playDig(() => {
      if (version === this.actionVersion && this.isEquipped() && this.turf.canTerraform(target)
        && this.distanceSquared(target) <= PITCHFORK_REACH ** 2) this.turf.dig(target);
    })) this.target = undefined;
  }

  dispose(): void {
    this.cancel();
    this.label.hide();
    this.pointer.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private distanceSquared(target: THREE.Vector3): number {
    return (this.world.player.position.x - target.x) ** 2
      + (this.world.player.position.z - target.z) ** 2;
  }

  private faceTarget(target: THREE.Vector3): void {
    this.direction.subVectors(target, this.world.player.position).setY(0);
    if (this.direction.lengthSq() < 1e-8) return;
    this.world.camera.getWorldDirection(this.forward);
    this.forward.setY(0).normalize();
    this.right.crossVectors(this.forward, this.up).normalize();
    const forward = this.direction.dot(this.forward);
    const side = this.direction.dot(this.right);
    this.animation.setFacing(Math.abs(forward) >= Math.abs(side) ? (forward > 0 ? 'up' : 'down') : 'side',
      Math.abs(side) > Math.abs(forward) && side < 0);
  }

  private hitTarget(): THREE.Vector3 | undefined {
    if (!this.isEquipped()) return undefined;
    const point = this.pointer.groundPoint();
    return point && this.turf.canTerraform(point) ? point : undefined;
  }

  private updateHover(): void {
    const hovering = this.hitTarget() !== undefined;
    if (hovering !== this.hovering) {
      this.hovering = hovering;
      if (hovering) this.label.show(': 铲地', 'right');
      else this.label.hide();
    }
    this.label.update();
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented) return;
    if (event.button === 0) { this.cancel(); return; }
    if (event.button !== 2 || !this.isEquipped()) return;
    this.pointer.trackPointer(event);
    const target = this.hitTarget();
    if (!target) { this.cancel(); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.request(target);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') this.cancel();
  };
}
