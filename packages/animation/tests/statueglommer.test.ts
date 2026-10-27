import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { StatueGlommerManager } from '../../prefab/src/statueglommer';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const statues = new StatueGlommerManager(scene, { scheduler, tickingarea: () => createMemo(() => awake.get()) });
  return { scene, scheduler, awake, statues };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('constructs full once, then declares the Lua OnLoadWorked pose for saved work', async () => {
  const { statues, scheduler } = setup();
  try {
    const model = statues.spawn(new THREE.Vector3(2, 0, 3), {
      id: 'saved-statue', transform: { position: [2, 0, 3], rotationY: 0 },
      components: { workable: { maxwork: -1, workleft: 2 }, pickable: { picked: true, caninteractwith: true } },
    });
    const inst = prefabInstance(model)!;
    expect(inst.listTags()).toContain('statue');
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'med', loop: false });
    expect(inst.sprite.sprite.peek().queue).toEqual([]);
    expect(statues.exportRecords()[0].record).toMatchObject({ id: 'saved-statue',
      components: { workable: { maxwork: -1, workleft: 2 }, pickable: { picked: true, caninteractwith: true } } });
    expect(PREFAB_DEFINITIONS.glommerStatues.parseComponents(statues.exportRecords()[0].record.components, 'statue', {} as never))
      .toEqual(statues.exportRecords()[0].record.components);
    await model.userData.display.artLoaded();
    expect(inst.sprite.currentAnimation).toBe('med');
    const fresh = prefabInstance(statues.spawn(new THREE.Vector3(3, 0, 3)))!;
    expect(fresh.sprite.sprite.peek().clip).toMatchObject({ name: 'full', loop: false });
    const worked = prefabInstance(statues.spawn(new THREE.Vector3(4, 0, 3), {
      id: 'worked-statue', transform: { position: [4, 0, 3], rotationY: 0 }, components: { statueglommer: { worked: true } },
    }))!;
    expect(worked.sprite.sprite.peek().clip).toMatchObject({ name: 'low', loop: false });
  } finally { statues.dispose(); scheduler.dispose(); }
});

it('rebuilds the declared clip after tile sleep without changing saved work', async () => {
  const { scene, scheduler, awake, statues } = setup();
  try {
    const model = statues.spawn(new THREE.Vector3(1, 0, 4), {
      id: 'sleeping-statue', transform: { position: [1, 0, 4], rotationY: 0 },
      components: { workable: { maxwork: -1, workleft: 2 }, pickable: { picked: true } },
    });
    await model.userData.display.artLoaded();
    const inst = prefabInstance(model)!;
    awake.set(false); await settle();
    expect(inst.status.peek()).toBe('asleep');
    expect(inst.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true); await settle();
    expect(model.parent).toBe(scene);
    expect(inst.sprite.currentAnimation).toBe('med');
    expect(statues.exportRecords()[0].record.components.workable?.workleft).toBe(2);
  } finally { statues.dispose(); scheduler.dispose(); }
});
