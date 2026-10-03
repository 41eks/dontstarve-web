import type { InventorySlot, ItemSlot } from './slots';
import type { InventoryItems, InventoryRecipeDefinition, InventoryStack } from './types';

function cloneStack(stack: InventoryStack | null): InventoryStack | null {
  return stack ? { ...stack } : null;
}

function isProductStack(stack: InventoryStack, recipe: InventoryRecipeDefinition): boolean {
  return stack.itemId === recipe.productId && stack.skinId === recipe.productSkinId;
}

/** Returns backpack stacks followed by ingredient-only stacks, without changing the slots. */
export function craft(
  recipe: InventoryRecipeDefinition,
  slots: readonly InventorySlot[],
  ingredientSlots: readonly ItemSlot[] = [],
): InventoryItems | null {
  if (!Number.isSafeInteger(recipe.productCount) || recipe.productCount <= 0) return null;

  const allSlots: readonly ItemSlot[] = [...slots, ...ingredientSlots];
  if (recipe.requiredItems?.some((itemId) =>
    !allSlots.some((slot) => slot.get()?.itemId === itemId))) return null;
  const next = allSlots.map((slot) => cloneStack(slot.get()));
  if (next.some((stack, index) => {
    if (!stack) return false;
    const maxStack = allSlots[index].maxStack?.(stack.itemId);
    return !Number.isSafeInteger(stack.count)
      || stack.count <= 0
      || (maxStack !== undefined && (
        !Number.isSafeInteger(maxStack) || maxStack <= 0 || stack.count > maxStack
      ));
  })) return null;

  for (const [itemId, amount] of Object.entries(recipe.ingredients)) {
    if (!Number.isSafeInteger(amount) || amount <= 0) return null;
    let remaining = amount;

    for (let index = 0; index < next.length && remaining > 0; index += 1) {
      const stack = next[index];
      if (stack?.itemId !== itemId) continue;
      const consumed = Math.min(stack.count, remaining);
      const count = stack.count - consumed;
      next[index] = count === 0 ? null : { ...stack, count };
      remaining -= consumed;
    }

    if (remaining > 0) return null;
  }

  if (recipe.buffered) return next;

  let productsRemaining = recipe.productCount;
  for (let index = 0; index < slots.length && productsRemaining > 0; index += 1) {
    const stack = next[index];
    if (!stack || !isProductStack(stack, recipe)) continue;
    const available = slots[index].maxStack(recipe.productId) - stack.count;
    if (available <= 0) continue;
    const added = Math.min(productsRemaining, available);
    next[index] = { ...stack, count: stack.count + added };
    productsRemaining -= added;
  }

  for (let index = 0; index < slots.length && productsRemaining > 0; index += 1) {
    if (next[index] !== null) continue;
    const maxStack = slots[index].maxStack(recipe.productId);
    if (!Number.isSafeInteger(maxStack) || maxStack <= 0) continue;
    const count = Math.min(productsRemaining, maxStack);
    next[index] = {
      itemId: recipe.productId,
      ...(recipe.productSkinId === undefined ? {} : { skinId: recipe.productSkinId }),
      count,
    };
    productsRemaining -= count;
  }

  return productsRemaining === 0 ? next : null;
}
