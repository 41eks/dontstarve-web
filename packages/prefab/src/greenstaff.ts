import type * as THREE from 'three';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { EquipmentLifecycle, ReadonlySignal } from '@dontstarve-web/signals';
import { SpellCaster, type PreparedSpellCast, type SpellCastDoer } from '../../componets/src/spellcaster';
import { getDeconstructionRecipe } from '../../componets/src/recipes';
import type { SpellCastTarget } from '../../stategraphs/src/spellcaster';
import { PlaySound, PreloadSounds, type SoundEventPath } from './sound';

export const GREENSTAFF_USES = 5;
export const GREENSTAFF_COLOUR = [51 / 255, 153 / 255, 51 / 255] as const;
export interface DeconstructionTarget extends SpellCastTarget {
  readonly components: {
    finiteuses?: { readonly percent: ReadonlySignal<number | undefined> };
    fueled?: { readonly percent: ReadonlySignal<number | undefined> };
    armor?: { GetPercent(): number };
    inventoryitem?: object;
    container?: { DropEverything(position: THREE.Vector3): void };
    stewer?: { Harvest(): unknown };
  };
  flush?(): void;
  PushEvent(name: string, data: unknown): void;
  removeOne(): boolean;
}
export interface DeconstructionLoot { readonly itemId: string; readonly count: number; }
export interface PreparedDeconstruction extends PreparedSpellCast {
  spawn(items: readonly DeconstructionLoot[], position: THREE.Vector3): boolean;
}
export interface GreenStaffWorld {
  prepareLoot(items: readonly DeconstructionLoot[]): Promise<PreparedDeconstruction>;
}

/** staff.lua destroystructure: one recipe product, scaled by its current condition. */
export function deconstructionLoot(target: Pick<DeconstructionTarget, 'prefab' | 'components'>): DeconstructionLoot[] {
  const recipe = getDeconstructionRecipe(target.prefab);
  if (!recipe) return [];
  const components = target.components;
  const condition = (!recipe.ignoresFiniteUses ? components.finiteuses?.percent.peek() : undefined)
    ?? (components.inventoryitem ? components.fueled?.percent.peek() ?? components.armor?.GetPercent() : undefined) ?? 1;
  return recipe.ingredients.filter(({ type, amount }) => amount > 0 && (!type.endsWith('gem') || type.slice(-11, -3) === 'precious'))
    .map(({ type, amount }) => ({ itemId: type, count: Math.max(1, Math.ceil(amount * condition / recipe.numtogive)) }));
}

const ingredientSounds: Readonly<Record<string, SoundEventPath>> = {
  nightmarefuel: 'dontstarve/common/destroy_magic', livinglog: 'dontstarve/common/destroy_magic',
  silk: 'dontstarve/common/destroy_clothing', beefalowool: 'dontstarve/common/destroy_clothing',
  twigs: 'dontstarve/common/destroy_tool',
  ...Object.fromEntries(['redgem', 'bluegem', 'greengem', 'purplegem', 'yellowgem', 'orangegem']
    .map(id => [id, 'dontstarve/common/gem_shatter' as const])),
  log: 'dontstarve/common/destroy_wood', boards: 'dontstarve/common/destroy_wood',
  rocks: 'dontstarve/common/destroy_stone', cutstone: 'dontstarve/common/destroy_stone',
  cutgrass: 'dontstarve/common/destroy_straw', cutreeds: 'dontstarve/common/destroy_straw',
};

export class GreenStaffController implements EquipmentLifecycle {
  readonly spellcaster: SpellCaster;
  private readonly entity: ItemEntity;
  constructor(entity: ItemEntity, world: GreenStaffWorld) {
    this.entity = entity;
    entity.addTag('nopunch'); entity.addTag('shadowlevel');
    entity.fxcolour = GREENSTAFF_COLOUR;
    entity.components.finiteuses.setMaxUses(GREENSTAFF_USES);
    this.spellcaster = entity.component('spellcaster', () => new SpellCaster(entity));
    entity.components.spellcaster = this.spellcaster;
    this.spellcaster.canUseOnTargets = true;
    this.spellcaster.canOnlyUseOnRecipes = true;
    this.spellcaster.setSpellFn((_staff, target, _position, doer, prepared) =>
      this.destroyStructure(target as DeconstructionTarget, doer, prepared as PreparedDeconstruction | undefined), async target => {
      const inst = target as DeconstructionTarget;
      inst.flush?.();
      const recipe = getDeconstructionRecipe(inst.prefab)!;
      const sounds = recipe.ingredients.flatMap(({ type }) => ingredientSounds[type] ? [ingredientSounds[type]] : []);
      // Reserve full-condition loot so condition changes before impact cannot exhaust prepared art.
      const loot = deconstructionLoot({ prefab: inst.prefab, components: {} });
      const results = await Promise.allSettled([world.prepareLoot(loot),
        PreloadSounds('dontstarve/wilson/use_gemstaff', 'dontstarve/common/staff_dissassemble', 'dontstarve/common/gem_shatter', ...sounds)]);
      if (results[0].status === 'rejected') throw results[0].reason;
      if (results[1].status === 'rejected') { results[0].value.dispose(); throw results[1].reason; }
      return results[0].value;
    });
  }
  onequip(): void {}
  onunequip(): void {}
  dispose(): void {}
  private destroyStructure(target: DeconstructionTarget, doer: SpellCastDoer, prepared?: PreparedDeconstruction): boolean {
    const recipe = getDeconstructionRecipe(target.prefab);
    if (!recipe || !prepared || !target.isValid() || this.entity.isRemoved) return false;
    target.flush?.();
    if (!target.isValid()) return false;
    if (!prepared.spawn(deconstructionLoot(target), target.position)) return false;
    for (const ingredient of recipe.ingredients) {
      const sound = ingredientSounds[ingredient.type];
      if (sound) PlaySound(sound, doer.position);
    }
    target.components.container?.DropEverything(target.position);
    target.components.stewer?.Harvest();
    target.PushEvent('ondeconstructstructure', doer);
    target.removeOne();
    PlaySound('dontstarve/common/staff_dissassemble', doer.position);
    if (doer.components.staffsanity) doer.components.staffsanity.doCastingDelta(-20);
    else doer.components.sanity?.doDelta(-20);
    const depleted = (this.entity.components.finiteuses.remaining ?? GREENSTAFF_USES) === 1;
    this.entity.components.finiteuses.use(1);
    if (depleted) PlaySound('dontstarve/common/gem_shatter', doer.position);
    return true;
  }
}
export function getGreenStaffController(entity: ItemEntity, world: GreenStaffWorld): GreenStaffController {
  return entity.component('greenstaff', () => new GreenStaffController(entity, world));
}
