import { afterEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { ItemEntityRegistry } from '@dontstarve-web/inventory';
import {
  ARMORSNURTLESHELL, ARMORSNURTLESHELL_ABSORPTION, FULL_ABSORPTION,
  configureArmorSnurtleshellEntity,
} from '../../prefab/src/armorsnurtleshell';
import { activePrefabs, type FoundEntity } from '../../prefab/src/activePrefabs';
import { createPerishWorld } from './perishWorldFixture';

afterEach(() => { activePrefabs.length = 0; });

function wornShell() {
  const world = createPerishWorld();
  const entity = new ItemEntityRegistry().create({ itemId: 'armorsnurtleshell', count: 1 });
  entity.BindPerishWorld(world);
  entity.configure({ equippable: 'body', configureEntity: configureArmorSnurtleshellEntity });
  const listeners = new Map<string, (data: unknown) => void>();
  const states: string[] = [];
  let shell = false;
  const owner = {
    ListenForEvent: (name: string, listener: (data: unknown) => void) => { listeners.set(name, listener); return () => listeners.delete(name); },
    PushEvent: vi.fn(),
    getPosition: () => new Vector3(),
    SoundEmitter: { PlaySound: vi.fn() },
    components: { inventory: { GetEquippedItem: (kind: string) => kind === 'body' ? entity : null } },
    HasStateTag: (tag: string) => shell && tag === 'shell',
    GoToState: (name: string) => { states.push(name); shell = true; listeners.get('newstate')?.({ statename: name }); },
  };
  // inventory:Equip calls equippable:Equip(owner); Unequip mirrors it.
  const lifecycle = { onunequip: () => entity.components.equippable!.Unequip(owner) };
  entity.components.equippable!.Equip(owner);
  return { world, entity, owner, lifecycle, listeners, states, leaveShell: () => { shell = false; listeners.get('newstate')?.({ statename: 'idle' }); } };
}

/** A combat entity at `position` (FindEntities range is 20) that targets `target`. */
function attacker(target: object, position = new Vector3(3, 0, 0)) {
  const combat = { target: target as object | undefined, DropTarget: vi.fn(() => { combat.target = undefined; }) };
  activePrefabs.push({ isRemoved: false, hasTag: () => false, getPosition: () => position, components: { combat } } as unknown as FoundEntity);
  return combat;
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
    expect(states).toEqual(['shell_enter']);
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
    const { world, entity, owner, listeners, lifecycle } = wornShell();
    listeners.get('blocked')!(undefined);
    expect(owner.SoundEmitter.PlaySound).toHaveBeenCalledWith('dontstarve/wilson/hit_armour');
    const target = attacker(owner);
    entity.components.useableitem!.StartUsingItem();
    lifecycle.onunequip();
    expect(listeners.size).toBe(0);
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
