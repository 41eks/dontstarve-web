import * as THREE from 'three';
import type { World } from 'cannon-es';
import { PrefabDisplay, PrefabDisplayGroup, SpriteResources, SpriteState } from '@dontstarve-web/display';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { TileStateQuery } from '@dontstarve-web/signals';
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
import { PrefabInstance, bindInstance, type PrefabComponents } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import { watchTileActivity } from './tileActivity';
import { newEntityId } from './saveRecord';
import type { DisplayDrivenPrefabManager, DisplayManagerWorld } from './manager';
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
export interface RuinsRelicRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: {
    ruinsRelic?: RuinsRelicSaveState;
    health?: { current: number; maximum: number };
    inventoryitemmoisture?: RelicMoistureSave;
  };
}
export interface RuinsRelicWorld extends DisplayManagerWorld {
  scheduler: GameTimeScheduler;
  tickingarea?: TileStateQuery;
  physics?: World;
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
  // Unimplemented moisture behaviour retains its source payload in the instance's save record.
  declare saveRecord: RuinsRelicRecord | undefined;
  constructor(prefabId: RuinsRelicId, world: RuinsRelicWorld, saved?: RuinsRelicRecord) {
    const initialRubble = prefabId.startsWith('ruins_rubble_');
    super(prefabId, new SpriteState({ name: initialRubble ? 'broken' : 'idle', held: true, billboard: true }));
    this.worldServices = world;
    this.prefabId = prefabId;
    this.name = relicName(prefabId); this.replica = prefabId.startsWith('ruinsrelic_');
    this.animated = ['table', 'chair', 'vase'].includes(this.name);
    this.entityId = saved?.id ?? newEntityId(); this.saveRecord = saved;
    this.sprite.playOnce(initialRubble ? 'broken' : 'idle');
    this.addTag('inspectable');
    Object.assign(this.components, { inspectable: Object.assign(new Inspectable(this), { nameoverride: 'relic' }),
      lootdropper: createStructureLootDropper(this) });
    const hauntable = new Hauntable(this, world.scheduler);
    // standardcomponents.lua MakeHauntableWork's work callback is commented out; it returns false.
    hauntable.SetOnHauntFn(() => false); this.components.hauntable = hauntable;
    this.onRemove(() => hauntable.dispose());
    if (this.replica) this.constructReplica();
    else this.constructNatural(world, initialRubble);
    if (saved) this.load(saved);
  }
  get transform() { return { position: this.position }; }

  private constructReplica(): void {
    const workable = new Workable(this); workable.SetWorkAction('HAMMER'); workable.SetWorkLeft(1);
    workable.SetOnFinishCallback(onhammered);
    this.components.workable = workable; this.onRemove(() => workable.dispose());
    if (isRelicItem(this.prefabId)) {
      this.addTag('furnituredecor');
      Object.assign(this.components, { inventoryitem: new InventoryItem(this), floater: new Floater(this),
        furnituredecor: new FurnitureDecor(this), inventoryitemmoisture: new InventoryItemMoisture(this) });
    } else {
      MakeObstaclePhysics(this, this.name === 'chair' ? .25 : .5);
      this.deploySmartRadius = this.name === 'chair' ? 1 : 1.6;
      if (this.name === 'chair') this.makeChair();
    }
  }
  private constructNatural(world: RuinsRelicWorld, rubble: boolean): void {
    for (const tag of ['cavedweller', 'smashable', 'object', this.name === 'table' || this.name === 'chair' ? 'stone' : 'clay',
      'noauradamage', 'electricdamageimmune']) this.addTag(tag);
    MakeObstaclePhysics(this, .25); this.minimap.SetIcon('relic.png');
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
  /** Source OnPreLoad applies maxhealth and switches rubble before health.OnLoad runs. */
  private load(saved: RuinsRelicRecord): void {
    if (this.replica) { this.skinId = saved.components.ruinsRelic?.skinId; return; }
    const health = this.components.health!;
    if (saved.components.health) health.SetMaxHealth(saved.components.health.maximum);
    const rubble = saved.components.ruinsRelic?.rubble === true;
    if (rubble !== this.rubble) this.setRubble(rubble);
    if (saved.components.health) health.OnLoad({ health: saved.components.health.current });
  }
  exportRecord(rotationY: number): RuinsRelicRecord {
    const health = this.components.health;
    return { id: String(this.entityId), transform: { position: this.position.toArray(), rotationY }, components: {
      ...this.replica ? {
        ...this.skinId ? { ruinsRelic: { skinId: this.skinId as keyof typeof RUINS_CHAIR_SKINS } } : {},
        ...this.saveRecord?.components.inventoryitemmoisture
          ? { inventoryitemmoisture: { ...this.saveRecord.components.inventoryitemmoisture } } : {},
      } : { ...this.rubble ? { ruinsRelic: { rubble: true as const } } : {},
        health: { current: health!.currenthealth, maximum: health!.maxhealth } },
    } };
  }
}

export class RuinsRelicManager implements DisplayDrivenPrefabManager<{ prefabId: RuinsRelicId; record: RuinsRelicRecord }> {
  private readonly resources = new SpriteResources(undefined, 'ruinsrelic');
  private readonly displays: PrefabDisplayGroup;
  private readonly relics = new Map<THREE.Group, RuinsRelicInstance>();
  private disposed = false;
  private readonly world: RuinsRelicWorld;
  constructor(scene: THREE.Scene, world: RuinsRelicWorld) { this.displays = new PrefabDisplayGroup(scene); this.world = world; }
  spawn(id: RuinsRelicId, position: THREE.Vector3, saved?: RuinsRelicRecord): THREE.Group {
    if (this.disposed) throw new Error('Relics disposed');
    const instance = new RuinsRelicInstance(id, this.world, saved), bank = `ruins_${instance.name}`;
    if (id === 'ruinsrelic_chair') instance.sprite.setSkinSource({ art: this.resources.archives, archives: RUINS_CHAIR_SKINS });
    const display = new PrefabDisplay({ name: id, status: instance.status, sprite: instance.sprite,
      archive: this.resources.archive({ bank, animationArchive: `${bank}.zip`, buildArchives: [`${bank}.zip`] },
        { instancedAnimations: 'all' }) });
    const model = display.model; bindInstance(model, instance);
    instance.position.copy(position); model.rotation.y = saved?.transform.rotationY ?? 0;
    if (this.world.physics) instance.bindPhysics(this.world.physics);
    const stop = watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active));
    instance.onRemove(stop);
    const entity = actionEntity(model, id);
    if (id === 'ruinsrelic_chair') entity.reskinTarget = reskinTarget({
      id: String(instance.entityId), prefabId: id, instance, display, sprite: instance.sprite,
      skins: Object.keys(RUINS_CHAIR_SKINS), position: instance.position,
      hasTag: tag => instance.hasTag(tag), isValid: () => !instance.isRemoved,
    });
    this.relics.set(model, instance); this.displays.mount(display); this.world.trackDisplay(display);
    return model;
  }
  get renderEntities() { return [...this.relics].filter(([, inst]) => inst.sprite.loaded).map(([object, inst]) =>
    ({ object, footPosition: inst.position, cameraDepth: 0, sortLayer: inst.name === 'chair' ? 0 : 1 })); }
  exportRecords() { return [...this.relics].filter(([, inst]) => inst.persists && !inst.isRemoved)
    .map(([model, inst]) => ({ prefabId: inst.prefabId, record: inst.exportRecord(model.rotation.y) })); }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const inst of this.relics.values()) inst.remove();
    this.relics.clear(); this.displays.dispose(); this.resources.dispose();
  }
}
