import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { dwarfStarLight } from '../../prefab/src/stafflight';
import { StaffCastingLight } from '../../prefab/src/yellowstaff';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';
import { prefabInstance } from '../../prefab/src/prefabInstance';

/** The inst.Light an entity's model declares. */
const declaredLight = (model: THREE.Object3D) => prefabInstance(model)?.light.peek();

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
    const owner = new THREE.Group();
    const light = new StaffCastingLight(owner);
    light.start();
    const radius = declaredLight(light.model)!.radius;
    light.update(1);
    expect(declaredLight(light.model)!.radius).toBeGreaterThan(radius);
    expect(declaredLight(owner)).toBeUndefined();
    light.stop();
    light.update(1);
    expect(declaredLight(light.model)).toBeUndefined();
    light.start();
    light.update(3);
    expect(declaredLight(light.model)).toBeUndefined();
  });
});
