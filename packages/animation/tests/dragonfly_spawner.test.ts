import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal, getWatchWorldContent } from '@dontstarve-web/signals';
import { DragonflyManager } from '../../prefab/src/dragonfly';
import { DragonflySpawnerManager, type DragonflySpawnerRecord } from '../../prefab/src/dragonfly_spawner';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { createTestWorldSources } from './worldContentFixture';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const saved: DragonflySpawnerRecord = { id: 'spawner-1', transform: { position: [0, 0, 0], rotationY: 0 },
  components: { dragonflySpawner: { childspawner: { childreninside: 1, childrenoutside: [],
    spawning: true, regening: false, queued_spawn: true, timetonextspawn: 1, timetonextregen: 0,
    emergencychildreninside: 0 } } } };

function setup(initialAwake: boolean) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(initialAwake);
  const sources = createTestWorldSources(scheduler);
  const dragonflies = new DragonflyManager(scene, { scheduler, tickingarea: () => createMemo(() => awake.get()),
    getWatchWorldContent: (key, register) => getWatchWorldContent(key, register, sources),
    trackDisplay: () => {} });
  const spawners = new DragonflySpawnerManager(scene, { scheduler, tickingarea: () => createMemo(() => awake.get()),
    spawnDragonfly: point => dragonflies.spawn(point), resolveDragonfly: id => dragonflies.getById(id),
    isPassable: () => true });
  return { scheduler, awake, dragonflies, spawners, dispose: () => { spawners.dispose(); dragonflies.dispose(); scheduler.dispose(); } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps the saved child queued while asleep and spawns it when the spawner wakes', async () => {
  const s = setup(false);
  try {
    const model = s.spawners.spawn(new THREE.Vector3(), saved);
    await settle();
    expect(prefabInstance(model)?.hasTag('CLASSIFIED')).toBe(true);
    expect(PREFAB_DEFINITIONS.dragonflySpawners.parseComponents(saved.components, 'dragonfly_spawner', { grounded: true } as never))
      .toEqual(saved.components);
    s.scheduler.advance(10);
    expect(s.dragonflies.exportRecords()).toHaveLength(0);
    s.awake.set(true); await settle();
    s.scheduler.advance(0); await settle();
    const [child] = s.dragonflies.exportRecords();
    expect(child).toBeDefined();
    expect(child.record.components.dragonfly.knownlocations?.locations.map(location => location.name).sort())
      .toEqual(['home', 'spawnpoint']);
    expect(s.spawners.exportRecords()[0].record.components.dragonflySpawner.childspawner)
      .toMatchObject({ childreninside: 0, childrenoutside: [child.record.id], queued_spawn: false });
  } finally { s.dispose(); }
});

it('relinks an outside dragonfly after load and regenerates one child after its removal', async () => {
  const first = setup(true);
  let child: ReturnType<DragonflyManager['exportRecords']>[number]['record'];
  let spawner: DragonflySpawnerRecord;
  try {
    first.spawners.spawn(new THREE.Vector3(), saved);
    await settle(); first.scheduler.advance(0); await settle();
    child = first.dragonflies.exportRecords()[0].record;
    spawner = first.spawners.exportRecords()[0].record;
  } finally { first.dispose(); }
  const restored = setup(true);
  try {
    restored.dragonflies.spawn(new THREE.Vector3(...child.transform.position), child);
    restored.spawners.spawn(new THREE.Vector3(...spawner.transform.position), spawner);
    await settle(); restored.scheduler.advance(0);
    restored.scheduler.advance(10);
    expect(restored.dragonflies.exportRecords()).toHaveLength(1);
    prefabInstance(restored.dragonflies.getById(child.id)!)!.remove();
    expect(restored.spawners.exportRecords()[0].record.components.dragonflySpawner.worldsettingstimer?.timers.regen_dragonfly)
      .toMatchObject({ timeleft: 9600 });
    restored.scheduler.advance(9600 + 10); await settle();
    expect(restored.dragonflies.exportRecords()).toHaveLength(1);
    expect(restored.dragonflies.exportRecords()[0].record.id).not.toBe(child.id);
  } finally { restored.dispose(); }
});
