import { Vector3 } from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { grassPrefabs, GRASS_REGROW_TIME } from '../../prefab/src/grass';
import { rockAvocadoBushPrefabs } from '../../prefab/src/rock_avocado_bush';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { FireFxHost } from '../../prefab/src/treeFire';
import type { PickablePlantWorld } from '../../prefab/src/pickablePlant';
import type { SpriteResources } from '@dontstarve-web/display';
import { bindTestWorld } from './worldContentFixture';

vi.mock('../../prefab/src/sound', () => ({ PlaySound: vi.fn(() => ({ stop: vi.fn(), isPlaying: () => true })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const fetch = vi.fn(() => { throw new Error('Logical plants must not load art'); });
  vi.stubGlobal('fetch', fetch);
  const scheduler = new GameTimeScheduler(), fire = FireFxHost.create('/dst/data/anim');
  const { season, getWatchWorldContent, unbind } = bindTestWorld(scheduler);
  const spawnGroundItem = vi.fn();
  const world: PickablePlantWorld = { scheduler, fire, getWatchWorldContent, spawnGroundItem };
  const position = new Vector3(3, 0, 6);
  /** The prefab's fn, then SpawnPrefab's SetPosition, without a manager or display. */
  const spawn = <T extends { setPosition(x: number, y: number, z: number): void }>(definition: { fn(position: Vector3, sprites: SpriteResources): T }) => {
    const inst = definition.fn(position, undefined as unknown as SpriteResources);
    inst.setPosition(position.x, position.y, position.z);
    return inst;
  };
  return { world, spawn, scheduler, season, fetch, spawnGroundItem,
    dispose: () => { fire.dispose(); unbind(); scheduler.dispose(); } };
}

it('registers grass callbacks without a manager or display, including winter pause, transplant and removal cancellation', () => {
  const s = setup(), grass = s.spawn(grassPrefabs(s.world).grass);
  const pickable = grass.components.pickable;
  try {
    expect(pickable.Pick({ giveItem: () => true })).toBe(true);
    expect(grass.sprite.currentAnimation).toBe('picking');
    s.season.set({ season: 'winter', progress: 0 });
    s.scheduler.advance(GRASS_REGROW_TIME);
    expect(pickable.canBePicked).toBe(false);
    s.season.set({ season: 'autumn', progress: 0 });
    s.scheduler.advance(GRASS_REGROW_TIME);
    expect(pickable.canBePicked).toBe(true);
    expect(grass.sprite.currentAnimation).toBe('grow');
    expect(grass.position.toArray()).toEqual([3, 0, 6]);

    pickable.OnTransplant();
    expect(pickable.IsBarren()).toBe(true);
    expect(grass.sprite.currentAnimation).toBe('idle_dead');
    expect(pickable.Fertilize({ components: { fertilizer: { withered_cycles: 0 } } })).toBe(true);
    expect(grass.sprite.currentAnimation).toBe('dead_to_empty');
    const workable = grass.components.workable!;
    expect(workable.WorkedBy({})).toBe(true);
    expect(grass.isRemoved).toBe(true);
    expect(s.spawnGroundItem.mock.calls.map(([item]) => item.itemId)).toEqual(['dug_grass']);
    s.scheduler.advance(GRASS_REGROW_TIME * 2);
    expect(pickable.state.phase.peek()).toBe('removed');
    expect(s.fetch).not.toHaveBeenCalled();
  } finally { grass.remove(); s.dispose(); }
});

it('keeps the rock avocado burning callback on its inst and restores a burning mature bush without art', () => {
  const s = setup();
  const bush = s.spawn(rockAvocadoBushPrefabs(s.world).rock_avocado_bush);
  bush.entityId = 'burning-bush';
  try {
    bush.SetPersistData({ burning: true, growable: { stage: 3 } });
    expect(bush.entityId).toBe('burning-bush');
    expect(bush.isRemoved).toBe(true);
    expect(s.spawnGroundItem.mock.calls.map(([item]) => item.itemId)).toEqual([
      'rock_avocado_fruit', 'rock_avocado_fruit', 'rock_avocado_fruit', 'ash',
    ]);
    s.scheduler.advance(2000);
    expect(s.spawnGroundItem).toHaveBeenCalledTimes(4);
    expect(s.fetch).not.toHaveBeenCalled();
  } finally { bush.remove(); s.dispose(); }
});
