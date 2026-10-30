import { findActionEntity } from '../../prefab/src/actionEntity';
import { prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { BeeQueenHiveManager } from '../../prefab/src/beequeenhivegrown';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const setup = () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const hives = new BeeQueenHiveManager(scene, { scheduler, tickingarea: () => createMemo(() => awake.get()) });
  return { scene, scheduler, awake, hives };
};
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('declares the Lua large_hit then nonlooping large sequence on a hammer hit and saves its work and timer', async () => {
  const { hives, scheduler } = setup();
  try {
    const model = hives.spawn(new THREE.Vector3(2, 0, 3));
    await prefabDisplay(model).artLoaded();
    const instance = prefabInstance(model)!;
    expect(instance.listTags()).toEqual(expect.arrayContaining(['event_trigger', 'antlion_sinkhole_blocker']));
    expect(instance.sprite.sprite.peek().clip).toMatchObject({ name: 'large', loop: false });
    (findActionEntity(model)?.components ?? prefabInstance(model)!.components).workable.WorkedBy({});
    expect(instance.sprite.sprite.peek().clip).toMatchObject({ name: 'large_hit', loop: false });
    expect(instance.sprite.sprite.peek().queue).toEqual([{ name: 'large', loop: false }]);
    for (let i = 0; i < 120; i++) hives.update(.1);
    expect(instance.sprite.currentAnimation).toBe('large');
    const saved = hives.exportRecords()[0].record;
    expect(saved.components.workable).toEqual({ maxwork: 16, workleft: 15 });
    expect(saved.components.beeQueenHiveTimer?.timers.hiveregen.timeleft).toBe(120);
    expect(PREFAB_DEFINITIONS.beeQueenHives.parseComponents(saved.components, 'hive', { grounded: true } as never))
      .toEqual(saved.components);
  } finally { hives.dispose(); scheduler.dispose(); }
});

it('settles the hit on tile sleep and rebuilds the declared large pose and honey appearance', async () => {
  const { scene, hives, awake, scheduler } = setup();
  try {
    const model = hives.spawn(new THREE.Vector3(1, 0, 4));
    await prefabDisplay(model).artLoaded();
    const instance = prefabInstance(model)!;
    (findActionEntity(model)?.components ?? prefabInstance(model)!.components).workable.WorkedBy({});
    awake.set(false); await settle();
    expect(instance.status.peek()).toBe('asleep');
    expect(instance.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    expect(instance.sprite.sprite.peek().clip).toMatchObject({ name: 'large', loop: false, finished: true });
    awake.set(true); await settle();
    expect(model.parent).toBe(scene);
    expect(instance.sprite.currentAnimation).toBe('large');
    expect(instance.sprite.sprite.peek().appearance.get('archive-hidden:honey3')).toMatchObject({ hidden: false });
  } finally { hives.dispose(); scheduler.dispose(); }
});
