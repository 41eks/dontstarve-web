import { createRenderEffect, createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { SpriteResources } from '@dontstarve-web/display';
import type { Floater } from '../../componets/src/floater';
import { createArchiveEntity, type PrefabInstance } from './prefabInstance';

const SHOWN = readonlySignal(createSignal(true));

/** float_fx.lua: build float_fx, bank float_front or float_back. */
function floatFxSource(sprites: SpriteResources, bank: 'float_front' | 'float_back') {
  return sprites.archive(
    { animationArchive: 'float_fx.zip', buildArchives: ['float_fx.zip'], bank },
    { dynamicParent: true },
  );
}

/**
 * floater.lua OnLandedClient / OnNoLongerLandedClient: while the item floats, float_fx_front and float_fx_back loop
 * their idle_front_<size> / idle_back_<size> ripples on it, raised by the floater's vertical offset and scaled by its
 * scale; the back one is drawn behind the item (LAYER_BACKGROUND). AnimState:SetFloatParams' bobbing and
 * SetOceanBlendParams have no display counterpart and are skipped. `unitScale` converts DST units to scene units.
 */
export function bindFloatFx(inst: PrefabInstance, floater: Floater, sprites: SpriteResources, unitScale: number): void {
  let shown: (() => void) | undefined;
  const show = () => {
    const effects = (['front', 'back'] as const).map(side => {
      const prefab = `float_fx_${side}`;
      const clip = `idle_${side}_${floater.size}`;
      const { instance, display } = createArchiveEntity(
        prefab,
        floatFxSource(sprites, side === 'front' ? 'float_front' : 'float_back'),
        { name: clip, billboard: true },
        prefab,
        fx => {
          fx.persists = false;
          for (const tag of ['NOBLOCK', 'FX', 'ignorewalkableplatforms']) {
            fx.addTag(tag);
          }
        },
        inst.status,
      );
      instance.sprite.start(clip);
      // Floater:AttachEffect: Transform:SetPosition(0, vert_offset or 0, 0) and the floater's scale.
      instance.sprite.setVisualHeight((floater.vert_offset ?? 0) * unitScale);
      instance.setScale(floater.xscale, floater.yscale, floater.zscale);
      const key = prefab;
      inst.sprite.attachFx(key, {
        sprite: instance.sprite,
        display,
        active: SHOWN,
        sortLayer: side === 'front' ? 2 : 0,
      });
      return () => {
        inst.sprite.detachFx(key);
        instance.remove();
        display.dispose();
      };
    });
    return () => effects.forEach(remove => remove());
  };
  const stop = createRenderEffect(() => {
    const floating = floater.floating.get();
    if (floating && !shown) {
      shown = show();
    } else if (!floating && shown) {
      shown();
      shown = undefined;
    }
  });
  inst.onRemove(() => {
    stop();
    shown?.();
    shown = undefined;
  });
}
