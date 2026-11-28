import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { BindTileMapSize, GetTileAreaAtPoint } from '../../packages/componets/src/tileManager';
import { PREFAB_DEFINITIONS, savedPrefabArchives } from '../../src/prefabDefinitions';

describe('saved prefab archive scan', () => {
  const definitions = Object.values(PREFAB_DEFINITIONS);

  it('lists only archives for prefabs present in the save, without duplicates', () => {
    const archives = savedPrefabArchives(definitions, { lava_pond: [{}, {}], lava_pond_rock: [{}], grass: [] });
    expect(archives).toEqual(['lava_tile.zip', 'scorched_rock.zip']);
  });

  it('preloads only art needed by records in the starting area around the saved player position', () => {
    const unbind = BindTileMapSize(1000);
    try {
      const inStartupArea = GetTileAreaAtPoint(new Vector3(-240, 0, 240));
      const at = (x: number, z: number, skinId?: string) => ({
        position: [x, 0, z] as const,
        components: skinId === undefined ? undefined : { stack: { skinId } },
      });
      const entities = {
        axe: [at(-108, 360, 'axe_rose'), at(-120, 360, 'axe_heart')],
        grass: [at(-108, 360)],
        lava_pond: [at(-240, 240)],
      };
      const archives = savedPrefabArchives(definitions, entities, record =>
        inStartupArea(new Vector3(...record.position)),
      );

      expect(archives).toContainEqual({ animation: 'axe.zip', build: 'axe.zip' });
      expect(archives).toContain('dynamic/axe_heart.zip');
      expect(archives).toContain('lava_tile.zip');
      expect(archives).not.toContain('dynamic/axe_rose.zip');
      expect(archives).not.toContainEqual({ animation: 'grass.zip', build: 'grass1.zip' });
    } finally {
      unbind();
    }
  });

  it('keeps split animation and build archives together', () => {
    expect(savedPrefabArchives(definitions, { grass: [{}] })).toEqual([
      { animation: 'grass.zip', build: 'grass1.zip' },
    ]);
  });

  it('lists tree art and per-building archives from the catalog', () => {
    expect(savedPrefabArchives(definitions, { evergreen: [{}, {}] })).toContainEqual({
      animation: 'evergreen_tall_old.zip',
      build: 'evergreen_new.zip',
    });
    const buildings = savedPrefabArchives(definitions, { moondial: [{}], wall_wood: [{}], fence: [{}] });
    expect(buildings).toContainEqual({ animation: 'moondial.zip', build: 'moondial_build.zip' });
    expect(buildings).toContainEqual({ animation: 'wall_wood.zip', build: 'wall_wood.zip' });
    expect(buildings).toContainEqual({ animation: 'fence_thin.zip', build: 'fence.zip' });
    expect(buildings).not.toContainEqual({ animation: 'tent.zip', build: 'tent.zip' });
  });

  it("resolves ground item art from each record's catalog entry, including symbol overrides and skins", () => {
    const stack = (itemId: string, skinId?: string) => ({ components: { stack: { itemId, count: 1, skinId } } });
    const archives = savedPrefabArchives(definitions, {
      axe: [stack('axe', 'axe_heart')],
      meatballs: [stack('meatballs')],
      not_an_item: [stack('not_an_item')],
    });
    expect(archives).toContainEqual({ animation: 'axe.zip', build: 'axe.zip' });
    expect(archives).toContain('dynamic/axe_heart.zip');
    expect(archives).toContainEqual({ animation: 'cook_pot_food.zip', build: 'cook_pot_food.zip' });
    expect(archives).not.toContain('dynamic/axe_rose.zip');
  });
});
