import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { EntityRegistry, type EntityRegistration } from '../../../src/entityRegistry';
import type { SavedEntity } from '../../../src/save/types';

const record = (id: string): SavedEntity => ({
  id, transform: { position: [3, 0, 4], rotationY: 0 },
  components: { health: { current: 50, maximum: 100 } },
});
function registration(): EntityRegistration<string> {
  return { prefabIds: ['thing'], restore: vi.fn(() => new THREE.Group()),
    debugSpawn: { prefabIds: ['thing', 'thing_item'], create: vi.fn(async () => {}) },
    exportRecords: vi.fn(() => [{ prefabId: 'thing', record: record('e_one') }]), dispose: vi.fn() };
}

describe('entity registry', () => {
  it('routes saved entities and debug aliases independently through one registration', async () => {
    const registry = new EntityRegistry(), family = registration();
    registry.register(family);
    expect(await registry.spawn('thing_item')).toBe(true);
    expect(family.debugSpawn!.create).toHaveBeenCalledWith('thing_item');
    expect(await registry.spawn('unknown')).toBe(false);
    await registry.restoreAll({ thing: [record('e_saved')] });
    expect(family.restore).toHaveBeenCalledWith('thing', record('e_saved'));
    expect(registry.byEntityId.get('e_saved')).toBeInstanceOf(THREE.Group);
    expect(registry.exportRecords()).toEqual({ thing: [record('e_one')] });
  });

  it.each([{ thing: [record('same')], other: [record('same')] }])('validates the entire save before restoring any models: %j', async (entities) => {
    const registry = new EntityRegistry(), family = registration();
    registry.register(family);
    registry.register({ ...registration(), prefabIds: ['other'], debugSpawn: undefined });
    await expect(registry.restoreAll(entities)).rejects.toThrow();
    expect(family.restore).not.toHaveBeenCalled();
    expect(registry.byEntityId.size).toBe(0);
  });

  it('exports detached transform and component snapshots, including empty families', () => {
    const registry = new EntityRegistry(), saved = record('e_one');
    registry.register({ ...registration(), exportRecords: () => [{ prefabId: 'thing', record: saved }] });
    registry.register({ ...registration(), prefabIds: ['empty'], debugSpawn: undefined, exportRecords: () => [] });
    const snapshot = registry.exportRecords();
    snapshot.thing[0].transform.position[0] = 99;
    snapshot.thing[0].components.health!.current = 0;
    expect(saved.transform.position[0]).toBe(3);
    expect(saved.components.health!.current).toBe(50);
    expect(snapshot.empty).toEqual([]);
  });

  it('preserves before/after physics timing and foot points, excluding ground layers', () => {
    const registry = new EntityRegistry(), calls: string[] = [], quaternion = new THREE.Quaternion();
    const entry = { object: new THREE.Group(), footPosition: new THREE.Vector3(0, 0, 10), cameraDepth: 0 };
    registry.register({ ...registration(), beforePhysics: () => calls.push('forces'),
      update: (_, received) => { expect(received).toBe(quaternion); calls.push('align'); }, renderEntities: () => [entry] });
    registry.register({ ...registration(), prefabIds: ['pond'], debugSpawn: undefined,
      exportRecords: () => [], update: () => calls.push('water') });
    registry.beforePhysics(0.1);
    calls.push('physics');
    registry.update(0.1, quaternion);
    expect(calls).toEqual(['forces', 'physics', 'align', 'water']);
    expect(registry.renderEntities).toEqual([entry]);
    expect(registry.renderEntities[0].footPosition).toBe(entry.footPosition);
  });

  it('disposes all owners even if one cleanup fails, and disables every lifecycle', async () => {
    const registry = new EntityRegistry(), family = registration();
    registry.register(family);
    registry.register({ ...registration(), prefabIds: ['other'], debugSpawn: undefined,
      dispose: () => { throw new Error('cleanup failed'); } });
    await registry.restoreAll({ thing: [record('saved')] });
    expect(() => registry.dispose()).toThrow(AggregateError);
    expect(family.dispose).toHaveBeenCalledOnce(); expect(registry.byEntityId.size).toBe(0);
    expect(registry.renderEntities).toEqual([]);
    await expect(registry.spawn('thing')).rejects.toThrow('disposed');
    await expect(registry.restoreAll({})).rejects.toThrow('disposed');
    expect(() => registry.exportRecords()).toThrow('disposed');
  });

  it('does not index entities whose async restoration finishes after disposal', async () => {
    let resolve!: (model: THREE.Group) => void;
    const registry = new EntityRegistry();
    registry.register({ ...registration(), restore: () => new Promise((done) => { resolve = done; }) });
    const restore = registry.restoreAll({ thing: [record('saved')] });
    registry.dispose(); resolve(new THREE.Group());
    await expect(restore).rejects.toThrow('disposed');
    expect(registry.byEntityId.size).toBe(0);
  });
});
