import { WILSON_ACTION_TIMES } from '@dontstarve-web/stategraphs/SGwilson';
import type { AnimElement, ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import { findImage, smallHash } from '@dontstarve-web/animation/animationAssets';
import * as THREE from 'three';
import { GROUND_ITEM_DEFINITIONS, GroundItemAssets } from './groundItems';
import { setPrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { HandEquipment, Signal, HandEquipmentLifecycle } from '@dontstarve-web/signals';
import type { SpellCastDoer, SpellCastMap } from '@dontstarve-web/stategraphs/spellcaster';
import { SpellCaster } from '../../componets/src/spellcaster';
import { PlaySound, PreloadSounds } from './sound';

export const YELLOWSTAFF_ID = 'yellowstaff';
export const YELLOWSTAFF_COLOUR = [223 / 255, 208 / 255, 69 / 255] as const;
export const OPALSTAFF_ID = 'opalstaff';
export const OPALSTAFF_COLOUR = [64 / 255, 64 / 255, 208 / 255] as const;
export type LightStaffId = typeof YELLOWSTAFF_ID | typeof OPALSTAFF_ID;
export const LIGHT_STAFF_USES = { yellowstaff: 20, opalstaff: 50 } as const;
export const LIGHT_STAFF_SANITY_COST = 20;
export const LIGHT_STAFF_CAST_SOUND = 'dontstarve/common/staffteleport';
export interface LightStaffWorld {
  readonly map: SpellCastMap;
  preparePrefab(prefab: 'stafflight' | 'staffcoldlight'): Promise<void>;
  spawnPrefab(prefab: 'stafflight' | 'staffcoldlight', position: THREE.Vector3): THREE.Object3D;
}

/** staff.lua yellow/opal: configure one spellcaster on the actual inventory entity. */
export class LightStaffController implements HandEquipmentLifecycle {
  readonly spellcaster: SpellCaster;
  private readonly entity: ItemEntity;
  private readonly world: LightStaffWorld;
  private slotSignal: Signal<HandEquipment | null> | undefined;
  private equipment: HandEquipment | null = null;
  constructor(entity: ItemEntity, world: LightStaffWorld) {
    if (!isLightStaff(entity.prefab)) throw new Error('LightStaffController requires a light staff');
    this.entity = entity; this.world = world;
    entity.addTag('nopunch'); entity.addTag('allow_action_on_impassable');
    if (entity.prefab === 'yellowstaff') entity.addTag('shadowlevel');
    entity.castsound = LIGHT_STAFF_CAST_SOUND;
    entity.fxcolour = entity.prefab === 'opalstaff' ? OPALSTAFF_COLOUR : YELLOWSTAFF_COLOUR;
    entity.components.finiteuses.setMaxUses(LIGHT_STAFF_USES[entity.prefab]);
    this.spellcaster = entity.component('spellcaster', () => new SpellCaster(entity, world.map));
    this.spellcaster.setSpellFn((_staff, _target, position, doer) => this.createLight(position, doer),
      () => Promise.all([world.preparePrefab(this.product), PreloadSounds(LIGHT_STAFF_CAST_SOUND, 'dontstarve/common/gem_shatter')])
        .then(() => undefined));
    this.spellcaster.canUseOnPoint = true;
    this.spellcaster.canUseOnPointWater = true;
  }
  private get product(): 'stafflight' | 'staffcoldlight' {
    return this.entity.prefab === 'opalstaff' ? 'staffcoldlight' : 'stafflight';
  }
  onequip(slotSignal: Signal<HandEquipment | null>): void {
    this.slotSignal = slotSignal; this.equipment = slotSignal.peek();
  }
  onunequip(): void { this.slotSignal = undefined; this.equipment = null; }
  dispose(): void { this.onunequip(); }
  private createLight(position: THREE.Vector3, doer: SpellCastDoer): boolean {
    if (this.entity.isRemoved) return false;
    this.world.spawnPrefab(this.product, position);
    const depleted = (this.entity.components.finiteuses.remaining ?? LIGHT_STAFF_USES[this.entity.prefab as LightStaffId]) === 1;
    const slotSignal = this.slotSignal, equipment = this.equipment;
    if (!this.entity.components.finiteuses.use(1)) return false;
    if (depleted) {
      PlaySound('dontstarve/common/gem_shatter', doer.position);
      if (slotSignal && equipment?.entity === this.entity && slotSignal.peek() === equipment) slotSignal.set(null);
    }
    if (doer.components.staffsanity) doer.components.staffsanity.doCastingDelta(-LIGHT_STAFF_SANITY_COST);
    else doer.components.sanity?.doDelta(-LIGHT_STAFF_SANITY_COST);
    return true;
  }
}
export function getLightStaffController(entity: ItemEntity, world: LightStaffWorld): LightStaffController {
  return entity.component('lightstaff', () => new LightStaffController(entity, world));
}
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
