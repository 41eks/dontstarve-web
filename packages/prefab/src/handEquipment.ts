import type { ItemEntity } from '@dontstarve-web/inventory';
import type { HandEquipmentLifecycle } from '@dontstarve-web/signals';
import type { ActionDescription } from '@dontstarve-web/stategraphs';
import type { WilsonCarryItem } from './player';
import { createTorchHandLifecycle, TORCH_SOUNDS } from './torch';
import { PreloadSounds, type SoundPosition } from './sound';
import { getLightStaffController, type LightStaffWorld } from './yellowstaff';

export interface HandEquipmentContext {
  soundPosition?: SoundPosition;
  setLightActive(active: boolean): void;
  lightStaffWorld?: LightStaffWorld;
}
export interface HandEquipmentDefinition {
  readonly handAction?: ActionDescription;
  preload?(): Promise<void>;
  createLifecycle?(entity: ItemEntity, context: HandEquipmentContext): HandEquipmentLifecycle | undefined;
}

/** Source hand prefabs declare their presentation and equip lifecycle together. */
const definitions: Record<WilsonCarryItem, HandEquipmentDefinition> = {
  torch: { preload: () => PreloadSounds(...TORCH_SOUNDS), createLifecycle: createTorchHandLifecycle },
  lantern: {},
  yellowstaff: { createLifecycle: (entity, context) => context.lightStaffWorld ? getLightStaffController(entity, context.lightStaffWorld) : undefined },
  opalstaff: { createLifecycle: (entity, context) => context.lightStaffWorld ? getLightStaffController(entity, context.lightStaffWorld) : undefined },
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
