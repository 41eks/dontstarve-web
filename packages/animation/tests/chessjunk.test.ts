import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ChessJunkManager, CHESSJUNK_IDS } from '../../prefab/src/chessjunk';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { EntityRegistry } from '../../../src/entityRegistry';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const registry = new EntityRegistry();
  const piles = new ChessJunkManager(scene, { scheduler, tickingarea: () => createMemo(() => awake.get()),
    trackDisplay: display => registry.trackDisplay(display) });
  return { scene, scheduler, awake, piles, registry };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads each source style and the repaired OnLoad animation', () => {
  const { piles, scheduler } = setup();
  try {
    for (const [index, id] of CHESSJUNK_IDS.entries()) {
      const record = { id: `source-${id}`, transform: { position: [index, 0, 3] as [number, number, number], rotationY: 0 },
        components: index === 0 ? {} : { chessJunk: { repaired: true as const, repairerid: 'u', repairerchar: 'wilson' } } };
      const model = piles.spawn(id, new THREE.Vector3(...record.transform.position), record);
      const inst = prefabInstance(model)!;
      expect(inst.listTags()).toEqual(expect.arrayContaining(['chess', 'mech']));
      expect(inst.sprite.sprite.peek().clip).toMatchObject(index === 0
        ? { name: 'idle1', loop: false } : { name: `hit${index + 1}`, loop: true });
    }
    const exported = piles.exportRecords();
    expect(exported.map(entry => entry.prefabId)).toEqual(CHESSJUNK_IDS);
    for (const { record } of exported) expect(PREFAB_DEFINITIONS.chessJunk.parseComponents(record.components, 'pile', {} as never))
      .toEqual(record.components);
  } finally { piles.dispose(); scheduler.dispose(); }
});

it('restores declared clip after tile sleep', async () => {
  const { scene, piles, scheduler, awake } = setup();
  try {
    const model = piles.spawn('chessjunk2', new THREE.Vector3(2, 0, 4), {
      id: 'repaired', transform: { position: [2, 0, 4], rotationY: 0 }, components: { chessJunk: { repaired: true } },
    });
    await model.userData.display.artLoaded();
    const inst = prefabInstance(model)!;
    awake.set(false); await settle();
    expect(inst.status.peek()).toBe('asleep'); expect(inst.sprite.loaded).toBe(false); expect(model.parent).toBeNull();
    awake.set(true); await settle();
    expect(model.parent).toBe(scene); expect(inst.sprite.currentAnimation).toBe('hit2');
  } finally { piles.dispose(); scheduler.dispose(); }
});

it('advances a spawned pile through the scene display tick', async () => {
  const { piles, scheduler, registry } = setup();
  try {
    const model = piles.spawn('chessjunk1', new THREE.Vector3());
    await model.userData.display.artLoaded();
    const sprite = prefabInstance(model)!.sprite;
    sprite.playOnce('idle1');
    const clip = sprite.sprite.peek().clip;
    expect(clip.finished).toBe(false);
    for (let frame = 0; frame < 60; frame++) registry.update(.1, new THREE.Quaternion());
    expect(clip.finished).toBe(true);
  } finally { piles.dispose(); registry.dispose(); scheduler.dispose(); }
});
