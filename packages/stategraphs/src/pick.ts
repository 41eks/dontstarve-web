import * as THREE from 'three';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { Combat } from '../../componets/src/combat';

/** The picker inst supplied to prefab onpickedfn callbacks. */
export interface PickActor {
  hasTag(tag: string): boolean;
  PushEvent?(name: string, data?: unknown): void;
  readonly components: {
    sanity?: { DoDelta(delta: number): void };
    combat?: Pick<Combat, 'GetAttacked'>;
    inventory?: { EquipHasTag(tag: string): boolean; GiveItem?(item: ItemEntity, source?: THREE.Vector3): boolean };
  };
}

/** The actor supplies inventory reception; products belong to the pickable component. */
export interface PickDoer {
  readonly picker?: PickActor;
  readonly loot?: unknown;
  giveItem(itemId: string, count: number, sourcePosition: THREE.Vector3): boolean;
  giveEntity?(entity: ItemEntity, sourcePosition: THREE.Vector3): boolean;
}

export interface PreparedPickDoer extends PickDoer { dispose(): void; }
export type PreparePickDoer = (itemId: string, count: number, entity?: ItemEntity) => PreparedPickDoer;

export interface PickableComponent {
  readonly canBePicked: boolean;
  readonly product?: string;
  readonly numToHarvest?: number;
  readonly quickpick?: boolean;
  readonly productEntity?: ItemEntity;
  pick(doer: PickDoer): boolean;
}

/** The inventory a picker's product goes to: it spawns the product, takes it, or drops it at the doer when full. */
export interface PickInventory {
  readonly entities: { create(spec: { itemId: string; count: number }): ItemEntity; destroy(entity: ItemEntity): void };
  GiveItem(entity: ItemEntity, source?: THREE.Vector3): boolean;
}

/**
 * pickable.lua Pick: the product (or the pickable's own product inst) is spawned for the picker and given to its
 * inventory; an unclaimed spawned product is destroyed with the receiver.
 */
export function preparePickReceiver(picker: PickActor & { readonly components: { inventory?: PickInventory } },
  itemId: string, count: number, original?: ItemEntity): PreparedPickDoer {
  const inventory = picker.components.inventory as PickInventory | undefined;
  if (!inventory) return { picker, giveItem: () => false, dispose: () => {} };
  const entity = original ?? inventory.entities.create({ itemId, count });
  let committed = false;
  return {
    loot: entity,
    picker,
    giveItem: (_itemId, _count, sourcePosition) => {
      if (committed || entity.isRemoved) return false;
      committed = inventory.GiveItem(entity, sourcePosition);
      return committed;
    },
    giveEntity: (item, sourcePosition) => {
      if (committed || item !== entity || item.isRemoved) return false;
      committed = inventory.GiveItem(item, sourcePosition);
      return committed;
    },
    dispose: () => { if (!committed && !original) inventory.entities.destroy(entity); },
  };
}
