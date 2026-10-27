import type { ItemEntity } from '@dontstarve-web/inventory';
import type { EquipmentLifecycle } from '@dontstarve-web/signals';
import { WILSON_ACTION_TIMES } from '@dontstarve-web/stategraphs/SGwilson';
import type { SpellCastDoer, SpellCastMap } from '@dontstarve-web/stategraphs/spellcaster';
import * as THREE from 'three';
import { SpellCaster } from '../../componets/src/spellcaster';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory, type EquipmentVisualItem } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import { spawnLightEntity } from './localLight';

export const YELLOWSTAFF_ID = 'yellowstaff';
export const YELLOWSTAFF_COLOUR = [223 / 255, 208 / 255, 69 / 255] as const;
export const OPALSTAFF_ID = 'opalstaff';
export const OPALSTAFF_COLOUR = [64 / 255, 64 / 255, 208 / 255] as const;
export type StaffId = LightStaffId | 'greenstaff' | 'firestaff';
export function isStaff(itemId: string | null | undefined): itemId is StaffId { return isLightStaff(itemId) || itemId === 'greenstaff' || itemId === 'firestaff'; }
export type LightStaffId = typeof YELLOWSTAFF_ID | typeof OPALSTAFF_ID;
export const LIGHT_STAFF_USES = { yellowstaff: 20, opalstaff: 50 } as const;
export const LIGHT_STAFF_SANITY_COST = 20;
export const LIGHT_STAFF_CAST_SOUND = 'dontstarve/common/staffteleport';
export interface LightStaffWorld {
  readonly map: SpellCastMap;
  /** SpawnPrefab at the cast's commit; the product's display loads its art. */
  spawnPrefab(prefab: 'stafflight' | 'staffcoldlight', position: THREE.Vector3): THREE.Object3D;
}

/** staff.lua yellow/opal: configure one spellcaster on the actual inventory entity. */
export class LightStaffController implements EquipmentLifecycle {
  readonly spellcaster: SpellCaster;
  private readonly entity: ItemEntity;
  private readonly world: LightStaffWorld;
  constructor(entity: ItemEntity, world: LightStaffWorld) {
    if (!isLightStaff(entity.prefab)) throw new Error('LightStaffController requires a light staff');
    this.entity = entity; this.world = world;
    entity.addTag('nopunch'); entity.addTag('allow_action_on_impassable');
    if (entity.prefab === 'yellowstaff') entity.addTag('shadowlevel');
    entity.castsound = LIGHT_STAFF_CAST_SOUND;
    entity.fxcolour = entity.prefab === 'opalstaff' ? OPALSTAFF_COLOUR : YELLOWSTAFF_COLOUR;
    entity.components.finiteuses.setMaxUses(LIGHT_STAFF_USES[entity.prefab]);
    this.spellcaster = entity.component('spellcaster', () => new SpellCaster(entity, world.map));
    entity.components.spellcaster = this.spellcaster;
    this.spellcaster.setSpellFn((_staff, _target, position, doer) => this.createLight(position, doer));
    this.spellcaster.canUseOnPoint = true;
    this.spellcaster.canUseOnPointWater = true;
  }
  private get product(): 'stafflight' | 'staffcoldlight' {
    return this.entity.prefab === 'opalstaff' ? 'staffcoldlight' : 'stafflight';
  }
  onequip(): void {}
  onunequip(): void {}
  dispose(): void {}
  private createLight(position: THREE.Vector3, doer: SpellCastDoer): boolean {
    if (this.entity.isRemoved) return false;
    this.world.spawnPrefab(this.product, position);
    const depleted = (this.entity.components.finiteuses.remaining ?? LIGHT_STAFF_USES[this.entity.prefab as LightStaffId]) === 1;
    if (!this.entity.components.finiteuses.use(1)) return false;
    if (depleted) PlaySound('dontstarve/common/gem_shatter', doer.position);
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
/** staff.lua onequip: `swap_<colour>staff` of swap_staffs, or the skin's; the red staff's prefab id is firestaff. */
export function staffVisual(item: EquipmentVisualItem & { readonly prefab: StaffId }) {
  const skin = skinArchive(item.prefab, GROUND_ITEM_DEFINITIONS[item.prefab].skinArchives, item.skinId);
  return handEquipmentVisual(item, [...skin ? [skin] : [], 'swap_staffs'], `swap_${item.prefab === 'firestaff' ? 'redstaff' : item.prefab}`);
}

/** staff_castinglight.lua's expanding light: a non-persistent FX light entity parented to the caster. */
export class StaffCastingLight {
  private readonly entity: ReturnType<typeof spawnLightEntity>;
  private elapsed = 0;
  private active = false;
  private duration = 1.9;
  private delay = 0.33;
  private colour: readonly [number, number, number] = YELLOWSTAFF_COLOUR;

  constructor(owner: THREE.Object3D) {
    this.entity = spawnLightEntity(owner, 'staff_castinglight');
  }

  get model(): THREE.Object3D { return this.entity.model; }

  /** staff_castinglight.lua SetUp(colour, duration, delay); the staff's own cast waits .33 seconds for 1.9. */
  start(colour: readonly [number, number, number] = YELLOWSTAFF_COLOUR, duration = 1.9, delay = 0.33): void {
    this.colour = colour;
    this.duration = duration;
    this.delay = delay;
    this.elapsed = 0;
    this.active = true;
    this.refresh(0);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.elapsed += dt;
    if (this.elapsed >= this.delay + this.duration) this.stop();
    else this.refresh(Math.max(0, (this.elapsed - this.delay) / this.duration));
  }

  stop(): void {
    this.active = false;
    this.entity.instance.light.set(null);
  }

  /** The caster is removed: the light entity goes with it. */
  dispose(): void {
    this.stop();
    this.entity.remove();
  }

  private refresh(progress: number): void {
    const k = progress ** 5;
    this.entity.instance.light.set({
      radius: (0.3 + 10 * k) * (TILE_SIZE / 4),
      intensity: 0.8 - 0.6 * k,
      falloff: 0.9 - 0.4 * k,
      colour: this.colour,
    });
  }
}

export const yellowstaffVisual: EquipmentVisualFactory = item => staffVisual({ ...item, prefab: item.prefab as StaffId });
