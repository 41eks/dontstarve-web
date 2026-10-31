import { prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { AtriumStatueManager, ATRIUM_STATUE_ID, type AtriumStatueRecord } from '../../prefab/src/atrium_statue';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { EntityRegistry } from '../../../src/entityRegistry';

// An imported Caves record: the source statue has no id or data, so the importer derives the ID from its index.
const RECORD: AtriumStatueRecord = {
  id: 'dst_04E26ADB66396E8D_atrium_statue_index_000001', transform: { position: [696, 0, 1605], rotationY: 0 }, components: {},
};

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
  const scene = new THREE.Scene(), awake = createSignal(true), physics = new CANNON.World();
  const registry = new EntityRegistry();
  const statues = new AtriumStatueManager(scene, { physics, tickingarea: () => createMemo(() => awake.get()),
    trackDisplay: display => registry.trackDisplay(display) });
  return { scene, awake, physics, statues, registry };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads a saved statue with the source construction, no tags, and the looping calm idle_full, and saves it unchanged', async () => {
  const { statues, physics, registry } = setup();
  try {
    const model = statues.spawn(new THREE.Vector3(...RECORD.transform.position), RECORD);
    const inst = prefabInstance(model)!;
    // fn plays idle_full once; OnNightmarePhaseChanged(..., true) then plays idle_full looping for a non-wild phase.
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_full', loop: true });
    expect(inst.sprite.sprite.peek().queue).toEqual([]);
    await prefabDisplay(model)!.artLoaded();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/atrium_statue.zip'));
    expect(inst.sprite.currentAnimation).toBe('idle_full');
    // MakeStatue adds no tags; `tickingarea` is this project's activity tag, added by actionEntity().
    expect(inst.listTags()).toEqual(['tickingarea']);
    // The workable and lootdropper are commented out in the source: only inspectable and roseinspectable remain.
    expect(Object.keys(inst.components).sort()).toEqual(['inspectable', 'roseinspectable']);
    expect(inst.minimap.icon).toBe('atrium_statue.png');
    expect(physics.bodies).toHaveLength(1);
    const exported = statues.exportRecords();
    expect(exported).toEqual([{ prefabId: ATRIUM_STATUE_ID, record: RECORD }]);
    expect(PREFAB_DEFINITIONS.atriumStatues.parseComponents(exported[0].record.components, 'statue', {} as never)).toEqual({});
  } finally { statues.dispose(); registry.dispose(); }
});

it('releases the statue art while its tile sleeps and redraws the declared idle_full when it wakes', async () => {
  const { scene, awake, statues, registry } = setup();
  try {
    const model = statues.spawn(new THREE.Vector3(...RECORD.transform.position), RECORD);
    const inst = prefabInstance(model)!;
    await prefabDisplay(model)!.artLoaded();
    const declared = inst.sprite.sprite.peek().clip;
    awake.set(false); await settle();
    expect(inst.status.peek()).toBe('asleep'); expect(inst.sprite.loaded).toBe(false); expect(model.parent).toBeNull();
    awake.set(true); await settle(); await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(scene);
    expect(inst.sprite.sprite.peek().clip).toEqual(declared);
    expect(inst.sprite.currentAnimation).toBe('idle_full');
    expect(statues.exportRecords()[0].record).toEqual(RECORD);
  } finally { statues.dispose(); registry.dispose(); }
});
