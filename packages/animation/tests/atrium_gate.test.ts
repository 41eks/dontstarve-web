import { prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { AtriumGateManager } from '../../prefab/src/atrium_gate';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { EntityRegistry } from '../../../src/entityRegistry';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const registry = new EntityRegistry();
  const gates = new AtriumGateManager(scene, { scheduler, tickingarea: () => createMemo(() => awake.get()),
    trackDisplay: display => registry.trackDisplay(display) });
  return { scene, scheduler, awake, gates };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('restores the source save as nonlooping idle after constructor and keeps its component fields', async () => {
  const { gates, scheduler } = setup();
  try {
    const model = gates.spawn(new THREE.Vector3(5, 0, 7), {
      id: 'atrium-source', transform: { position: [5, 0, 7], rotationY: 0 }, components: { pickable: { picked: true } },
    });
    const instance = prefabInstance(model)!;
    expect(instance.listTags()).toEqual(expect.arrayContaining(['gemsocket', 'stargate', 'give_dolongaction']));
    expect(instance.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: false });
    expect(instance.sprite.sprite.peek().queue).toEqual([]);
    // An unrepaired gate draws only SetBuild("atrium_gate"), never pieces of the repaired build.
    expect(instance.sprite.sprite.peek().appearance.get('archive-build')).toMatchObject({ archive: 'atrium_gate.zip' });
    const floor = model.children.find(child => prefabInstance(child)?.prefab === 'atrium_gate_floor')!;
    expect(prefabInstance(floor)!.listTags()).toEqual(['DECOR', 'NOCLICK']);
    expect(model.children.filter(child => prefabInstance(child)?.prefab === 'atrium_gate_terraform_blocker')).toHaveLength(24);
    expect(gates.exportRecords()[0].record).toMatchObject({ id: 'atrium-source', components: { pickable: { picked: true } } });
    expect(PREFAB_DEFINITIONS.atriumGates.parseComponents(gates.exportRecords()[0].record.components, 'atrium', {} as never))
      .toEqual(gates.exportRecords()[0].record.components);
    await prefabDisplay(model).artLoaded();
    expect(instance.sprite.currentAnimation).toBe('idle');
    const cooldown = gates.spawn(new THREE.Vector3(8, 0, 7), {
      id: 'atrium-cooldown', transform: { position: [8, 0, 7], rotationY: 0 },
      components: { charliecutscene: { gatefixed: true }, worldsettingstimer: {
        timers: { cooldown: { timeleft: .5, paused: false } },
      } },
    });
    const restored = prefabInstance(cooldown)!;
    expect(restored.sprite.sprite.peek().clip).toMatchObject({ name: 'cooldown', loop: true });
    expect(restored.sprite.sprite.peek().appearance.get('archive-build')).toMatchObject({ archive: 'atrium_gate_build.zip' });
    const destabilizing = gates.spawn(new THREE.Vector3(11, 0, 7), {
      id: 'atrium-destabilizing', transform: { position: [11, 0, 7], rotationY: 0 },
      components: { worldsettingstimer: { timers: { destabilizing: { timeleft: .5, paused: false } } } },
    });
    const overloading = prefabInstance(destabilizing)!;
    // The unloaded pre transition settles per ResidentSprite's contract; the queued loop is the restored clip.
    expect(overloading.sprite.sprite.peek().clip).toMatchObject({ name: 'overload_loop', loop: true });
    expect(overloading.sprite.sprite.peek().queue).toEqual([]);
    // AnimState:Hide("KEY") hides the vault key's KEY layer; the socketed atrium key (KEY symbol) stays drawn.
    expect(overloading.sprite.sprite.peek().appearance.get('layer:KEY')).toEqual({ kind: 'layer', layer: 'KEY', hidden: true });
    expect(overloading.sprite.sprite.peek().appearance.has('archive-hidden:KEY')).toBe(false);
    const fx = destabilizing.children.find(child => prefabInstance(child)?.prefab === 'atrium_gate_activatedfx')!;
    expect(prefabInstance(fx)!.listTags()).toEqual(['DECOR', 'NOCLICK']);
  } finally { gates.dispose(); scheduler.dispose(); }
});

it('rebuilds the declared idle clip and child floor after tile sleep', async () => {
  const { scene, gates, scheduler, awake } = setup();
  try {
    const model = gates.spawn(new THREE.Vector3(1, 0, 4), {
      id: 'atrium-sleep', transform: { position: [1, 0, 4], rotationY: 0 }, components: { pickable: { picked: true } },
    });
    await prefabDisplay(model).artLoaded();
    const instance = prefabInstance(model)!;
    const floor = model.children.find(child => prefabInstance(child)?.prefab === 'atrium_gate_floor')!;
    await prefabDisplay(floor).artLoaded();
    awake.set(false); await settle();
    expect(instance.status.peek()).toBe('asleep');
    expect(instance.sprite.loaded).toBe(false);
    expect(prefabInstance(floor)!.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true); await settle();
    expect(model.parent).toBe(scene);
    expect(instance.sprite.currentAnimation).toBe('idle');
    expect(prefabInstance(floor)!.sprite.currentAnimation).toBe('idle_active');
    await prefabDisplay(floor).artLoaded();
    // LAYER_BACKGROUND: its own mesh draws after every turf layer (< -0.6), outside the depth-writing instance batch.
    const meshes = floor.getObjectsByProperty('isMesh', true) as THREE.Mesh[];
    expect(meshes.filter(mesh => mesh.visible).map(mesh => mesh.renderOrder)).toEqual([-.56]);
    for (let node = meshes[0].parent; node && node !== floor; node = node.parent) expect(node.renderOrder).toBe(0);
    expect(gates.exportRecords()[0].record.components.pickable).toEqual({ picked: true });
  } finally { gates.dispose(); scheduler.dispose(); }
});
