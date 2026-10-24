import { findImage, smallHash, type AnimElement, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from './groundItems';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { HandEquipment, HandEquipmentLifecycle, Signal } from '@dontstarve-web/signals';
import { Tool } from '../../componets/src/tool';

export const PICKAXE_USES = 33; // tuning.lua; gold consumes 1 / GOLDENTOOLFACTOR = .25 per MINE.

/** pickaxe.lua / axe.lua: finiteuses removes the inst; an equipped item clears its injected slot. */
export class FiniteUsesToolLifecycle implements HandEquipmentLifecycle {
  private slot?: Signal<HandEquipment | null>;
  private equipment: HandEquipment | null = null;
  constructor(entity: ItemEntity) {
    entity.components.finiteuses.setOnFinished(() => {
      const slot = this.slot, equipment = this.equipment;
      if (slot && equipment?.entity === entity && slot.peek() === equipment) slot.set(null);
      return entity.isRemoved || entity.remove();
    });
  }
  onequip(slot: Signal<HandEquipment | null>): void { this.slot = slot; this.equipment = slot.peek(); }
  onunequip(): void { this.slot = undefined; this.equipment = null; }
  dispose(): void { this.onunequip(); }
}

export function getPickaxeLifecycle(entity: ItemEntity): HandEquipmentLifecycle {
  return entity.component('pickaxe', () => new FiniteUsesToolLifecycle(entity));
}

export function configurePickaxeEntity(entity: ItemEntity): void {
  entity.components.finiteuses.setMaxUses(PICKAXE_USES);
  entity.components.finiteuses.setConsumption('MINE', entity.prefab === 'goldenpickaxe' ? .25 : 1);
  entity.components.tool = entity.component('tool', () => {
    const tool = new Tool(entity);
    tool.SetAction('MINE');
    return tool;
  });
  getPickaxeLifecycle(entity);
}

type PickaxeBuild = Awaited<ReturnType<GroundItemAssets['loadBuild']>>;

export type PickaxeTool = 'pickaxe' | 'goldenpickaxe';
export function isPickaxeTool(value: string): value is PickaxeTool {
  return value === 'pickaxe' || value === 'goldenpickaxe';
}

export interface HeldToolEquipment<Tool extends string = string> {
  readonly tool: Tool;
  /** Held symbol swapped over the player's `swap_object`, e.g. `swap_pickaxe`. */
  readonly symbol: string;
  readonly builds: readonly PickaxeBuild[];
}
export type PickaxeEquipment = HeldToolEquipment<PickaxeTool>;

const PICKAXE_SWAP: Readonly<Record<PickaxeTool, { archive: string; symbol: string }>> = {
  pickaxe: { archive: 'swap_pickaxe.zip', symbol: 'swap_pickaxe' },
  goldenpickaxe: { archive: 'swap_goldenpickaxe.zip', symbol: 'swap_goldenpickaxe' },
};

/** pickaxe.lua: swap_object uses swap_pickaxe / swap_goldenpickaxe, distinct from the ground art. */
export async function loadPickaxeEquipment(
  assets: GroundItemAssets,
  tool: PickaxeTool,
  skinId?: string,
): Promise<PickaxeEquipment> {
  return loadHeldToolEquipment(assets, tool, PICKAXE_SWAP[tool], skinId);
}

/** Held symbols come from the swap build, or from the skin build when the ground item has a skin. */
export async function loadHeldToolEquipment<Tool extends string>(
  assets: GroundItemAssets,
  tool: Tool,
  swap: { archive: string; symbol: string },
  skinId?: string,
): Promise<HeldToolEquipment<Tool>> {
  const skinArchive = skinId ? GROUND_ITEM_DEFINITIONS[tool].skinArchives[skinId] : undefined;
  if (skinId && !skinArchive) throw new Error(`Unknown ${tool} skin: ${skinId}`);
  const [base, skin] = await Promise.all([
    assets.loadBuild(swap.archive),
    skinArchive ? assets.loadBuild(skinArchive) : undefined,
  ]);
  return { tool, symbol: swap.symbol, builds: skin ? [skin, base] : [base] };
}

export function resolvePickaxePlayerSprite(equipment: HeldToolEquipment, element: AnimElement): ResolvedSprite[] {
  const symbol = smallHash(equipment.symbol);
  for (const source of equipment.builds) {
    const image = findImage(source.build, symbol, element.imageIndex);
    if (image) return [{ element, image, materials: source.materials }];
    // Missing held frames in an explicitly overridden symbol mean hidden art.
    if (source.build.symbols.has(symbol)) return [];
  }
  return [];
}
