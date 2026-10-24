import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { dwarfStarLight } from '../../prefab/src/stafflight';
import { StaffCastingLight } from '../../prefab/src/yellowstaff';
import { getPrefabLocalLight } from '../../prefab/src/localLight';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';

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
    const radius = getPrefabLocalLight(light.model)!.radius;
    light.update(1);
    expect(getPrefabLocalLight(light.model)!.radius).toBeGreaterThan(radius);
    expect(getPrefabLocalLight(owner)).toBeUndefined();
    light.stop();
    light.update(1);
    expect(getPrefabLocalLight(light.model)).toBeUndefined();
    light.start();
    light.update(3);
    expect(getPrefabLocalLight(light.model)).toBeUndefined();
  });
});
