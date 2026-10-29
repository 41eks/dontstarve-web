import { ArchiveSpriteAssets, preloadSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { PrefabDisplayGroup, SpriteState } from '@dontstarve-web/display';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { ReskinFxMessage, ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import type * as THREE from 'three';
import { Vector3 } from 'three';
import { SpellCaster } from '../../componets/src/spellcaster';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { bindInstance, PrefabInstance } from './prefabInstance';
import { PlaySound, type SoundEventPath } from './sound';
import { TILE_SIZE } from './tile';

export function configureReskinToolEntity(entity: ItemEntity): void {
  entity.addTag('nopunch');
  entity.spelltype = 'RESKIN';
  entity._cached_reskinname ??= new Map();
  entity.components.spellcaster = entity.component('spellcaster', () => {
    const caster = new SpellCaster(entity);
    caster.canUseOnTargets = true;
    caster.canUseOnDead = true;
    caster.veryQuickCast = true;
    // The renderer prepares build/symbol assets before the animation commits the cast.
    caster.setSpellFn((_tool, target) => {
      const inst = target as ReskinTarget;
      if (!inst.preparedReskin?.apply(inst.reskinFx)) return false;
      entity._cached_reskinname!.set(inst.prefabId, inst.skinId);
      return true;
    });
    caster.setCanCastFn((_doer, target) => {
      const inst = target as ReskinTarget | undefined;
      return !!inst && !inst.reskinToolCannotTargetThis && inst.isValid()
        && (nextReskin(inst.skins, inst.skinId, entity._cached_reskinname, inst.prefabId) !== undefined || inst.skinId !== undefined);
    });
    return caster;
  });
}

export function nextReskin(skins: readonly string[], current?: string,
  cache?: ReadonlyMap<string, string | undefined>, prefab?: string): string | undefined {
  if (cache && prefab) {
    const cached = cache.get(prefab);
    if (cached !== current) return cached;
  }
  return skins[(current === undefined ? -1 : skins.indexOf(current)) + 1];
}

// reskin_tool.lua's GetReskinFXInfo. Offsets use DST units, converted below.
const fxInfo: Readonly<Record<string, { offset?: number; scale: number }>> = {
  cookpot: { offset: 0.5, scale: 1.4 }, firepit: { scale: 1.2 }, campfire: { scale: 1.2 },
  icebox: { offset: 0.3, scale: 1.3 }, treasurechest: { offset: 0.1, scale: 1.1 },
  tent: { offset: 0.4, scale: 2 }, dragonflychest: { offset: 0.1, scale: 1.4 },
  saltbox: { offset: 0.3, scale: 1.3 }, pighouse: { offset: 1.5, scale: 2.2 },
  mushroom_light: { offset: 1.2, scale: 1.8 }, mushroom_light2: { offset: 1.2, scale: 1.8 },
  researchlab: { offset: 0.5, scale: 1.4 }, researchlab2: { offset: 0.5, scale: 1.4 },
  researchlab3: { offset: 0.5, scale: 1.4 }, researchlab4: { offset: 0.5, scale: 1.3 },
  yellowstaff: { offset: 0.4, scale: 1 }, opalstaff: { offset: 0.4, scale: 1 }, greenstaff: { offset: 0.4, scale: 1 }, firestaff: { offset: 0.4, scale: 1 },
  trident: { offset: 0.4, scale: 1 },
  shovel: { offset: 0.2, scale: 1 }, featherhat: { offset: 0.1, scale: 1.1 },
  wormhole: { scale: 1.3 },
  wall_moonrock: { offset: 0.2, scale: 1.2 },
  wall_ruins: { offset: 0.2, scale: 1.3 }, wall_stone: { offset: 0.2, scale: 1.3 },
  fence: { offset: 0.1, scale: 1.2 },
};

export function reskinEffectSound(toolSkinId?: string): SoundEventPath {
  return toolSkinId === 'reskin_tool_brush' ? 'terraria1/skins/spectrepaintbrush'
    : 'dontstarve/common/together/reskin_tool';
}

type CreateEffectSprite = Awaited<ReturnType<typeof preloadSharedArchiveSprite>>;

/** A logical FX request: the receiving target supplies its own prefab and ground-contact position. */
class ReskinFx implements ReskinFxMessage {
  private played = false;
  readonly footPosition = new Vector3();
  readonly instance: PrefabInstance;
  private readonly toolSkinId?: string;

  constructor(instance: PrefabInstance, toolSkinId?: string) { this.instance = instance; this.toolSkinId = toolSkinId; }

  play(position: THREE.Vector3, prefabId: string): void {
    if (this.played || this.instance.status.peek() === 'removed') return;
    this.played = true;
    const info = fxInfo[prefabId];
    this.footPosition.copy(position);
    this.instance.position.copy(position);
    this.instance.position.y += (info?.offset ?? 0) * (TILE_SIZE / 4);
    this.instance.scale.setScalar(info?.scale ?? 1);
    this.instance.sprite.setVisible(true);
    this.instance.sprite.playOnce('puff', () => this.instance.remove());
    PlaySound(reskinEffectSound(this.toolSkinId), position);
  }

  dispose(): void { if (!this.played) this.instance.remove(); }
}

/** explode_small.lua: logical one-shot entities; all visual ownership stays in packages/display. */
export class ReskinEffects {
  private readonly assets = new ArchiveSpriteAssets('ground');
  private readonly displays: PrefabDisplayGroup;
  private readonly prepared = new Map<string, Promise<CreateEffectSprite>>();
  private readonly effects = new Set<ReskinFx>();
  private disposed = false;

  constructor(scene: THREE.Scene) { this.displays = new PrefabDisplayGroup(scene); }

  async prepare(toolSkinId?: string): Promise<ReskinFxMessage> {
    if (this.disposed) throw new Error('Reskin effects have been disposed');
    const key = toolSkinId ?? '';
    const skinArchive = toolSkinId ? GROUND_ITEM_DEFINITIONS.reskin_tool.skinArchives[toolSkinId] : undefined;
    if (toolSkinId && !skinArchive) throw new Error(`Unknown reskin tool skin: ${toolSkinId}`);
    let request = this.prepared.get(key);
    if (!request) {
      request = preloadSharedArchiveSprite(this.assets, {
        animationArchive: 'reskin_tool_fx.zip', bank: 'fx_shadow_dust',
        buildArchives: ['reskin_tool_fx.zip', ...skinArchive ? [skinArchive] : []],
      });
      this.prepared.set(key, request);
      void request.catch(() => this.prepared.delete(key));
    }
    const create = await request;
    if (this.disposed) throw new Error('Reskin effects have been disposed');
    const prefab = toolSkinId ? `explode_${toolSkinId.replace('_tool', '')}` : 'explode_reskin';
    const sprite = new SpriteState({ name: 'puff', held: true, billboard: true });
    const instance = new PrefabInstance(prefab, sprite);
    instance.addTag('FX');
    instance.persists = false;
    sprite.setVisible(false);
    sprite.setLightOverride(toolSkinId ? 0 : 1);
    if (skinArchive) sprite.setSymbolOverride('shadow_dust', skinArchive);
    const effect = new ReskinFx(instance, toolSkinId);
    const display = this.displays.add({ name: prefab, status: instance.status, sprite, light: instance.light,
      archive: { create: clip => create(clip.name, clip.loop) } }, effect.footPosition);
    bindInstance(display.model, instance);
    this.effects.add(effect);
    return effect;
  }

  get renderEntities() { return this.displays.renderEntities; }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    this.displays.update(Math.min(dt, 0.1), cameraQuaternion);
    for (const effect of this.effects) if (effect.instance.status.peek() === 'removed') this.effects.delete(effect);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const effect of this.effects) effect.instance.remove();
    this.effects.clear();
    this.displays.dispose();
    this.assets.dispose();
    this.prepared.clear();
  }
}

/** reskin_tool.lua onequip: swap_reskin_tool, or the skin's, named on the owner's AnimState. */
export const reskinToolVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('reskin_tool', GROUND_ITEM_DEFINITIONS.reskin_tool.skinArchives, item.skinId);
  return handEquipmentVisual(item, [...skin ? [skin] : [], 'swap_reskin_tool'], 'swap_reskin_tool');
};
