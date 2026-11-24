import { SpriteState } from '@dontstarve-web/display';
import { WorldContentKey, type GetWatchWorldContent, type ReadonlySignal } from '@dontstarve-web/signals';
import type { World } from 'cannon-es';
import { Burnable, type BurnableOnBurntFn } from '../../componets/src/burnable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/inspectable';
import { LootDropper } from '../../componets/src/lootdropper';
import { LunarHailBuildup } from '../../componets/src/lunarhailbuildup';
import { Propagator, PROPAGATOR_CANT_TAGS } from '../../componets/src/propagator';
import { Workable } from '../../componets/src/workable';
import { addComponent, removeComponent } from './components';
import type { TheCamera } from './followcamera';
import {
  LIVINGTREE_CONFIG as CONFIG,
  type chop_down_burnt_tree as ChopBurnt,
  type Extinguish as ExtinguishCallback,
  type fn as Constructor,
  type makestump as MakeStump,
  type OnBurnt as BurntCallback,
  type ondug as DugCallback,
  type onload as LoadCallback,
  type onsave as SaveCallback,
  type onworked as WorkedCallback,
  type onworkfinish as WorkFinishCallback,
  type ShakeCamera as ShakeCallback,
} from './generated/livingtree.schema';
import { groundLootSpawner, type SpawnGroundItem } from './groundPrefab';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { definePrefabIds } from './prefabRegistration';
import {
  DefaultBurnFn,
  DefaultBurntFn,
  DefaultExtinguishFn,
  MakeObstaclePhysics,
  RemovePhysicsColliders,
} from './standardcomponents';
import { WORLD_SCALE } from './tile';
import type { ReadonlyVector3 } from './transform';
import type { FireFxHost } from './treeFire';

export const LIVINGTREE_ID = CONFIG.prefab;
const SNOW_ARCHIVE = `${CONFIG.snow.build}.zip`;
export const LIVINGTREE_ART = {
  animationArchive: CONFIG.archive,
  buildArchives: [CONFIG.archive, SNOW_ARCHIVE],
  bank: CONFIG.bank,
};
const { clips } = CONFIG;

interface LivingTreeWorld {
  readonly scheduler: GameTimeScheduler;
  readonly fire: FireFxHost;
  readonly physics?: World;
  readonly TheCamera: TheCamera;
  readonly getWatchWorldContent?: GetWatchWorldContent;
  readonly spawnGroundItem: SpawnGroundItem;
  readonly supportsOfflineSkins: boolean;
  isOcean?(position: ReadonlyVector3): boolean;
  shakeCamera?(position: ReadonlyVector3, duration: number, speed: number, scale: number, radius: number): void;
}

export class LivingTreeInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    hauntable?: Hauntable;
    lunarhailbuildup?: LunarHailBuildup;
    lootdropper: LootDropper;
    propagator?: Propagator;
    workable?: Workable<LivingTreeInstance>;
  };
  declare SoundEmitter: ReturnType<PrefabInstance['AddSoundEmitter']>;
  world!: LivingTreeWorld;
  snowCovered?: ReadonlySignal<boolean>;
}

function RemoveAfterChop(inst: LivingTreeInstance): void {
  inst.remove();
}

/** The source animover is timed from anim.bin even while the tile has no resident sprite. */
function BurntChopAnimOver(inst: LivingTreeInstance): void {
  inst.PushEvent('animover');
}

const chop_down_burnt_tree: ChopBurnt = (inst, chopper) => {
  removeComponent(inst, 'workable');
  inst.SoundEmitter.PlaySound(CONFIG.sounds.crumble);
  if (!chopper?.hasTag?.('playerghost')) {
    inst.SoundEmitter.PlaySound(CONFIG.sounds.axe);
  }
  inst.AnimState.PlayAnimation(clips.chop_burnt_tall.name, false);
  RemovePhysicsColliders(inst);
  inst.ListenForEvent('animover', RemoveAfterChop);
  inst.DoTaskInTime(CONFIG.clipSeconds.chop_burnt_tall, BurntChopAnimOver);
  inst.components.lootdropper.SpawnLootPrefab(CONFIG.burnt.loot);
  inst.components.lootdropper.DropLoot();
};

/** The active Lua hauntable helpers all retain the cooldown and return false (HAUNTFIX). */
function makeHauntable(inst: LivingTreeInstance, cooldown: number): void {
  const hauntable = addComponent(inst, 'hauntable', Hauntable, inst.world.scheduler);
  hauntable.SetCooldown(cooldown);
  hauntable.SetOnHauntFn(() => false);
}

const Extinguish: ExtinguishCallback = inst => {
  inst.components.burnable?.Extinguish();
  removeComponent(inst, 'burnable');
  removeComponent(inst, 'propagator');
  removeComponent(inst, 'hauntable');
  makeHauntable(inst, CONFIG.burnt.hauntCooldown);
  inst.components.lootdropper.SetLoot([]);
  const workable = inst.components.workable;
  if (workable) {
    workable.SetWorkLeft(CONFIG.burnt.work);
    workable.SetOnWorkCallback(undefined);
    workable.SetOnFinishCallback(chop_down_burnt_tree);
  }
};

const OnBurnt: BurntCallback & BurnableOnBurntFn = owner => {
  if (!(owner instanceof LivingTreeInstance)) {
    return;
  }
  const inst = owner;
  inst.DoTaskInTime(CONFIG.burnt.extinguishDelay, Extinguish);
  inst.AnimState.PlayAnimation(clips.burnt_tall.name, true);
  inst.rayTestOnBB = CONFIG.burnt.rayTestOnBB;
  inst.addTag(CONFIG.burnt.tag);
  inst.minimap.SetIcon(CONFIG.burnt.icon);
};

const ondug: DugCallback = inst => {
  inst.components.lootdropper.SpawnLootPrefab(CONFIG.stump.loot);
  inst.remove();
};

function UpdateLunarHailBuildup(inst: LivingTreeInstance): void {
  const { snow } = CONFIG;
  const covered = inst.snowCovered?.peek() ?? false;
  const buildup = inst.components.lunarhailbuildup?.IsBuildupWorkable() ?? false;
  const source = buildup ? (covered ? snow.snowyBuildup : snow.buildup) : snow.source;
  inst.sprite.setSymbolOverride(snow.symbol, SNOW_ARCHIVE, source);
  if (buildup || covered) {
    inst.sprite.showLayer(snow.layer);
  } else {
    inst.sprite.hideLayer(snow.layer);
  }
}

function RemoveLunarHailBuildup(inst: LivingTreeInstance): void {
  removeComponent(inst, 'lunarhailbuildup');
  inst.RemoveEventCallback('lunarhailbuildupworkablestatechanged', UpdateLunarHailBuildup);
}

function burnStump(owner: Parameters<BurnableOnBurntFn>[0]): void {
  if (owner instanceof LivingTreeInstance) {
    DefaultBurntFn(owner, owner.world);
  }
}

function makeBurnable(inst: LivingTreeInstance, config: typeof CONFIG.tree.burnable | typeof CONFIG.stump.burnable) {
  const { fire, scheduler } = inst.world;
  const burnable = addComponent(inst, 'burnable', Burnable, scheduler);
  burnable.SetFXLevel(config.level);
  burnable.SetBurnTime(config.time);
  burnable.AddBurnFX(config.prefab, config.offset);
  burnable.SetFXSpawner(() => fire.spawn(inst));
  burnable.SetOnIgniteFn(() => DefaultBurnFn(inst));
  burnable.SetOnExtinguishFn(() => DefaultExtinguishFn(inst));
  burnable.SetOnBurntFn(burnStump);
  return burnable;
}

function makePropagator(
  inst: LivingTreeInstance,
  preset: typeof CONFIG.tree.propagator | typeof CONFIG.stump.propagator,
): void {
  addComponent(
    inst,
    'propagator',
    Propagator,
    preset,
    radius => inst.TheSim.FindEntities(inst.position, radius, undefined, PROPAGATOR_CANT_TAGS),
    WORLD_SCALE,
    inst.world.scheduler,
    inst.world.getWatchWorldContent,
  );
}

const makestump: MakeStump = (inst, instant) => {
  removeComponent(inst, 'workable');
  RemoveLunarHailBuildup(inst);
  removeComponent(inst, 'burnable');
  makeBurnable(inst, CONFIG.stump.burnable);
  removeComponent(inst, 'propagator');
  makePropagator(inst, CONFIG.stump.propagator);
  removeComponent(inst, 'hauntable');
  makeHauntable(inst, CONFIG.stump.hauntCooldown);
  RemovePhysicsColliders(inst);
  if (instant) {
    inst.AnimState.PlayAnimation(clips.stump.name, false);
  } else {
    inst.AnimState.PushAnimation(clips.stump.name, true);
  }
  const workable = addComponent(inst, 'workable', Workable<LivingTreeInstance>);
  workable.SetWorkAction(CONFIG.stump.work.action);
  workable.SetOnFinishCallback(ondug);
  workable.SetWorkLeft(CONFIG.stump.work.count);
  inst.addTag(CONFIG.stump.tag);
  inst.minimap.SetIcon(CONFIG.stump.icon);
};

const onworked: WorkedCallback = (inst, chopper) => {
  if (!chopper?.hasTag?.('playerghost')) {
    inst.SoundEmitter.PlaySound(chopper?.hasTag?.('beaver') ? CONFIG.sounds.beaver : CONFIG.sounds.axe);
  }
  inst.SoundEmitter.PlaySound(CONFIG.sounds.hit);
  inst.AnimState.PlayAnimation(clips.chop.name, false);
  inst.AnimState.PushAnimation(clips.idle.name, true);
};

const ShakeCamera: ShakeCallback = inst => {
  const { duration, speed, scale, radius } = CONFIG.shake;
  inst.world.shakeCamera?.(inst.position, duration, speed, scale, radius * WORLD_SCALE);
};

const onworkfinish: WorkFinishCallback = (inst, chopper) => {
  const right = inst.world.TheCamera.GetRightVec();
  const origin = inst.getPosition();
  const chopperPosition = chopper.getPosition?.();
  const fallsLeft = chopperPosition !== undefined && chopperPosition.clone().sub(origin).dot(right) > 0;
  inst.SoundEmitter.PlaySound(CONFIG.sounds.fall);
  inst.SoundEmitter.PlaySound(CONFIG.sounds.die);
  inst.AnimState.PlayAnimation(fallsLeft ? clips.fallleft.name : clips.fallright.name, false);
  const distance = CONFIG.loot.fallOffset * WORLD_SCALE * (fallsLeft ? -1 : 1);
  inst.components.lootdropper.DropLoot(origin.clone().addScaledVector(right, distance));
  inst.DoTaskInTime(CONFIG.shake.delay, ShakeCamera);
  makestump(inst, undefined);
};

const onsave: SaveCallback = (inst, data) => {
  const stump = inst.hasTag(CONFIG.stump.tag);
  const burnt = inst.hasTag(CONFIG.burnt.tag) || inst.components.burnable?.IsBurning();
  if (stump || burnt) {
    data.livingtree = { ...(stump ? { stump: true } : {}), ...(burnt ? { burnt: true } : {}) };
  }
};

const onload: LoadCallback = (inst, data) => {
  const tree = data?.livingtree;
  if (tree?.stump) {
    makestump(inst, true);
    if (tree.burnt || inst.hasTag(CONFIG.burnt.tag)) {
      DefaultBurntFn(inst, inst.world);
      RemoveLunarHailBuildup(inst);
    }
  } else if (tree?.burnt && !inst.hasTag(CONFIG.burnt.tag)) {
    OnBurnt(inst);
    RemoveLunarHailBuildup(inst);
  }
};

function fn(world: LivingTreeWorld, position: ReadonlyVector3): ReturnType<Constructor> {
  const inst = new LivingTreeInstance(
    LIVINGTREE_ID,
    new SpriteState({ name: clips[CONFIG.initialClip].name, billboard: true }),
  );
  inst.world = world;
  inst.BindScheduler(world.scheduler);
  inst.setPosition(position.x, 0, position.z);
  inst.AddSoundEmitter();
  inst.deploySmartRadius = CONFIG.physics.deployRadius * WORLD_SCALE;
  inst.addTag(CONFIG.tags[0]);
  MakeObstaclePhysics(inst, CONFIG.physics.radius, CONFIG.physics.height);
  if (world.physics) {
    inst.bindPhysics(world.physics);
  }
  inst.minimap.SetIcon(CONFIG.tree.icon);
  for (const tag of CONFIG.tags.slice(1)) {
    inst.addTag(tag);
  }
  inst.AnimState.PlayAnimation(clips[CONFIG.initialClip].name, true);
  inst.sprite.setSymbolOverride(CONFIG.snow.symbol, SNOW_ARCHIVE, CONFIG.snow.source);
  inst.addTag(CONFIG.snow.tag);
  inst.sprite.hideLayer(CONFIG.snow.layer);

  addComponent(inst, 'inspectable', Inspectable);
  const loot = addComponent(inst, 'lootdropper', LootDropper, groundLootSpawner(world));
  loot.SetLoot(CONFIG.loot.normal);
  if (world.supportsOfflineSkins) {
    loot.AddChanceLoot(CONFIG.loot.chance.prefab, CONFIG.loot.chance.chance);
  }

  const workable = addComponent(inst, 'workable', Workable<LivingTreeInstance>);
  workable.SetWorkAction(CONFIG.tree.work.action);
  workable.SetWorkLeft(CONFIG.tree.work.count);
  workable.SetOnWorkCallback(onworked);
  workable.SetOnFinishCallback(onworkfinish);
  const burnable = makeBurnable(inst, CONFIG.tree.burnable);
  burnable.SetFXLevel(CONFIG.tree.finalFireLevel);
  burnable.SetOnBurntFn(OnBurnt);
  makePropagator(inst, CONFIG.tree.propagator);
  makeHauntable(inst, CONFIG.tree.hauntCooldown);

  inst.snowCovered = world.getWatchWorldContent?.(WorldContentKey.SnowCovered, stop => inst.onRemove(stop));
  const { lunarHail } = CONFIG;
  const buildup = addComponent(
    inst,
    'lunarhailbuildup',
    LunarHailBuildup,
    world.scheduler,
    lunarHail.decayPeriod,
    lunarHail.decayRate,
  );
  inst.ListenForEvent('lunarhailbuildupworkablestatechanged', UpdateLunarHailBuildup);
  if (inst.snowCovered) {
    inst.onRemove(inst.snowCovered.subscribe(() => UpdateLunarHailBuildup(inst)));
  }
  UpdateLunarHailBuildup(inst);
  buildup.SetTotalWorkAmount(lunarHail.work);
  buildup.SetMoonGlassAmount(lunarHail.moonGlass);

  // OnHalloweenSetup requires the HALLOWED_NIGHTS world event and the livingtree_halloween prefab.
  inst.OnSave = onsave;
  inst.OnLoad = onload;
  return inst;
}

export function livingTreePrefabs(
  world: LivingTreeWorld,
): Record<typeof LIVINGTREE_ID, PrefabEntityDefinition<LivingTreeInstance>> {
  return {
    [LIVINGTREE_ID]: {
      fn: position => fn(world, position),
      assets: LIVINGTREE_ART,
      assetOptions: {
        staticBillboard: true,
        instancedAnimations: [clips.idle.name, clips.stump.name, clips.burnt_tall.name],
      },
    },
  };
}

export const livingTreeRegistration = {
  create: livingTreePrefabs,
  families: { livingtree: definePrefabIds([LIVINGTREE_ID], true) },
};
