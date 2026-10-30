import { findActionEntity } from '../../prefab/src/actionEntity';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { SCULPTING_TABLE_DEFINITION, SCULPTING_TABLE_ID } from '../../prefab/src/sculptingtable';
import { smallHash } from '../src/animationAssets';
import { deserializeSave } from '../../../src/save/deserialize';
import type { SaveDocument } from '../../../src/save/types';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };
import type { WorldContext } from '../../prefab/src/worldContext';
import * as sound from '../../prefab/src/sound';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { reskinEntity } from '../../prefab/src/reskin_tool';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function createPlacement() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const dropLoot = vi.fn();
  const world = { scene: new THREE.Scene(), player: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(), renderer: { domElement: new EventTarget() }, dropLoot } as unknown as WorldContext;
  const placement = new AnimatedBuildingPlacement(world, { [SCULPTING_TABLE_ID]: SCULPTING_TABLE_DEFINITION }, () => false);
  return { placement, dropLoot };
}

/** The held block the table's own AnimState declares for its sprite: OverrideSymbol("cutstone01", swapfile, symbol). */
const heldBlock = (model: THREE.Object3D) => {
  const declared = prefabInstance(model)!.sprite.sprite.peek().appearance.get('anim-state');
  return declared?.kind === 'anim-state' ? declared.state.peek().overrides.get(smallHash('cutstone01'))?.sources : undefined;
};

const offer = (prefab: string) => {
  const taken = vi.fn(() => true);
  return { entity: { prefab, hasTag: () => false }, take: taken };
};

it('accepts one marble or cutstone, hands it back on PICK and restores it from a save', async () => {
  const handles: sound.SoundHandle[] = [];
  const play = vi.spyOn(sound, 'PlaySound').mockImplementation(() => {
    const handle = { stop: vi.fn(), isPlaying: () => true, setVolume: vi.fn() };
    handles.push(handle);
    return handle;
  });
  const itemSound = 'dontstarve/common/together/moonbase/moonstaff_place';
  const { placement } = await createPlacement();
  try {
    placement.spawn(SCULPTING_TABLE_ID);
    const [{ model, canGive }] = placement.giveTargets;
    const trader = (findActionEntity(model)?.components ?? prefabInstance(model)!.components).trader, pickable = (findActionEntity(model)?.components ?? prefabInstance(model)!.components).pickable;
    expect(heldBlock(model)).toBeUndefined();
    expect(prefabInstance(model)!.listTags()).toContain('trader');
    expect(prefabInstance(model)!.listTags()).not.toContain('pickable');
    expect(placement.exportRecords()[0].record.components).not.toHaveProperty('sculptingtable');

    // abletoaccepttest: only sculptable materials, and only into an empty slot.
    expect(trader.AbleToAccept({ prefab: 'log', hasTag: () => false })).toEqual({ ok: false, reason: 'NOTSCULPTABLE' });
    const log = offer('log');
    expect(trader.AcceptGift(log.entity, log.take)).toBe(false);
    expect(log.take).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();

    const cancelled = offer('marble');
    expect(trader.AcceptGift(cancelled.entity, () => false)).toBe(false);
    expect(play).not.toHaveBeenCalled();

    const marble = offer('marble');
    expect(trader.AcceptGift(marble.entity, marble.take)).toBe(true);
    expect(marble.take).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledExactlyOnceWith(itemSound, model.position);
    expect(heldBlock(model)).toEqual([{ archive: 'marble.zip', symbol: smallHash('marble01') }]);
    expect(prefabInstance(model)!.listTags()).toContain('pickable');
    expect(canGive(offer('cutstone').entity)).toBe(false);
    expect(trader.AbleToAccept(offer('cutstone').entity)).toEqual({ ok: false, reason: 'SLOTFULL' });
    const full = offer('cutstone');
    expect(trader.AcceptGift(full.entity, full.take)).toBe(false);
    expect(play).toHaveBeenCalledTimes(1);
    expect(placement.exportRecords()[0].record.components.sculptingtable).toEqual({ itemname: 'marble' });

    // The save parser accepts the exported block, rejects other items, and restoring consumes nothing.
    const saved = placement.exportRecords()[0].record;
    const parse = (record: typeof saved) => {
      const save = structuredClone(initialWorld) as unknown as SaveDocument;
      save.world.entities = { sculptingtable: [{ ...structuredClone(record), transform: { ...record.transform, position: [...record.transform.position] } }] };
      save.players.local.inventory.containers = { 'player:inventory': { slotCount: 15, slots: [] }, 'player:equipment': { slotCount: 3, slots: [] } };
      save.players.local.inventory.bufferedBuilds = [];
      return deserializeSave(JSON.stringify(save), { items: {}, skins: {}, recipes: {}, recipeSkins: {},
        buildings: definitions.animatedBuildings, walls: Object.keys(definitions.walls) });
    };
    expect(() => parse({ ...saved, components: { ...saved.components, sculptingtable: { itemname: 'log' } } })).toThrow(/itemname/);
    const restored = placement.spawnFromSave(SCULPTING_TABLE_ID, parse(saved).world.entities.sculptingtable[0]);
    expect((findActionEntity(restored)?.components ?? prefabInstance(restored)!.components).pickable.product).toBe('marble');
    expect(prefabInstance(restored)!.listTags()).toContain('pickable');
    // Lua onload calls giveitem, including its sound; reskinning only replaces art.
    expect(play).toHaveBeenCalledTimes(2);
    expect(play).toHaveBeenLastCalledWith(itemSound, restored.position);
    expect(reskinEntity(placement.reskinTargets[0])).toBe(true);
    expect(play).toHaveBeenCalledTimes(2);
    // The declaration belongs to the entity, so the new skin's sprite is dressed with the same block.
    expect(heldBlock(model)).toEqual([{ archive: 'marble.zip', symbol: smallHash('marble01') }]);

    // pickable.lua Pick: the product goes to the picker, then the block disappears and the slot reopens.
    expect(pickable.pick({ giveItem: () => false })).toBe(false);
    expect(play).toHaveBeenCalledTimes(2);
    const doer = { giveItem: vi.fn(() => true) };
    expect(pickable.pick(doer)).toBe(true);
    expect(play).toHaveBeenCalledTimes(3);
    expect(play).toHaveBeenLastCalledWith(itemSound, model.position);
    expect(doer.giveItem).toHaveBeenCalledWith('marble', 1, expect.anything());
    expect(heldBlock(model)).toBeUndefined();
    expect(prefabInstance(model)!.listTags()).not.toContain('pickable');
    expect(pickable.pick(doer)).toBe(false);
    expect(play).toHaveBeenCalledTimes(3);
    expect(placement.exportRecords()[0].record.components).not.toHaveProperty('sculptingtable');
    const cutstone = offer('cutstone');
    expect(trader.AcceptGift(cutstone.entity, cutstone.take)).toBe(true);
    expect(play).toHaveBeenCalledTimes(4);
    expect(placement.exportRecords()[0].record.components.sculptingtable).toEqual({ itemname: 'cutstone' });
  } finally { placement.dispose(); }
  expect(handles.every(handle => vi.mocked(handle.stop).mock.calls.length === 1)).toBe(true);
});

it('drops the held block with the recipe loot when hammered', async () => {
  const { placement, dropLoot } = await createPlacement();
  try {
    await placement.spawn(SCULPTING_TABLE_ID);
    const [{ model }] = placement.giveTargets;
    const marble = offer('marble');
    (findActionEntity(model)?.components ?? prefabInstance(model)!.components).trader.AcceptGift(marble.entity, marble.take);
    const target = placement.hammerTargets[0];
    for (let hit = 0; hit < 4; hit++) target.playHit();
    expect(dropLoot).toHaveBeenCalledOnce();
    const items = dropLoot.mock.calls[0][0] as { itemId: string; count: number }[];
    expect(items).toContainEqual({ itemId: 'marble', count: 1 });
    expect(items.some(({ itemId }) => itemId === 'boards')).toBe(true);
    expect(placement.exportRecords()).toEqual([]);
    expect(placement.giveTargets).toEqual([]);
  } finally { placement.dispose(); }
});
