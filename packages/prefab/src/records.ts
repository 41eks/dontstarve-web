import type { ItemEntity, InventoryItemSpec } from '@dontstarve-web/inventory';
import { createResidentGroundItem, GROUND_ITEM_DISPLAY_SPECS } from './groundItems';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';
import type { SoundEventPath } from './sound';

export const RECORD_ID = 'record';

// records.lua's default and skinprefabs.lua's record_init_fn song overrides.
export const RECORD_SONGS: Readonly<Record<string, SoundEventPath>> = {
  record: 'dontstarve/music/gramaphone_ragtime',
  record_creepyforest: 'dontstarve/music/gramaphone_creepyforest',
  record_drstyle: 'dontstarve/music/gramaphone_drstyle',
  record_efs: 'dontstarve/music/gramaphone_efs',
  record_hallowednights: 'dontstarve/music/gramaphone_hallowednights',
};

export function configureRecordEntity(entity: ItemEntity): void {
  entity.addTag('cattoy');
  entity.addTag('phonograph_record');
}

/** phonograph.lua: ShouldAcceptItem checks the prefab tag, independently of its skin. */
export function isPhonographRecord(entity: Pick<ItemEntity, 'hasTag'>): boolean {
  return entity.hasTag('phonograph_record');
}

export const RECORD_ITEM_SPECS: Readonly<Record<string, InventoryItemSpec>> = {
  [RECORD_ID]: { ...GROUND_ITEM_DISPLAY_SPECS[RECORD_ID], maxStack: 1, configureEntity: configureRecordEntity },
};

export function createRecordGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  return {
    itemIds: [RECORD_ID],
    configureEntity: configureRecordEntity,
    create: (item, inst) => createResidentGroundItem(context, { ...item, sprite: inst.sprite }).visual,
  };
}
