import { definePrefabIds } from './prefabRegistration';
import { addComponent, removeComponent } from './components';
import { SpriteState } from '@dontstarve-web/display';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Health } from '../../componets/src/health';
import { Combat } from '../../componets/src/combat';
import { Workable } from '../../componets/src/workable';
import { Repairable } from '../../componets/src/repairable';
import { InventoryItem } from '../../componets/src/inventoryitem';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { RoseInspectable } from '../../componets/src/pandoraschestSignatures';
import { FurnitureDecor, InventoryItemMoisture, Sittable } from '../../componets/src/ruinsrelicSignatures';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabInstance, type PrefabComponents, type PrefabEntityDefinition } from './prefabInstance';
import { MakeInventoryFloatable, MakeObstaclePhysics } from './standardcomponents';
import { clearPersistData, type EntityPersistData, structureHealth } from './saveRecord';
import type { ReadonlyVector3 } from './transform';
import type { WorldContext } from './worldContext';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import { LootDropper } from '../../componets/src/lootdropper';

export const RELIC_NAMES = ['table', 'chair', 'vase', 'chipbowl', 'bowl', 'plate'] as const;
type RelicName = (typeof RELIC_NAMES)[number];
export type RuinsRelicId =
  | `ruinsrelic_${RelicName}`
  | `ruins_${RelicName}`
  | `ruins_rubble_${'table' | 'chair' | 'vase'}`;
export const RUINS_RELIC_IDS: readonly RuinsRelicId[] = [
  ...RELIC_NAMES.map(name => `ruinsrelic_${name}` as const),
  ...RELIC_NAMES.map(name => `ruins_${name}` as const),
  'ruins_rubble_table',
  'ruins_rubble_chair',
  'ruins_rubble_vase',
];
export const RUINS_RELIC_ITEM_IDS = [
  'ruinsrelic_vase',
  'ruinsrelic_chipbowl',
  'ruinsrelic_bowl',
  'ruinsrelic_plate',
] as const;
export const RUINS_CHAIR_SKINS = {
  ruinsrelic_chair_tesla: 'dynamic/ruinsrelic_chair_tesla.zip',
  ruinsrelic_chair_toilet: 'dynamic/ruinsrelic_chair_toilet.zip',
} as const;
export interface RuinsRelicSaveState {
  rubble?: true;
}
export interface RelicMoistureSave {
  moisture?: number;
  wet?: true;
}
export interface RuinsRelicWorld {
  scheduler: GameTimeScheduler;
  fx?: WorldContext['fx'];
  dropLoot?: WorldContext['dropLoot'];
}
export function relicName(id: RuinsRelicId): RelicName {
  const name = RELIC_NAMES.find(relic => id.endsWith(`_${relic}`));
  if (!name) {
    throw new Error(`${id} names no relic`);
  }
  return name;
}
/** ruinsrelic.lua's replicas, as opposed to smashables.lua's natural relics and rubble. */
export function isRelicReplica(id: RuinsRelicId): id is `ruinsrelic_${RelicName}` {
  return id.startsWith('ruinsrelic_');
}

/** The skins a relic prefab takes: only the replica chair has any. */
export function relicSkins(id: RuinsRelicId): typeof RUINS_CHAIR_SKINS | undefined {
  return id === 'ruinsrelic_chair' ? RUINS_CHAIR_SKINS : undefined;
}

export function isRelicItem(id: string): id is (typeof RUINS_RELIC_ITEM_IDS)[number] {
  return RUINS_RELIC_ITEM_IDS.some(known => known === id);
}

/** ruinsrelic.lua item.OnHammered: collapse material, then recipe salvage and Remove. */
function onhammered(inst: RuinsRelicInstance | ItemEntity): void {
  const material = inst.prefab === 'ruinsrelic_table' || inst.prefab === 'ruinsrelic_chair' ? 'rock' : 'pot';
  inst.worldServices?.fx?.collapse?.('small', inst.getPosition(), material);
  inst.components.lootdropper!.DropLoot();
  inst.remove();
}

/** The replica decor's inventory path shares the same constructor-only dependencies. */
export function configureRuinsRelicItem(inst: ItemEntity): void {
  if (!isRelicItem(inst.prefab)) {
    return;
  }
  const scheduler = inst.components.perishable.scheduler;
  if (scheduler && !inst.components.hauntable) {
    addComponent(inst, 'hauntable', Hauntable, scheduler).SetOnHauntFn(() => false);
  }
  if ('furnituredecor' in inst.components) {
    return;
  }
  inst.addTag('furnituredecor');
  addComponent(inst, 'furnituredecor', FurnitureDecor);
  // The item's MakeInventoryFloatable comes from the ground item catalog with its world (bindItemWorld).
  addComponent(inst, 'inventoryitemmoisture', InventoryItemMoisture);
  addComponent(inst, 'inspectable', Inspectable).SetNameOverride('relic');
  addComponent(inst, 'lootdropper', LootDropper, spawnStructureLoot(inst), STRUCTURE_LOOT_RECIPES);
  const workable = addComponent(inst, 'workable', Workable);
  workable.SetWorkAction('HAMMER');
  workable.SetWorkLeft(1);
  workable.SetOnFinishCallback(onhammered);
}

/** ruinsrelic.lua fn, or smashables.lua makefn -> OnPreLoad -> health.OnLoad. No art IO. */
export class RuinsRelicInstance extends PrefabInstance<SpriteState> {
  declare readonly components: PrefabComponents & { sittable?: Sittable };
  readonly prefabId: RuinsRelicId;
  readonly replica: boolean;
  readonly name: RelicName;
  readonly animated: boolean;
  rubble = false;
  constructor(prefabId: RuinsRelicId, world: RuinsRelicWorld, position: ReadonlyVector3) {
    const initialRubble = prefabId.startsWith('ruins_rubble_');
    super(prefabId, new SpriteState({ name: initialRubble ? 'broken' : 'idle', held: true, billboard: true }));
    this.worldServices = world;
    this.prefabId = prefabId;
    this.name = relicName(prefabId);
    this.replica = isRelicReplica(prefabId);
    this.animated = ['table', 'chair', 'vase'].includes(this.name);
    this.setPosition(position.x, 0, position.z);
    this.sprite.playOnce(initialRubble ? 'broken' : 'idle');
    // ruinsrelic.lua and smashables.lua: a chair's AnimState:SetFinalOffset(-1).
    if (this.name === 'chair') {
      this.sprite.setBehindFoot(true);
    }
    addComponent(this, 'inspectable', Inspectable).SetNameOverride('relic');
    addComponent(this, 'lootdropper', LootDropper, spawnStructureLoot(this), STRUCTURE_LOOT_RECIPES);
    const hauntable = addComponent(this, 'hauntable', Hauntable, world.scheduler);
    // standardcomponents.lua MakeHauntableWork's work callback is commented out; it returns false.
    hauntable.SetOnHauntFn(() => false);
    if (this.replica) {
      this.constructReplica();
    } else {
      this.constructNatural(world, initialRubble);
    }
  }

  private constructReplica(): void {
    const workable = addComponent(this, 'workable', Workable);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(1);
    workable.SetOnFinishCallback(onhammered);
    if (isRelicItem(this.prefabId)) {
      this.addTag('furnituredecor');
      addComponent(this, 'inventoryitem', InventoryItem);
      // MakeInventoryFloatable(inst, "small", FLOATER_VERT_OFFSET, 0.95).
      MakeInventoryFloatable(this, 'small', this.name === 'vase' || this.name === 'bowl' ? 0.3 : 0.1, 0.95);
      addComponent(this, 'furnituredecor', FurnitureDecor);
      addComponent(this, 'inventoryitemmoisture', InventoryItemMoisture);
    } else {
      this.deploySmartRadius = this.name === 'chair' ? 1 : 1.6;
      if (this.name === 'chair') {
        MakeChair(this);
      }
    }
  }
  private constructNatural(world: RuinsRelicWorld, rubble: boolean): void {
    for (const tag of [
      'cavedweller',
      'smashable',
      'object',
      this.name === 'table' || this.name === 'chair' ? 'stone' : 'clay',
      'noauradamage',
      'electricdamageimmune',
    ]) {
      this.addTag(tag);
    }
    this.minimap.SetIcon('relic.png');
    this.deploySmartRadius = this.name === 'table' ? 1.6 : ['chair', 'vase', 'bowl'].includes(this.name) ? 1 : 0.25;
    const health = addComponent(this, 'health', Health, 90 + (Math.random() * 2 - 1) * 20);
    health.nofadeout = true;
    health.canheal = false;
    const combat = addComponent(this, 'combat', Combat, () => world.scheduler.now);
    combat.SetKeepTargetFunction(() => false);
    if (this.animated) {
      combat.onhitfn = () => OnHit(this);
    }
    addComponent(this, 'roseinspectable', RoseInspectable);
    health.ondelta = (_, old, current) => OnHealthDelta(this, old, current);
    SetRubble(this, rubble);
    health.SetPercent(rubble ? 0.2 : 0.8);
  }
}

function OnHealthDelta(inst: RuinsRelicInstance, old: number, current: number): void {
  if (!inst.rubble && current < 0.5 && current < old) {
    if (inst.animated) {
      inst.sprite.playOnce('repair');
    }
    SetRubble(inst, true);
  }
}

function MakeChair(inst: RuinsRelicInstance): void {
  addComponent(inst, 'sittable', Sittable);
  // Sittable derives its own cansit tag.
  for (const tag of ['structure', 'limited_chair', 'uncomfortable_chair']) {
    inst.addTag(tag);
  }
}

function OnRepaired(inst: RuinsRelicInstance): void {
  if (inst.components.health!.GetPercent() >= 1) {
    if (inst.animated) {
      inst.sprite.playOnce('hit');
    }
    SetRubble(inst, false);
  } else {
    OnHit(inst);
  }
}

/** smashables.lua SetIsRubble and MakeRubble / MakeRelic for the ported relics. */
function SetRubble(inst: RuinsRelicInstance, rubble: boolean): void {
  inst.rubble = rubble;
  inst.components.inspectable!.SetNameOverride(rubble ? 'ruins_rubble' : 'relic');
  if (rubble) {
    if (!inst.components.repairable) {
      const repairable = addComponent(inst, 'repairable', Repairable, undefined, 'stone');
      repairable.onrepaired = () => OnRepaired(inst);
    }
    if (inst.name === 'chair') {
      removeComponent(inst, 'sittable');
      for (const tag of ['structure', 'limited_chair']) {
        inst.removeTag(tag);
      }
    }
  } else {
    removeComponent(inst, 'repairable');
    if (inst.name === 'chair') {
      MakeChair(inst);
    }
  }
  const clip = rubble ? 'broken' : 'idle';
  if (inst.animated) {
    inst.sprite.pushAnimation(clip, false);
  } else {
    inst.sprite.playOnce(clip);
  }
}

function OnHit(inst: RuinsRelicInstance): void {
  if (inst.animated) {
    inst.sprite.playOnce(inst.rubble ? 'repair' : 'hit');
    inst.sprite.pushAnimation(inst.rubble ? 'broken' : 'idle', false);
  }
}

/** smashables.lua OnPreLoad sets maxhealth and restores the rubble components before health.OnLoad. */
function OnPreLoad(inst: RuinsRelicInstance, data: EntityPersistData): void {
  const saved = structureHealth(data);
  if (saved) {
    inst.components.health!.SetMaxHealth(saved.maximum);
  }
  const rubble = data.ruinsRelic?.rubble === true;
  if (rubble !== inst.rubble) {
    SetRubble(inst, rubble);
  }
}

/** smashables.lua OnSave; replicas preserve the moisture record from ruinsrelic.lua. */
function OnSave(inst: RuinsRelicInstance, data: EntityPersistData): void {
  const health = inst.components.health;
  clearPersistData(data);
  if (inst.replica) {
    const moisture = inst.saveRecord?.components.inventoryitemmoisture;
    if (moisture) {
      data.inventoryitemmoisture = { ...moisture };
    }
  } else {
    if (inst.rubble) {
      data.ruinsRelic = { rubble: true };
    }
    data.health = { current: health!.currenthealth, maximum: health!.maxhealth };
  }
}

/** The Prefabs ruinsrelic.lua and smashables.lua return: six replicas, six natural relics and three rubble pieces. */
export function ruinsRelicPrefabs(
  world: RuinsRelicWorld,
): Readonly<Record<RuinsRelicId, PrefabEntityDefinition<RuinsRelicInstance>>> {
  const define = (id: RuinsRelicId): PrefabEntityDefinition<RuinsRelicInstance> => {
    const name = relicName(id),
      bank = `ruins_${name}`,
      replica = isRelicReplica(id);
    // MakeObstaclePhysics: replica chair .25 and table .5; every natural relic .25; replica decor has inventory physics.
    const radius = replica ? (name === 'chair' ? 0.25 : name === 'table' ? 0.5 : undefined) : 0.25;
    const skins = relicSkins(id);
    return {
      fn: position => {
        const inst = new RuinsRelicInstance(id, world, position);
        inst.OnSave = OnSave;
        if (!replica) {
          inst.OnPreLoad = OnPreLoad;
        }
        return inst;
      },
      assets: { bank, animationArchive: `${bank}.zip`, buildArchives: [`${bank}.zip`] },
      assetOptions: { instancedAnimations: 'all' },
      ...(radius === undefined ? {} : { physics: { make: MakeObstaclePhysics, radius } }),
      ...(skins ? { skins } : {}),
    };
  };
  return Object.fromEntries(RUINS_RELIC_IDS.map(id => [id, define(id)])) as Record<
    RuinsRelicId,
    PrefabEntityDefinition<RuinsRelicInstance>
  >;
}

export const ruinsRelicRegistration = {
  create: ruinsRelicPrefabs,
  families: { ruinsRelics: definePrefabIds(RUINS_RELIC_IDS, true) },
};
