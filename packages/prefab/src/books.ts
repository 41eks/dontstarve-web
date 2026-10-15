import type * as THREE from 'three';
import { WorldContentKey, type GetWatchWorldContent, type ReadonlySignal, type WorldMoonPhase } from '@dontstarve-web/signals';
import type { InventoryItemSpec, ItemEntity } from '@dontstarve-web/inventory';
import type { BookDef, BufferedActionObject } from '@dontstarve-web/stategraphs';
import { Book, type BookFxWorld, type BookReaderInst, type BookResult } from '../../componets/src/book';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { FindEntities, type FoundEntity } from './actionEntity';
import { configureBurnableItemEntity } from './burnableItems';
import type { Pickable } from './components/pickable';
import catalog from './groundItems.json' with { type: 'json' };
import { TILE_SIZE } from './tile';

export const BOOK_SILVICULTURE_ID = 'book_silviculture';
export const BOOK_RAIN_ID = 'book_rain';
export const BOOK_MOON_ID = 'book_moon';
export type BookId = typeof BOOK_SILVICULTURE_ID | typeof BOOK_RAIN_ID | typeof BOOK_MOON_ID;

/** Services books.lua reaches through TheSim, TheWorld and inst:DoTaskInTime. */
export interface BookWorld extends BookFxWorld<BookReader> {
  readonly root: THREE.Object3D;
  readonly scheduler: GameTimeScheduler;
  readonly getWatchWorldContent: GetWatchWorldContent;
  /** TheWorld.state.precipitation and the `ms_forceprecipitation` event. */
  readonly weather: {
    readonly preciptype: ReadonlySignal<string>;
    ForcePrecipitation(enable: boolean): void;
  };
  /** TheWorld.state.moonphase and the `ms_setmoonphase` event. */
  readonly moon: {
    SetMoonPhase(phase: WorldMoonPhase): void;
  };
}
export type BookReader = BookReaderInst & { getPosition(): THREE.Vector3 };
export type BookComponent = Book<ItemEntity, BookReader, BookWorld>;

// TUNING.BOOK_USES_LARGE, TUNING.SANITY_LARGE.
/** TUNING.BOOKSTATION_RESTORE_AMOUNT: the fraction of the maximum a bookstation restores per period. */
export const BOOKSTATION_RESTORE_AMOUNT = .01;
/** Whole uses and restored amounts (integer maximum * 1%) are all multiples of this, whatever the book's maximum. */
export const BOOK_USE_STEP = .01;
const BOOK_USES_SMALL = 3;
const BOOK_USES_LARGE = 5;
const SANITY_LARGE = 33;
const SANITY_HUGE = 50;
const SILVICULTURE_RANGE = 30 * (TILE_SIZE / 4);
const SILVICULTURE_ONEOF_TAGS = ['leif', 'silviculture', 'tree', 'winter_tree'];
const SILVICULTURE_CANT_TAGS = ['magicgrowth', 'player', 'FX', 'pickable', 'stump', 'withered', 'barren', 'INLIMBO', 'ancienttree'];

type GrowthTarget = FoundEntity & { components: FoundEntity['components'] & { pickable?: Pickable } };

/** books.lua trygrowth for the ported pickable branch; growable, crop, harvestable and leif are not ported. */
function trygrowth(inst: GrowthTarget): boolean {
  if (inst.isRemoved || inst.hasTag('INLIMBO') || inst.hasTag('withered')) return false;
  const pickable = inst.components.pickable;
  if (!pickable) return false;
  if (pickable.canBePicked && pickable.canInteractWith) return false;
  // ConsumeCycles(1) only changes transplanted/protected cycle counts, which these plants do not keep.
  return pickable.finishGrowing();
}

interface BookDefinition extends BookDef {
  readonly uses: number;
  readonly read_sanity: number;
  fn(inst: ItemEntity, reader: BookReader, world: BookWorld): BookResult;
}

const BOOK_DEFS: Readonly<Record<BookId, BookDefinition>> = {
  book_silviculture: {
    uses: BOOK_USES_LARGE,
    read_sanity: -SANITY_LARGE,
    fx_under_prefab: 'fx_roots_under_book',
    layer_sound: { frame: 17, sound: 'wickerbottom_rework/book_spells/silviculture' },
    fn(_inst, reader, world) {
      const ents = FindEntities(world.root, reader.getPosition(), SILVICULTURE_RANGE, [], SILVICULTURE_CANT_TAGS, SILVICULTURE_ONEOF_TAGS)
        .filter(v => (v.components as GrowthTarget['components']).pickable !== undefined || v.hasTag('leif')) as GrowthTarget[];
      if (ents.length === 0) return [false, 'NOSILVICULTURE'];
      trygrowth(ents.splice(Math.floor(Math.random() * ents.length), 1)[0]);
      if (ents.length > 0) {
        const timevar = 1 - 1 / (ents.length + 1);
        for (const v of ents) world.scheduler.schedule(timevar * Math.random(), () => trygrowth(v));
      }
      return [true];
    },
  },
  book_rain: {
    uses: BOOK_USES_LARGE,
    read_sanity: -SANITY_LARGE,
    fx: 'fx_book_rain',
    // The farming-soil moisture the Lua adds around the reader needs farming_manager, which is not ported.
    fn(_inst, _reader, world) {
      world.weather.ForcePrecipitation(world.weather.preciptype.peek() === 'none');
      return [true];
    },
  },
  book_moon: {
    uses: BOOK_USES_SMALL,
    read_sanity: -SANITY_HUGE,
    fx: 'fx_book_moon',
    // The cave refusal (NOMOONINCAVES) needs a cave world; the project only has the forest.
    // ANNOUNCE_BOOK_MOON_DAYTIME needs the unported talker component.
    fn(_inst, _reader, world) {
      const cleanups: (() => void)[] = [];
      try {
        const moon = world.getWatchWorldContent(WorldContentKey.Moon, stop => cleanups.push(stop));
        if (moon.peek().phase === 'full') return [false, 'ALREADYFULLMOON'];
        world.moon.SetMoonPhase('full');
        return [true];
      } finally { cleanups.forEach(stop => stop()); }
    },
  },
};

/** Items with the `bookcabinet_item` tag: books.lua MakeBook and papyrus.lua (cookbook.lua is not ported). */
export function isBookCabinetItem(itemId: string): boolean { return isBook(itemId) || itemId === 'papyrus'; }
export function isBook(itemId: string): itemId is BookId { return Object.hasOwn(BOOK_DEFS, itemId); }
export function getBookDef(itemId: BookId): BookDef { return BOOK_DEFS[itemId]; }

/** The inst fields SGwilson's book2 reads: def, swap_build, swap_prefix and GetSkinBuild(). */
export function bookActionObject(entity: ItemEntity): BufferedActionObject {
  if (!isBook(entity.prefab)) throw new Error(`${entity.prefab} is not a book`);
  const skinArchive = entity.skinId === undefined ? undefined
    : (catalog.items[entity.prefab].skinArchives as Readonly<Record<string, string>>)[entity.skinId];
  if (entity.skinId !== undefined && !skinArchive) throw new Error(`Unknown book skin ${entity.skinId}`);
  return {
    prefab: entity.prefab, def: BOOK_DEFS[entity.prefab], swap_build: 'swap_books', swap_prefix: entity.prefab,
    ...(skinArchive ? { skinBuild: skinArchive.replace(/^dynamic\/|\.zip$/g, '') } : {}),
    hasTag: tag => entity.hasTag(tag),
  };
}

/** books.lua MakeBook: tags, book, finiteuses and MakeSmallBurnable on the inventory inst. */
export function configureBookEntity(entity: ItemEntity): void {
  if (!isBook(entity.prefab)) return;
  const def = BOOK_DEFS[entity.prefab];
  entity.addTag('book');
  entity.addTag('bookcabinet_item');
  entity.components.finiteuses.setMaxUses(def.uses);
  const book = entity.component('book', () => new Book<ItemEntity, BookReader, BookWorld>(entity));
  entity.components.book = book;
  book.SetOnRead(def.fn);
  book.SetReadSanity(def.read_sanity);
  book.SetFx(def.fx);
  configureBurnableItemEntity(entity);
}

export function getBookComponent(entity: ItemEntity): BookComponent | undefined {
  return entity.getComponent<BookComponent>('book');
}

export const BOOK_ITEM_SPECS: Readonly<Record<BookId, InventoryItemSpec>> = {
  book_silviculture: { name: catalog.items.book_silviculture.name, icon: catalog.items.book_silviculture.icon,
    atlas: catalog.items.book_silviculture.atlas, maxStack: 1,
    maxUses: BOOK_USES_LARGE, useStep: BOOK_USE_STEP, configureEntity: configureBookEntity },
  book_moon: { name: catalog.items.book_moon.name, icon: catalog.items.book_moon.icon,
    atlas: catalog.items.book_moon.atlas, maxStack: 1,
    maxUses: BOOK_USES_SMALL, useStep: BOOK_USE_STEP, configureEntity: configureBookEntity },
  book_rain: { name: catalog.items.book_rain.name, icon: catalog.items.book_rain.icon,
    atlas: catalog.items.book_rain.atlas, maxStack: 1,
    maxUses: BOOK_USES_LARGE, useStep: BOOK_USE_STEP, configureEntity: configureBookEntity },
};
