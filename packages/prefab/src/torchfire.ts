import type { VfxJson } from '@dontstarve-web/display';

/** torchfire.lua master_postinit: fx_offset is the FollowSymbol y offset, in animation pixels (y grows down). */
export const TORCH_FIRE_OFFSET_Y = -110;

const int = (r: number, g: number, b: number, a: number) => [r / 255, g / 255, b / 255, a / 255] as const;
const SMOKE_MAX_SCALE = 1.25;
const FIRE_MAX_SCALE = 3;

/**
 * torchfire.lua common_postinit: the VFXEffect's smoke and fire emitters, their envelopes, EmitterManager rates and
 * emit_fn. The entity follows the holder's swap_object symbol; the holder's display draws it.
 */
export const TORCH_FIRE_VFX: VfxJson = {
  emitters: [{
    texture: 'fx/smoke.tex', maxParticles: 64, maxLifetime: .7, blendMode: 'premultiplied', uvFrameWidth: .25, sortOffset: 1,
    colourEnvelope: [[0, int(35, 32, 30, 0)], [.3, int(35, 32, 30, 100)], [.55, int(30, 30, 30, 28)], [1, int(30, 30, 30, 0)]],
    scaleEnvelope: [[0, [SMOKE_MAX_SCALE * .4, SMOKE_MAX_SCALE * .4]], [.5, [SMOKE_MAX_SCALE * .6, SMOKE_MAX_SCALE * .6]],
      [.65, [SMOKE_MAX_SCALE * .9, SMOKE_MAX_SCALE * .9]], [1, [SMOKE_MAX_SCALE, SMOKE_MAX_SCALE]]],
    // smoke_num_particles_to_emit = -50 is the start delay.
    particlesPerSecond: 80, initialCount: -50,
    sphereRadius: .05, velocity: [0, .05, 0], velocitySpread: [.01, 0, .01], lifetime: [.9, .1],
  }, {
    texture: 'fx/torchfire.tex', maxParticles: 64, maxLifetime: .3, blendMode: 'additive', uvFrameWidth: .25, sortOffset: 2,
    colourEnvelope: [[0, int(187, 111, 60, 128)], [.49, int(187, 111, 60, 128)], [.5, int(255, 255, 0, 128)],
      [.51, int(255, 30, 56, 128)], [.75, int(255, 30, 56, 128)], [1, int(255, 7, 28, 0)]],
    scaleEnvelope: [[0, [FIRE_MAX_SCALE * .5, FIRE_MAX_SCALE]], [1, [FIRE_MAX_SCALE * .5 * .5, FIRE_MAX_SCALE * .5]]],
    particlesPerSecond: 40, initialCount: 1,
    sphereRadius: .05, velocity: [0, 0, 0], velocitySpread: [.01, 0, .01], lifetime: [.9, .1],
  }],
};
