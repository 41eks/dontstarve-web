import { addComponent } from './components';
import * as THREE from 'three';
import { WorldContentKey, type GetWatchWorldContent, type WorldContentSignal, type WorldPhase } from '@dontstarve-web/signals';
import type { GroundItemDefinition, ItemPrefabWorld } from './groundPrefab';
import { ItemEntity } from '@dontstarve-web/inventory';
import { bindItemWorld, dropStackIndividually, type ItemPrefabDefinition, GROUND_ITEM_DEFINITIONS } from './groundItems';
import { TOTAL_DAY_TIME } from '../../componets/src/perishable';
import { Deployable } from '../../componets/src/deployable';
import { ButterflyStateGraph, type ButterflyStateInst, type ButterflyStateName } from '../../stategraphs/src/SGbutterfly';
import { LocoMotor, type LocoMotorInst } from '../../componets/src/locomotor';
import { KnownLocations } from '../../componets/src/knownlocations';
import { Pollinator } from '../../componets/src/pollinator';
import { Workable } from '../../componets/src/workable';
import { Brain } from '../../brains/src/brain';
import { ButterflyBrain } from '../../brains/src/butterflybrain';
import { MoonButterflyBrain } from '../../brains/src/moonbutterflybrain';
import { RADIANS } from '../../brains/src/simutil';
import type { BrainEntity, BrainInst, BrainWorld } from '../../brains/src/types';
import { MOONBUTTERFLY_PERISH_INV_MODIFIER, MOONBUTTERFLY_PERISH_TIME, MOONBUTTERFLY_SPEED } from './moonbutterflyTuning';
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import { animationLengths } from './animationTimings';

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
    if (entity.prefab === MOONBUTTERFLY_ID) addComponent(entity, 'deployable', Deployable, (point, _deployer, map) => {
        // moonbutterfly.lua OnDeploy.
        if (!map.SpawnPrefab('moonbutterfly_sapling', point)) return false;
        PlaySound('dontstarve/wilson/plant_tree', point);
        entity.remove();
        return true;
      }, { mode: 'PLANT', spacing: 3.2 * (TILE_SIZE / 4), placer: { bank: 'baby_moon_tree', build: 'baby_moon_tree', animation: 'idle' } });
    else addComponent(entity, 'deployable', Deployable, (point, deployer, map) => {
        // butterfly.lua OnDeploy.
        const flower = map.SpawnPrefab('planted_flower', point);
        if (!flower) return false;
        flower.PushEvent('growfrombutterfly');
        entity.remove();
        PlaySound('dontstarve/common/plant', deployer.position);
        return true;
      }, { mode: 'PLANT', spacing: .75 * (TILE_SIZE / 4), placer: { bank: 'flowers', build: 'flowers', animation: 'f1' } });
  }
  if (entity.prefab === BUTTERFLY_ID) {
    entity.addTag('small_livestock');
    entity.addTag('show_spoilage');
    const perishable = entity.components.perishable;
    perishable.localMultiplier = () => entity.components.inventoryitem.owner ? 1 : 0;
    perishable.perishfn = () => {
      const owner = entity.components.inventoryitem.owner, slot = entity.components.inventoryitem.slot;
      if (!owner) return;
      const count = entity.components.stackable.count;
      const position = entity.components.inventoryitem.GetHeldPosition()?.clone();
      const loot = new Map<string, number>();
      for (let i = 0; i < count; i++) for (const prefab of BUTTERFLY_DEFINITIONS.butterfly.generateLoot(Math.random)) {
        loot.set(prefab, (loot.get(prefab) ?? 0) + 1);
      }
      owner.PushEvent('murdered', { victim: entity, stackmult: count, negligent: true });
      if (entity.remove()) for (const [itemId, amount] of loot) {
        const item = entity.worldServices?.spawnItem?.({ itemId, count: amount });
        if (!item) continue;
        if (position) item.setPosition(position.x, position.y, position.z);
        slot?.GiveItem?.(item);
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
  if (!entity.components.workable) {
    const workable = addComponent(entity, 'workable', Workable);
    workable.SetWorkAction('NET');
    workable.SetWorkLeft(1);
    workable.SetOnFinishCallback((_inst, worker) => {
      worker.components?.inventory?.GiveItem?.(entity, entity.transform.position);
      if (worker.components?.inventory) PlaySound('dontstarve/common/butterfly_trap', entity.transform.position);
    });
    entity.ListenForEvent('ondropped', () => workable.SetWorkLeft(1));
  }
}

/** moonbutterfly.lua: it spoils four times slower in an inventory and is simply removed if it perishes there. */
export function configureMoonButterflyEntity(entity: ItemEntity): void {
  configureButterflyEntity(entity);
  const perishable = entity.components.perishable;
  perishable.localMultiplier = () => entity.components.inventoryitem.owner ? MOONBUTTERFLY_PERISH_INV_MODIFIER : 1;
  perishable.perishfn = () => {
    entity.components.inventoryitem.slot?.remove();
  };
}

/** TheWorld as the butterflies read it besides TheSim: the day cycle and the world's edge. */
export interface ButterflyWorld {
  getWatchWorldContent?: GetWatchWorldContent;
  /** Flying creatures ignore obstacles, but cannot leave the world. */
  constrainPosition?(position: THREE.Vector3): void;
}

export type ButterflyState = ButterflyStateName | 'removed';

export interface ButterflyAnimation {
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

/** What the butterfly's fn takes from the world besides its item registry. */
export interface ButterflyServices {
  readonly random?: () => number;
  /** lootdropper:DropLoot's item spawns at the butterfly's position. */
  readonly dropLoot?: (itemIds: readonly string[], position: THREE.Vector3) => void;
  /** AnimState, when the sprite json's own playback is not the one being driven. */
  readonly animation?: ButterflyAnimation;
}

/**
 * The butterfly or moonbutterfly inst of butterfly.lua and moonbutterfly.lua: an inventory item whose locomotor,
 * stategraph (SGbutterfly.lua) and brain (the *brain.lua files) are its own. SetBrain's brain stops in limbo and while the
 * entity sleeps; UpdateButterfly advances it, the locomotor, the stategraph and the physics motor once a frame.
 */
export class ButterflyEntity extends ItemEntity implements BrainInst, LocoMotorInst {
  readonly definition: ButterflyDefinition;
  /** The brain's TheWorld: isday, and FindEntities over the flowers, the threats and the other butterflies. */
  world!: BrainWorld;
  locomotor!: LocoMotor;
  /** SetStateGraph("SGbutterfly"). */
  stategraph!: ButterflyStateGraph;
  /** Held in an inventory: the creature neither thinks nor moves. */
  inInventory = false;
  get removed(): boolean { return this.inInventory || this.isRemoved; }
  /** Physics:SetMotorVel's speed along the heading. */
  motorSpeed = 0;
  /** GetTime() of the creature's own frames. */
  time = 0;
  animation!: ButterflyAnimation;
  /** The engine's animover, buffered like SG events in stategraph.lua and handled on the next stategraph update. */
  animationOver = false;
  butterflyWorld!: ButterflyWorld;
  cycle?: WorldContentSignal<WorldPhase>;
  randomSource: () => number = Math.random;
  dropLootItems?: ButterflyServices['dropLoot'];
  readonly scratch = new THREE.Vector3();

  constructor(definition: ButterflyDefinition, ...item: ConstructorParameters<typeof ItemEntity>) {
    super(...item);
    this.definition = definition;
  }

  // conventions-allow instance-method: GetTime(), which the brain's behaviours call on inst.
  getTime(): number { return this.time; }
  // conventions-allow instance-method: math.random, which the brain's behaviours call on inst.
  random(): number { return this.randomSource(); }
  // conventions-allow instance-method: the engine's Physics:SetMotorVel, which locomotor calls on inst.
  setMotorSpeed(speed: number): void { this.motorSpeed = speed; }

  get state(): ButterflyState { return this.removed ? 'removed' : this.stategraph.stateName; }
}

/** butterfly.lua fn()'s creature: tags, locomotor, knownlocations, pollinator, SetStateGraph and SetBrain. */
export function MakeButterflyCreature(inst: ButterflyEntity, butterflyWorld: ButterflyWorld, services: ButterflyServices = {}): void {
  const { definition } = inst;
  inst.animation = services.animation ?? inst.sprite;
  inst.butterflyWorld = butterflyWorld;
  inst.cycle = butterflyWorld.getWatchWorldContent?.(WorldContentKey.Cycle, stop => inst.onRemove(stop));
  if (services.random) inst.randomSource = services.random;
  inst.dropLootItems = services.dropLoot;
  for (const tag of definition.tags) inst.addTag(tag);
  inst.world = createBrainWorld(inst);
  // locomotor must be constructed before the stategraph.
  inst.locomotor = addComponent(inst, 'locomotor', LocoMotor);
  if (definition.walkspeed !== undefined) inst.locomotor.walkspeed = definition.walkspeed;
  addComponent(inst, 'knownlocations', KnownLocations);
  if (definition.pollinates) addComponent(inst, 'pollinator', Pollinator<BrainEntity>);
  inst.stategraph = new ButterflyStateGraph(stateContext(inst));
  inst.SetStateGraph(() => inst.stategraph.sg);
  inst.SetBrain(definition.createBrain);
  inst.ListenForEvent('ondropped', OnDropped);
  inst.ListenForEvent('onputininventory', OnPutInInventory);
  inst.onRemove(() => { inst.motorSpeed = 0; });
  // OnDropped explicitly enters idle rather than the graph's initial takeoff.
  OnDropped(inst);
}

/** SGbutterfly's inst: the entity's AnimState, Physics, lootdropper and buffered action. */
function stateContext(inst: ButterflyEntity): ButterflyStateInst {
  const playAnimation = (name: string, loop = false) => {
    if (loop) inst.animation.start(name);
    else inst.animation.playOnce(name, () => { inst.animationOver = true; });
  };
  return {
    locomotor: inst.locomotor,
    get bufferedaction() { return inst.bufferedaction; },
    playAnimation,
    // PushAnimation is only used after the previous animation completed, so it plays immediately.
    pushAnimation: playAnimation,
    isCurrentAnimation: name => inst.animation.currentAnimation === name,
    getCurrentAnimationLength: () => {
      const length = BUTTERFLY_ANIMATION_LENGTHS.get(inst.animation.currentAnimation);
      if (length === undefined) throw new Error(`butterfly_basic.zip has no animation ${inst.animation.currentAnimation}`);
      return length;
    },
    stopPhysics: () => { inst.motorSpeed = 0; },
    // Flying creatures have no physics body in this world.
    removePhysicsColliders: () => {},
    landFlyingCreature: () => { inst.removeTag('flying'); inst.PushEvent('on_landed'); },
    raiseFlyingCreature: () => { inst.addTag('flying'); inst.PushEvent('on_no_longer_landed'); },
    performBufferedAction: () => inst.PerformBufferedAction(),
    dropLoot: () => {
      const items = inst.definition.generateLoot(() => inst.random());
      const { x, y, z } = inst.getPosition();
      inst.dropLootItems?.(items, new THREE.Vector3(x, y, z));
    },
    remove: () => inst.remove(),
    random: () => inst.random(),
  };
}

/** butterfly.lua OnDropped: inst.sg:GoToState("idle"). */
function OnDropped(inst: ButterflyEntity): void {
  inst.inInventory = false;
  inst.bufferedaction = undefined;
  inst.locomotor.Stop();
  inst.stategraph.goToState('idle');
}

function OnPutInInventory(inst: ButterflyEntity): void {
  inst.locomotor.Stop();
  inst.bufferedaction = undefined;
  inst.inInventory = true;
}

/** One frame: brain, locomotor, stategraph, then the physics motor. */
export function UpdateButterfly(inst: ButterflyEntity, dt: number): void {
  if (inst.removed) return;
  const step = Math.max(0, Math.min(dt, 0.1));
  inst.time += step;
  inst.brain?.tick(inst.time);
  if (inst.locomotor.isUpdating) inst.locomotor.update(step);
  if (inst.removed) return;
  if (inst.animationOver) {
    inst.animationOver = false;
    inst.PushEvent('animover');
    if (inst.removed) return;
  }
  inst.stategraph.update(step);
  if (inst.removed) return;
  stepMotor(inst, step);
}

function stepMotor(inst: ButterflyEntity, dt: number): void {
  if (inst.motorSpeed <= 0) return;
  const radians = inst.rotation / RADIANS;
  const position = inst.scratch.copy(inst.transform.position);
  position.x += Math.cos(radians) * inst.motorSpeed * dt;
  position.z -= Math.sin(radians) * inst.motorSpeed * dt;
  inst.butterflyWorld.constrainPosition?.(position);
  inst.transform.setPosition(position.x, position.y, position.z);
}

/** The brain's TheWorld: simutil.lua FindEntity / GetClosestInstWithTag over TheSim, and isday. */
function createBrainWorld(inst: ButterflyEntity): BrainWorld {
  const world = inst.butterflyWorld;
  // Transform:GetWorldPosition of the searcher, which the brain passes as a BrainEntity.
  const origin = new THREE.Vector3();
  const at = (from: BrainEntity) => { const { x, y, z } = from.getPosition(); return origin.set(x, y, z); };
  return {
    // butterflybrain.lua tests isday when the behaviour tree evaluates its go-home branch.
    get isDay() { return (inst.cycle?.peek() ?? 'day') === 'day'; },
    // FindEntity skips the searcher and entities that are not visible, those in limbo among them.
    findEntity: (from, radius, fn, must, cant, oneOf) => inst.TheSim.FindEntities(at(from), radius, must, cant, oneOf)
      .find(entity => entity !== from && entity.IsVisible() && !entity.inlimbo && (!fn || fn(entity, from))),
    getClosestInstWithTag: (tags, from, radius) => {
      const [first, second] = inst.TheSim.FindEntities(at(from), radius, tags);
      return first !== from ? first : second;
    },
    isAboveGroundAtPoint: (x, _y, z) => {
      if (!world.constrainPosition) return true;
      const point = new THREE.Vector3(x, 0, z);
      world.constrainPosition(point);
      return point.x === x && point.z === z;
    },
  };
}

/**
 * butterfly.lua and moonbutterfly.lua: the creature's brain, stategraph and locomotor run while it flies awake in the
 * world; OnDropped lets a stack go one insect at a time.
 */
export function butterflyPrefabs(world: ItemPrefabWorld): Record<ButterflyPrefabId, ItemPrefabDefinition> {
  const dropLoot = (itemIds: readonly string[], position: THREE.Vector3) => {
    const counts = new Map<string, number>();
    for (const itemId of itemIds) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    const items: GroundItemDefinition[] = [...counts].map(([itemId, count]) => ({
      ...GROUND_ITEM_DEFINITIONS[itemId], itemId, count,
    }));
    world.dropLoot?.(items, position);
  };
  const definition = (prefab: ButterflyPrefabId): ItemPrefabDefinition => ({
    fn: () => {
      const inst = world.newItem(prefab, (...item) => new ButterflyEntity(BUTTERFLY_DEFINITIONS[prefab], ...item));
      inst.sprite.resetPresentation({ name: 'idle_flight_loop', billboard: true });
      bindItemWorld(inst, world);
      return inst;
    },
    // butterfly.lua and moonbutterfly.lua share a bank; only the latter substitutes its build.
    source: world.sprites.factory({ animationArchive: 'butterfly_basic.zip', buildArchive: 'butterfly_basic.zip',
      skinArchive: prefab === BUTTERFLY_ID ? undefined : 'butterfly_moon.zip' }),
    onSpawned: inst => {
      world.configureItem(inst);
      (prefab === MOONBUTTERFLY_ID ? configureMoonButterflyEntity : configureButterflyEntity)(inst);
      if (prefab === BUTTERFLY_ID && !inst.components.inventoryitem.owner) inst.components.perishable.StopPerishing();
      if (!(inst instanceof ButterflyEntity)) return;
      MakeButterflyCreature(inst, world.butterflyWorld, { dropLoot });
      const flicker = prefab === MOONBUTTERFLY_ID ? bindMoonButterfly(inst) : undefined;
      inst.onRemove(world.componentUpdates.register({
        OnUpdate: dt => {
          if (inst.status.peek() !== 'active') return;
          UpdateButterfly(inst, dt);
          flicker?.(dt);
        },
      }));
      inst.ListenForEvent('ondropped', () => dropStackIndividually(inst, world));
    },
  });
  return { [BUTTERFLY_ID]: definition(BUTTERFLY_ID), [MOONBUTTERFLY_ID]: definition(MOONBUTTERFLY_ID) };
}

// moonbutterfly.lua light: radius .5, intensity .5 flickering, falloff .8, colour (.3, .55, .45), light override .15.
const LIGHT_RADIUS = .5 * (TILE_SIZE / 4), LIGHT_INTENSITY = .5, LIGHT_FALLOFF = .8;

/** moonbutterfly.lua: its flickering light, and onperish in the world. Returns OnUpdateFlicker's frame step. */
function bindMoonButterfly(entity: ButterflyEntity): (dt: number) => void {
  let flickerTime = 0, flickerElapsed = 0, lit = true;
  const setLight = (intensity: number) => entity.light.set(lit
    ? { colour: [.3, .55, .45], radius: LIGHT_RADIUS, intensity, falloff: LIGHT_FALLOFF } : null);
  const sprite = entity.sprite;
  sprite.setLightOverride(.15);
  setLight(LIGHT_INTENSITY);
  entity.ListenForEvent('perished', () => {
    if (entity.components.inventoryitem.owner || entity.removed) return;
    // onperish: the net no longer works, the light goes out, then `death` and removal after 3 seconds.
    entity.components.workable?.SetWorkable(false);
    lit = false;
    setLight(0);
    sprite.setLightOverride(null);
    entity.addTag('dead');
    entity.removeTag('spore');
    entity.PushEvent('death');
    entity.persists = false;
    entity.DoTaskInTime(3, inst => inst.remove());
  });
  entity.ListenForEvent('onputininventory', () => { lit = false; setLight(0); });
  entity.ListenForEvent('ondropped', () => {
    lit = true;
    entity.components.knownlocations?.RememberLocation('home', entity.getPosition());
    setLight(LIGHT_INTENSITY);
  });
  // OnUpdateFlicker runs every .1s: intensity = .5 + .05 * (1 + sin(t * .7 + sin(t * 6.28))) / 2, t in 15x seconds.
  return dt => {
    flickerElapsed += dt;
    while (flickerElapsed >= .1) {
      flickerElapsed -= .1;
      flickerTime += .1;
      const time = flickerTime * 15;
      const flicker = (1 + Math.sin(time * .7 + Math.sin(time * 6.28))) * .5;
      setLight(LIGHT_INTENSITY + .05 * flicker);
    }
  };
}
