import { prefabDisplay, SpriteState } from '@dontstarve-web/display';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Health } from '../../componets/src/health';
import { Combat } from '../../componets/src/combat';
import { Workable } from '../../componets/src/workable';
import { Repairable } from '../../componets/src/repairable';
import { InventoryItem } from '../../componets/src/inventoryitem';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { RoseInspectable } from '../../componets/src/pandoraschestSignatures';
import { Floater, FurnitureDecor, InventoryItemMoisture, Sittable } from '../../componets/src/ruinsrelicSignatures';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabInstance, type PrefabComponents, type PrefabEntityDefinition } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import type { PlacementSaveRecord } from './saveRecord';
import type { ReadonlyVector3 } from './transform';
import { actionEntity } from './actionEntity';
import type { WorldContext } from './worldContext';
import { createStructureLootDropper } from './structureLoot';
import { reskinTarget } from './reskin_tool';

export const RELIC_NAMES = ['table', 'chair', 'vase', 'chipbowl', 'bowl', 'plate'] as const;
type RelicName = typeof RELIC_NAMES[number];
export type RuinsRelicId = `ruinsrelic_${RelicName}` | `ruins_${RelicName}` | `ruins_rubble_${'table' | 'chair' | 'vase'}`;
export const RUINS_RELIC_IDS: readonly RuinsRelicId[] = [
  ...RELIC_NAMES.map(name => `ruinsrelic_${name}` as const),
  ...RELIC_NAMES.map(name => `ruins_${name}` as const),
  'ruins_rubble_table', 'ruins_rubble_chair', 'ruins_rubble_vase',
];
export const RUINS_RELIC_ITEM_IDS = ['ruinsrelic_vase', 'ruinsrelic_chipbowl', 'ruinsrelic_bowl', 'ruinsrelic_plate'] as const;
export const RUINS_CHAIR_SKINS = {
  ruinsrelic_chair_tesla: 'dynamic/ruinsrelic_chair_tesla.zip',
  ruinsrelic_chair_toilet: 'dynamic/ruinsrelic_chair_toilet.zip',
} as const;
export interface RuinsRelicSaveState { rubble?: true; skinId?: keyof typeof RUINS_CHAIR_SKINS }
export interface RelicMoistureSave { moisture?: number; wet?: true }
export interface RuinsRelicWorld {
  scheduler: GameTimeScheduler;
  fx?: WorldContext['fx'];
  dropLoot?: WorldContext['dropLoot'];
}
export function relicName(id: RuinsRelicId): RelicName { return id.split('_').at(-1) as RelicName; }
export function isRelicItem(id: string): id is typeof RUINS_RELIC_ITEM_IDS[number] {
  return (RUINS_RELIC_ITEM_IDS as readonly string[]).includes(id);
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
  if (!isRelicItem(inst.prefab)) return;
  const scheduler = inst.components.perishable.scheduler;
  if (scheduler && !inst.components.hauntable) inst.components.hauntable = inst.component('hauntable', () => {
    const component = new Hauntable(inst, scheduler); component.SetOnHauntFn(() => false); return component;
  });
  if ('furnituredecor' in inst.components) return;
  inst.addTag('furnituredecor'); inst.addTag('inspectable');
  Object.assign(inst.components, { furnituredecor: new FurnitureDecor(inst), floater: new Floater(inst),
    inventoryitemmoisture: new InventoryItemMoisture(inst),
    inspectable: Object.assign(new Inspectable(inst), { nameoverride: 'relic' }),
    lootdropper: createStructureLootDropper(inst) });
  const workable = inst.component('workable', () => {
    const component = new Workable(inst); component.SetWorkAction('HAMMER'); component.SetWorkLeft(1);
    component.SetOnFinishCallback(onhammered);
    return component;
  });
  Object.assign(inst.components, { workable });
}

/** ruinsrelic.lua fn, or smashables.lua makefn -> OnPreLoad -> health.OnLoad. No art IO. */
export class RuinsRelicInstance extends PrefabInstance<SpriteState> {
  declare readonly components: PrefabComponents & { inspectable?: { nameoverride: string }; sittable?: Sittable };
  readonly prefabId: RuinsRelicId;
  readonly replica: boolean;
  readonly name: RelicName;
  readonly animated: boolean;
  private rubble = false;
  constructor(prefabId: RuinsRelicId, world: RuinsRelicWorld, position: ReadonlyVector3) {
    const initialRubble = prefabId.startsWith('ruins_rubble_');
    super(prefabId, new SpriteState({ name: initialRubble ? 'broken' : 'idle', held: true, billboard: true }));
    this.worldServices = world;
    this.prefabId = prefabId;
    this.name = relicName(prefabId); this.replica = prefabId.startsWith('ruinsrelic_');
    this.animated = ['table', 'chair', 'vase'].includes(this.name);
    this.setPosition(position.x, 0, position.z);
    this.sprite.playOnce(initialRubble ? 'broken' : 'idle');
    // ruinsrelic.lua and smashables.lua: a chair's AnimState:SetFinalOffset(-1).
    if (this.name === 'chair') this.sprite.setBehindFoot(true);
    this.addTag('inspectable');
    Object.assign(this.components, { inspectable: Object.assign(new Inspectable(this), { nameoverride: 'relic' }),
      lootdropper: createStructureLootDropper(this) });
    const hauntable = new Hauntable(this, world.scheduler);
    // standardcomponents.lua MakeHauntableWork's work callback is commented out; it returns false.
    hauntable.SetOnHauntFn(() => false); this.components.hauntable = hauntable;
    this.onRemove(() => hauntable.dispose());
    if (this.replica) this.constructReplica();
    else this.constructNatural(world, initialRubble);
  }

  private constructReplica(): void {
    const workable = new Workable(this); workable.SetWorkAction('HAMMER'); workable.SetWorkLeft(1);
    workable.SetOnFinishCallback(onhammered);
    this.components.workable = workable; this.onRemove(() => workable.dispose());
    if (isRelicItem(this.prefabId)) {
      this.addTag('furnituredecor');
      Object.assign(this.components, { inventoryitem: new InventoryItem(this), floater: new Floater(this),
        furnituredecor: new FurnitureDecor(this), inventoryitemmoisture: new InventoryItemMoisture(this) });
    } else {
      this.deploySmartRadius = this.name === 'chair' ? 1 : 1.6;
      if (this.name === 'chair') this.makeChair();
    }
  }
  private constructNatural(world: RuinsRelicWorld, rubble: boolean): void {
    for (const tag of ['cavedweller', 'smashable', 'object', this.name === 'table' || this.name === 'chair' ? 'stone' : 'clay',
      'noauradamage', 'electricdamageimmune']) this.addTag(tag);
    this.minimap.SetIcon('relic.png');
    this.deploySmartRadius = this.name === 'table' ? 1.6 : ['chair', 'vase', 'bowl'].includes(this.name) ? 1 : .25;
    const health = new Health(90 + (Math.random() * 2 - 1) * 20, this);
    health.nofadeout = true; health.canheal = false;
    const combat = new Combat(this, () => world.scheduler.now);
    combat.SetKeepTargetFunction(() => false);
    if (this.animated) combat.onhitfn = () => this.onHit();
    Object.assign(this.components, { health, combat, roseinspectable: new RoseInspectable(this) });
    health.ondelta = (_, old, current) => {
      if (!this.rubble && current < .5 && current < old) {
        if (this.animated) this.sprite.playOnce('repair');
        this.setRubble(true);
      }
    };
    this.onRemove(() => { health.dispose(); this.components.repairable?.dispose(); });
    this.setRubble(rubble); health.SetPercent(rubble ? .2 : .8);
  }
  private makeChair(): void {
    Object.assign(this.components, { sittable: new Sittable(this) });
    // The constructor-only Sittable does not add its source tag itself.
    for (const tag of ['cansit', 'structure', 'limited_chair', 'uncomfortable_chair']) this.addTag(tag);
  }
  private setRubble(rubble: boolean): void {
    this.rubble = rubble;
    const inspectable = this.components.inspectable as { nameoverride: string };
    inspectable.nameoverride = rubble ? 'ruins_rubble' : 'relic';
    if (rubble) {
      if (!this.components.repairable) {
        const repairable = new Repairable(this, undefined, 'stone');
        repairable.onrepaired = () => {
          if (this.components.health!.GetPercent() >= 1) {
            if (this.animated) this.sprite.playOnce('hit');
            this.setRubble(false);
          } else this.onHit();
        };
        this.components.repairable = repairable;
      }
      if (this.name === 'chair') {
        delete this.components.sittable;
        for (const tag of ['cansit', 'structure', 'limited_chair']) this.removeTag(tag);
      }
    } else {
      this.components.repairable?.dispose(); delete this.components.repairable;
      if (this.name === 'chair') this.makeChair();
    }
    const clip = rubble ? 'broken' : 'idle';
    if (this.animated) this.sprite.pushAnimation(clip, false);
    else this.sprite.playOnce(clip);
  }
  onHit(): void {
    if (!this.animated) return;
    this.sprite.playOnce(this.rubble ? 'repair' : 'hit');
    this.sprite.pushAnimation(this.rubble ? 'broken' : 'idle', false);
  }
  /**
   * Source OnPreLoad applies maxhealth and switches rubble before health.OnLoad runs. The record keeps health as
   * `{ current, maximum }`, which the component's own OnLoad leaves alone, so all three steps run here.
   */
  OnLoad(_inst: unknown, data: PlacementSaveRecord['components']): void {
    if (this.replica) { this.skinId = data.ruinsRelic?.skinId; return; }
    const health = this.components.health!, saved = data.health as { current: number; maximum: number } | undefined;
    if (saved) health.SetMaxHealth(saved.maximum);
    const rubble = data.ruinsRelic?.rubble === true;
    if (rubble !== this.rubble) this.setRubble(rubble);
    if (saved) health.OnLoad({ health: saved.current });
  }
  /** ruinsrelic.lua has no OnSave; the skin and an unported moisture payload keep their record fields. smashables.lua saves rubble and health. */
  OnSave(_inst: unknown, data: PlacementSaveRecord['components']): void {
    const health = this.components.health;
    for (const key of Object.keys(data)) delete (data as Record<string, unknown>)[key];
    Object.assign(data, this.replica ? {
      ...this.skinId ? { ruinsRelic: { skinId: this.skinId as keyof typeof RUINS_CHAIR_SKINS } } : {},
      ...this.saveRecord?.components.inventoryitemmoisture
        ? { inventoryitemmoisture: { ...this.saveRecord.components.inventoryitemmoisture } } : {},
    } : { ...this.rubble ? { ruinsRelic: { rubble: true as const } } : {},
      health: { current: health!.currenthealth, maximum: health!.maxhealth } });
  }
}

/** The Prefabs ruinsrelic.lua and smashables.lua return: six replicas, six natural relics and three rubble pieces. */
export function ruinsRelicPrefabs(world: RuinsRelicWorld): Readonly<Record<RuinsRelicId, PrefabEntityDefinition<RuinsRelicInstance>>> {
  const define = (id: RuinsRelicId): PrefabEntityDefinition<RuinsRelicInstance> => {
    const name = relicName(id), bank = `ruins_${name}`, replica = id.startsWith('ruinsrelic_');
    // MakeObstaclePhysics: replica chair .25 and table .5; every natural relic .25; replica decor has inventory physics.
    const radius = replica ? name === 'chair' ? .25 : name === 'table' ? .5 : undefined : .25;
    const skins = id === 'ruinsrelic_chair' ? RUINS_CHAIR_SKINS : undefined;
    return {
      fn: position => new RuinsRelicInstance(id, world, position),
      assets: { bank, animationArchive: `${bank}.zip`, buildArchives: [`${bank}.zip`] },
      assetOptions: { instancedAnimations: 'all' },
      ...radius === undefined ? {} : { physics: { make: MakeObstaclePhysics, radius } },
      ...skins ? {
        skins,
        onSpawned: (inst: RuinsRelicInstance) => {
          const model = inst.transform.model;
          actionEntity(model, id).reskinTarget = reskinTarget({
            get id() { return String(inst.entityId); }, prefabId: id, instance: inst, display: prefabDisplay(model)!,
            sprite: inst.sprite, skins: Object.keys(RUINS_CHAIR_SKINS), get position() { return inst.position; },
            hasTag: tag => inst.hasTag(tag), isValid: () => !inst.isRemoved,
          });
        },
      } : {},
    };
  };
  return Object.fromEntries(RUINS_RELIC_IDS.map(id => [id, define(id)])) as Record<RuinsRelicId, PrefabEntityDefinition<RuinsRelicInstance>>;
}
