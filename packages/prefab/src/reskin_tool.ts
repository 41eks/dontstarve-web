import { addComponent } from './components';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { PrefabDisplayGroup, SpriteResources, SpriteState } from '@dontstarve-web/display';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { nextReskin, type ReskinFxMessage, type ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import type * as THREE from 'three';
import { Vector3 } from 'three';
import { SpellCaster, type SpellCastDoer } from '../../componets/src/spellcaster';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { bindInstance, PrefabInstance } from './prefabInstance';
import { PlaySound, type SoundEventPath } from './sound';
import { TILE_SIZE } from './tile';

/** The entity a CASTSPELL targets, when its declared skin source has skins (PREFAB_SKINS[target.prefab]). */
export function reskinTargetOf(target: object | undefined): ReskinTarget | undefined {
  return target instanceof PrefabInstance && target.sprite.skinNames.length ? target : undefined;
}

/** spellCB: select the skin at the hit frame and prepare the target's explode_reskin presentation. */
function spellCB(tool: ItemEntity, target: object | undefined): boolean {
  const inst = reskinTargetOf(target);
  if (!inst) {
    return false;
  }
  const fx = tool.worldServices?.reskinEffects?.prepare(tool.skinId);
  const reskinned = reskinEntity(inst, tool, fx);
  if (!reskinned) {
    fx?.dispose();
  }
  return reskinned;
}

function can_cast_fn(
  _doer: SpellCastDoer,
  target: object | undefined,
  _pos: THREE.Vector3 | undefined,
  tool: ItemEntity,
): boolean {
  const inst = reskinTargetOf(target);
  const skinId = inst?.sprite.skinId.peek();
  return (
    !!inst &&
    !inst.isRemoved &&
    (nextReskin(inst.sprite.skinNames, skinId, tool._cached_reskinname, inst.prefab) !== undefined ||
      skinId !== undefined)
  );
}

export function configureReskinToolEntity(inst: ItemEntity): void {
  inst.addTag('nopunch');
  inst.spelltype = 'RESKIN';
  inst._cached_reskinname ??= new Map();
  if (inst.components.spellcaster) {
    return;
  }
  const spellcaster = addComponent(inst, 'spellcaster', SpellCaster<ItemEntity>);
  spellcaster.canUseOnTargets = true;
  spellcaster.canUseOnDead = true;
  spellcaster.veryQuickCast = true;
  spellcaster.SetSpellFn(spellCB);
  spellcaster.SetCanCastFn(can_cast_fn);
}

export { nextReskin };

/**
 * spellCB: GetNextSkin, remembered on the tool for the prefab, then TheSim:ReskinEntity, which writes the skin into the
 * entity's sprite json; the entity's own skin functions follow that declaration. The fx plays at the entity.
 */
export function reskinEntity(
  target: ReskinTarget,
  tool?: Pick<ItemEntity, '_cached_reskinname'>,
  fx?: ReskinFxMessage,
): boolean {
  if (target.isRemoved) {
    return false;
  }
  const skinId = nextReskin(
    target.sprite.skinNames,
    target.sprite.skinId.peek(),
    tool?._cached_reskinname,
    target.prefab,
  );
  tool?._cached_reskinname?.set(target.prefab, skinId);
  target.sprite.skinId.set(skinId);
  fx?.play(target.position, target.prefab);
  return true;
}

// reskin_tool.lua's GetReskinFXInfo. Offsets use DST units, converted below.
const fxInfo: Readonly<Record<string, { offset?: number; scale: number }>> = {
  cookpot: { offset: 0.5, scale: 1.4 },
  firepit: { scale: 1.2 },
  campfire: { scale: 1.2 },
  icebox: { offset: 0.3, scale: 1.3 },
  treasurechest: { offset: 0.1, scale: 1.1 },
  tent: { offset: 0.4, scale: 2 },
  dragonflychest: { offset: 0.1, scale: 1.4 },
  dragonflyfurnace: { offset: 0.6, scale: 1.8 },
  saltbox: { offset: 0.3, scale: 1.3 },
  pighouse: { offset: 1.5, scale: 2.2 },
  mushroom_light: { offset: 1.2, scale: 1.8 },
  mushroom_light2: { offset: 1.2, scale: 1.8 },
  researchlab: { offset: 0.5, scale: 1.4 },
  researchlab2: { offset: 0.5, scale: 1.4 },
  researchlab3: { offset: 0.5, scale: 1.4 },
  researchlab4: { offset: 0.5, scale: 1.3 },
  yellowstaff: { offset: 0.4, scale: 1 },
  opalstaff: { offset: 0.4, scale: 1 },
  greenstaff: { offset: 0.4, scale: 1 },
  firestaff: { offset: 0.4, scale: 1 },
  orangestaff: { offset: 0.4, scale: 1 },
  icestaff: { offset: 0.4, scale: 1 },
  trident: { offset: 0.4, scale: 1 },
  shovel: { offset: 0.2, scale: 1 },
  featherhat: { offset: 0.1, scale: 1.1 },
  wormhole: { scale: 1.3 },
  wall_moonrock: { offset: 0.2, scale: 1.2 },
  wall_ruins: { offset: 0.2, scale: 1.3 },
  wall_stone: { offset: 0.2, scale: 1.3 },
  fence: { offset: 0.1, scale: 1.2 },
};

export function reskinEffectSound(toolSkinId?: string): SoundEventPath {
  return toolSkinId === 'reskin_tool_brush'
    ? 'terraria1/skins/spectrepaintbrush'
    : 'dontstarve/common/together/reskin_tool';
}

/** A logical FX request: the receiving target supplies its own prefab and ground-contact position. */
class ReskinFx implements ReskinFxMessage {
  private played = false;
  readonly footPosition = new Vector3();
  readonly instance: PrefabInstance;
  private readonly toolSkinId?: string;

  constructor(instance: PrefabInstance, toolSkinId?: string) {
    this.instance = instance;
    this.toolSkinId = toolSkinId;
  }

  play(position: ReadonlyVector3, prefabId: string): void {
    if (this.played || this.instance.status.peek() === 'removed') {
      return;
    }
    this.played = true;
    const info = fxInfo[prefabId];
    this.footPosition.copy(position);
    this.instance.setPosition(position.x, position.y + (info?.offset ?? 0) * (TILE_SIZE / 4), position.z);
    this.instance.setScale(info?.scale ?? 1);
    this.instance.sprite.setVisible(true);
    this.instance.sprite.playOnce('puff', () => this.instance.remove());
    PlaySound(reskinEffectSound(this.toolSkinId), position);
  }

  dispose(): void {
    if (!this.played) {
      this.instance.remove();
    }
  }
}

/** explode_small.lua: logical one-shot entities; all visual ownership stays in packages/display. */
export class ReskinEffects {
  /** The puff art shared by every effect; declaring its source performs no IO, each effect's display loads it. */
  private readonly sprites = new SpriteResources(undefined, 'ground');
  private readonly displays: PrefabDisplayGroup;
  private readonly effects = new Set<ReskinFx>();
  private disposed = false;

  constructor(scene: THREE.Scene) {
    this.displays = new PrefabDisplayGroup(scene);
  }

  /** Spawns the hidden puff at once; its display loads the art while the cast plays. */
  prepare(toolSkinId?: string): ReskinFxMessage {
    if (this.disposed) {
      throw new Error('Reskin effects have been disposed');
    }
    const skinArchive = toolSkinId ? GROUND_ITEM_DEFINITIONS.reskin_tool.skinArchives[toolSkinId] : undefined;
    if (toolSkinId && !skinArchive) {
      throw new Error(`Unknown reskin tool skin: ${toolSkinId}`);
    }
    const archive = this.sprites.archive({
      animationArchive: 'reskin_tool_fx.zip',
      bank: 'fx_shadow_dust',
      buildArchives: ['reskin_tool_fx.zip', ...(skinArchive ? [skinArchive] : [])],
    });
    const prefab = toolSkinId ? `explode_${toolSkinId.replace('_tool', '')}` : 'explode_reskin';
    const sprite = new SpriteState({ name: 'puff', held: true, billboard: true });
    const instance = new PrefabInstance(prefab, sprite);
    instance.addTag('FX');
    instance.persists = false;
    sprite.setVisible(false);
    sprite.setLightOverride(toolSkinId ? 0 : 1);
    if (skinArchive) {
      sprite.setSymbolOverride('shadow_dust', skinArchive);
    }
    const effect = new ReskinFx(instance, toolSkinId);
    const display = this.displays.add(
      { root: instance.transform.model, name: prefab, sprite, light: instance.light, art: { archive } },
      effect.footPosition,
    );
    bindInstance(display.model, instance);
    this.effects.add(effect);
    return effect;
  }

  get renderEntities() {
    return this.displays.renderEntities;
  }

  update(dt: number): void {
    this.displays.update(Math.min(dt, 0.1));
    for (const effect of this.effects) {
      if (effect.instance.status.peek() === 'removed') {
        this.effects.delete(effect);
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const effect of this.effects) {
      effect.instance.remove();
    }
    this.effects.clear();
    this.displays.dispose();
    this.sprites.dispose();
  }
}

/** reskin_tool.lua onequip: swap_reskin_tool, or the skin's, named on the owner's AnimState. */
export const reskinToolVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('reskin_tool', GROUND_ITEM_DEFINITIONS.reskin_tool.skinArchives, item.skinId);
  return handEquipmentVisual(item, [...(skin ? [skin] : []), 'swap_reskin_tool'], 'swap_reskin_tool');
};
