import { readFile } from 'node:fs/promises';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { dstUnitsToWorld } from '../../animation/src/units';
import { ComponentUpdates } from '../../componets/src/componentUpdates';
import { SANITY_MODE_INSANITY, SANITY_MODE_LUNACY } from '../../componets/src/sanity';
import { DisposeSounds } from '../src/sound';
import { FindVisualNodeAtPoint, WorldTopology, type TopologySave } from '../src/topology';
import { TurfMap, type TurfTileSave } from '../src/turfMap';
import { createPlayer, playerInst } from '../../../tests/fixtures/playerVisual';

let map: TurfMap;
let topology: WorldTopology;

beforeAll(async () => {
  // The bundled forest: its lunar island is the topology's lunacyarea nodes.
  const save = JSON.parse(
    await readFile(new URL('../../../public/saves/Cluster_1/Master.json', import.meta.url), 'utf8'),
  ) as {
    world: {
      map: {
        generator: { options: { size: number } };
        tiles: TurfTileSave[];
        defaultTileId: number;
        topology: TopologySave;
      };
    };
  };
  const { generator, tiles, defaultTileId } = save.world.map;
  map = new TurfMap(generator.options.size, tiles, defaultTileId);
  topology = new WorldTopology(save.world.map.topology);
});

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const relative = String(url).slice(String(url).indexOf('dst/data/') + 9);
      return new Response(await readFile(new URL(`../../../public/dst/data/${relative}`, import.meta.url)));
    }),
  );
});
afterEach(() => {
  DisposeSounds();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('maps each topology node centre back to its node through the imported nodeidtilemap', () => {
  topology.nodes.forEach((node, index) => {
    expect(topology.GetNodeIdAtPoint(node)).toBe(index + 1);
  });
  expect(topology.nodes.filter(node => node.tags?.includes('lunacyarea')).length).toBeGreaterThan(0);
});

it('turns the player lunacy on the lunar island and back to insanity on the mainland, via areaaware', async () => {
  const lunar = topology.nodes.find(node => node.tags?.includes('lunacyarea'))!;
  const mainland = topology.nodes.find(
    node => !node.tags?.includes('lunacyarea') && FindVisualNodeAtPoint(map, topology, node).node === node,
  )!;
  const componentUpdates = new ComponentUpdates();
  const player = playerInst(
    await createPlayer('/dst/data/anim', {
      stats: { sanity: 100 },
      componentUpdates,
      areaaware: {
        FindVisualNodeAtPoint: point => FindVisualNodeAtPoint(map, topology, point),
      },
    }),
  );
  const sanity = player.components.sanity!;
  const changes: unknown[] = [];
  player.ListenForEvent('changearea', (_inst, area) => changes.push(area?.tags));

  player.setPosition(mainland.x, 0, mainland.z);
  componentUpdates.update(1 / 30);
  expect(sanity.GetSanityMode()).toBe(SANITY_MODE_INSANITY);

  player.setPosition(lunar.x, 0, lunar.z);
  componentUpdates.update(1 / 30);
  expect(player.components.areaaware!.CurrentlyInTag('lunacyarea')).toBe(true);
  expect(sanity.GetSanityMode()).toBe(SANITY_MODE_LUNACY);

  // Within SetUpdateDist(.45) of the last check, the area is not re-tested.
  const pushed = changes.length;
  player.setPosition(lunar.x + dstUnitsToWorld(0.4), 0, lunar.z);
  componentUpdates.update(1 / 30);
  expect(changes.length).toBe(pushed);

  player.setPosition(mainland.x, 0, mainland.z);
  componentUpdates.update(1 / 30);
  expect(sanity.GetSanityMode()).toBe(SANITY_MODE_INSANITY);
  player.remove();
});
