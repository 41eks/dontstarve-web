import { createEffect, watchSignal } from '@dontstarve-web/signals';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Workable, type Worker } from '../../componets/src/workable';
import { createResidentGroundItem } from './groundItems';
import { configureTradableEntity } from './tradable';
import { createBurnableItemVisual } from './burnableItems';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import type { GroundItemFactory, GroundPrefabContext, PreparedGroundSpawn } from './groundPrefab';
import type { LootLaunch } from './lootFling';
import type { Vector3 } from 'three';
import catalog from './groundItems.json' with { type: 'json' };

export const ROCK_AVOCADO_ITEM_IDS = ['rock_avocado_fruit', 'rock_avocado_fruit_ripe', 'rock_avocado_fruit_ripe_cooked', 'rock_avocado_fruit_sprout'] as const;
const PRODUCTS = ['rock_avocado_fruit_ripe', 'rock_avocado_fruit_sprout', 'rocks'] as const;
type Product = typeof PRODUCTS[number];
export function rockAvocadoProduct(roll: number): Product {
  return roll < .65 ? PRODUCTS[0] : roll < .66 ? PRODUCTS[1] : PRODUCTS[2];
}
/** physics.lua LaunchAt with TUNING.ROCK_FRUIT_LOOT: a negative speedmult scatters away from `target`. */
function scatterLaunch(origin: Vector3, target?: Vector3): LootLaunch {
  const direction = target ? Math.atan2(target.z - origin.z, target.x - origin.x) : 0;
  return { angle: direction + (Math.random() * 2 - 1) * 65 * Math.PI / 180,
    height: .5, speed: { min: -1.8, range: -3.6 }, ySpeed: { min: .4, range: 2 } };
}
interface FruitPresentation {
  sprite: ArchiveSpriteCommands;
  outputs: Map<Product, PreparedGroundSpawn[]>;
}

/** rock_avocado_fruit.lua on_mine and stack_size_changed; the inst owns work and consumption. */
export class RockAvocadoFruit {
  readonly workable: Workable;
  private readonly entity: ItemEntity;
  private readonly cleanups: (() => void)[] = [];
  private presentation?: FruitPresentation;
  constructor(entity: ItemEntity) {
    this.entity = entity;
    entity.addTag('molebait'); entity.addTag('quakedebris');
    this.workable = new Workable(entity);
    entity.components.workable = this.workable;
    this.workable.SetWorkAction('MINE');
    this.workable.SetOnWorkCallback((worker, _remaining, workdone) => this.mine(worker, workdone));
    // Explosions knock around these fruits in specific.
    this.cleanups.push(entity.ListenForEvent('explosion', data => this.explode(data as { explosive?: Worker } | undefined)));
    const count = watchSignal(entity.components.stackable.size, stop => this.cleanups.push(stop));
    createEffect(() => this.workable.SetWorkLeft(count.get()));
  }
  bind(presentation: FruitPresentation): void { this.presentation = presentation; }
  release(presentation: FruitPresentation): void { if (this.presentation === presentation) this.presentation = undefined; }
  private mine(worker: Worker, workdone: number): void {
    const presentation = this.presentation;
    if (!presentation) throw new Error('Stone fruit mining requires prepared ground products');
    const count = this.entity.components.stackable.count;
    const worked = Math.max(1, Math.min(count, Math.ceil(workdone)));
    if (count > worked) presentation.sprite.playOnce('mined', () => presentation.sprite.playOnce('idle'));
    const counts = new Map<Product, number>(PRODUCTS.map(id => [id, 0]));
    for (let i = 0; i < worked; i++) { const id = rockAvocadoProduct(Math.random()); counts.set(id, counts.get(id)! + 1); }
    const origin = this.entity.getPosition(), target = worker.getPosition?.();
    for (const [prefab, amount] of counts) {
      if (!amount) continue;
      const launch = scatterLaunch(origin, target);
      const output = presentation.outputs.get(prefab)!.shift();
      if (!output?.spawn(origin, amount, launch)) throw new Error(`Stone fruit product not prepared: ${prefab}`);
      if (prefab === 'rock_avocado_fruit_ripe') output.spawnedEntity?.PushEvent('split_open', undefined);
    }
    if (worked === count) this.entity.remove();
    else { this.entity.components.stackable.count = count - worked; this.workable.SetWorkLeft(count - worked); }
  }
  /** OnExplosion_rock_avocado_fruit_full: a fruit that survives the blast is thrown away from it. */
  private explode(data: { explosive?: Worker } | undefined): void {
    const target = data?.explosive?.getPosition?.();
    if (target) this.entity.PushEvent('launch', scatterLaunch(this.entity.getPosition(), target));
  }
  dispose(): void {
    this.cleanups.splice(0).forEach(stop => stop()); this.workable.dispose(); this.presentation = undefined;
  }
}

export function configureRockAvocadoFruitEntity(entity: ItemEntity): void {
  if (!(ROCK_AVOCADO_ITEM_IDS as readonly string[]).includes(entity.prefab)) return;
  configureTradableEntity(entity);
  if (entity.prefab === 'rock_avocado_fruit') entity.component('rock_avocado_fruit', () => new RockAvocadoFruit(entity));
  else if (entity.prefab === 'rock_avocado_fruit_ripe') { entity.addTag('molebait'); entity.addTag('cookable'); }
}

/** All possible outputs are prepared before a stack becomes an actionable ground target. */
export function createRockAvocadoGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const displays = new Set<PrefabDisplay>();
  return {
    itemIds: ['rock_avocado_fruit', 'rock_avocado_fruit_ripe'], configureEntity: configureRockAvocadoFruitEntity,
    async create(item) {
      if (item.itemId === 'rock_avocado_fruit_ripe') {
        const base = await createResidentGroundItem(context, item), sprite = base.instance.sprite;
        let stop: (() => void) | undefined;
        let visual;
        try { visual = await createBurnableItemVisual(context, item.itemId, base, displays); }
        catch (error) { base.visual.dispose(); throw error; }
        return { ...visual, bindEntity(entity: ItemEntity) {
          visual.bindEntity?.(entity);
          stop = entity.ListenForEvent('split_open', () => sprite.playOnce('split_open', () => sprite.playOnce('idle_split_open')));
        }, dispose() { stop?.(); visual.dispose(); } };
      }
      const { visual, instance: { sprite } } = await createResidentGroundItem(context, item);
      if (!context.prepareSpawn) { visual.dispose(); throw new Error('Stone fruit needs prepared loot'); }
      const requests = PRODUCTS.flatMap(prefab => Array.from({ length: item.count }, () => ({ prefab,
        request: context.prepareSpawn!({ ...catalog.items[prefab], itemId: prefab, count: 40 }),
      })));
      const results = await Promise.allSettled(requests.map(output => output.request));
      if (results.some(result => result.status === 'rejected')) {
        visual.dispose(); results.forEach(result => { if (result.status === 'fulfilled') result.value.dispose(); });
        throw (results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason;
      }
      const outputs = new Map<Product, PreparedGroundSpawn[]>(PRODUCTS.map(id => [id, []]));
      results.forEach((result, index) => { if (result.status === 'fulfilled') outputs.get(requests[index].prefab)!.push(result.value); });
      const presentation = { sprite, outputs };
      let controller: RockAvocadoFruit | undefined;
      return { ...visual, bindEntity(entity: ItemEntity) {
        controller = entity.getComponent<RockAvocadoFruit>('rock_avocado_fruit')!; controller.bind(presentation);
      }, dispose() {
        controller?.release(presentation); for (const pieces of outputs.values()) pieces.forEach(output => output.dispose()); visual.dispose();
      } };
    },
    renderEntities: () => [...displays].flatMap(display => display.fxRenderEntries),
    dispose() { displays.clear(); },
  };
}
