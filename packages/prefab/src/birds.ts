import type { ItemEntity } from '@dontstarve-web/inventory';
import { Occupier } from '../../componets/src/occupiable';
import { TOTAL_DAY_TIME } from '../../componets/src/perishable';
import type { SoundEventPath } from './sound';

export const BIRD_IDS = ['crow', 'robin', 'robin_winter', 'canary'] as const;
export type BirdId = typeof BIRD_IDS[number];

export function isBirdId(itemId: string): itemId is BirdId {
  return (BIRD_IDS as readonly string[]).includes(itemId);
}

/** tuning.lua: BIRD_PERISH_TIME = total_day_time * 5, MakeFeedableSmallLivestock's starve time. */
export const BIRD_PERISH_TIME = TOTAL_DAY_TIME * 5;

/** birds.lua makebird(name, soundname): BIRD_SOUNDS.chirp / death. */
export const BIRD_SOUNDS: Readonly<Record<BirdId, { readonly chirp: SoundEventPath; readonly death: SoundEventPath }>> = {
  crow: { chirp: 'dontstarve/birds/chirp_crow', death: 'dontstarve/birds/death_crow' },
  robin: { chirp: 'dontstarve/birds/chirp_robin', death: 'dontstarve/birds/death_robin' },
  robin_winter: { chirp: 'dontstarve/birds/chirp_junco', death: 'dontstarve/birds/death_junco' },
  canary: { chirp: 'dontstarve/birds/chirp_canary', death: 'dontstarve/birds/death_canary' },
};

/** birds.lua lootdropper: AddRandomLoot(feather, canary and .1 or 1), AddRandomLoot(smallmeat, 1), numrandomloot = 1. */
export function generateBirdLoot(bird: BirdId, random: () => number = Math.random): string {
  const featherWeight = bird === 'canary' ? .1 : 1;
  return random() * (featherWeight + 1) < featherWeight ? `feather_${bird}` : 'smallmeat';
}

/** MakeSmallPerishableCreature's onperish: a starved bird in a holder is replaced by its loot. */
function onperish(entity: ItemEntity): void {
  const owner = entity.components.inventoryitem.owner;
  if (!owner) return;
  // health is present, so the holder is told about the (negligent) murder first.
  owner.PushEvent('murdered', { victim: entity, stackmult: 1, negligent: true });
  owner.replace(generateBirdLoot(entity.prefab as BirdId));
}

/**
 * birds.lua makebird + MakeFeedableSmallLivestock for the carried bird: tags, occupier, and a
 * perishable that stops while the bird is on the ground (StopPerishing in OnDropped).
 */
export function configureBirdEntity(entity: ItemEntity): void {
  for (const tag of ['bird', entity.prefab, 'smallcreature', 'small_livestock', 'show_spoilage']) entity.addTag(tag);
  // SGbird's stunned state allows pickup; the stunned ground pose is the only ground form ported.
  entity.components.inventoryitem.canbepickedup = true;
  entity.components.inventoryitem.canbepickedupalive = true;
  const occupier = entity.component('occupier', () => new Occupier<ItemEntity>());
  const perishable = entity.components.perishable;
  perishable.perishfn = () => onperish(entity);
  // In a holder or a cage the bird starves; MakeSmallPerishableCreature stops it on the ground.
  perishable.localMultiplier = () => entity.components.inventoryitem.owner || occupier.GetOwner() ? 1 : 0;
  perishable.occupierCage = () => occupier.GetOwner() !== undefined;
}
