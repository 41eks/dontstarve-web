import { SpriteState } from '@dontstarve-web/display';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { BernieBigBrain, BernieBrain, type BerniePlayer } from '../../brains/src/berniebrain';
import { AnimState } from '../../componets/src/animstate';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Health } from '../../componets/src/health';
import { ComponentTimer, Timer } from '../../componets/src/timer';
import { createBernieStateGraph, type BernieStateInst } from '../../stategraphs/src/SGbernie';
import { FRAMES } from '../../stategraphs/src/stategraph';
import { animationTiming } from './animationTimings';
import { GROUND_ITEM_DEFINITIONS, createResidentGroundItem } from './groundItems';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';
import { listenInventoryEvents } from './inventoryEvents';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import { MakeCharacterPhysics, WORLD_SCALE } from './standardcomponents';

export type { BerniePlayer } from '../../brains/src/berniebrain';

export const BERNIE_ITEM_ID = 'bernie_inactive';
export const BERNIE_ACTIVE_ID = 'bernie_active';
export const BERNIE_BIG_ID = 'bernie_big';
export type BernieCreatureId = typeof BERNIE_ACTIVE_ID | typeof BERNIE_BIG_ID;

// tuning.lua
const BERNIE_HEALTH = 1000;
const BERNIE_BIG_HEALTH = 2000;
/** bernie_inactive.lua tryreanimate: rangesq = 16 * 16. */
const REANIMATE_RANGE = 16;

/** AllPlayers and SpawnPrefab, as bernie_inactive.lua, bernie_active.lua and bernie_big.lua reach them. */
export interface BernieWorld {
  readonly scheduler: GameTimeScheduler;
  getPlayers(): readonly BerniePlayer[];
  /** SpawnPrefab("bernie_active" | "bernie_big", skin) on the shared PrefabEntityManager. */
  spawnPrefab(prefab: BernieCreatureId, position: ReadonlyVector3, skinId?: string): PrefabInstance | undefined;
  /** SpawnPrefab("bernie_inactive", skin): the item, lying on the ground at `position`. */
  spawnInactive(position: ReadonlyVector3, skinId?: string): ItemEntity | undefined;
}

/** bernie_common.lua isleadercrazy; the willow_berniesanity skills and hotheaded (willow_bernieai) are not ported. */
function isleadercrazy(leader: BerniePlayer): boolean {
  return leader.components.sanity?.IsCrazy() === true;
}

/** Each form's skin from another's, as the prefabs gsub the shadow / lunar builds and the form suffix. */
function formSkin(skinId: string | undefined, from: '' | '_active' | '_big', to: '' | '_active' | '_big'): string | undefined {
  if (skinId === undefined) return undefined;
  const base = skinId.replace('_shadow_build', '').replace('_lunar_build', '');
  return `${from ? base.replace(from, '') : base}${to}`;
}

/**
 * bernie_inactive.lua toground / topocket / OnEntitySleep / OnEntityWake: while the item lies awake on the ground it
 * runs tryreanimate every second. The fueled durability (and the health it becomes), the decay of a dead Bernie,
 * the equippable, insulator and the transform_cd timer it carries over are not ported.
 */
function bindBernieItem(inst: ItemEntity, world: BernieWorld): () => void {
  let onGround = !inst.components.inventoryitem.owner;
  const activatetask = new ComponentTimer(world.scheduler, () => {
    activatetask.start(1);
    tryreanimate(inst, world);
  });
  const refresh = () => {
    if (!onGround || inst.isRemoved || inst.status.peek() !== 'active') activatetask.stop();
    else if (activatetask.snapshot.peek().status !== 'scheduled') activatetask.start(1);
  };
  const removeInventoryEvents = listenInventoryEvents(inst, {
    ondropped: () => { onGround = true; refresh(); },
    onload: () => { onGround = !inst.components.inventoryitem.owner; refresh(); },
    onputininventory: () => { onGround = false; refresh(); },
  });
  const stopStatus = inst.status.subscribe(refresh);
  refresh();
  return () => { removeInventoryEvents(); stopStatus(); activatetask.stop(); };
}

/** bernie_inactive.lua tryreanimate: the nearest crazy, visible player within 16 units wakes Bernie up. */
function tryreanimate(inst: ItemEntity, world: BernieWorld): void {
  let target: BerniePlayer | undefined, rangesq = (REANIMATE_RANGE * WORLD_SCALE) ** 2;
  const position = inst.position;
  for (const v of world.getPlayers()) {
    if (!isleadercrazy(v) || !v.IsVisible()) continue;
    const distsq = v.position.distanceToSquared(position);
    if (distsq < rangesq) { rangesq = distsq; target = v; }
  }
  if (!target) return;
  const active = world.spawnPrefab(BERNIE_ACTIVE_ID, position, formSkin(inst.skinId, '', '_active'));
  if (active) inst.remove();
}

/** The inventory item on the ground: the catalog art plays `inactive`, and the item reanimates near a crazy player. */
export function createBernieGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  return {
    itemIds: [BERNIE_ITEM_ID],
    create: (item, entity) => {
      const { visual } = createResidentGroundItem(context, { ...item, entity });
      const stop = context.bernieWorld ? bindBernieItem(entity, context.bernieWorld) : () => {};
      return { ...visual, dispose() { stop(); visual.dispose(); } };
    },
  };
}

/**
 * bernie_active.lua and bernie_big.lua: a reanimated Bernie runs its stategraph and brain until it sits back down
 * as the item. Combat, locomotion, following, the taunt, hauntable, the pickup replacement, sounds, DynamicShadow,
 * facing modes and bernie_big's allegiance and fire art are not ported.
 */
export class BernieInstance extends PrefabInstance implements BernieStateInst {
  declare readonly components: PrefabInstance['components'] & { health: Health; timer: Timer; inspectable: Inspectable };
  declare sg: ReturnType<typeof createBernieStateGraph>;
  readonly big: boolean;
  /** bernie_big.lua inst.bernieleader */
  bernieleader?: BerniePlayer;
  should_shrink?: boolean;
  private readonly world: BernieWorld;
  private readonly animstate: AnimState;
  private readonly bernieBrain: BernieBrain | BernieBigBrain;
  private readonly spawnedAt: number;
  private readonly archive: string;
  private readonly tasks = new Set<() => void>();

  constructor(world: BernieWorld, big: boolean) {
    super(big ? BERNIE_BIG_ID : BERNIE_ACTIVE_ID, new SpriteState({ name: 'idle_loop', billboard: true }));
    this.world = world;
    this.big = big;
    this.spawnedAt = world.scheduler.now;
    this.archive = big ? 'bernie_big.zip' : 'bernie.zip';
    for (const tag of big ? ['largecreature', 'companion', 'soulless', 'crazy', 'bigbernie'] : ['smallcreature', 'companion', 'soulless']) this.addTag(tag);
    this.addTag('inspectable');
    if (big) this.setScale(.7);
    const health = new Health(big ? BERNIE_BIG_HEALTH : BERNIE_HEALTH, this);
    health.nofadeout = true;
    const timer = new Timer(world.scheduler, () => {}, ['transform_cd']);
    Object.assign(this.components, { health, timer, inspectable: new Inspectable(this) });

    const clips = ['idle_loop', 'idle_loop_nodir', 'activate', 'deactivate', ...big ? ['deactivate_pst'] : []];
    const lengths = new Map(clips.map(name => { const clip = animationTiming(this.archive, name); return [name, clip.frames / clip.frameRate]; }));
    this.animstate = new AnimState(world.scheduler, lengths, event => this.sg?.pushEvent(event));
    // The sprite follows the logical AnimState at once, so SetTime right after PlayAnimation lands on the new clip.
    const stopSprite = this.animstate.animation.subscribe(({ name, loop }) => {
      if (loop) this.sprite.start(name); else this.sprite.playOnce(name);
    });
    this.sg = big ? createBernieStateGraph(this, true, world.scheduler) : createBernieStateGraph(this, false, world.scheduler);
    this.bernieBrain = big ? new BernieBigBrain(this, WORLD_SCALE) : new BernieBrain(this, WORLD_SCALE);
    this.brain = this.bernieBrain;
    this.bernieBrain.Start();
    this.think();
    this.onRemove(() => {
      this.bernieBrain.Stop();
      for (const cancel of [...this.tasks]) cancel();
      this.sg.dispose();
      stopSprite(); this.animstate.dispose();
      timer.dispose(); health.dispose();
    });
  }

  /** BrainManager: an awake Bernie's brain updates again once its tree's sleep time has passed. */
  private think(): void {
    if (this.isRemoved) return;
    if (this.status.peek() === 'active') this.bernieBrain.tick(this.world.scheduler.now);
    const sleep = this.bernieBrain.GetSleepTime();
    this.doTaskInTime(Math.max(sleep ?? 1, FRAMES), () => this.think());
  }

  /** inst:DoTaskInTime, cancelled with the inst. */
  doTaskInTime(seconds: number, fn: () => void): () => void {
    const cancel = this.world.scheduler.schedule(seconds, () => { this.tasks.delete(cancel); if (!this.isRemoved) fn(); });
    this.tasks.add(cancel);
    return () => { cancel(); this.tasks.delete(cancel); };
  }

  // --- BernieStateInst ---------------------------------------------------------------------------

  playAnimation(name: string, loop = false): void { this.animstate.PlayAnimation(name, loop); }
  pushAnimation(name: string, loop = false): void { this.animstate.PushAnimation(name, loop); }
  isCurrentAnimation(name: string): boolean { return this.animstate.animation.peek().name === name; }
  getCurrentAnimationLength(): number { return this.animstate.length; }
  setAnimationTime(seconds: number): void {
    const clip = animationTiming(this.archive, this.animstate.animation.peek().name);
    this.sprite.setFrame(Math.floor(seconds * clip.frameRate) % clip.frames);
  }
  setInvincible(invincible: boolean): void { this.components.health.SetInvincible(invincible); }

  // --- BernieBrainInst ---------------------------------------------------------------------------

  getTime(): number { return this.world.scheduler.now; }
  random(): number { return Math.random(); }
  getPlayers(): readonly BerniePlayer[] { return this.world.getPlayers(); }
  isleadercrazy(leader: BerniePlayer): boolean { return isleadercrazy(leader); }
  GetTimeAlive(): number { return this.world.scheduler.now - this.spawnedAt; }
  /** health.lua OnSave, kept as the record's `{ current, maximum }`. */
  OnSave(_inst: unknown, data: PlacementSaveRecord['components']): void {
    const { health } = this.components;
    data.health = { current: health.currenthealth, maximum: health.maxhealth };
  }

  /** health.lua OnLoad from the record; bernie_big.lua OnLoad then stands a loaded big Bernie idle instead of activating. */
  OnLoad(_inst: unknown, data: PlacementSaveRecord['components']): void {
    if (data.health) {
      this.components.health.SetMaxHealth(data.health.maximum);
      this.components.health.OnLoad({ health: data.health.current });
    }
    if (this.big) this.sg.goToState('idle');
  }

  /** bernie_big.lua onLeaderChanged; the skill tree speed, regen, health and allegiance branches are not ported. */
  onLeaderChanged(leader: BerniePlayer): void { this.bernieleader = leader; }

  /**
   * bernie_active.lua / bernie_big.lua goinactive: the item takes Bernie's place, its skin without the form suffix.
   * Health becoming the item's fuel and the transform_cd it carries are not ported, as the item has neither.
   */
  GoInactive(): ItemEntity | undefined {
    const inactive = this.world.spawnInactive(this.position,
      formSkin(this.skinId, this.big ? '_big' : '_active', ''));
    if (inactive) this.remove();
    return inactive;
  }

  /** bernie_active.lua gobig: a crazy Willow nearby turns Bernie into bernie_big, which records her as its leader. */
  GoBig(leader: BerniePlayer): BernieInstance | undefined {
    if (this.big || leader.bigbernies) return undefined;
    const big = this.world.spawnPrefab(BERNIE_BIG_ID, this.position,
      formSkin(this.skinId, '_active', '_big')) as BernieInstance | undefined;
    if (!big) return undefined;
    (leader.bigbernies = new Set()).add(big);
    big.components.health.SetPercent(this.components.health.GetPercent());
    big.onLeaderChanged(leader);
    this.remove();
    return big;
  }
}

/** skinprefabs.lua: each form's skins share the item skin's build. */
const formSkins = (suffix: '_active' | '_big') => Object.fromEntries(Object.entries(GROUND_ITEM_DEFINITIONS[BERNIE_ITEM_ID].skinArchives)
  .map(([skin, archive]) => [`${skin}${suffix}`, archive]));

/** The Prefabs bernie_active.lua and bernie_big.lua return. */
export function berniePrefabs(world: BernieWorld): Readonly<Record<BernieCreatureId, PrefabEntityDefinition<BernieInstance>>> {
  return {
    [BERNIE_ACTIVE_ID]: {
      fn: () => new BernieInstance(world, false),
      assets: { animationArchive: 'bernie.zip', buildArchives: ['bernie_build.zip'], bank: 'bernie' },
      skins: formSkins('_active'),
      // MakeCharacterPhysics(inst, 50, .25)
      physics: { make: (inst, rad) => MakeCharacterPhysics(inst, 50, rad), radius: .25 },
      minimapIcon: 'bernie.png',
    },
    [BERNIE_BIG_ID]: {
      fn: () => new BernieInstance(world, true),
      assets: { animationArchive: 'bernie_big.zip', buildArchives: ['bernie_build.zip'], bank: 'bernie_big' },
      skins: formSkins('_big'),
      // MakeCharacterPhysics(inst, 500, .65)
      physics: { make: (inst, rad) => MakeCharacterPhysics(inst, 500, rad), radius: .65 },
      minimapIcon: 'bernie.png',
    },
  };
}
