import * as THREE from 'three';
import { WorldContentKey, type GetWatchWorldContent, type WorldContentSignal, type WorldPhase } from '@dontstarve-web/signals';
import { SpriteResources } from '@dontstarve-web/display';
import type { GroundItemDefinition, GroundItemFactory, GroundPrefabContext } from './groundPrefab';
import { ItemEntity } from '@dontstarve-web/inventory';
import { TOTAL_DAY_TIME } from '../../componets/src/perishable';
import { Deployable } from '../../componets/src/deployable';
import { BufferedAction } from '../../stategraphs/src/bufferedaction';
import { ButterflyStateGraph, type ButterflyStateInst, type ButterflyStateName } from '../../stategraphs/src/SGbutterfly';
import { LocoMotor, type LocoMotorInst, type LocoMotorPoint } from '../../componets/src/locomotor';
import { KnownLocations } from '../../componets/src/knownlocations';
import { Pollinator } from '../../componets/src/pollinator';
import { Workable } from '../../componets/src/workable';
import { Brain } from '../../brains/src/brain';
import { ButterflyBrain } from '../../brains/src/butterflybrain';
import { MoonButterflyBrain } from '../../brains/src/moonbutterflybrain';
import { RADIANS } from '../../brains/src/simutil';
import type { BrainComponents, BrainEntity, BrainInst, BrainWorld } from '../../brains/src/types';
import catalog from './groundItems.json' with { type: 'json' };
import { MOONBUTTERFLY_PERISH_INV_MODIFIER, MOONBUTTERFLY_PERISH_TIME, MOONBUTTERFLY_SPEED } from './moonbutterflyTuning';
import { FindEntities, type FoundEntity } from './actionEntity';
import { PlaySound } from './sound';
import { ComponentTimer } from '../../componets/src/timer';
import { TILE_SIZE } from './tile';
import { animationLengths } from './animationTimings';
import { createPrefabEntity, prefabInstance } from './prefabInstance';

export const BUTTERFLY_ID = 'butterfly';
export const MOONBUTTERFLY_ID = 'moonbutterfly';
export type ButterflyPrefabId = typeof BUTTERFLY_ID | typeof MOONBUTTERFLY_ID;
export const BUTTERFLY_PERISH_TIME = 3 * TOTAL_DAY_TIME;

export { MOONBUTTERFLY_PERISH_INV_MODIFIER, MOONBUTTERFLY_PERISH_TIME, MOONBUTTERFLY_SPEED };

export function configureButterflyEntity(entity: ItemEntity): void {
  entity.components.inventoryitem.canbepickedup = false;
  entity.components.inventoryitem.canbepickedupalive = true;
  entity.addTag('butterfly');
  entity.addTag('catchable');
  if (!entity.components.deployable) {
    entity.addTag('deployedplant');
    entity.components.deployable = entity.component('deployable', () => entity.prefab === MOONBUTTERFLY_ID
      ? new Deployable(entity, (point, _deployer, map) => {
        // moonbutterfly.lua OnDeploy.
        if (!map.SpawnPrefab('moonbutterfly_sapling', point)) return false;
        PlaySound('dontstarve/wilson/plant_tree', point);
        entity.remove();
        return true;
      }, { mode: 'PLANT', spacing: 3.2 * (TILE_SIZE / 4), placer: { bank: 'baby_moon_tree', build: 'baby_moon_tree', animation: 'idle' } })
      : new Deployable(entity, (point, deployer, map) => {
        // butterfly.lua OnDeploy.
        const flower = map.SpawnPrefab('planted_flower', point);
        if (!flower) return false;
        flower.PushEvent('growfrombutterfly');
        entity.remove();
        PlaySound('dontstarve/common/plant', deployer.position);
        return true;
      }, { mode: 'PLANT', spacing: .75 * (TILE_SIZE / 4), placer: { bank: 'flowers', build: 'flowers', animation: 'f1' } }));
  }
  if (entity.prefab === BUTTERFLY_ID) {
    entity.addTag('small_livestock');
    entity.addTag('show_spoilage');
    const perishable = entity.components.perishable;
    perishable.localMultiplier = () => entity.components.inventoryitem.owner ? 1 : 0;
    perishable.perishfn = () => {
      const owner = entity.components.inventoryitem.owner;
      if (!owner) return;
      const count = entity.components.stackable.count;
      const position = owner.getPosition?.().clone();
      const loot = new Map<string, number>();
      for (let i = 0; i < count; i++) for (const prefab of BUTTERFLY_DEFINITIONS.butterfly.generateLoot(Math.random)) {
        loot.set(prefab, (loot.get(prefab) ?? 0) + 1);
      }
      owner.PushEvent('murdered', { victim: entity, stackmult: count, negligent: true });
      if (entity.remove()) for (const [itemId, amount] of loot) {
        const item = new ItemEntity({ itemId, count: amount });
        if (position) item.transform.position.copy(position);
        owner.GiveItem?.(item);
      }
    };
    entity.component('butterflyperishing', () => {
      const stops = [
        entity.ListenForEvent('onputininventory', () => perishable.StartPerishing()),
        entity.ListenForEvent('ondropped', () => perishable.StopPerishing()),
      ];
      return { dispose: () => stops.forEach(stop => stop()) };
    });
  }
  entity.components.workable = entity.component('workable', () => {
    const workable = new Workable(entity);
    workable.SetWorkAction('NET');
    workable.SetWorkLeft(1);
    workable.SetOnFinishCallback((_inst, worker) => {
      worker.components?.inventory?.GiveItem(entity, entity.transform.position);
      if (worker.components?.inventory) PlaySound('dontstarve/common/butterfly_trap', entity.transform.position);
    });
    entity.ListenForEvent('ondropped', () => workable.SetWorkLeft(1));
    return workable;
  });
}

/** moonbutterfly.lua: it spoils four times slower in an inventory and is simply removed if it perishes there. */
export function configureMoonButterflyEntity(entity: ItemEntity): void {
  configureButterflyEntity(entity);
  const perishable = entity.components.perishable;
  perishable.localMultiplier = () => entity.components.inventoryitem.owner ? MOONBUTTERFLY_PERISH_INV_MODIFIER : 1;
  perishable.perishfn = () => {
    const owner = entity.components.inventoryitem.owner as { remove?(): boolean } | null;
    owner?.remove?.();
  };
}

export interface ButterflyFlower {
  readonly id: string;
  readonly position: THREE.Vector3;
}

export interface ButterflyWorld {
  getWatchWorldContent?: GetWatchWorldContent;
  /** Player and other entities carrying DST's scarytoprey tag. */
  getThreatPositions(): readonly THREE.Vector3[];
  getFlowers(): readonly ButterflyFlower[];
  /** Flying creatures ignore obstacles, but cannot leave the world. */
  constrainPosition?(position: THREE.Vector3): void;
}

export type ButterflyState = ButterflyStateName | 'removed';

interface ButterflyAnimation {
  start(name: string): void;
  playOnce(name: string, onComplete?: () => void): void;
  update(dt: number): void;
  readonly currentAnimation: string;
}

/** butterfly.lua and moonbutterfly.lua share the butterfly bank; its clip lengths come from the source anim.bin. */
const BUTTERFLY_ANIMATION_LENGTHS = animationLengths('butterfly_basic.zip');

const BASE_TAGS = ['butterfly', 'flying', 'ignorewalkableplatformdrowning', 'insect', 'smallcreature',
  'cattoyairborne', 'wildfireprotected', 'deployedplant'] as const;

export interface ButterflyDefinition {
  readonly prefab: ButterflyPrefabId;
  readonly tags: readonly string[];
  readonly walkspeed?: number;
  readonly pollinates: boolean;
  readonly createBrain: (inst: BrainInst) => Brain;
  /** lootdropper:DropLoot at death, as item IDs. */
  readonly generateLoot: (random: () => number) => readonly string[];
}

export const BUTTERFLY_DEFINITIONS: Readonly<Record<ButterflyPrefabId, ButterflyDefinition>> = {
  // butterfly.lua: AddRandomLoot("butter", 0.1), ("butterflywings", 5), numrandomloot = 1.
  butterfly: {
    prefab: BUTTERFLY_ID, tags: [...BASE_TAGS, 'noember'], pollinates: true,
    createBrain: inst => new ButterflyBrain(inst),
    generateLoot: random => {
      const roll = random() * 5.1;
      return [roll < .1 ? 'butter' : 'butterflywings'];
    },
  },
  // moonbutterfly.lua: SetChanceLootTable('moonbutterfly') → moonbutterflywings 1.0.
  moonbutterfly: {
    prefab: MOONBUTTERFLY_ID, walkspeed: MOONBUTTERFLY_SPEED, pollinates: false,
    tags: [...BASE_TAGS, 'show_spoilage', 'small_livestock', 'lunar_aligned'],
    createBrain: inst => new MoonButterflyBrain(inst),
    generateLoot: () => ['moonbutterflywings'],
  },
};

/** An entity as the brains see it: tags, a ground position and a validity flag. */
class SimpleEntity implements BrainEntity {
  readonly components: BrainComponents = {};
  valid = true;
  readonly prefab: string;
  readonly tags: ReadonlySet<string>;
  readonly position: () => THREE.Vector3;
  constructor(prefab: string, tags: readonly string[], position: () => THREE.Vector3) {
    this.prefab = prefab;
    this.tags = new Set(tags);
    this.position = position;
  }
  hasTag(tag: string): boolean { return this.tags.has(tag); }
  isValid(): boolean { return this.valid; }
  getPosition(): LocoMotorPoint { const { x, y, z } = this.position(); return { x, y, z }; }
  getPhysicsRadius(): number { return 0; }
}

/** Flower and threat entities shared by every butterfly of one world, so identity comparisons hold. */
class ButterflyEntities {
  private readonly flowers = new Map<string, SimpleEntity>();
  private readonly flowerPositions = new Map<string, THREE.Vector3>();
  private readonly ids = new Map<BrainEntity, string>();
  private readonly threats: SimpleEntity[] = [];
  private threatPositions: readonly THREE.Vector3[] = [];

  sync(world: ButterflyWorld): { flowers: SimpleEntity[]; threats: SimpleEntity[] } {
    const present = new Set<string>();
    for (const flower of world.getFlowers()) {
      present.add(flower.id);
      this.flowerPositions.set(flower.id, flower.position);
      if (!this.flowers.has(flower.id)) {
        const entity = new SimpleEntity('flower', ['flower'], () => this.flowerPositions.get(flower.id)!);
        this.flowers.set(flower.id, entity);
        this.ids.set(entity, flower.id);
      }
    }
    for (const [id, entity] of this.flowers) {
      if (present.has(id)) continue;
      entity.valid = false;
      this.flowers.delete(id);
      this.flowerPositions.delete(id);
      this.ids.delete(entity);
    }
    const positions = world.getThreatPositions();
    this.threatPositions = positions;
    while (this.threats.length < positions.length) {
      const index = this.threats.length;
      this.threats.push(new SimpleEntity('wilson', ['scarytoprey', 'player'], () => this.threatPositions[index]));
    }
    return { flowers: [...this.flowers.values()], threats: this.threats.slice(0, positions.length) };
  }

  idOf(entity: BrainEntity): string | undefined { return this.ids.get(entity); }
}

const entityRegistries = new WeakMap<ButterflyWorld, ButterflyEntities>();

const distanceSquared = (a: LocoMotorPoint, b: LocoMotorPoint) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/**
 * The live butterfly or moonbutterfly inst: components, stategraph and brain as in butterfly.lua,
 * SGbutterfly.lua and the *brain.lua files, driven from the committed inventory entity's transform.
 */
export class ButterflyCreature implements BrainInst, ButterflyStateInst, LocoMotorInst {
  readonly definition: ButterflyDefinition;
  readonly world: BrainWorld;
  readonly locomotor: LocoMotor;
  readonly sg: ButterflyStateGraph;
  readonly brain: Brain;
  bufferedaction: BufferedAction | undefined;
  private inInventory = false;
  get removed(): boolean { return this.inInventory || this.entity.isRemoved; }
  private rotation = 0;
  private motorSpeed = 0;
  private time = 0;
  private readonly entity: ItemEntity;
  get components(): BrainComponents { return this.entity.components; }
  get prefab(): string { return this.entity.prefab; }
  getPosition(): THREE.Vector3 { return this.entity.position; }
  getPhysicsRadius(): number { return this.entity.getPhysicsRadius(); }
  private readonly transform: ItemEntity['transform'];
  private readonly animation: ButterflyAnimation;
  private readonly sharedEntities: ButterflyEntities;
  private readonly butterflyWorld: ButterflyWorld;
  private readonly cycle?: WorldContentSignal<WorldPhase>;
  private readonly cleanups: (() => void)[] = [];
  private readonly getOthers: (position: LocoMotorPoint, radius: number) => readonly ButterflyCreature[];
  private readonly randomSource: () => number;
  /** The engine's animover, buffered like SG events in stategraph.lua and handled on the next stategraph update. */
  private animationOver = false;
  private readonly onAnimationOver = () => { this.animationOver = true; };
  private readonly dropLootItems?: (itemIds: readonly string[], position: THREE.Vector3) => void;
  private snapshot: { flowers: SimpleEntity[]; threats: SimpleEntity[] } = { flowers: [], threats: [] };
  private readonly scratch = new THREE.Vector3();

  constructor(definition: ButterflyDefinition, entity: ItemEntity, animation: ButterflyAnimation,
    butterflyWorld: ButterflyWorld, getOthers: (position: LocoMotorPoint, radius: number) => readonly ButterflyCreature[] = () => [],
    random: () => number = Math.random, dropLoot?: ButterflyCreature['dropLootItems']) {
    this.entity = entity;
    this.definition = definition;
    this.transform = entity.transform;
    this.animation = animation;
    this.butterflyWorld = butterflyWorld;
    this.cycle = butterflyWorld.getWatchWorldContent?.(WorldContentKey.Cycle, stop => this.cleanups.push(stop));
    this.getOthers = getOthers;
    this.randomSource = random;
    this.dropLootItems = dropLoot;
    for (const tag of definition.tags) entity.addTag(tag);
    let shared = entityRegistries.get(butterflyWorld);
    if (!shared) entityRegistries.set(butterflyWorld, shared = new ButterflyEntities());
    this.sharedEntities = shared;
    this.world = this.createWorld();
    // locomotor must be constructed before the stategraph.
    this.locomotor = new LocoMotor(this);
    if (definition.walkspeed !== undefined) this.locomotor.walkspeed = definition.walkspeed;
    this.components.locomotor = this.locomotor;
    this.components.knownlocations = new KnownLocations();
    if (definition.pollinates) this.components.pollinator = new Pollinator<BrainEntity>(this);
    this.sg = new ButterflyStateGraph(this);
    this.brain = definition.createBrain(this);
    this.brain.inst.brain = this.brain;
    entity.brain = this.brain;
    for (const name of ['locomote', 'death', 'animover']) this.cleanups.push(entity.ListenForEvent(name, data => this.sg.pushEvent(name, data)));
    this.cleanups.push(entity.ListenForEvent('ondropped', () => this.onDropped()),
      entity.ListenForEvent('onputininventory', () => this.onPutInInventory()));
    // OnDropped explicitly enters idle rather than the graph's initial takeoff.
    this.onDropped();
  }

  // --- BrainInst / entity script
  getTime(): number { return this.time; }
  random(): number { return this.randomSource(); }
  addTag(tag: string): void { this.entity.addTag(tag); }
  removeTag(tag: string): void { this.entity.removeTag(tag); }
  hasTag(tag: string): boolean { return this.entity.hasTag(tag); }
  isNear(other: BrainEntity, distance: number): boolean {
    return distanceSquared(this.getPosition(), other.getPosition()) <= distance * distance;
  }
  getAngleToPoint(x: number, _y: number, z: number): number {
    const position = this.getPosition();
    const angle = Math.atan2(-(z - position.z), x - position.x) * RADIANS;
    return (angle % 360 + 360) % 360;
  }
  setRotation(degrees: number): void { this.rotation = degrees; }
  get facing(): number { return this.rotation; }

  ListenForEvent(name: string, fn: (data?: unknown) => void): void { this.entity.ListenForEvent(name, fn); }
  RemoveEventCallback(name: string, fn: (data?: unknown) => void): void { this.entity.RemoveEventCallback(name, fn); }
  PushEvent(name: string, data?: unknown): void { this.entity.PushEvent(name, data); }

  /** entityscript.lua PushBufferedAction */
  PushBufferedAction(action: BufferedAction): void {
    const current = this.bufferedaction;
    if (current && current.target === action.target && current.action === action.action
      && current.invobject === action.invobject && !this.sg.hasStateTag('idle')) return;
    if (current) {
      current.fail();
      this.bufferedaction = undefined;
    }
    if (!action.isValid()) {
      this.PushEvent('actionfailed', { action });
      return;
    }
    this.bufferedaction = action;
    if (!this.sg.startAction(action)) {
      this.PushEvent('performaction', { action });
      action.fail();
      this.bufferedaction = undefined;
    }
  }

  // --- ButterflyStateInst
  performBufferedAction(): boolean | undefined {
    const action = this.bufferedaction;
    if (!action) return undefined;
    const target = action.target as BrainEntity | undefined;
    if (target?.isValid()) {
      const { x, y, z } = target.getPosition();
      this.setRotation(this.getAngleToPoint(x, y, z));
    }
    this.PushEvent('performaction', { action });
    const success = action.do();
    if (success) {
      if (this.bufferedaction === action) this.bufferedaction = undefined;
      return true;
    }
    this.PushEvent('actionfailed', { action });
    action.fail();
    if (this.bufferedaction === action) this.bufferedaction = undefined;
    return undefined;
  }

  playAnimation(name: string, loop = false): void {
    if (loop) this.animation.start(name);
    else this.animation.playOnce(name, this.onAnimationOver);
  }
  // PushAnimation is only used after the previous animation completed, so it plays immediately.
  pushAnimation(name: string, loop = false): void { this.playAnimation(name, loop); }
  isCurrentAnimation(name: string): boolean { return this.animation.currentAnimation === name; }
  getCurrentAnimationLength(): number { return BUTTERFLY_ANIMATION_LENGTHS.get(this.animation.currentAnimation)!; }
  stopPhysics(): void { this.motorSpeed = 0; }
  removePhysicsColliders(): void { /* flying creatures have no physics body in this world */ }
  setMotorSpeed(speed: number): void { this.motorSpeed = speed; }
  landFlyingCreature(): void { this.removeTag('flying'); this.PushEvent('on_landed'); }
  raiseFlyingCreature(): void { this.addTag('flying'); this.PushEvent('on_no_longer_landed'); }
  dropLoot(): void {
    const items = this.definition.generateLoot(() => this.random());
    const { x, y, z } = this.getPosition();
    this.dropLootItems?.(items, new THREE.Vector3(x, y, z));
  }
  remove(): void {
    if (this.removed) return;
    this.entity.remove();
    this.brain.Stop();
    this.stopPhysics();
    this.cleanups.splice(0).forEach(stop => stop());
  }
  isValid(): boolean { return !this.removed; }

  // --- lifecycle driven by the inventory entity
  get state(): ButterflyState { return this.removed ? 'removed' : this.sg.stateName; }
  get targetFlowerId(): string | undefined {
    const target = this.components.pollinator?.target;
    return target ? this.sharedEntities.idOf(target) : undefined;
  }

  onDropped(): void {
    this.inInventory = false;
    this.bufferedaction = undefined;
    this.brain.Stop();
    this.locomotor.Stop();
    this.sg.goToState('idle');
    this.brain.Start();
  }

  onPutInInventory(): void {
    this.brain.Stop();
    this.locomotor.Stop();
    this.bufferedaction = undefined;
    this.inInventory = true;
  }

  dispose(): void {
    this.onPutInInventory();
    this.cleanups.splice(0).forEach(stop => stop());
  }

  /** One frame: brain, locomotor, stategraph, then the physics motor. */
  update(dt: number): void {
    if (this.removed) return;
    const step = Math.max(0, Math.min(dt, 0.1));
    this.time += step;
    this.snapshot = this.sharedEntities.sync(this.butterflyWorld);
    this.brain.tick(this.time);
    if (this.locomotor.isUpdating) this.locomotor.update(step);
    if (this.removed) return;
    if (this.animationOver) {
      this.animationOver = false;
      this.sg.pushEvent('animover');
      if (this.removed) return;
    }
    this.sg.update(step);
    if (this.removed) return;
    this.stepMotor(step);
  }

  private stepMotor(dt: number): void {
    if (this.motorSpeed <= 0) return;
    const radians = this.rotation / RADIANS;
    const position = this.scratch.copy(this.transform.position);
    position.x += Math.cos(radians) * this.motorSpeed * dt;
    position.z -= Math.sin(radians) * this.motorSpeed * dt;
    this.butterflyWorld.constrainPosition?.(position);
    this.transform.position.copy(position);
  }

  private createWorld(): BrainWorld {
    const world = this.butterflyWorld;
    const creature = this;
    const candidates = (origin: LocoMotorPoint, radius: number): BrainEntity[] => {
      const { flowers, threats } = creature.snapshot;
      return [...threats, ...flowers,
        ...creature.getOthers(origin, radius).filter(other => other !== creature && other.isValid())];
    };
    const matches = (entity: BrainEntity, must?: readonly string[], cant?: readonly string[], oneOf?: readonly string[]) =>
      (must ?? []).every(tag => entity.hasTag(tag)) && !(cant ?? []).some(tag => entity.hasTag(tag))
      && (!oneOf?.length || oneOf.some(tag => entity.hasTag(tag)));
    const find = (from: BrainEntity, radius: number, must?: readonly string[], cant?: readonly string[], oneOf?: readonly string[]) => {
      const origin = from.getPosition();
      return candidates(origin, radius)
        .filter(entity => entity !== from && entity.isValid() && matches(entity, must, cant, oneOf)
          && distanceSquared(origin, entity.getPosition()) <= radius * radius)
        .sort((a, b) => distanceSquared(origin, a.getPosition()) - distanceSquared(origin, b.getPosition()));
    };
    return {
      // butterflybrain.lua tests isday when the behaviour tree evaluates its go-home branch.
      get isDay() { return (creature.cycle?.peek() ?? 'day') === 'day'; },
      findEntity: (from, radius, fn, must, cant, oneOf) =>
        find(from, radius, must, cant, oneOf).find(entity => fn === undefined || fn(entity, from)),
      getClosestInstWithTag: (tags, from, radius) => find(from, radius, tags)[0],
      isAboveGroundAtPoint: (x, _y, z) => {
        if (!world.constrainPosition) return true;
        const point = new THREE.Vector3(x, 0, z);
        world.constrainPosition(point);
        return point.x === x && point.z === z;
      },
    };
  }
}

/** Share original DST build textures across separately animated butterflies. */
export class ButterflyAssets {
  private readonly resources: SpriteResources;
  private disposed = false;
  constructor(assetBaseUrl: string) { this.resources = new SpriteResources(assetBaseUrl); }
  dispose(): void { this.disposed = true; this.resources.dispose(); }

  create(prefab: ButterflyPrefabId, world: ButterflyWorld,
    getOthers: (position: LocoMotorPoint, radius: number) => readonly ButterflyCreature[],
    dropLoot?: ButterflyCreature['dropLootItems'], entity?: ItemEntity) {
    if (this.disposed) throw new Error('Insect assets have been disposed');
    // butterfly.lua and moonbutterfly.lua share a bank; only the latter substitutes its build.
    const source = this.resources.factory({ animationArchive: 'butterfly_basic.zip', buildArchive: 'butterfly_basic.zip',
      skinArchive: prefab === BUTTERFLY_ID ? undefined : 'butterfly_moon.zip' });
    const name = `GroundItem:${prefab}`;
    entity ??= new ItemEntity({ itemId: prefab, count: 1 });
    const { instance, display } = createPrefabEntity(prefab, source, { name: 'idle_flight_loop', billboard: true, instance: entity }, name);
    const model = display.model;
    configureButterflyEntity(instance);
    const creature = instance.component('butterfly_creature', () => new ButterflyCreature(BUTTERFLY_DEFINITIONS[prefab], instance,
      instance.sprite, world, getOthers, undefined, dropLoot));
    return {
      model, instance, display, controller: creature,
      update: (dt: number) => creature.update(dt),
      isRemoved: () => instance.isRemoved,
      dispose() { display.dispose(); },
    };
  }
}

/** Keep the butterfly's flower-occupancy rules with its own prefab. */
export function createButterflyGroundSprite(
  assets: ButterflyAssets,
  world: ButterflyWorld,
  findEntities: (position: THREE.Vector3, radius: number, mustTags: readonly string[]) => readonly FoundEntity[],
  prefab: ButterflyPrefabId = BUTTERFLY_ID,
  dropLoot?: ButterflyCreature['dropLootItems'],
  /** The original logical item, whose controller and components survive pickup and dropping. */
  entity?: ItemEntity,
) {
  let model: THREE.Group | undefined;
  const origin = new THREE.Vector3();
  const visual = assets.create(prefab, world, (position, radius) => findEntities(origin.set(position.x, position.y, position.z), radius, ['butterfly'])
    .flatMap(neighbour => {
      const neighbourModel = (neighbour as { model?: THREE.Object3D }).model;
      const creature = neighbourModel !== model
        ? (neighbourModel && prefabInstance<ItemEntity>(neighbourModel)?.getComponent<ButterflyCreature>('butterfly_creature')) : undefined;
      return creature ? [creature] : [];
    }), dropLoot, entity);
  model = visual.model;
  return { ...visual, get controller() { return visual.controller; }, isRemoved: () => visual.controller?.removed ?? false };
}

/** Back-compat name for the live inst driving a ground butterfly's model. */
export { ButterflyCreature as ButterflyController };

export function createButterflyGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const assets = new ButterflyAssets(context.animationBaseUrl);
  const dropLoot = (itemIds: readonly string[], position: THREE.Vector3) => {
    const counts = new Map<string, number>();
    for (const itemId of itemIds) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    const items: GroundItemDefinition[] = [...counts].map(([itemId, count]) => ({
      ...catalog.items[itemId as keyof typeof catalog.items], itemId, count,
    }));
    context.dropLoot?.(items, position);
  };
  return {
    itemIds: [BUTTERFLY_ID, MOONBUTTERFLY_ID], capture: 'net',
    configureEntity: entity => {
      (entity.prefab === MOONBUTTERFLY_ID ? configureMoonButterflyEntity : configureButterflyEntity)(entity);
      if (entity.prefab === BUTTERFLY_ID && !entity.components.inventoryitem.owner) entity.components.perishable.StopPerishing();
    },
    create: (definition, inst) => {
      const prefab = definition.itemId === MOONBUTTERFLY_ID ? MOONBUTTERFLY_ID : BUTTERFLY_ID;
      const visual = createButterflyGroundSprite(assets, context.butterflyWorld,
        (position, radius, mustTags) => FindEntities(position, radius, mustTags), prefab, dropLoot, inst);
      if (prefab === MOONBUTTERFLY_ID) bindMoonButterflyVisual(visual);
      return visual;
    },
    dispose: () => assets.dispose(),
  };
}

// moonbutterfly.lua light: radius .5, intensity .5 flickering, falloff .8, colour (.3, .55, .45), light override .15.
const LIGHT_RADIUS = .5 * (TILE_SIZE / 4), LIGHT_INTENSITY = .5, LIGHT_FALLOFF = .8;

function bindMoonButterflyVisual(visual: Awaited<ReturnType<typeof createButterflyGroundSprite>>): void {
  const { model } = visual;
  let flickerTime = 0, flickerElapsed = 0, lit = true;
  const setLight = (intensity: number) => prefabInstance(model)!.light.set(lit
    ? { colour: [.3, .55, .45], radius: LIGHT_RADIUS, intensity, falloff: LIGHT_FALLOFF } : null);
  const sprite = prefabInstance(model)!.sprite;
  sprite.setLightOverride(.15);
  setLight(LIGHT_INTENSITY);
  const update = visual.update;
  // OnUpdateFlicker runs every .1s: intensity = .5 + .05 * (1 + sin(t * .7 + sin(t * 6.28))) / 2, t in 15x seconds.
  visual.update = (dt: number) => {
    update(dt);
    flickerElapsed += dt;
    while (flickerElapsed >= .1) {
      flickerElapsed -= .1;
      flickerTime += .1;
      const time = flickerTime * 15;
      const flicker = (1 + Math.sin(time * .7 + Math.sin(time * 6.28))) * .5;
      setLight(LIGHT_INTENSITY + .05 * flicker);
    }
  };
  const entity = visual.instance;
  const stops: (() => void)[] = [];
  stops.push(entity.ListenForEvent('perished', () => {
    if (entity.components.inventoryitem.owner || visual.controller?.removed) return;
    // onperish: the net no longer works, the light goes out, then `death` and removal after 3 seconds.
    entity.components.workable?.SetWorkable(false);
    lit = false;
    setLight(0);
    sprite.setLightOverride(null);
    visual.controller?.addTag('dead');
    visual.controller?.removeTag('spore');
    visual.controller?.PushEvent('death');
    entity.persists = false;
    const scheduler = entity.components.perishable.scheduler;
    if (!scheduler) throw new Error('Moon butterfly decay requires the world scheduler');
    const removal = new ComponentTimer(scheduler, () => entity.remove());
    entity.onRemove(() => removal.stop());
    removal.start(3);
  }));
  stops.push(entity.ListenForEvent('onputininventory', () => { lit = false; setLight(0); }));
  stops.push(entity.ListenForEvent('ondropped', () => {
    lit = true;
    visual.controller?.components.knownlocations?.RememberLocation('home', visual.controller.getPosition());
    setLight(LIGHT_INTENSITY);
  }));
  const dispose = visual.dispose;
  visual.dispose = () => { stops.splice(0).forEach(stop => stop()); dispose(); };
}
