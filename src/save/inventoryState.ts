import type { InventoryRecipeDefinition, InventoryStore } from '@dontstarve-web/inventory';
import type { SaveDocument } from './types';

/** The saved player's inventory.lua OnLoad and builder buffered builds, loaded into the player's store. */
export function loadSavedInventory(store: InventoryStore, save: SaveDocument,
  recipes: Readonly<Record<string, InventoryRecipeDefinition>>): void {
  store.loadSaved(save.players.local.inventory, save.players.local.builder.bufferedBuilds, recipes);
}

/** A loaded save's player inventory as serializeSave takes it back, for a save written without a live store. */
export function savedInventoryOf(save: SaveDocument): ReturnType<InventoryStore['exportSaved']> {
  return { inventory: structuredClone(save.players.local.inventory), bufferedBuilds: structuredClone(save.players.local.builder.bufferedBuilds) };
}
