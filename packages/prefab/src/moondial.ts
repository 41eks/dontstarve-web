import { AnimState as SymbolState } from '@dontstarve-web/animation/animState';
import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import {
  createEffect,
  WorldContentKey,
  type ReadonlySignal,
  type WorldMoonState,
  type WorldPhase,
} from '@dontstarve-web/signals';
import { AnimState } from '../../componets/src/animstate';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Hauntable, HAUNT_COOLDOWN_SMALL } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/inspectable';
import { LootDropper } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { MoondialStateGraph, type MoondialStateInst } from '../../stategraphs/src/SGmoondial';
import { animationLengths } from './animationTimings';
import { buildingPlacer, buildingPrefab, MakeBuildingPersist, type BuildingDeclaration } from './building';
import { addComponent } from './components';
import definitions from './definitions.json' with { type: 'json' };
import {
  MOONDIAL_CONFIG,
  type getstatus as GetStatusCallback,
  type onhammered as OnHammeredCallback,
  type onmoonphasechagned as MoonPhaseCallback,
} from './generated/moondial.schema';
import { PrefabInstance } from './prefabInstance';
import { PlaySound } from './sound';
import type { SoundEmitter } from './soundEmitter';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import { WORLD_SCALE } from './tile';
import type { PrefabWorldContext } from './worldContext';

export const MOONDIAL_ID = 'moondial' as const;
export type MoondialId = typeof MOONDIAL_ID;

const declaration: BuildingDeclaration = {
  ...definitions.animatedBuildings.moondial,
  archive: MOONDIAL_CONFIG.archive,
  buildArchive: MOONDIAL_CONFIG.buildArchive,
  idleAnimation: MOONDIAL_CONFIG.idleAnimation,
};
export const MOONDIAL_SKIN_ARCHIVES: Readonly<Record<string, string>> = declaration.skinArchives!;
export const MOONDIAL_PLACER = buildingPlacer(declaration, MOONDIAL_CONFIG.bank);
const LENGTHS = animationLengths(MOONDIAL_CONFIG.archive);

export class MoondialInstance extends PrefabInstance implements MoondialStateInst {
  declare readonly components: PrefabInstance['components'] & { lootdropper: LootDropper };
  declare SoundEmitter: SoundEmitter;
  declare sg: ReturnType<typeof MoondialStateGraph>;
  readonly animstate: AnimState;
  readonly symbols = new SymbolState();
  moon?: ReadonlySignal<WorldMoonState>;
  cycle?: ReadonlySignal<WorldPhase>;
  scrapbook_anim?: string;

  constructor(world: PrefabWorldContext, sprites: SpriteResources) {
    super(MOONDIAL_ID, new SpriteState({ name: MOONDIAL_CONFIG.idleAnimation, billboard: true }));
    const scheduler = world.scheduler ?? new GameTimeScheduler();
    if (!world.scheduler) {
      this.onRemove(() => scheduler.dispose());
    }
    this.animstate = new AnimState(scheduler, LENGTHS, event => this.PushEvent(event));
    this.onRemove(() => this.animstate.dispose());
    fn(this, world, sprites, scheduler);
  }
}

const onmoonphasechagned: MoonPhaseCallback = (inst, phase) => {
  const { phase: current, waxing } = inst.moon?.peek() ?? { phase: 'new', waxing: true };
  if ((waxing && current !== 'new') || current === 'full') {
    for (const symbol of MOONDIAL_CONFIG.reflectionSymbols) {
      inst.symbols.ClearOverrideSymbol(symbol);
    }
  } else {
    for (const symbol of MOONDIAL_CONFIG.reflectionSymbols) {
      inst.symbols.OverrideSymbol(symbol, MOONDIAL_CONFIG.reflectionBuild, symbol);
    }
  }
  const { colour, falloff, intensity, phases } = MOONDIAL_CONFIG.light;
  const { override, radius } = phases[current];
  inst.sprite.setLightOverride(override);
  inst.light.set(radius > 0 ? { radius: radius * WORLD_SCALE, falloff, intensity, colour } : null);
  if (phase !== undefined) {
    inst.sg.goToState('next');
  }
};

const onhammered: OnHammeredCallback = inst => {
  inst.components.lootdropper.DropLoot();
  // rock_break_fx.lua has no art. Its local proxy plays the stone-break sound.
  PlaySound('dontstarve/wilson/rock_break', inst.position);
  inst.remove();
};

const getstatus: GetStatusCallback & NonNullable<Inspectable['getstatus']> = (inst: unknown, viewer: unknown) => {
  if (!(inst instanceof MoondialInstance)) {
    return undefined;
  }
  if (inst.worldServices?.isCave) {
    return 'CAVE';
  }
  const moon = inst.moon?.peek();
  if (
    moon?.phase === 'full' &&
    viewer !== null &&
    typeof viewer === 'object' &&
    'hasTag' in viewer &&
    typeof viewer.hasTag === 'function' &&
    viewer.hasTag('wereness')
  ) {
    return 'WEREBEAVER';
  }
  if (inst.cycle?.peek() !== 'night') {
    return 'GENERIC';
  }
  if (!moon || moon.phase === 'new') {
    return 'NIGHT_NEW';
  }
  if (moon.phase === 'full') {
    return 'NIGHT_FULL';
  }
  return moon.waxing ? 'NIGHT_WAX' : 'NIGHT_WANE';
};

function fn(
  inst: MoondialInstance,
  world: PrefabWorldContext,
  sprites: SpriteResources,
  scheduler: GameTimeScheduler,
): void {
  inst.BindWorld(world);
  inst.BindScheduler(scheduler);
  inst.AddSoundEmitter();
  inst.deploySmartRadius = MOONDIAL_CONFIG.deployRadius * WORLD_SCALE;
  for (const tag of MOONDIAL_CONFIG.tags) {
    inst.addTag(tag);
  }
  inst.scrapbook_anim = MOONDIAL_CONFIG.idleAnimation;
  inst.sprite.setAnimState(inst.symbols.json, sprites.archives);

  // The map already follows this entity's transform and draws its icon above fog.
  inst.minimap.SetIcon(MOONDIAL_CONFIG.minimap.icon);
  inst.minimap.SetCanUseCache(MOONDIAL_CONFIG.minimap.cache);
  inst.minimap.SetDrawOverFogOfWar(MOONDIAL_CONFIG.minimap.overFog);

  const hauntable = addComponent(inst, 'hauntable', Hauntable, scheduler);
  hauntable.SetCooldown(HAUNT_COOLDOWN_SMALL);
  hauntable.SetOnHauntFn(() => false); // MakeHauntableWork's work callback is commented out in Lua.

  const workable = addComponent(inst, 'workable', Workable<MoondialInstance>);
  workable.SetWorkAction(MOONDIAL_CONFIG.workable.action);
  workable.SetWorkLeft(MOONDIAL_CONFIG.workable.workLeft);
  workable.SetOnFinishCallback(onhammered);

  addComponent(inst, 'inspectable', Inspectable).getstatus = getstatus;
  addComponent(inst, 'lootdropper', LootDropper, spawnStructureLoot(inst), STRUCTURE_LOOT_RECIPES);

  const cleanup = (stop: () => void) => inst.onRemove(stop);
  inst.moon = world.getWatchWorldContent?.(WorldContentKey.Moon, cleanup);
  inst.cycle = world.getWatchWorldContent?.(WorldContentKey.Cycle, cleanup);
  inst.SetStateGraph(entity => MoondialStateGraph(entity, scheduler));
  MakeBuildingPersist(inst);

  // The constructor applies the initial look. Later phase changes enter SGmoondial's next state.
  let previousPhase = inst.moon?.peek().phase;
  inst.onRemove(
    createEffect(() => {
      const phase = inst.moon?.get().phase;
      const changed = phase !== previousPhase;
      previousPhase = phase;
      onmoonphasechagned(inst, changed ? phase : undefined);
    }),
  );
}

export function moondialPrefabs(world: PrefabWorldContext) {
  return {
    [MOONDIAL_ID]: buildingPrefab(
      declaration,
      MOONDIAL_CONFIG.bank,
      MOONDIAL_CONFIG.physicsRadius,
      (_position, sprites) => new MoondialInstance(world, sprites),
      world,
    ),
  };
}
