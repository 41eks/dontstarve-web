import catalog from './groundItems.json' with { type: 'json' };

/** constants.lua NUM_TRINKETS; trinkets.lua registers `trinket_1` … `trinket_46` (32–46 are Hallowed Nights). */
export const TRINKET_IDS = Object.keys(catalog.items).filter(id => /^trinket_\d+$/.test(id)) as (keyof typeof catalog.items)[];
