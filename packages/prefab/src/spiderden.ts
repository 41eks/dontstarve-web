import { definePrefabIds } from './prefabRegistration';
import { SpriteState } from '@dontstarve-web/display';
import { WorldContentKey, type GetWatchWorldContent } from '@dontstarve-web/signals';
import { Bedazzlement } from '../../componets/src/bedazzlement';
import { Burnable } from '../../componets/src/burnable';
import { ChildSpawner, type ChildSpawnerChild } from '../../componets/src/childspawner';
import { Combat } from '../../componets/src/combat';
import { Freezable } from '../../componets/src/freezable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Growable, type GrowthStage } from '../../componets/src/growable';
import { Hauntable, HAUNT_COOLDOWN_MEDIUM } from '../../componets/src/hauntable';
import { Health } from '../../componets/src/health';
import { Inspectable } from '../../componets/src/inspectable';
import { LootDropper } from '../../componets/src/lootdropper';
import { Propagator, PROPAGATOR_CANT_TAGS } from '../../componets/src/propagator';
import { Shaveable } from '../../componets/src/shaveable';
import { SleepingBag } from '../../componets/src/sleepingbag';
import { UPGRADETYPES, Upgradeable } from '../../componets/src/upgradeable';
import { WorldSettingsTimer } from '../../componets/src/atriumGateSignatures';
import { Workable } from '../../componets/src/workable';
import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { type EntityPersistData, structureHealth } from './saveRecord';
import { MakeMediumFreezableCharacter, MakeObstaclePhysics } from './standardcomponents';
import { TILE_SIZE } from './tile';

export const SPIDERDEN_ID = 'spiderden' as const;
/**
 * spiderden.lua assets: spider_cocoon.zip holds the bank and build. The SOUND and MINIMAP_IMAGE entries need no archive
 * here; the icon comes from the mirrored minimap atlas. frozen.zip is not declared: the OnFreeze / OnThaw callbacks that
 * override `swap_frozen` are not ported.
 */
export const SPIDERDEN_ARCHIVES = ['spider_cocoon.zip'];
const SPIDERDEN_BANK = 'spider_cocoon';

/** tuning.lua SPIDERDEN_SPIDERS, SPIDERDEN_EMERGENCY_WARRIORS, SPIDERDEN_EMERGENCY_RADIUS and SPIDERDEN_HEALTH. */
const SPIDERDEN_SPIDERS = [3, 6, 9] as const;
const SPIDERDEN_EMERGENCY_WARRIORS = [0, 4, 8] as const;
const SPIDERDEN_EMERGENCY_RADIUS = [10, 15, 20] as const;
export const SPIDERDEN_HEALTH = [250, 500, 1000] as const;
const SPRING_COMBAT_MOD = 1.33;
const SPRING_GROWTH_MODIFIER = 0.75;
/** tuning.lua SPIDERDEN_REGEN_TIME (3 * seg_time) and SPIDERDEN_RELEASE_TIME. */
const SPIDERDEN_REGEN_TIME = 90;
const SPIDERDEN_RELEASE_TIME = 5;
/** tuning.lua SPIDERDEN_GROW_TIME and SPIDERDEN_GROW_TIME_QUEEN, for day_time = 300. */
const SPIDERDEN_GROW_TIME = [2400, 2400, 6000] as const;
const SPIDERDEN_GROW_TIME_QUEEN = 6000;
/** The sleepingbag values AddSleepingBag writes: SLEEP_HEALTH_PER_TICK * 1.5, SLEEP_HUNGER_PER_TICK * 1.5, dryingrate. */
const SLEEPINGBAG_HEALTH_TICK = 1.5;
const SLEEPINGBAG_HUNGER_TICK = -1.5;
const SLEEPINGBAG_DRYINGRATE = 1;
const UNIT = TILE_SIZE / 4;

/** What the scene injects into every spider den. */
export interface SpiderdenWorld {
  scheduler: GameTimeScheduler;
  getWatchWorldContent?: GetWatchWorldContent;
}

/** ANIM_DATA's per stage table, as spiderden.lua names the clips. */
interface SpiderdenAnims {
  hit: string;
  hit_combat: string;
  idle: string;
  init: string;
  freeze: string;
  thaw: string;
  bedazzle: string;
  bedazzle_drop_timing: number;
}

const ANIM_DATA = {
  SMALL: {
    hit: 'cocoon_small_hit',
    hit_combat: 'cocoon_small_hit_combat',
    idle: 'cocoon_small',
    init: 'grow_sac_to_small',
    freeze: 'frozen_small',
    thaw: 'frozen_loop_pst_small',
    bedazzle: 'cocoon_small_bedazzled',
    bedazzle_drop_timing: 15,
  },
  MEDIUM: {
    hit: 'cocoon_medium_hit',
    hit_combat: 'cocoon_medium_hit_combat',
    idle: 'cocoon_medium',
    init: 'grow_small_to_medium',
    freeze: 'frozen_medium',
    thaw: 'frozen_loop_pst_medium',
    bedazzle: 'cocoon_medium_bedazzled',
    bedazzle_drop_timing: 20,
  },
  LARGE: {
    hit: 'cocoon_large_hit',
    hit_combat: 'cocoon_large_hit_combat',
    idle: 'cocoon_large',
    init: 'grow_medium_to_large',
    freeze: 'frozen_large',
    thaw: 'frozen_loop_pst_large',
    bedazzle: 'cocoon_large_bedazzled',
    bedazzle_drop_timing: 22,
  },
} as const satisfies Record<string, SpiderdenAnims>;

/** spiderden.lua LOOT_DATA. */
const LOOT_DATA = {
  SMALL: ['silk', 'silk'],
  MEDIUM: ['silk', 'silk', 'silk', 'silk'],
  LARGE: ['silk', 'silk', 'silk', 'silk', 'silk', 'silk', 'spidereggsack'],
} as const;

type SpiderdenChildSpawner<Inst> = ChildSpawner<Inst, ChildSpawnerChild<Inst>>;

/** spiderden.lua fn: the components it adds. */
export class SpiderdenInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    health: Health;
    childspawner: SpiderdenChildSpawner<SpiderdenInstance>;
    worldsettingstimer: WorldSettingsTimer;
    lootdropper: LootDropper;
    burnable: Burnable;
    freezable: Freezable;
    combat: Combat;
    upgradeable: Upgradeable;
    propagator: Propagator;
    growable: Growable;
    inspectable: Inspectable;
    workable: Workable<SpiderdenInstance>;
    hauntable: Hauntable;
    shaveable: Shaveable;
    bedazzlement: Bedazzlement;
    sleepingbag?: SleepingBag;
  };
  /** inst.anims: the clip table of the current growth stage, set by SetSmall / SetMedium / SetLarge. */
  anims!: SpiderdenAnims;
  /** The season the den spawned in, for SpringCombatMod / SpringGrowthMod; there is no season watch. */
  springSeason = false;
  /** spiderden.lua's scrapbook fields; no scrapbook is rendered. */
  scrapbook_anim = 'cocoon_large';
}

/**
 * spiderden.lua has no OnSave; health:OnSave writes the current health, kept as the record's `{ current, maximum }` as
 * the other structures do.
 */
export function saveSpiderdenHealth(
  inst: PrefabInstance & { components: { health: Health } },
  data: EntityPersistData,
): void {
  const { health } = inst.components;
  data.health = { current: health.currenthealth, maximum: health.maxhealth };
}

/** Health of the record's `{ current, maximum }`, after the components loaded the stage's own records. */
export function loadSpiderdenHealth(inst: SpiderdenInstance, data: EntityPersistData): void {
  const saved = structureHealth(data);
  if (saved) {
    inst.components.health.OnLoad({ health: saved.current, maxhealth: saved.maximum });
  }
}

/** SpringCombatMod(amount): the script's seasonal multiplier of the staged child counts. */
function springCombatMod(amount: number, spring: boolean): number {
  return spring ? amount * SPRING_COMBAT_MOD : amount;
}

/**
 * SetStage(inst, stage, skip_anim): the staged clips, max health, children, minimap icon and upgradeable stage.
 * GroundCreepEntity:SetRadius is not wired yet: the world GroundCreep exists, its sources are not attached.
 */
function SetStage(inst: SpiderdenInstance, stage: number, skip_anim = false): void {
  const { childspawner, health, upgradeable } = inst.components;
  if (stage <= 3 && childspawner !== undefined) {
    childspawner.SetMaxChildren(Math.floor(springCombatMod(SPIDERDEN_SPIDERS[stage - 1]!, inst.springSeason)));
    childspawner.SetMaxEmergencyChildren(SPIDERDEN_EMERGENCY_WARRIORS[stage - 1]!);
    childspawner.SetEmergencyRadius(SPIDERDEN_EMERGENCY_RADIUS[stage - 1]!);
    health.SetMaxHealth(SPIDERDEN_HEALTH[stage - 1]!);
    inst.minimap.SetIcon(`spiderden_${stage}.png`);
    if (!skip_anim) {
      inst.AnimState.PlayAnimation(inst.anims.init);
      inst.AnimState.PushAnimation(inst.anims.idle, true);
    }
  }
  // upgradeable:SetStage(stage)
  upgradeable.stage = stage;
}

function SetSmall(inst: SpiderdenInstance): void {
  inst.anims = ANIM_DATA.SMALL;
  SetStage(inst, 1);
  inst.components.lootdropper.SetLoot(LOOT_DATA.SMALL);

  inst.components.burnable?.SetFXLevel(3);
  inst.components.burnable?.SetBurnTime(20);
  inst.components.freezable?.SetShatterFXLevel(3);
  inst.components.freezable?.SetResistance(2);
}

function SetMedium(inst: SpiderdenInstance): void {
  inst.anims = ANIM_DATA.MEDIUM;
  SetStage(inst, 2);
  inst.components.lootdropper.SetLoot(LOOT_DATA.MEDIUM);

  inst.components.burnable?.SetFXLevel(3);
  inst.components.burnable?.SetBurnTime(20);
  inst.components.freezable?.SetShatterFXLevel(4);
  inst.components.freezable?.SetResistance(3);
}

function SetLarge(inst: SpiderdenInstance): void {
  inst.anims = ANIM_DATA.LARGE;
  SetStage(inst, 3);
  inst.components.lootdropper.SetLoot(LOOT_DATA.LARGE);

  inst.components.burnable?.SetFXLevel(4);
  inst.components.burnable?.SetBurnTime(30);
  inst.components.freezable?.SetShatterFXLevel(5);
  inst.components.freezable?.SetResistance(4);
  AddSleepingBag(inst);
}

/**
 * AddSleepingBag: the sleeping bag and its values. onsleep / onwake and SetTemperatureTickFn are the prefab callbacks
 * this port leaves out, so only the component, its ticks and the `tent` tag are set.
 */
function AddSleepingBag(inst: SpiderdenInstance): void {
  const sleepingbag = inst.components.sleepingbag ?? addComponent(inst, 'sleepingbag', SleepingBag);
  sleepingbag.health_tick = SLEEPINGBAG_HEALTH_TICK;
  sleepingbag.hunger_tick = SLEEPINGBAG_HUNGER_TICK;
  sleepingbag.dryingrate = SLEEPINGBAG_DRYINGRATE;
  inst.addTag('tent');
}

/** DoTaskInTime(0): a stage 3 den gets its sleeping bag, as `growable:GetStage() >= 3` in spiderden.lua. */
function addSleepingBagIfLarge(inst: SpiderdenInstance): void {
  if (inst.components.growable.GetStage() >= 3) {
    AddSleepingBag(inst);
  }
}

/** GetSmallGrowTime / GetMedGrowTime / GetLargeGrowTime. */
const GetSmallGrowTime = () => SPIDERDEN_GROW_TIME[0] * (1 + Math.random());
const GetMedGrowTime = () => SPIDERDEN_GROW_TIME[1] * (1 + Math.random());
const GetLargeGrowTime = () => SPIDERDEN_GROW_TIME_QUEEN * (1 + Math.random());

/** growth_stages: the three ported stages. AttemptMakeQueen's queen stage is not declared, so growth stops at 3. */
function growthStages(inst: SpiderdenInstance): readonly GrowthStage[] {
  return [
    { time: () => GetSmallGrowTime(), fn: () => SetSmall(inst) },
    { time: () => GetMedGrowTime(), fn: () => SetMedium(inst) },
    { time: () => GetLargeGrowTime(), fn: () => SetLarge(inst) },
  ];
}

function fn(world: SpiderdenWorld): SpiderdenInstance {
  const inst = new SpiderdenInstance(SPIDERDEN_ID, new SpriteState({ name: 'cocoon_small', billboard: true }));
  inst.BindScheduler(world.scheduler);
  const season = world.getWatchWorldContent?.(WorldContentKey.Season, stop => inst.onRemove(stop))?.value.season;
  inst.springSeason = season === 'spring';
  inst.AddSoundEmitter();
  // MakeObstaclePhysics(inst, inst.physicsradiusoverride): the tag here, the body from the definition's physics.
  inst.physicsRadiusOverride = 0.5;
  inst.addTag('blocker');
  // SetBank / SetBuild("spider_cocoon") and PlayAnimation("cocoon_small", true) are the definition's assets and clip.
  inst.sprite.setSymbolHidden('bedazzled_flare', true);

  inst.addTag('cavedweller');
  inst.addTag('structure');
  inst.addTag('lifedrainable');
  inst.addTag('beaverchewable');
  inst.addTag('hostile');
  inst.addTag('spiderden');
  inst.addTag('bedazzleable');
  inst.addTag('hive');
  inst.addTag('NPC_workable');

  inst.scrapbook_anim = 'cocoon_large';

  addComponent(inst, 'health', Health, undefined, world.scheduler).SetMaxHealth(200);

  const childspawner = addComponent(
    inst,
    'childspawner',
    ChildSpawner<SpiderdenInstance, ChildSpawnerChild<SpiderdenInstance>>,
    world.scheduler,
  );
  childspawner.childname = 'spider';
  childspawner.SetRegenPeriod(SPIDERDEN_REGEN_TIME);
  childspawner.SetSpawnPeriod(SPIDERDEN_RELEASE_TIME);
  // WorldSettings_ChildSpawner_SpawnPeriod / _RegenPeriod add this signature component; their external timers are not
  // ported, and TUNING.SPIDERDEN_ENABLED is true so childreninside is kept.
  addComponent(inst, 'worldsettingstimer', WorldSettingsTimer);
  // childspawner:SetGoHomeFn(OnGoHome) and SetSpawnedFn(onspawnspider) are prefab callbacks, not registered here.
  childspawner.allowboats = true;
  childspawner.emergencychildname = 'spider_warrior'; // TUNING.SPAWN_SPIDER_WARRIORS
  childspawner.emergencychildrenperplayer = 1;
  childspawner.canemergencyspawn = true; // TUNING.SPIDERDEN_ENABLED

  addComponent(inst, 'lootdropper', LootDropper, () => undefined);

  // MakeMediumBurnable(inst), without its fx and callbacks.
  const burnable = addComponent(inst, 'burnable', Burnable, world.scheduler);
  burnable.SetFXLevel(3);
  burnable.SetBurnTime(20);

  // MakeMediumFreezableCharacter(inst), without the shatter fx and the freeze listeners.
  MakeMediumFreezableCharacter(inst, world);

  addComponent(inst, 'combat', Combat, () => world.scheduler.now);

  const upgradeable = addComponent(inst, 'upgradeable', Upgradeable);
  upgradeable.upgradetype = UPGRADETYPES.SPIDER;

  // MakeMediumPropagator(inst), without SetOnFlashPoint.
  addComponent(
    inst,
    'propagator',
    Propagator,
    'medium',
    radius => inst.TheSim.FindEntities(inst.position, radius, undefined, PROPAGATOR_CANT_TAGS),
    UNIT,
    world.scheduler,
    world.getWatchWorldContent,
  );

  const growable = addComponent(inst, 'growable', Growable, world.scheduler, growthStages(inst), seconds =>
    inst.springSeason ? seconds * SPRING_GROWTH_MODIFIER : seconds,
  );
  growable.springgrowth = true;
  growable.SetStage(1);
  growable.StartGrowing();

  addComponent(inst, 'inspectable', Inspectable);

  addComponent(inst, 'workable', Workable<SpiderdenInstance>, () => world.scheduler.now).SetWorkAction(undefined);

  addComponent(inst, 'hauntable', Hauntable, world.scheduler).SetCooldown(HAUNT_COOLDOWN_MEDIUM);

  addComponent(inst, 'shaveable', Shaveable);

  addComponent(inst, 'bedazzlement', Bedazzlement);

  inst.DoTaskInTime(0, addSleepingBagIfLarge);

  inst.OnSave = saveSpiderdenHealth;
  inst.OnLoad = loadSpiderdenHealth;
  return inst;
}

/** The Prefab spiderden.lua returns: only `spiderden`, as SetPrefabName saves every level under it. */
export function spiderdenPrefabs(
  world: SpiderdenWorld,
): Readonly<Record<typeof SPIDERDEN_ID, PrefabEntityDefinition<SpiderdenInstance>>> {
  return {
    [SPIDERDEN_ID]: {
      fn: () => fn(world),
      assets: {
        animationArchive: 'spider_cocoon.zip',
        buildArchives: SPIDERDEN_ARCHIVES,
        bank: SPIDERDEN_BANK,
      },
      physics: { make: MakeObstaclePhysics, radius: 0.5 },
      minimapIcon: 'spiderden_1.png',
    },
  };
}

export const spiderdenRegistration = {
  create: spiderdenPrefabs,
  families: { spiderDens: definePrefabIds([SPIDERDEN_ID], true) },
};
