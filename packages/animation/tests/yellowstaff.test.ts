import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { dwarfStarLight } from '../../prefab/src/stafflight';
import { createStaffCastingLightManager, StaffCastingLightInstance, type StaffCastingLightId } from '../../prefab/src/staff_castinglight';
import { BufferedAction } from '../../stategraphs/src/bufferedaction';
import { createWilsonPlayer, wilsonPlayerInstance, type WilsonAnimationController } from './playerVisual';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabDisplayGroup } from '../../display/src';
import * as THREE from 'three';

const FRAME = 1 / 30;

describe('yellowstaff source lighting', () => {
  it('pulses the dwarf star on its twenty-second cycle', () => {
    expect(dwarfStarLight(0)).toMatchObject({ radius: 33, intensity: 0.8, falloff: 0.8 });
    expect(dwarfStarLight(10)).toMatchObject({ radius: 36 });
    expect(dwarfStarLight(10).intensity).toBeCloseTo(0.7);
    expect(dwarfStarLight(20).radius).toBeCloseTo(33);
    expect(inventoryItemEquipmentKind('yellowstaff')).toBe('hand');
    expect(inventoryItemMaxStack('yellowstaff')).toBe(1);
  });

  const setupLights = () => {
    const scene = new THREE.Scene(), scheduler = new GameTimeScheduler();
    const displays = new PrefabDisplayGroup(scene), lights = createStaffCastingLightManager(displays, { scheduler });
    const advanceFrames = (count: number) => { for (let i = 0; i < count; i++) scheduler.advance(FRAME); };
    return { lights, displays, scheduler, advanceFrames };
  };

  it('stays at the caster\'s spawn position, grows after its delay and removes itself two frames after going dark', () => {
    const { lights, displays, advanceFrames } = setupLights();
    const light = lights.spawn('staff_castinglight', new THREE.Vector3(6, 0, 9));
    light.SetUp([1, 0, 0], 1.9, .33);
    expect(light.position.toArray()).toEqual([6, 0, 9]);
    expect(light.hasTag('FX')).toBe(true);
    expect(lights.exportRecords()).toEqual([]);
    expect(light.light.peek()).toEqual({ radius: .3 * 3, intensity: .8, falloff: .9, colour: [1, 0, 0] });
    advanceFrames(9);
    expect(light.light.peek()!.radius).toBeCloseTo(.9);
    advanceFrames(1); // .33 seconds: the first OnUpdate, _value 1 of 57.
    const k = (1 / 57) ** 5;
    expect(light.light.peek()!.radius).toBeCloseTo((.3 + 10 * k) * 3);
    advanceFrames(55); // _value 56.
    const last = (56 / 57) ** 5;
    expect(light.light.peek()).toMatchObject({ intensity: expect.closeTo(.8 - .6 * last), falloff: expect.closeTo(.9 - .4 * last) });
    advanceFrames(1); // _value 57: Light:Enable(false), then DoTaskInTime(2 * FRAMES, inst.Remove).
    expect(light.light.peek()).toBeUndefined();
    expect(light.isRemoved).toBe(false);
    advanceFrames(2);
    expect(light.isRemoved).toBe(true);
    lights.dispose(); displays.dispose();
  });

  it('spawns one light per cast at the player: an interrupted cast removes it, a committed one leaves it to finish', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
    const { lights, displays } = setupLights();
    const model = await createWilsonPlayer('/dst/data/anim'), player = wilsonPlayerInstance(model);
    const controller = player.animationController as WilsonAnimationController, graph = controller.stategraph;
    const setUp = vi.spyOn(StaffCastingLightInstance.prototype, 'SetUp');
    const spawned: StaffCastingLightInstance[] = [];
    controller.bindSpawnPrefab((prefab, position) => {
      const light = lights.spawn(prefab as StaffCastingLightId, position);
      spawned.push(light);
      return light;
    });
    player.setPosition(6, 0, 9);
    const cast = () => graph.pushBufferedAction(new BufferedAction('CASTSPELL', () => {}, undefined, {
      invobject: { prefab: 'yellowstaff', fxcolour: [1, 0, 0], hasTag: () => false },
    } as never));
    cast();
    expect(graph.stateName).toBe('castspell');
    expect(setUp).toHaveBeenLastCalledWith([1, 0, 0], 1.9, .33);
    expect(spawned[0].position.toArray()).toEqual([6, 0, 9]);
    player.setPosition(12, 0, 9);
    expect(spawned[0].position.toArray()).toEqual([6, 0, 9]);
    graph.goToState('idle');
    expect(spawned[0].isRemoved).toBe(true);

    cast();
    graph.update(53 / 30);
    graph.goToState('idle');
    expect(spawned[1].isRemoved).toBe(false);

    // SGwilson.lua amulet_rebirth: SetUp({ 150 / 255, 46 / 255, 46 / 255 }, 1.7, 1) on entering.
    graph.goToState('amulet_rebirth');
    graph.update(0);
    expect(setUp).toHaveBeenLastCalledWith([150 / 255, 46 / 255, 46 / 255], 1.7, 1);
    setUp.mockRestore();
    player.remove(); lights.dispose(); displays.dispose();
    vi.unstubAllGlobals();
  });

  it('uses the small settings, and removing it cancels its tasks', () => {
    const { lights, displays, advanceFrames } = setupLights();
    const small = lights.spawn('staff_castinglight_small', new THREE.Vector3());
    small.SetUp([1, 1, 1], .75, 0);
    advanceFrames(11); // No delay: the first OnUpdate is due at once, so _value is 12 of 23.
    const k = (12 / 23) ** 5;
    expect(small.light.peek()).toMatchObject({ radius: expect.closeTo((.3 + 4 * k) * 3), intensity: expect.closeTo(.8 - .7 * k), falloff: expect.closeTo(1.1 + .3 * k) });
    small.remove();
    const removed = small.light.peek();
    advanceFrames(5);
    expect(small.light.peek()).toBe(removed);
    lights.dispose(); displays.dispose();
  });
});
