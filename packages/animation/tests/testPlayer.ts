import type * as THREE from 'three';
import type { ArchiveSpriteCommands } from '../../display/src';
import { InventoryStore } from '../../inventory/src';
import { createEmptyEntity, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { createInventoryStore } from '../../../src/inventory';
import { testEnts } from './entsFixture';
import { entityOf } from './entityFixture';
import type { DeployMap } from '../../componets/src/deployable';

/** A player entity as a test's act.doer: an entity tagged "player" that owns its inventory store. */
export type TestPlayer = PrefabInstance<ArchiveSpriteCommands> & {
  readonly components: PrefabInstance['components'] & { inventory: InventoryStore };
  /** TheWorld.Map, which the application puts on its player for ACTIONS.DEPLOY. */
  Map?: DeployMap;
  /** equippable:Equip(owner): the slot of the player's sprite each equipped inst draws on. */
  OpenEquipmentView?: import('../../signals/src').EquipmentOwner['OpenEquipmentView'];
};

function ownsStore(inst: PrefabInstance<ArchiveSpriteCommands>): inst is TestPlayer {
  return inst.components.inventory instanceof InventoryStore;
}

export interface TestPlayerOptions {
  /** The entity that acts, when the test already has it. */
  readonly entity?: PrefabInstance<ArchiveSpriteCommands>;
  /** A player or entity model whose entity acts (a bare model gets one); a new entity at the origin otherwise. */
  readonly model?: THREE.Object3D;
  /** TheWorld.Map for the actions that read it. */
  readonly map?: DeployMap;
  /** The store the player owns; an empty one unless given. */
  readonly inventory?: InventoryStore;
  readonly position?: { readonly x: number; readonly y: number; readonly z: number };
  /** The character a new entity is, "wilson" unless given. */
  readonly prefab?: string;
  readonly tags?: readonly string[];
}

/**
 * The entity that acts in a test, as the application's player inst does: it is tagged "player", owns `inventory`
 * (inventory.inst, the store's actor and its items' owner) and is every action's doer.
 */
export function testPlayer({ entity, model, inventory = createInventoryStore([]), position, map, prefab = 'wilson', tags = [] }: TestPlayerOptions = {}): TestPlayer {
  // A new player entity is tracked in a world of its own, so its TheSim finds what a test adds there.
  const existing = entity ?? (model && prefabInstance(model));
  const inst: PrefabInstance<ArchiveSpriteCommands> = existing
    ?? testEnts().track(model ? entityOf(model, prefab) : createEmptyEntity(prefab).instance);
  for (const tag of ['player', ...tags]) inst.addTag(tag);
  if (position) inst.setPosition(position.x, position.y, position.z);
  inst.components.inventory = inventory;
  inventory.bindActor(inst);
  if (!ownsStore(inst)) throw new Error('A test player owns its inventory store');
  if (map) inst.Map = map;
  return inst;
}
