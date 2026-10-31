import type { ItemEntity } from '@dontstarve-web/inventory';
import type { EquipmentLifecycle } from '@dontstarve-web/signals';
import type { SpellCastMap } from '@dontstarve-web/stategraphs/castspell';
import type * as THREE from 'three';
import { SpellCaster } from '../../componets/src/spellcaster';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { TILE_SIZE } from './tile';

export const TRIDENT_ID = 'trident';
// tuning.lua: wilson_attack = 34; TRIDENT = { DAMAGE = wilson_attack * 1.5, USES = 200, SPELL = { USE_COUNT = 50, RADIUS = 2.75 } }.
export const TRIDENT_DAMAGE = 34 * 1.5;
export const TRIDENT_USES = 200;
const SPELL_USE_COUNT = 50;
const SPELL_RADIUS = 2.75;
const COST_PER_EXPLOSION = TRIDENT_USES / SPELL_USE_COUNT;
const WORLD_SCALE = TILE_SIZE / 4;
const FX_RADIUS = SPELL_RADIUS * 0.65 * WORLD_SCALE;
export const TRIDENT_STRUM_SOUND = 'hookline_2/characters/trident_attack';

export interface TridentWorld {
  readonly map: SpellCastMap;
  /** SpawnPrefab("crab_king_waterspout") at a point on the water. */
  spawnWaterspout(position: THREE.Vector3): void;
}

/** trident.lua: one point spellcaster that works only on water, and its finiteuses cost per explosion. */
export class TridentController implements EquipmentLifecycle {
  readonly spellcaster: SpellCaster;
  private readonly entity: ItemEntity;
  private readonly world: TridentWorld;
  constructor(entity: ItemEntity, world: TridentWorld) {
    this.entity = entity; this.world = world;
    entity.addTag('allow_action_on_impassable'); entity.addTag('guitar');
    entity.addTag('pointy'); entity.addTag('sharp');
    entity.components.finiteuses.setMaxUses(TRIDENT_USES);
    // on_uses_finished: the owner hears toolbroke before the item removes itself.
    entity.components.finiteuses.setOnFinished(() => {
      entity.components.inventoryitem.owner?.PushEvent('toolbroke', { tool: entity });
      return entity.remove();
    });
    this.spellcaster = entity.component('spellcaster', () => new SpellCaster(entity, world.map));
    entity.components.spellcaster = this.spellcaster;
    this.spellcaster.setSpellFn((_trident, _target, position) => this.createWaterExplosion(position));
    this.spellcaster.canUseOnPointWater = true;
  }
  onequip(): void {}
  onunequip(): void {}
  dispose(): void {}

  /** create_water_explosion: waterspouts at four spokes around the target, then the use cost. */
  private createWaterExplosion(position: THREE.Vector3): boolean {
    if (this.entity.isRemoved || !this.entity.components.inventoryitem.owner) return false;
    // GetRandomWithVariance(-45, 20)
    let angle = -45 + (Math.random() * 2 - 1) * 20;
    for (let i = 0; i < 4; i++) {
      angle += 90;
      const point = position.clone();
      point.x += FX_RADIUS * Math.cos(angle * Math.PI / 180);
      point.z -= FX_RADIUS * Math.sin(angle * Math.PI / 180);
      if (this.world.map.isOceanAtPoint(point)) this.world.spawnWaterspout(point);
    }
    return this.entity.components.finiteuses.use(COST_PER_EXPLOSION);
  }
}

export function getTridentController(entity: ItemEntity, world: TridentWorld): TridentController {
  return entity.component('trident', () => new TridentController(entity, world));
}

/** trident.lua on_equipped: swap_object uses swap_trident, or the same symbol of the skin build. SGwilson's play_strum names the plain swap_trident. */
export const tridentVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('trident', GROUND_ITEM_DEFINITIONS.trident.skinArchives, item.skinId);
  return handEquipmentVisual(item, [...skin ? [skin] : [], 'swap_trident'], 'swap_trident');
};
