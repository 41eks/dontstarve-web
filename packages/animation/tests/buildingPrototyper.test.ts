import { readFile } from 'node:fs/promises';
import { Group, PerspectiveCamera, Scene } from 'three';
import { expect, it, vi } from 'vitest';
import { Builder } from '../../componets/src/builder';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { actionEntity, actionEntitiesChanged, FindEntities } from '../../prefab/src/actionEntity';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import * as sound from '../../prefab/src/sound';
import type { WorldContext } from '../../prefab/src/worldContext';
import { withEntity } from './entityFixture';
import { bindTestWorld } from './worldContentFixture';
import { managedBuildings } from './managedBuildings';

it('uses real prototypers for book and sculpting stations, retaining their own callbacks and dynamic technology', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const stop = vi.fn();
  vi.spyOn(sound, 'PlaySound').mockReturnValue({ stop, isPlaying: () => true, setVolume() {} });
  const scheduler = new GameTimeScheduler(), sources = bindTestWorld(scheduler);
  const player = withEntity(new Group(), 'waxwell');
  const world = { scene: new Scene(), player, camera: new PerspectiveCamera(), ground: new Group(),
    renderer: { domElement: new EventTarget() }, scheduler, getWatchWorldContent: sources.getWatchWorldContent } as unknown as WorldContext;
  const placement = managedBuildings(world, { consume: () => false });
  let builder: Builder | undefined;
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    const bookModel = await placement.spawnFromSave('bookstation', { id: 'books',
      transform: { position: [3, 0, 0], rotationY: 0 }, components: {} });
    const tableModel = await placement.spawnFromSave('sculptingtable', { id: 'table',
      transform: { position: [18, 0, 0], rotationY: 0 }, components: {} });
    const book = prefabInstance(bookModel)!, table = prefabInstance(tableModel)!;
    expect(book.components.prototyper!.on).toBe(false);
    builder = new Builder(actionEntity(player, 'waxwell'), { findEntities: FindEntities,
      researchMachineDistance: 12, entitiesChanged: actionEntitiesChanged, getWatchWorldContent: sources.getWatchWorldContent });
    expect(book.components.prototyper!.on).toBe(true);
    expect(table.components.prototyper!.on).toBe(false);
    expect(builder.accessible_tech_trees.peek().BOOKCRAFT).toBe(1);
    expect(book.sprite.currentAnimation).toBe('proximity_loop');
    player.position.set(18, 0, 0);
    sources.playerpositions.set([player.position.clone()]); await settle();
    expect(book.components.prototyper!.on).toBe(false);
    expect(table.components.prototyper!.on).toBe(true);
    expect(table.sprite.currentAnimation).toBe('proximity_loop');
    expect(builder.accessible_tech_trees.peek().SCULPTING).toBe(1);
    table.components.trader!.AcceptGift({ prefab: 'marble', hasTag: () => false }, () => true); await settle();
    expect(builder.accessible_tech_trees.peek().SCULPTING).toBe(2);
    expect(book.components.prototyper!.trees.BOOKCRAFT).toBe(1);
    builder.SetCraftingEnabled(false);
    expect(table.components.prototyper!.on).toBe(false);
    expect(stop).toHaveBeenCalledOnce();
  } finally {
    builder?.dispose(); placement.dispose(); sources.unbind(); scheduler.dispose();
    prefabInstance(player)?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
