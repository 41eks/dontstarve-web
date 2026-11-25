import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import { createEffect, createMemo, createSignal, readonlySignal, WorldContentKey } from '@dontstarve-web/signals';
import type { GetWatchWorldContent, ReadonlySignal } from '@dontstarve-web/signals';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Hauntable, HAUNT_COOLDOWN_MEDIUM } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/inspectable';
import { LootDropper } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { buildingPlacer, buildingPrefab, SaveBuilding, type BuildingDeclaration } from './building';
import { addComponent } from './components';
import definitions from './definitions.json' with { type: 'json' };
import { FliesController } from './flies';
import {
  STICK_HEAD_CONFIG,
  type OnFinish as OnFinishCallback,
  type OnFinishHaunt as OnFinishHauntCallback,
  type OnFullMoon as OnFullMoonCallback,
  type OnHaunt as OnHauntCallback,
  type OnWorked as OnWorkedCallback,
  type onload as OnLoadCallback,
  type onsave as OnSaveCallback,
} from './generated/stickheads.schema';
import { createArchiveEntity, PrefabInstance, type PrefabComponents } from './prefabInstance';
import { PlaySound } from './sound';
import { DefaultBurntStructureFn, onloadBurnt, onsaveBurnt } from './standardcomponents';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import type { ReadonlyVector3 } from './transform';
import { BurnableBinding } from './treeFire';
import type { PrefabWorldContext } from './worldContext';

export const PIG_HEAD_ID = 'pighead' as const;
export type PigHeadId = typeof PIG_HEAD_ID;
export const MERM_HEAD_ID = 'mermhead' as const;
export type MermHeadId = typeof MERM_HEAD_ID;
type StickHeadId = PigHeadId | MermHeadId;

const SHOWN = readonlySignal(createSignal(true));
/** tuning.lua HAUNT_TINY. */
const HAUNT_TINY = 1;

export class StickHeadInstance extends PrefabInstance {
  declare readonly prefab: StickHeadId;
  declare readonly components: PrefabComponents & {
    lootdropper: LootDropper;
    hauntable: Hauntable;
  };
  /** The head's temporary awake state is set by the moon and haunt callbacks. */
  awake?: true;
  flies?: PrefabInstance;
  scrapbook_anim?: string;
  /** The tile-gated value of TheWorld.state.isfullmoon. */
  fullMoon?: ReadonlySignal<boolean>;

  constructor(id: StickHeadId, world: PrefabWorldContext, position: ReadonlyVector3, sprites: SpriteResources) {
    const { idleAnimation } = STICK_HEAD_CONFIG[id];
    super(id, new SpriteState({ name: idleAnimation, billboard: true, held: true }));
    create_common(this, world, position, sprites);
  }
}

const OnFinish: OnFinishCallback = inst => {
  const { burnable, lootdropper } = inst.components;
  if (burnable?.IsBurning()) {
    burnable.Extinguish();
  }
  inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
  if (inst.fullMoon?.peek()) {
    lootdropper.SpawnLootPrefab('nightmarefuel');
  }
  lootdropper.DropLoot();
  inst.remove();
};

const OnWorked: OnWorkedCallback = inst => {
  if (!inst.hasTag('burnt')) {
    const { idleAwake, idleAnimation } = STICK_HEAD_CONFIG[inst.prefab];
    inst.sprite.playOnce('hit');
    inst.sprite.pushAnimation(inst.awake ? idleAwake : idleAnimation, true);
  }
};

const OnFullMoon: OnFullMoonCallback = (inst, isfullmoon) => {
  if (!inst.hasTag('burnt')) {
    const { wakeAnimation, idleAwake, idleAnimation } = STICK_HEAD_CONFIG[inst.prefab];
    if (isfullmoon) {
      if (!inst.awake) {
        inst.awake = true;
        inst.sprite.playOnce(wakeAnimation);
        inst.sprite.pushAnimation(idleAwake, false);
      }
    } else if (inst.awake) {
      inst.awake = undefined;
      inst.sprite.playOnce('sleep');
      inst.sprite.pushAnimation(idleAnimation, false);
    }
  }
};

const onsave: OnSaveCallback = (inst, data) => {
  SaveBuilding(inst, data);
  onsaveBurnt(inst, data);
};

const onload: OnLoadCallback = (inst, data) => {
  onloadBurnt(inst, data);
};

const OnFinishHaunt: OnFinishHauntCallback = inst => {
  if (inst.awake && !(inst.fullMoon?.peek() || inst.hasTag('burnt'))) {
    inst.awake = undefined;
    inst.sprite.playOnce('sleep');
    inst.sprite.pushAnimation(STICK_HEAD_CONFIG[inst.prefab].idleAnimation, false);
  }
};

const OnHaunt: OnHauntCallback = inst => {
  if (!(inst.awake || inst.hasTag('burnt'))) {
    const { wakeAnimation, idleAwake } = STICK_HEAD_CONFIG[inst.prefab];
    inst.awake = true;
    inst.sprite.playOnce(wakeAnimation);
    inst.sprite.pushAnimation(idleAwake, true);
    inst.DoTaskInTime(4, OnFinishHaunt);
    inst.components.hauntable.SetHauntValue(HAUNT_TINY);
    return true;
  }
  return false;
};

/** SpawnChild("flies"): the child follows the head's tile activity and owns its own animation and audio. */
function spawnFlies(
  inst: StickHeadInstance,
  sprites: SpriteResources,
  scheduler: GameTimeScheduler,
  getWatchWorldContent?: GetWatchWorldContent,
): PrefabInstance {
  const { child } = STICK_HEAD_CONFIG[inst.prefab];
  const source = sprites.archive(
    { animationArchive: 'flies.zip', buildArchives: ['flies.zip'], bank: 'flies' },
    { dynamicParent: true, pickable: false },
  );
  const flies = createArchiveEntity(
    child,
    source,
    { name: 'swarm_pre', billboard: true },
    child,
    entity => {
      entity.persists = false;
    },
    inst.status,
  );
  inst.AddChild(flies.instance);
  inst.sprite.attachFx(child, {
    sprite: flies.instance.sprite,
    display: flies.display,
    active: SHOWN,
    sortLayer: 2,
  });
  const controller = new FliesController(flies.instance, inst.position, scheduler, getWatchWorldContent);
  flies.instance.onRemove(() => controller.dispose());
  inst.onRemove(() => inst.sprite.detachFx(child));
  return flies.instance;
}

/** worldstate.lua: isfullmoon = isnight and moonphase == "full". */
function watchFullMoon(inst: StickHeadInstance, world: PrefabWorldContext): void {
  if (!world.getWatchWorldContent) {
    return;
  }
  const stopOnRemove = (stop: () => void) => inst.onRemove(stop);
  const area = inst.transform.getTileActivity(world.tickingarea, stopOnRemove);
  const options = area ? { active: area } : undefined;
  const moon = world.getWatchWorldContent(WorldContentKey.Moon, stopOnRemove, options);
  const cycle = world.getWatchWorldContent(WorldContentKey.Cycle, stopOnRemove, options);
  const fullMoon = createMemo(() => moon.get().phase === 'full' && cycle.get() === 'night');
  inst.fullMoon = fullMoon;
  const stop = createEffect(() => OnFullMoon(inst, fullMoon.get()));
  inst.onRemove(() => {
    stop();
    fullMoon.dispose();
  });
}

function create_common(
  inst: StickHeadInstance,
  world: PrefabWorldContext,
  position: ReadonlyVector3,
  sprites: SpriteResources,
): void {
  const { fire, scheduler } = world;
  if (!fire || !scheduler) {
    throw new Error("A stick head needs the world's fire effects and scheduler");
  }
  const config = STICK_HEAD_CONFIG[inst.prefab];
  inst.BindWorld(world);
  inst.setPosition(position.x, 0, position.z);
  inst.BindScheduler(scheduler);
  inst.AddSoundEmitter();
  for (const tag of config.tags) {
    inst.addTag(tag);
  }
  inst.scrapbook_anim = config.idleAnimation;

  addComponent(inst, 'lootdropper', LootDropper, spawnStructureLoot(inst), STRUCTURE_LOOT_RECIPES);
  addComponent(inst, 'inspectable', Inspectable);
  inst.flies = spawnFlies(inst, sprites, scheduler, world.getWatchWorldContent);

  const workable = addComponent(inst, 'workable', Workable<StickHeadInstance>);
  workable.SetWorkAction(config.workable.action);
  workable.SetWorkLeft(config.workable.workLeft);
  workable.SetOnWorkCallback(OnWorked);
  workable.SetOnFinishCallback(OnFinish);

  const burn = new BurnableBinding(
    inst,
    {
      ...config.burnable,
      propagator: 'small',
      onExtinguish: () => PlaySound('dontstarve/common/fireOut', inst.position),
      onBurnt: () => {
        DefaultBurntStructureFn(inst);
        burn.dispose();
      },
    },
    { fire, scheduler },
  );

  inst.OnSave = onsave;
  inst.OnLoad = onload;
  watchFullMoon(inst, world);

  const hauntable = addComponent(inst, 'hauntable', Hauntable, scheduler);
  hauntable.SetCooldown(HAUNT_COOLDOWN_MEDIUM);
  hauntable.SetOnHauntFn(OnHaunt);
}

function create_pighead(
  world: PrefabWorldContext,
  position: ReadonlyVector3,
  sprites: SpriteResources,
): StickHeadInstance {
  return new StickHeadInstance(PIG_HEAD_ID, world, position, sprites);
}

function create_mermhead(
  world: PrefabWorldContext,
  position: ReadonlyVector3,
  sprites: SpriteResources,
): StickHeadInstance {
  return new StickHeadInstance(MERM_HEAD_ID, world, position, sprites);
}

function buildingDeclaration(id: StickHeadId): BuildingDeclaration {
  const { archive, idleAnimation } = STICK_HEAD_CONFIG[id];
  return { ...definitions.animatedBuildings[id], archive, idleAnimation };
}

const DECLARATIONS = {
  [PIG_HEAD_ID]: buildingDeclaration(PIG_HEAD_ID),
  [MERM_HEAD_ID]: buildingDeclaration(MERM_HEAD_ID),
};

export const STICK_HEAD_PLACERS = {
  [PIG_HEAD_ID]: buildingPlacer(DECLARATIONS[PIG_HEAD_ID], STICK_HEAD_CONFIG[PIG_HEAD_ID].bank),
  [MERM_HEAD_ID]: buildingPlacer(DECLARATIONS[MERM_HEAD_ID], STICK_HEAD_CONFIG[MERM_HEAD_ID].bank),
};

export function stickHeadPrefabs(world: PrefabWorldContext) {
  return {
    [PIG_HEAD_ID]: buildingPrefab(
      DECLARATIONS[PIG_HEAD_ID],
      STICK_HEAD_CONFIG[PIG_HEAD_ID].bank,
      undefined,
      (position, sprites) => create_pighead(world, position, sprites),
      world,
    ),
    [MERM_HEAD_ID]: buildingPrefab(
      DECLARATIONS[MERM_HEAD_ID],
      STICK_HEAD_CONFIG[MERM_HEAD_ID].bank,
      undefined,
      (position, sprites) => create_mermhead(world, position, sprites),
      world,
    ),
  };
}
