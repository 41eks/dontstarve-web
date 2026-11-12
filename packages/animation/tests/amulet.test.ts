import { expect, it, vi } from 'vitest';
import { Hunger } from '../../componets/src/hunger';
import { Health } from '../../componets/src/health';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { AMULET_ID, REDAMULET_CONVERSION, REDAMULET_CONVERSION_TIME, REDAMULET_USES } from '../../prefab/src/amulet';
import { smallHash } from '../src/animationAssets';
import { HAUNT_COOLDOWN_MEDIUM } from '../../componets/src/hauntable';
import { createPickupInventory } from './pickupFixture';
import { testPlayer } from './testPlayer';
import { wilsonPlayer } from './wilsonPlayer';
import { declaredAnimState } from './animStateFixture';
import { addComponent } from '../../prefab/src/components';
import { createEquipmentViews } from '../../prefab/src/equipmentVisual';
import { GroundItemAssets } from '../../prefab/src/groundItems';
import { HatEquipmentAssets } from '../../prefab/src/hats';
import { SpriteState } from '@dontstarve-web/display';
import type { WilsonStateName } from '../../stategraphs/src/SGwilson';
import { createPerishWorld } from './perishWorldFixture';

function wornAmulet(health: number, hunger: number) {
  const inventory = createPickupInventory(), world = createPerishWorld();
  inventory.entities.bindPerishWorld(world);
  // The wearer is a player inst: its health and hunger, its stategraph, and the slots of its sprite equipment draws on.
  const player = wilsonPlayer();
  const owner = testPlayer({ model: player.transform.model, inventory });
  const stats = { health: addComponent(owner, 'health', Health, 150), hunger: addComponent(owner, 'hunger', Hunger, 150) };
  stats.health.SetCurrentHealth(health);
  stats.hunger.SetCurrent(hunger);
  const graph = player.sg;
  const sprite = new SpriteState({ name: 'idle' }), assets = new GroundItemAssets();
  owner.OpenEquipmentView = createEquipmentViews(owner, { sprite: { sprite, art: assets }, assets,
    hats: new HatEquipmentAssets('/dst/data/anim'), lightParent: player });
  // GoToState pushes "newstate" on the player inst.
  const enter = (name: WilsonStateName) => graph.goToState(name);
  /** Whether the player's sprite still declares the amulet's swap_body. */
  const swapBody = () => declaredAnimState(sprite).json.peek().overrides.has(smallHash('swap_body'));
  inventory.add(AMULET_ID, 1);
  const entity = inventory.getEntity(inventorySlotAddress(0))!;
  expect(inventory.EquipFromInventory(entity)).toBe(true);
  return { inventory, world, entity, stats, enter, owner, swapBody };
}

it('is a body resurrector with source uses and a hauntable that resurrects', () => {
  const { inventory, entity } = wornAmulet(150, 150);
  try {
    expect(inventory.getEntity(equipmentSlotAddress('body'))).toBe(entity);
    expect(entity.components.equippable).toMatchObject({ equipslot: 'body', is_magic_dapperness: true });
    expect(entity.hasTag('resurrector')).toBe(true);
    expect(entity.components.finiteuses.remaining ?? REDAMULET_USES).toBe(REDAMULET_USES);
    expect(entity.components.hauntable).toBeDefined();
  } finally { inventory.dispose(); }
});

it('converts hunger into health every 30 game seconds while hurt, spending one use each time', () => {
  const { inventory, world, entity, stats } = wornAmulet(100, 100);
  try {
    world.advance(REDAMULET_CONVERSION_TIME - 1);
    expect(stats.health.currenthealth).toBe(100);
    world.advance(1);
    expect(stats.health.currenthealth).toBe(100 + REDAMULET_CONVERSION);
    expect(stats.hunger.current).toBe(100 - REDAMULET_CONVERSION);
    expect(entity.components.finiteuses.remaining).toBe(REDAMULET_USES - 1);
    world.advance(REDAMULET_CONVERSION_TIME);
    expect(stats.health.currenthealth).toBe(100 + 2 * REDAMULET_CONVERSION);
    // Healthy owners and nearly empty stomachs cost nothing.
    stats.health.SetVal(150);
    world.advance(REDAMULET_CONVERSION_TIME);
    expect(entity.components.finiteuses.remaining).toBe(REDAMULET_USES - 2);
    stats.health.SetVal(100); stats.hunger.SetCurrent(5);
    world.advance(REDAMULET_CONVERSION_TIME);
    expect(stats.health.currenthealth).toBe(100);
    expect(entity.components.finiteuses.remaining).toBe(REDAMULET_USES - 2);
  } finally { inventory.dispose(); }
});

it('stops converting once unequipped, and keeps its worn art through amulet_rebirth', () => {
  const { inventory, world, entity, stats, enter, swapBody } = wornAmulet(100, 100);
  try {
    expect(swapBody()).toBe(true);
    // SGwilson amulet_rebirth onenter: ConsumeEquippedAmulet removes the worn amulet from the inventory.
    enter('amulet_rebirth');
    expect(inventory.GetEquippedItem('body')).toBeNull();
    expect(entity.isRemoved).toBe(true);
    // onunequip_red keeps swap_body; the slot is retained past equippable:Unequip closing the view.
    expect(swapBody()).toBe(true);
    world.advance(REDAMULET_CONVERSION_TIME * 2);
    expect(stats.health.currenthealth).toBe(100);
    // SGwilson amulet_rebirth onexit: the art the amulet left goes as the owner leaves the state.
    enter('idle');
    expect(swapBody()).toBe(false);
    enter('amulet_rebirth');
    expect(swapBody()).toBe(false);
    // Outside amulet_rebirth the art goes with the unequip.
    const second = wornAmulet(100, 100);
    second.inventory.Unequip('body');
    expect(second.swapBody()).toBe(false);
    second.inventory.dispose();
  } finally { inventory.dispose(); }
});

it('removes itself when the last use is spent', () => {
  const { inventory, world, entity } = wornAmulet(10, 100);
  try {
    entity.components.finiteuses.remaining = 1;
    world.advance(REDAMULET_CONVERSION_TIME);
    expect(entity.isRemoved).toBe(true);
    expect(inventory.getEntity(equipmentSlotAddress('body'))).toBeNull();
  } finally { inventory.dispose(); }
});

it('asks a haunting ghost to respawn from the amulet, then cools down on the game clock', () => {
  const { inventory, world, entity } = wornAmulet(150, 150);
  try {
    const hauntable = entity.components.hauntable!;
    // A player's ghost haunts it.
    const ghost = testPlayer({ tags: ['playerghost'] }), respawn = vi.fn();
    ghost.ListenForEvent('respawnfromghost', (_inst, data) => respawn(data));
    hauntable.DoHaunt(ghost);
    // hauntable.lua: the amulet inst itself is the resurrection source.
    expect(respawn).toHaveBeenCalledWith({ source: entity });
    expect(entity.hasTag('haunted')).toBe(true);
    world.advance(HAUNT_COOLDOWN_MEDIUM);
    expect(entity.hasTag('haunted')).toBe(false);
  } finally { inventory.dispose(); }
});
