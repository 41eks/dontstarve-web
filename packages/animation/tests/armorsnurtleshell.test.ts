import { describe, expect, it, vi } from 'vitest';
import { ItemEntityRegistry } from '@dontstarve-web/inventory';
import {
  ARMORSNURTLESHELL, ARMORSNURTLESHELL_ABSORPTION, FULL_ABSORPTION,
  configureArmorSnurtleshellEntity, createArmorSnurtleshellLifecycle,
} from '../../prefab/src/armorsnurtleshell';
import { PlaySound } from '../../prefab/src/sound';

vi.mock('../../prefab/src/sound', () => ({ PlaySound: vi.fn(() => ({})) }));

function wornShell() {
  const entity = new ItemEntityRegistry().create({ itemId: 'armorsnurtleshell', count: 1 });
  entity.configure({ equippable: 'body', configureEntity: configureArmorSnurtleshellEntity });
  const listeners = new Map<string, (data: unknown) => void>();
  const states: string[] = [];
  let shell = false;
  const owner = {
    ListenForEvent: (name: string, listener: (data: unknown) => void) => { listeners.set(name, listener); return () => listeners.delete(name); },
    PushEvent: vi.fn(),
    HasStateTag: (tag: string) => shell && tag === 'shell',
    GoToState: (name: string) => { states.push(name); shell = true; listeners.get('newstate')?.({ statename: name }); },
  };
  const lifecycle = createArmorSnurtleshellLifecycle(entity);
  lifecycle.onequip(owner);
  return { entity, owner, lifecycle, listeners, states, leaveShell: () => { shell = false; listeners.get('newstate')?.({ statename: 'idle' }); } };
}

describe('armorsnurtleshell', () => {
  it('uses the source armor values and only tags itself as a shell', () => {
    const { entity } = wornShell();
    expect(entity.hasTag('shell')).toBe(true);
    expect(entity.hasTag('hardarmor')).toBe(true);
    expect(entity.components.armor!.maxcondition).toBe(ARMORSNURTLESHELL);
    expect(entity.components.armor!.GetAbsorption()).toBe(ARMORSNURTLESHELL_ABSORPTION);
    expect(entity.components.equippable!.equipslot).toBe('body');
    expect(entity.components.useableitem!.CanInteract()).toBe(false); // not in the equipment slot
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

  it('plays the armor impact when blocked and releases the owner on unequip', () => {
    const { entity, listeners, lifecycle } = wornShell();
    listeners.get('blocked')!(undefined);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/hit_armour');
    lifecycle.onunequip();
    expect(listeners.size).toBe(0);
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
