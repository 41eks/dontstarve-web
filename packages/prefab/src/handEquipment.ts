import type { ItemEntity } from '@dontstarve-web/inventory';
import type { HandEquipmentLifecycle } from '@dontstarve-web/signals';
import type { WilsonCarryItem } from './player';
import { createTorchHandLifecycle, TORCH_SOUNDS } from './torch';
import { PreloadSounds, type SoundPosition } from './sound';

export interface HandEquipmentContext {
  soundPosition?: SoundPosition;
  setLightActive(active: boolean): void;
}
export interface HandEquipmentDefinition {
  readonly handAction?: string;
  preload?(): Promise<void>;
  createLifecycle?(entity: ItemEntity, context: HandEquipmentContext): HandEquipmentLifecycle;
}

/** Source hand prefabs declare their presentation and equip lifecycle together. */
const definitions: Record<WilsonCarryItem, HandEquipmentDefinition> = {
  torch: { preload: () => PreloadSounds(...TORCH_SOUNDS), createLifecycle: createTorchHandLifecycle },
  lantern: {},
  yellowstaff: { handAction: ': 施放法术' },
  opalstaff: { handAction: ': 施放法术' },
  bugnet: {},
  hammer: {},
  reskin_tool: {},
  pickaxe: {},
  goldenpickaxe: {},
  pitchfork: {},
  goldenpitchfork: {},
  farm_hoe: {},
  golden_farm_hoe: {},
  shovel: {},
  goldenshovel: {},
};

export function getHandEquipmentDefinition(itemId: string): { carryItem: WilsonCarryItem; definition: HandEquipmentDefinition } | undefined {
  if (!Object.hasOwn(definitions, itemId)) return undefined;
  const carryItem = itemId as WilsonCarryItem;
  return { carryItem, definition: definitions[carryItem] };
}

export async function preloadHandEquipment(): Promise<void> {
  await Promise.all(Object.values(definitions).map(definition => definition.preload?.()));
}
