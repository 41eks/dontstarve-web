import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { LIGHTNING_ROD_DEFINITION, LIGHTNING_ROD_ID } from '../../prefab/src/lightning_rod';
import { SendLightningStrike } from '../../prefab/src/lightning';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { getPrefabLocalLight } from '../../prefab/src/localLight';
import type { SpriteController } from '../src/sprite';
import type { WorldContext } from '../../prefab/src/worldContext';
import * as sound from '../../prefab/src/sound';
import { deserializeSave } from '../../../src/save/deserialize';
import type { SaveDocument } from '../../../src/save/types';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };

const DAY = 480;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function createPlacement() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const play = vi.spyOn(sound, 'PlaySound').mockReturnValue({ stop: vi.fn(), isPlaying: () => true, setVolume: vi.fn() });
  const scheduler = new GameTimeScheduler();
  const fx = { prepare: vi.fn(async () => undefined), spawn: vi.fn() };
  const scene = new THREE.Scene();
  const world = { scene, player: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(), renderer: { domElement: new EventTarget() }, scheduler, fx,
    secondsUntilNextDay: (now: number) => DAY - now % DAY } as unknown as WorldContext;
  const placement = new AnimatedBuildingPlacement(world, { [LIGHTNING_ROD_ID]: LIGHTNING_ROD_DEFINITION }, () => false);
  return { placement, scheduler, fx, scene, play };
}

const strikeAt = (scene: THREE.Scene, fx: object, position: THREE.Vector3) =>
  SendLightningStrike({ root: scene, fx: fx as never }, position);

it('is charged by a strike for three days: zaps on the 10–40 s task, loses a day per cycle, then goes dark', async () => {
  const { placement, scheduler, fx, scene, play } = await createPlacement();
  try {
    await placement.spawn(LIGHTNING_ROD_ID);
    const [{ model }] = placement.hammerTargets;
    scene.add(model);
    const components = model.userData.components;
    expect(components.inspectable.getstatus()).toBeUndefined();
    expect(getPrefabLocalLight(model)).toBeUndefined();

    // The strike lands 30 units away; the rod within 40 units takes it over.
    const struck = await strikeAt(scene, fx, model.position.clone().add(new THREE.Vector3(30 * 3, 0, 0)));
    expect(struck.x).toBeCloseTo(model.position.x);
    expect(fx.spawn).toHaveBeenCalledWith('lightning', expect.any(THREE.Vector3));
    expect(components.inspectable.getstatus()).toBe('CHARGED');
    expect(getPrefabLocalLight(model)).toMatchObject({ intensity: .5, falloff: 1 });
    expect((model.userData.animationController as SpriteController).currentAnimation).toBe('hit');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fx.spawn).toHaveBeenCalledWith('lightning_rod_fx', expect.any(THREE.Vector3));
    expect(play).toHaveBeenCalledWith('dontstarve/common/lightningrod', model.position);

    // The zap task fires again within 10–40 seconds.
    const zaps = () => play.mock.calls.filter(([path]) => path === 'dontstarve/common/lightningrod').length;
    const before = zaps();
    scheduler.advance(40);
    expect(zaps()).toBeGreaterThan(before);

    expect(placement.exportRecords()[0].record.components.lightningrod).toEqual({ charged: true, chargeleft: 3 });
    scheduler.advance(DAY);
    expect(placement.exportRecords()[0].record.components.lightningrod).toEqual({ charged: true, chargeleft: 2 });
    scheduler.advance(DAY);
    expect(components.battery.CanBeUsed(undefined, .5)).toEqual([true]);
    scheduler.advance(DAY);
    expect(components.inspectable.getstatus()).toBeUndefined();
    expect(getPrefabLocalLight(model)).toBeUndefined();
    expect(placement.exportRecords()[0].record.components).not.toHaveProperty('lightningrod');
    const settled = zaps();
    scheduler.advance(DAY * 3);
    expect(zaps()).toBe(settled);
  } finally { placement.dispose(); }
});

it('draws a battery charge as one decaying point, not three', async () => {
  const { placement, fx, scene } = await createPlacement();
  try {
    await placement.spawn(LIGHTNING_ROD_ID);
    const [{ model }] = placement.hammerTargets;
    scene.add(model);
    const battery = model.userData.components.battery;
    expect(battery.CanBeUsed()).toEqual([false, 'NOT_ENOUGH_CHARGE']);
    await strikeAt(scene, fx, model.position);
    expect(battery.CanBeUsed()).toEqual([true]);
    // chargeleft 3 holds one full point: 0.4 is drawn without discharging, 1 empties it.
    battery.OnUsed(undefined, .4);
    expect(model.userData.lightningrod.chargeleft).toBeCloseTo(2.6);
    expect(battery.ResolvePartialChargeMult(undefined, 2)).toBeCloseTo(.6);
    battery.OnUsed(undefined, 1);
    expect(model.userData.lightningrod.charged).toBe(false);
    expect(battery.CanBeUsed(undefined, .1)).toEqual([false, 'NOT_ENOUGH_CHARGE']);
  } finally { placement.dispose(); }
});

it('keeps its charge and skin through c_save, and re-arms its day timer from the current world time', async () => {
  const { placement, scheduler, fx, scene } = await createPlacement();
  try {
    await placement.spawn(LIGHTNING_ROD_ID);
    const reskin = await placement.reskinTargets[0].prepareNextSkin();
    expect(reskin.apply()).toBe(true);
    reskin.dispose();
    const [{ model }] = placement.hammerTargets;
    scene.add(model);
    await strikeAt(scene, fx, model.position);
    scheduler.advance(DAY);
    const saved = placement.exportRecords()[0].record;
    expect(saved.components.building).toMatchObject({ skinId: 'lightning_rod_adventure' });
    expect(saved.components.lightningrod).toEqual({ charged: true, chargeleft: 2 });

    const save = structuredClone(initialWorld) as unknown as SaveDocument;
    save.world.entities = { lightning_rod: [{ ...structuredClone(saved), transform: { ...saved.transform, position: [...saved.transform.position] } }] };
    save.players.local.inventory.containers = { 'player:inventory': { slotCount: 15, slots: [] }, 'player:equipment': { slotCount: 3, slots: [] } };
    save.players.local.inventory.bufferedBuilds = [];
    const record = deserializeSave(JSON.stringify(save), { items: {}, skins: {}, recipes: {}, recipeSkins: {},
      buildings: definitions.animatedBuildings, walls: Object.keys(definitions.walls) }).world.entities.lightning_rod[0];
    const restored = await placement.spawnFromSave(LIGHTNING_ROD_ID, record);
    expect(restored.userData.instance?.skinId).toBe('lightning_rod_adventure');
    expect(restored.userData.lightningrod.chargeleft).toBe(2);
    expect(getPrefabLocalLight(restored)).toBeDefined();
    scheduler.advance(DAY);
    expect(restored.userData.lightningrod.chargeleft).toBe(1);
  } finally { placement.dispose(); }
});
