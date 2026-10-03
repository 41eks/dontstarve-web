import * as THREE from 'three';
import { findImage, smallHash, type AnimElement, type ResolvedSprite } from '@three-roaming/animation/animationAssets';
import { GROUND_ITEM_DEFINITIONS, GroundItemAssets, createGroundItemSprite } from './groundItems';
import { setPrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';

export const LANTERN_ID = 'lantern';
export const LANTERN_COLOUR = [180 / 255, 195 / 255, 150 / 255] as const;

/** mininglantern.lua's fuel-dependent light; fuel is supplied by the caller. */
export class LanternLightController {
  private fuelPercent = 1;
  private requestedOn = false;

  constructor(owner: THREE.Object3D, onChange?: (lit: boolean) => void) {
    this.owner = owner;
    this.onChange = onChange;
  }

  private readonly owner: THREE.Object3D;
  private readonly onChange?: (lit: boolean) => void;

  get isLit(): boolean { return this.requestedOn && this.fuelPercent > 0; }

  setLit(lit: boolean): void {
    this.requestedOn = lit;
    this.refresh();
  }

  setFuelPercent(percent: number): void {
    if (!Number.isFinite(percent)) throw new RangeError('Lantern fuel percent must be finite');
    this.fuelPercent = THREE.MathUtils.clamp(percent, 0, 1);
    this.refresh();
  }

  dispose(): void {
    this.setLit(false);
  }

  private refresh(): void {
    setPrefabLocalLight(this.owner, this.isLit ? {
      radius: THREE.MathUtils.lerp(3, 5, this.fuelPercent) * (TILE_SIZE / 4),
      intensity: THREE.MathUtils.lerp(0.4, 0.6, this.fuelPercent),
      falloff: 0.9,
      colour: LANTERN_COLOUR,
    } : null);
    this.onChange?.(this.isLit);
  }
}

export interface LanternGroundOptions {
  skinId?: string;
  fuelPercent?: number;
  lit?: boolean;
}

/** Dropping a fuelled lantern lights it; its source origin remains the foot point. */
export async function createLanternGroundSprite(assets: GroundItemAssets, options: LanternGroundOptions = {}) {
  const sprite = await createGroundItemSprite(assets, LANTERN_ID, options.skinId);
  const light = new LanternLightController(sprite.model, (lit) => sprite.setAnimation(lit ? 'idle_on' : 'idle_off'));
  light.setFuelPercent(options.fuelPercent ?? 1);
  light.setLit(options.lit ?? true);
  return {
    model: sprite.model,
    update: sprite.update,
    light,
    dispose() { light.dispose(); sprite.dispose(); },
  };
}

type LanternBuild = Awaited<ReturnType<GroundItemAssets['loadBuild']>>;
export interface LanternEquipment { readonly builds: readonly LanternBuild[]; }

export async function loadLanternEquipment(assets: GroundItemAssets, skinId?: string): Promise<LanternEquipment> {
  const skinArchive = skinId ? GROUND_ITEM_DEFINITIONS.lantern.skinArchives[skinId] : undefined;
  if (skinId && !skinArchive) throw new Error(`Unknown lantern skin: ${skinId}`);
  const base = await assets.loadBuild('swap_lantern.zip');
  const skin = skinArchive ? await assets.loadBuild(skinArchive) : undefined;
  return { builds: skin ? [skin, base] : [base] };
}

/** Worn art uses swap_lantern and lantern_overlay, never the ground idle pose. */
export function resolveLanternPlayerSprite(equipment: LanternEquipment, element: AnimElement): ResolvedSprite[] {
  const hash = element.imageHash === smallHash('swap_object') ? smallHash('swap_lantern')
    : smallHash('lantern_overlay');
  for (const source of equipment.builds) {
    const image = findImage(source.build, hash, element.imageIndex);
    if (image) return [{ element, image, materials: source.materials }];
  }
  return [];
}
