import { WILSON_ACTION_TIMES } from '@dontstarve-web/stategraphs/SGwilson';
import type { AnimElement, ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import { findImage, smallHash } from '@dontstarve-web/animation/animationAssets';
import * as THREE from 'three';
import { GROUND_ITEM_DEFINITIONS, GroundItemAssets } from './groundItems';
import { setPrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';

export const YELLOWSTAFF_ID = 'yellowstaff';
export const YELLOWSTAFF_COLOUR = [223 / 255, 208 / 255, 69 / 255] as const;
export const OPALSTAFF_ID = 'opalstaff';
export const OPALSTAFF_COLOUR = [64 / 255, 64 / 255, 208 / 255] as const;
export type LightStaffId = typeof YELLOWSTAFF_ID | typeof OPALSTAFF_ID;
export function isLightStaff(itemId: string | null | undefined): itemId is LightStaffId {
  return itemId === YELLOWSTAFF_ID || itemId === OPALSTAFF_ID;
}
export const YELLOWSTAFF_CAST_TIME = WILSON_ACTION_TIMES.cast;
type StaffBuild = Awaited<ReturnType<GroundItemAssets['loadBuild']>>;
export interface YellowStaffEquipment { readonly builds: readonly StaffBuild[]; readonly symbol: string; }

export async function loadYellowStaffEquipment(assets: GroundItemAssets, skinId?: string): Promise<YellowStaffEquipment> {
  return loadLightStaffEquipment(assets, YELLOWSTAFF_ID, skinId);
}

export async function loadLightStaffEquipment(assets: GroundItemAssets, itemId: LightStaffId, skinId?: string): Promise<YellowStaffEquipment> {
  const skinArchive = skinId ? GROUND_ITEM_DEFINITIONS[itemId].skinArchives[skinId] : undefined;
  if (skinId && !skinArchive) throw new Error(`Unknown ${itemId} skin: ${skinId}`);
  const base = await assets.loadBuild('swap_staffs.zip');
  const skin = skinArchive ? await assets.loadBuild(skinArchive) : undefined;
  return { builds: skin ? [skin, base] : [base], symbol: `swap_${itemId}` };
}

export function resolveYellowStaffPlayerSprite(equipment: YellowStaffEquipment, element: AnimElement): ResolvedSprite[] {
  for (const source of equipment.builds) {
    const image = findImage(source.build, smallHash(equipment.symbol), element.imageIndex);
    if (image) return [{ element, image, materials: source.materials }];
  }
  return [];
}

/** staff_castinglight.lua's expanding light, on a separate child of the caster. */
export class StaffCastingLight {
  readonly model = new THREE.Group();
  private elapsed = 0;
  private active = false;
  private colour: readonly [number, number, number] = YELLOWSTAFF_COLOUR;

  constructor(owner: THREE.Object3D) {
    this.model.name = 'staff_castinglight';
    owner.add(this.model);
  }

  start(colour: readonly [number, number, number] = YELLOWSTAFF_COLOUR): void {
    this.colour = colour;
    this.elapsed = 0;
    this.active = true;
    this.refresh(0);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.elapsed += dt;
    if (this.elapsed >= 0.33 + 1.9) this.stop();
    else this.refresh(Math.max(0, (this.elapsed - 0.33) / 1.9));
  }

  stop(): void {
    this.active = false;
    setPrefabLocalLight(this.model, null);
  }

  private refresh(progress: number): void {
    const k = progress ** 5;
    setPrefabLocalLight(this.model, {
      radius: (0.3 + 10 * k) * (TILE_SIZE / 4),
      intensity: 0.8 - 0.6 * k,
      falloff: 0.9 - 0.4 * k,
      colour: this.colour,
    });
  }
}
