import { describe, expect, it } from 'vitest';
import { PREFAB_DEFINITIONS, savedPrefabArchives } from '../../../src/prefabDefinitions';

describe('saved prefab archive scan', () => {
  const definitions = Object.values(PREFAB_DEFINITIONS);

  it('lists only archives for prefabs present in the save, without duplicates', () => {
    const archives = savedPrefabArchives(definitions, { lava_pond: [{}, {}], lava_pond_rock: [{}], grass: [] });
    expect(archives).toEqual(['lava_tile.zip', 'scorched_rock.zip']);
  });

  it('keeps split animation and build archives together', () => {
    expect(savedPrefabArchives(definitions, { grass: [{}] })).toEqual([{ animation: 'grass.zip', build: 'grass1.zip' }]);
  });

  it('lists tree art and per-building archives from the catalog', () => {
    expect(savedPrefabArchives(definitions, { evergreen: [{}, {}] })).toContainEqual({ animation: 'evergreen_tall_old.zip', build: 'evergreen_new.zip' });
    const buildings = savedPrefabArchives(definitions, { moondial: [{}], wall_wood: [{}], fence: [{}] });
    expect(buildings).toContainEqual({ animation: 'moondial.zip', build: 'moondial_build.zip' });
    expect(buildings).toContainEqual({ animation: 'wall_wood.zip', build: 'wall_wood.zip' });
    expect(buildings).toContainEqual({ animation: 'fence_thin.zip', build: 'fence.zip' });
    expect(buildings).not.toContainEqual({ animation: 'tent.zip', build: 'tent.zip' });
  });

  it('resolves ground item art from each record\'s catalog entry, including symbol overrides and skins', () => {
    const stack = (itemId: string, skinId?: string) => ({ components: { stack: { itemId, count: 1, skinId } } });
    const archives = savedPrefabArchives(definitions, {
      ground_item: [stack('axe', 'axe_heart'), stack('meatballs'), stack('not_an_item')],
    });
    expect(archives).toContainEqual({ animation: 'axe.zip', build: 'axe.zip' });
    expect(archives).toContain('dynamic/axe_heart.zip');
    expect(archives).toContainEqual({ animation: 'cook_pot_food.zip', build: 'cook_pot_food.zip' });
    expect(archives).not.toContain('dynamic/axe_rose.zip');
  });
});
