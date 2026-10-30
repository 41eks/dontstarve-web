import { describe, expect, it } from 'vitest';
import { dwarfStarLight } from '../../prefab/src/stafflight';
import { StaffCastingLight } from '../../prefab/src/staff_castinglight';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';
import { createEmptyEntity } from '../../prefab/src/prefabInstance';

describe('yellowstaff source lighting', () => {
  it('pulses the dwarf star on its twenty-second cycle', () => {
    expect(dwarfStarLight(0)).toMatchObject({ radius: 33, intensity: 0.8, falloff: 0.8 });
    expect(dwarfStarLight(10)).toMatchObject({ radius: 36 });
    expect(dwarfStarLight(10).intensity).toBeCloseTo(0.7);
    expect(dwarfStarLight(20).radius).toBeCloseTo(33);
    expect(inventoryItemEquipmentKind('yellowstaff')).toBe('hand');
    expect(inventoryItemMaxStack('yellowstaff')).toBe(1);
  });

  it('cleans up the temporary casting light on cancellation and completion', () => {
    const owner = createEmptyEntity('wilson').instance;
    const light = new StaffCastingLight(owner);
    // Parented to the caster: the caster declares the casting light's own signal, not a copy.
    expect([...owner.light.slots.peek().values()]).toEqual([light.instance.light.json]);
    light.start();
    const radius = light.instance.light.peek()!.radius;
    light.update(1);
    expect(light.instance.light.peek()!.radius).toBeGreaterThan(radius);
    expect(owner.light.peek()).toBeUndefined();
    light.stop();
    light.update(1);
    expect(light.instance.light.peek()).toBeUndefined();
    light.start();
    light.update(3);
    expect(light.instance.light.peek()).toBeUndefined();
    light.dispose();
    expect(owner.light.slots.peek().size).toBe(0);
  });
});
