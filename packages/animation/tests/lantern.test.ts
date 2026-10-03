import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LanternLightController } from '../../prefab/src/lantern';
import { getPrefabLocalLight } from '../../prefab/src/localLight';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';

describe('lantern light lifecycle', () => {
  it('uses source fuel-dependent lighting and clears the owner when extinguished', () => {
    const owner = new THREE.Group();
    const light = new LanternLightController(owner);
    expect(getPrefabLocalLight(owner)).toBeUndefined();
    light.setLit(true);
    expect(getPrefabLocalLight(owner)).toMatchObject({ radius: 15, intensity: 0.6, falloff: 0.9 });
    light.setFuelPercent(0.5);
    expect(getPrefabLocalLight(owner)).toMatchObject({ radius: 12, intensity: 0.5 });
    light.setFuelPercent(0);
    expect(light.isLit).toBe(false);
    expect(getPrefabLocalLight(owner)).toBeUndefined();
    light.setLit(false);
    light.setFuelPercent(1);
    expect(getPrefabLocalLight(owner)).toBeUndefined();
    light.setLit(true);
    light.dispose();
    expect(getPrefabLocalLight(owner)).toBeUndefined();
    expect(inventoryItemEquipmentKind('lantern')).toBe('hand');
    expect(inventoryItemMaxStack('lantern')).toBe(1);
  });

  it('rejects invalid fuel without losing an existing light', () => {
    const light = new LanternLightController(new THREE.Group());
    light.setLit(true);
    expect(() => light.setFuelPercent(NaN)).toThrow(RangeError);
    expect(light.isLit).toBe(true);
  });
});
