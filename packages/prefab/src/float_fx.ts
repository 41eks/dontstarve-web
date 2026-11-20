import { createRenderEffect, createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { SpriteResources } from '@dontstarve-web/display';
import type { Floater } from '../../componets/src/floater';
import { createArchiveEntity, type PrefabInstance } from './prefabInstance';

const SHOWN = readonlySignal(createSignal(true));
/** TUNING.OCEAN_SHADER.EFFECT_TINT_AMOUNT: how far the effects under floating items take the ocean's colour. */
const EFFECT_TINT_AMOUNT = 0.6;

/** float_fx.lua: build float_fx, bank float_front or float_back. */
function floatFxSource(sprites: SpriteResources, bank: 'float_front' | 'float_back') {
  return sprites.archive(
    { animationArchive: 'float_fx.zip', buildArchives: ['float_fx.zip'], bank },
    { dynamicParent: true },
  );
}

/**
 * floater.lua OnLandedClient / OnNoLongerLandedClient: while the item floats, float_fx_front and float_fx_back loop
 * their idle_front_<size> / idle_back_<size> ripples on it, raised by the floater's vertical offset, scaled by its
 * scale and tinted by the ocean (SetOceanBlendParams); the back one is drawn behind the item (LAYER_BACKGROUND). The
 * item itself bobs and is cut at the waterline (SetFloatParams(-0.05, 1.0, bob_percent)), until it stops floating
 * (SetFloatParams(0, 0, 0)). `unitScale` converts DST units to scene units.
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
      instance.AnimState.SetOceanBlendParams(EFFECT_TINT_AMOUNT);
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
      inst.AnimState.SetFloatParams(-0.05, 1.0, floater.bob_percent);
    } else if (!floating && shown) {
      shown();
      shown = undefined;
      inst.AnimState.SetFloatParams(0.0, 0.0, 0.0);
    }
  });
  inst.onRemove(() => {
    stop();
    shown?.();
    shown = undefined;
  });
}
