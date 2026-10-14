import type * as THREE from 'three';
import { findImage, smallHash, type AnimElement, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { EquipmentLifecycle } from '@dontstarve-web/signals';
import type { SpellCastMap } from '@dontstarve-web/stategraphs/spellcaster';
import { SpellCaster } from '../../componets/src/spellcaster';
import { GROUND_ITEM_DEFINITIONS, GroundItemAssets } from './groundItems';
import { PreloadSounds } from './sound';
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
  /** Load crab_king_waterspout art and sound before the cast is buffered. */
  prepareWaterspout(): Promise<void>;
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
    this.spellcaster.setSpellFn((_trident, _target, position) => this.createWaterExplosion(position),
      () => Promise.all([world.prepareWaterspout(), PreloadSounds(TRIDENT_STRUM_SOUND)]).then(() => undefined));
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

type TridentBuild = Awaited<ReturnType<GroundItemAssets['loadBuild']>>;
export interface TridentEquipment { readonly builds: readonly TridentBuild[] }

/** trident.lua on_equipped: swap_object uses swap_trident, or the same symbol of the skin build. */
export async function loadTridentEquipment(assets: GroundItemAssets, skinId?: string): Promise<TridentEquipment> {
  const skinArchive = skinId ? GROUND_ITEM_DEFINITIONS.trident.skinArchives[skinId] : undefined;
  if (skinId && !skinArchive) throw new Error(`Unknown trident skin: ${skinId}`);
  const [base, skin] = await Promise.all([
    assets.loadBuild('swap_trident.zip'),
    skinArchive ? assets.loadBuild(skinArchive) : undefined,
  ]);
  return { builds: skin ? [skin, base] : [base] };
}

export function resolveTridentPlayerSprite(equipment: TridentEquipment, element: AnimElement): ResolvedSprite[] {
  const symbol = smallHash('swap_trident');
  for (const source of equipment.builds) {
    const image = findImage(source.build, symbol, element.imageIndex);
    if (image) return [{ element, image, materials: source.materials }];
  }
  return [];
}
