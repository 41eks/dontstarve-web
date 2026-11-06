import { RuinsRelicInstance } from '../../prefab/src/ruinsrelic';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { afterEach, expect, it, vi } from 'vitest';
import { Quaternion, Scene, Vector3 } from 'three';
import { prefabDisplay } from '../../display/src/prefabDisplay';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import type { PrefabWorldContext } from '../../prefab/src/worldContext';
import { IceBoxInstance } from '../../prefab/src/icebox';
import { MushroomLightInstance } from '../../prefab/src/mushroom_light';
import { createTestWorldFx } from './worldFxFixture';
import { readFile } from 'node:fs/promises';
import * as sound from '../../prefab/src/sound';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('runs a prefab’s work callbacks without loaded art and leaves component state on the same instance', () => {
  const dropLoot = vi.fn(), collapse = vi.fn();
  const inst = new IceBoxInstance({ dropLoot, fx: { spawn: vi.fn(), collapse } } as unknown as PrefabWorldContext);
  inst.setPosition(3, 0, -7);
  inst.entityId = 'saved-icebox';
  inst.skinId = 'icebox_crystal';
  const container = inst.components.container!;
  vi.spyOn(container, 'DropEverything'); vi.spyOn(container, 'Close');
  const work = inst.components.workable!;
  try {
    expect(inst.sprite.loaded).toBe(false);
    expect(work.WorkedBy({})).toBe(true);
    expect(inst.sprite.sprite.peek()).toMatchObject({ clip: { name: 'hit', loop: false }, queue: [{ name: 'closed', loop: false }] });
    expect(container.DropEverything).toHaveBeenCalledExactlyOnceWith(inst.position);
    expect(container.Close).toHaveBeenCalledOnce();
    expect(inst.entityId).toBe('saved-icebox');
    expect(inst.skinId).toBe('icebox_crystal');
    expect(inst.components.container).toBe(container);
    expect(dropLoot).not.toHaveBeenCalled();
    expect(inst.isRemoved).toBe(false);

    expect(work.WorkedBy({})).toBe(true);
    expect(collapse).toHaveBeenCalledExactlyOnceWith('small', inst.position, 'metal');
    const dropped = dropLoot.mock.calls.flatMap(([items]) => items.flatMap(({ itemId, count }: { itemId: string; count: number }) => Array(count).fill(itemId)));
    expect(dropped.sort()).toEqual(['cutstone', 'gears', 'goldnugget']);
    expect(inst.isRemoved).toBe(true);
    expect(work.WorkedBy({})).toBe(false);
  } finally { work.dispose(); inst.remove(); }
});

it('checks the lamp’s declared light and skips the final hit before running its finish callback', () => {
  const collapse = vi.fn();
  const inst = new MushroomLightInstance('mushroom_light', { fx: { spawn: vi.fn(), collapse } } as unknown as PrefabWorldContext);
  const container = inst.components.container!;
  vi.spyOn(container, 'DropEverything');
  const work = inst.components.workable!;
  try {
    // Animation names do not determine whether the lamp is on.
    inst.sprite.start('idle_on');
    work.WorkedBy({});
    expect(inst.sprite.currentAnimation).toBe('hit');
    inst.light.set({ radius: 2, intensity: .5, falloff: .8, colour: [1, 1, 1] });
    inst.sprite.start('idle');
    work.WorkedBy({});
    expect(inst.sprite.currentAnimation).toBe('hit_on');
    const hit = vi.spyOn(inst.sprite, 'playOnce');
    vi.mocked(container.DropEverything).mockClear();
    work.WorkedBy({});
    expect(hit).not.toHaveBeenCalled();
    expect(container.DropEverything).toHaveBeenCalledOnce();
    expect(collapse).toHaveBeenCalledOnce();
    expect(inst.isRemoved).toBe(true);
  } finally { work.dispose(); inst.remove(); }
});

it('lets collapse effects finish independently and reuses their art after a previous effect is removed', async () => {
  const fetch = vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(sound, 'PlaySound').mockReturnValue({ stop: vi.fn(), isPlaying: () => false, setVolume: vi.fn() });
  const scene = new Scene(), fx = createTestWorldFx(scene), position = new Vector3(2, 0, -4), rotation = new Quaternion();
  try {
    fx.collapse('small', position, 'wood');
    const first = prefabInstance(fx.renderEntities[0].object)!;
    expect([...first.listTags()].sort()).toEqual(['FX', 'NOCLICK']);
    expect(first.persists).toBe(false);
    expect(first.position).not.toBe(position);
    expect(first.position.equals(position)).toBe(true);
    await prefabDisplay(fx.renderEntities[0].object)!.artLoaded();
    expect(first.sprite.loaded).toBe(true);
    for (let i = 0; i < 90; i++) fx.update(1 / 30, rotation);
    expect(first.isRemoved).toBe(true);
    expect(fx.renderEntities).toEqual([]);
    expect(scene.children).toEqual([]);

    fx.collapse('big', position, 'stone');
    const second = prefabInstance(fx.renderEntities[0].object)!;
    await prefabDisplay(fx.renderEntities[0].object)!.artLoaded();
    expect(second.sprite.loaded).toBe(true);
    expect(second.sprite.currentAnimation).toBe('collapse_large');
    expect(fetch).toHaveBeenCalledOnce();
    fx.dispose();
    expect(second.isRemoved).toBe(true);
    expect(scene.children).toEqual([]);
  } finally { fx.dispose(); }
});

it('hammers a replica decor through its real instance, declaring material FX before component salvage and removal', () => {
  const scheduler = new GameTimeScheduler(), calls: string[] = [];
  const collapse = vi.fn(() => { calls.push('collapse'); });
  const dropLoot = vi.fn(() => { calls.push('loot'); });
  const inst = new RuinsRelicInstance('ruinsrelic_plate', { scheduler, fx: { spawn: vi.fn(), collapse }, dropLoot },
    new Vector3(4, 0, -3));
  inst.onRemove(() => { calls.push('remove'); });
  const worked = vi.fn(); inst.ListenForEvent('worked', worked);
  const worker = {};
  try {
    expect(inst.sprite.loaded).toBe(false);
    expect(inst.components.workable!.WorkedBy(worker)).toBe(true);
    expect(worked).toHaveBeenCalledWith({ worker, workleft: 0 });
    expect(collapse).toHaveBeenCalledExactlyOnceWith('small', inst.position, 'pot');
    expect(dropLoot).toHaveBeenCalled();
    expect(calls[0]).toBe('collapse'); expect(calls.at(-1)).toBe('remove');
    expect(inst.isRemoved).toBe(true);
    expect(inst.components.workable!.WorkedBy(worker)).toBe(false);
  } finally { inst.remove(); scheduler.dispose(); }
});
