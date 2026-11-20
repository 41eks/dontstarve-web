import { addComponent } from './components';
import {
  handEquipmentVisual,
  skinArchive,
  type EquipmentVisualFactory,
  type HeldEquipFunctions,
} from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { PlaySound } from './sound';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Terraformer, type TerraformerMap } from '../../componets/src/terraformer';
import { AddWeapon, GOLDENTOOLFACTOR, WILSON_ATTACK } from './handTool';

const PITCHFORK_DAMAGE = WILSON_ATTACK * 0.5; // tuning.lua PITCHFORK_DAMAGE

export type PitchforkTool = 'pitchfork' | 'goldenpitchfork';
export function isPitchforkTool(value: string): value is PitchforkTool {
  return value === 'pitchfork' || value === 'goldenpitchfork';
}

const PITCHFORK_SWAP: Readonly<Record<PitchforkTool, { archive: string; symbol: string }>> = {
  pitchfork: { archive: 'swap_pitchfork.zip', symbol: 'swap_pitchfork' },
  goldenpitchfork: { archive: 'swap_goldenpitchfork.zip', symbol: 'swap_goldenpitchfork' },
};

/** pitchfork.lua: held swap symbols are distinct from each tool's ground idle. */
export const pitchforkVisual: EquipmentVisualFactory = item => {
  const tool = item.prefab as PitchforkTool,
    swap = PITCHFORK_SWAP[tool];
  const skin = skinArchive(tool, GROUND_ITEM_DEFINITIONS[tool].skinArchives, item.skinId);
  const visual = handEquipmentVisual(item, [...(skin ? [skin] : []), swap.archive], swap.symbol, [], false);
  return {
    ...visual,
    onequip(owner) {
      visual.onequip(owner);
      if (item.prefab === 'goldenpitchfork') {
        PlaySound('dontstarve/wilson/equip_item_gold');
      }
    },
  };
};

/**
 * pitchfork.lua common_fn, with golden's attackwear. Its finiteuses (PITCHFORK_USES, TERRAFORM consumption) is not
 * ported: BufferedAction:Do's OnUsedAsItem does not wear the invobject for TERRAFORM yet.
 */
export function configurePitchforkEntity(inst: ItemEntity): void {
  inst.addTag('sharp');
  const weapon = AddWeapon(inst, PITCHFORK_DAMAGE, false);
  addComponent(inst, 'terraformer', Terraformer);
  if (inst.prefab === 'goldenpitchfork') {
    weapon.attackwear = 1 / GOLDENTOOLFACTOR;
  }
}

/** While held in a world, the terraformer works that world's map. */
export function createTerraformerLifecycle(entity: ItemEntity, map: TerraformerMap): HeldEquipFunctions {
  return {
    onequip() {
      if (entity.components.terraformer) {
        entity.components.terraformer.map = map;
      }
    },
    onunequip() {
      if (entity.components.terraformer) {
        entity.components.terraformer.map = undefined;
      }
    },
  };
}
