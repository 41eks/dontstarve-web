import { Group } from 'three';
import { expect, it, vi } from 'vitest';
import { createEmptyEntity, createPrefabEntity } from '../../prefab/src/prefabInstance';
import { miniMapEntities, subscribeMiniMapEntities } from '../../map/src/minimapEntities';
import { BindTileMapSize } from '../../componets/src/tileManager';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

it('subscribes to prefab map declarations, preserves marker identity and foot position across sleep, and releases subscriptions on removal', async () => {
  const before = [...miniMapEntities()];
  const unbind = BindTileMapSize(96);
  const entity = createPrefabEntity('tree', { create: () => new Group(), release: vi.fn() }, { name: 'idle' }, 'tree', instance => {
    // Declaration needs neither an attached transform nor any loaded map assets.
    instance.minimap.SetIcon('evergreen.png');
    instance.minimap.SetPriority(-1);
  });
  const iconless = createEmptyEntity('iconless');
  const { instance } = entity;
  let stopNotifications = () => {};
  try {
    await settle();
    const marker = [...miniMapEntities()].find(marker => marker.position === instance.position)!;
    expect(marker.icon).toBe('evergreen.png');
    expect(marker.priority).toBe(-1);
    expect(miniMapEntities().size).toBe(before.length + 1);
    const changed = vi.fn(), stop = instance.minimap.json.subscribe(changed);
    const notified = vi.fn();
    stopNotifications = subscribeMiniMapEntities((entry, present) => { if (entry === marker) notified(present); });
    expect(notified).toHaveBeenCalledExactlyOnceWith(true); notified.mockClear();
    instance.position.set(2, 0, 4);
    expect(marker.position).toBe(instance.position);
    expect(marker.position.toArray()).toEqual([2, 0, 4]);
    expect(changed).not.toHaveBeenCalled();
    stop();
    instance.tileTracker.sync(); await settle();
    expect(notified).not.toHaveBeenCalled(); // Moving inside the tile never reaches DOM consumers.
    instance.position.set(12, 0, 24);
    for (let i = 0; i < 59; i++) instance.tileTracker.moved();
    await settle(); expect(notified).not.toHaveBeenCalled();
    instance.tileTracker.moved(); await settle();
    expect(notified).toHaveBeenCalledExactlyOnceWith(true);
    stopNotifications(); notified.mockClear();

    instance.setActive(false);
    instance.minimap.SetIcon('evergreen_stump.png');
    instance.minimap.SetCanUseCache(false);
    instance.minimap.SetDrawOverFogOfWar(true);
    await settle();
    expect(miniMapEntities().has(marker)).toBe(true);
    expect(marker).toMatchObject({ icon: 'evergreen_stump.png', enabled: true, canUseCache: false, drawOverFogOfWar: true });
    instance.minimap.SetEnabled(false); await settle();
    expect(marker.enabled).toBe(false);
    instance.setActive(true); instance.minimap.SetEnabled(true); await settle();
    expect(miniMapEntities().has(marker)).toBe(true);
    expect(marker.enabled).toBe(true);

    instance.minimap.SetIcon(''); await settle();
    expect(miniMapEntities().has(marker)).toBe(false);
    instance.minimap.SetIcon('evergreen.png'); await settle();
    expect(miniMapEntities().has(marker)).toBe(true);
    instance.remove(); await settle();
    expect(miniMapEntities().has(marker)).toBe(false);
    instance.minimap.SetIcon('evergreen_burnt.png'); instance.minimap.SetEnabled(true); await settle();
    expect([...miniMapEntities()]).toEqual(before);
    expect(notified).not.toHaveBeenCalled();
  } finally {
    stopNotifications();
    for (const entry of [entity, iconless]) { entry.instance.remove(); entry.display.dispose(); }
    await settle();
    unbind();
  }
});

it('keeps the logical map declaration when the world display is disposed', async () => {
  const entity = createEmptyEntity('tree');
  try {
    entity.instance.minimap.SetIcon('evergreen.png'); await settle();
    const marker = [...miniMapEntities()].find(marker => marker.position === entity.instance.position)!;
    entity.display.dispose();
    entity.instance.minimap.SetPriority(2); await settle();
    expect(miniMapEntities().has(marker)).toBe(true);
    expect(marker.priority).toBe(2);
    entity.instance.remove(); await settle();
    expect(miniMapEntities().has(marker)).toBe(false);
  } finally {
    entity.instance.remove(); entity.display.dispose();
    await settle();
  }
});
