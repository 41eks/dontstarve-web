import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { RuinsStatueMageManager } from '../../prefab/src/ruins_statue_mage';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { EntityRegistry } from '../../../src/entityRegistry';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const registry = new EntityRegistry();
  const statues = new RuinsStatueMageManager(scene, { scheduler, tickingarea: () => createMemo(() => awake.get()),
    trackDisplay: display => registry.trackDisplay(display) });
  return { scene, scheduler, awake, statues };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads gem and declares the source calm-phase idle_full loop', async () => {
  const { statues, scheduler } = setup();
  try {
    const model = statues.spawn(new THREE.Vector3(2, 0, 3), {
      id: 'mage-source', transform: { position: [2, 0, 3], rotationY: 0 }, components: { ruinsStatueMage: { gem: 'orangegem' } },
    });
    const inst = prefabInstance(model)!;
    expect(inst.listTags()).toEqual(expect.arrayContaining(['cavedweller', 'structure', 'statue']));
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_full', loop: true });
    expect(inst.sprite.sprite.peek().appearance.get('archive-symbol:swap_gem')).toMatchObject({ archive: 'statue_ruins_gem.zip', sourceSymbol: 'orangegem' });
    expect(statues.exportRecords()[0].record.components.ruinsStatueMage).toEqual({ gem: 'orangegem' });
    expect(PREFAB_DEFINITIONS.ruinsStatueMages.parseComponents(statues.exportRecords()[0].record.components, 'mage', {} as never))
      .toEqual(statues.exportRecords()[0].record.components);
    await model.userData.display.artLoaded();
    expect(inst.sprite.currentAnimation).toBe('idle_full');
  } finally { statues.dispose(); scheduler.dispose(); }
});

it('restores the declared clip and gem after tile sleep', async () => {
  const { scene, statues, scheduler, awake } = setup();
  try {
    const model = statues.spawn(new THREE.Vector3(1, 0, 4), {
      id: 'mage-sleep', transform: { position: [1, 0, 4], rotationY: 0 }, components: { ruinsStatueMage: { gem: 'purplegem' } },
    });
    await model.userData.display.artLoaded();
    const inst = prefabInstance(model)!;
    awake.set(false); await settle();
    expect(inst.status.peek()).toBe('asleep'); expect(inst.sprite.loaded).toBe(false); expect(model.parent).toBeNull();
    awake.set(true); await settle();
    expect(model.parent).toBe(scene);
    expect(inst.sprite.currentAnimation).toBe('idle_full');
    expect(inst.sprite.sprite.peek().appearance.get('archive-symbol:swap_gem')).toMatchObject({ sourceSymbol: 'purplegem' });
  } finally { statues.dispose(); scheduler.dispose(); }
});
