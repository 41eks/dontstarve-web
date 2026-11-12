import { afterEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { inventorySlotAddress } from '@dontstarve-web/inventory';
import {
  ARMORSNURTLESHELL, ARMORSNURTLESHELL_ABSORPTION, FULL_ABSORPTION,

} from '../../prefab/src/armorsnurtleshell';
import { SpriteState } from '@dontstarve-web/display';
import { PrefabInstance } from '../../prefab/src/prefabInstance';
import { addComponent } from '../../prefab/src/components';
import { createPerishWorld } from './perishWorldFixture';
import { testEnts } from './entsFixture';
import { createPickupInventory } from './pickupFixture';
import { testPlayer } from './testPlayer';
import { wilsonStateInst } from './wilsonStateInst';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';

let ents = testEnts();
afterEach(() => { ents.dispose(); ents = testEnts(); });

function wornShell() {
  const world = createPerishWorld(), inventory = createPickupInventory();
  inventory.entities.bindPerishWorld(world);
  // The wearer is a player inst: its inventory wears the shell and its stategraph hides in it, pushing newstate on it.
  const owner = testPlayer({ inventory });
  const graph = owner.SetStateGraph(() => new WilsonStateGraph(wilsonStateInst({
    PushEvent: (name: string, data?: unknown) => owner.PushEvent(name, data) })));
  const goToState = vi.spyOn(graph, 'goToState');
  const playSound = vi.spyOn(owner.AddSoundEmitter(), 'PlaySound').mockImplementation(() => {});
  inventory.add('armorsnurtleshell', 1);
  const entity = inventory.getEntity(inventorySlotAddress(0))!;
  ents.track(entity);
  expect(inventory.EquipFromInventory(entity)).toBe(true);
  // inventory:Unequip calls equippable:Unequip(owner).
  const lifecycle = { onunequip: () => inventory.Unequip('body') };
  return { world, entity, owner, lifecycle, playSound, states: () => goToState.mock.calls.map(([name]) => name),
    leaveShell: () => graph.goToState('idle') };
}

class TargetingCombat {
  target: object | undefined;
  readonly DropTarget = vi.fn(() => { this.target = undefined; });
  constructor(_inst: unknown, target: object) { this.target = target; }
}
class Attacker extends PrefabInstance<SpriteState, { combat?: TargetingCombat }> {}
function attacker(target: object, position = new Vector3(3, 0, 0)) {
  const inst = ents.track(new Attacker('attacker', new SpriteState({ name: '' })));
  inst.setPosition(position.x, position.y, position.z);
  return addComponent(inst, 'combat', TargetingCombat, target);
}

describe('armorsnurtleshell', () => {
  it('uses the source armor values and only tags itself as a shell', () => {
    const { entity } = wornShell();
    expect(entity.hasTag('shell')).toBe(true);
    expect(entity.hasTag('hardarmor')).toBe(true);
    expect(entity.components.armor!.maxcondition).toBe(ARMORSNURTLESHELL);
    expect(entity.components.armor!.GetAbsorption()).toBe(ARMORSNURTLESHELL_ABSORPTION);
    expect(entity.components.equippable!.equipslot).toBe('body');
    expect(entity.components.useableitem!.CanInteract()).toBe(true); // replica.equippable:IsEquipped()
    entity.components.equippable!.Unequip(wornShell().owner);
    expect(entity.components.useableitem!.CanInteract()).toBe(false);
  });

  it('hides on use, absorbs everything while in the shell, and relaxes when the state ends', () => {
    const { entity, states, leaveShell } = wornShell();
    const useable = entity.components.useableitem!, armor = entity.components.armor!;
    expect(useable.StartUsingItem()).toBe(true);
    expect(states()).toEqual(['shell_enter']);
    expect(armor.GetAbsorption()).toBe(FULL_ABSORPTION);
    expect(entity.hasTag('inuse')).toBe(true);
    leaveShell();
    expect(armor.GetAbsorption()).toBe(ARMORSNURTLESHELL_ABSORPTION);
    expect(entity.hasTag('inuse')).toBe(false);
  });

  it('drops the targets on a hiding owner five seconds after use, unless the use stops first', () => {
    const { world, entity, owner, leaveShell } = wornShell();
    const useable = entity.components.useableitem!;
    const near = attacker(owner), far = attacker(owner, new Vector3(25, 0, 0)), other = attacker({});
    useable.StartUsingItem();
    world.advance(4.9);
    expect(near.DropTarget).not.toHaveBeenCalled();
    world.advance(.1);
    expect(near.DropTarget).toHaveBeenCalledOnce();
    expect(far.DropTarget).not.toHaveBeenCalled();
    expect(other.DropTarget).not.toHaveBeenCalled();
    // Leaving the shell stops using the item, which cancels the pending task.
    const again = attacker(owner);
    leaveShell();
    useable.StartUsingItem();
    leaveShell();
    world.advance(5);
    expect(again.DropTarget).not.toHaveBeenCalled();
  });

  it('plays the armor impact through the owner when blocked and releases the owner on unequip', () => {
    const { world, entity, owner, playSound, lifecycle } = wornShell();
    owner.PushEvent('blocked');
    expect(playSound).toHaveBeenCalledWith('dontstarve/wilson/hit_armour');
    const target = attacker(owner);
    entity.components.useableitem!.StartUsingItem();
    lifecycle.onunequip();
    playSound.mockClear(); owner.PushEvent('blocked');
    expect(playSound).not.toHaveBeenCalled();
    world.advance(5);
    expect(target.DropTarget).not.toHaveBeenCalled(); // onunequip runs onstopuse
    expect(entity.components.useableitem!.StartUsingItem()).toBe(true); // no owner: nothing hides
  });

  it('wears down by damage, saves only a damaged condition and removes itself when worn out', () => {
    const { entity } = wornShell();
    const armor = entity.components.armor!;
    armor.TakeDamage(ARMORSNURTLESHELL / 2);
    expect(armor.GetPercent()).toBeCloseTo(.5);
    expect(armor.OnSave()).toEqual({ condition: ARMORSNURTLESHELL / 2 });
    armor.TakeDamage(ARMORSNURTLESHELL);
    expect(entity.isRemoved).toBe(true);
  });
});
