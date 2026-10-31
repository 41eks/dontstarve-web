import type * as THREE from 'three';
import type { Pickable } from './components/pickable';
import { PickablePlantManager, type PickablePlantDefinition, type PickablePlantRecord } from './pickablePlant';

export const BERRYBUSH_ID = 'berrybush' as const;
export const BERRYBUSH_REGROW_TIME = 3 * 480;
// Maximum before the fifth (final) transplanted pick: 3 days + 4 half-days + 2 days variance.
export const BERRYBUSH_MAX_REGROW_TIME = BERRYBUSH_REGROW_TIME + 4 * 240 + 960;
export const BERRYBUSH_SKINS = ['berrybush_cawnival', 'berrybush_mystical', 'berrybush_swamp'] as const;
const BERRY_LAYERS = ['berries', 'berriesmore', 'berriesmost'] as const;

/** berrybush.lua getregentimefn_normal: evaluate randomness only when starting a new regrowth task. */
export function berrybushRegrowTime(pickable: Pickable): number {
  const maximum = pickable.maximumCycles!;
  return BERRYBUSH_REGROW_TIME + 240 * Math.max(0, maximum - (pickable.cyclesLeft ?? maximum)) + 960 * Math.random();
}

export const BERRYBUSH_DEFINITION: PickablePlantDefinition = {
  prefab: BERRYBUSH_ID, animArchive: 'berrybush.zip', buildArchive: 'berrybush.zip',
  minimapIcon: 'berrybush.png',
  archiveSprite: { bank: 'berrybush', instancedAnimations: 'all' },
  tags: ['bush', 'plant', 'renewable', 'lunarplant_target', 'witherable', 'SnowCovered', 'blocker'],
  product: 'berries', regrowTime: BERRYBUSH_REGROW_TIME, getRegenTime: berrybushRegrowTime,
  idle: { name: 'idle', randomFrame: true }, picked: { clips: ['picked', 'idle'] },
  empty: { name: 'idle', frame: 'first' }, grow: 'grow', barren: 'dead',
  dugLoot: 'dug_berrybush', extraLoot: ['twigs', 'twigs'], maxCycles: () => 4 + Math.floor(Math.random() * 2),
  witherable: true, burnTime: 30, burnFxLevel: 4, propagatorSize: 'medium', deploySmartRadius: 3,
  physicsRadius: .1, snowCovered: true,
  skins: BERRYBUSH_SKINS, dugSkins: BERRYBUSH_SKINS.map(skin => `dug_${skin}`),
  digLoot: (instance, pickable, withered) => withered || pickable.IsBarren()
    ? [{ prefab: 'twigs' }, { prefab: 'twigs' }]
    : [...pickable.canBePicked ? [{ prefab: 'berries' }] : [],
      { prefab: 'dug_berrybush', skinId: instance.skinId ? `dug_${instance.skinId}` : undefined }],
  createAppearance: context => {
    const setBerries = (percent?: number) => {
      const layer = percent === undefined ? undefined : percent >= .9 ? 'berriesmost' : percent >= .33 ? 'berriesmore' : 'berries';
      for (const name of BERRY_LAYERS) {
        if (name === layer) context.animation.showLayer(name); else context.animation.hideLayer(name);
      }
    };
    const full = (pickable: Pickable) => {
      setBerries(pickable.canBePicked ? (pickable.cyclesLeft ?? pickable.maximumCycles!) / pickable.maximumCycles! : undefined);
    };
    return {
      restore: full,
      picked: pickable => {
        if (pickable.IsBarren()) { context.play(['idle_to_dead', 'dead']); setBerries(); }
        else context.play(['picked', 'idle'], false, () => setBerries());
      },
      regen: pickable => { context.play(['grow', 'idle'], true); full(pickable); },
      empty: () => {
        if (context.instance.hasTag('withered') || context.animation.currentAnimation === 'dead') {
          context.play(['dead_to_idle', 'idle']);
        } else context.play(['idle'], true);
        setBerries();
      },
      barren: () => {
        if (context.instance.hasTag('withered') || context.animation.currentAnimation === 'idle') {
          context.play(['idle_to_dead', 'dead']);
        } else context.play(['dead']);
        setBerries();
      },
      transplant: () => { context.play(['dead']); setBerries(); },
    };
  },
};

/** The normal berrybush branch; berrybush2 and juicy bushes are separate source prefabs. */
export class BerrybushManager extends PickablePlantManager {
  spawn(position: THREE.Vector3, saved?: PickablePlantRecord): THREE.Group {
    return this.spawnPlant(BERRYBUSH_DEFINITION, position, saved);
  }
  /** dug_berrybush ondeploy: SpawnPrefab with the dug skin's bush skin, then OnTransplant; the display loads the art. */
  transplant(position: THREE.Vector3, dugSkinId?: string): boolean {
    const model = this.spawnPlant(BERRYBUSH_DEFINITION, position, undefined, dugSkinId?.replace(/^dug_/, ''));
    this.getInstance(model)!.components.pickable.OnTransplant();
    return true;
  }
  exportRecords(): PickablePlantRecord[] { return this.exportPlants().map(({ record }) => record); }
}
