import { addComponent } from './components';
import { FindEntities } from './actionEntity';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { createSignal, readonlySignal, getBoundWatchWorldContent } from '@dontstarve-web/signals';
import { createArchiveEntity } from './prefabInstance';
import { Burnable } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import type { BurnableInst } from '../../componets/src/burnable';
import type { ItemPrefabWorld } from './groundPrefab';
import { GROUND_ART_DEFINITIONS, groundItemPrefab, type ItemPrefabDefinition } from './groundItems';
import catalog from './groundItems.json' with { type: 'json' };
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import { TILE_SIZE } from './tile';

// cutgrass.lua / log.lua / livinglog.lua / books.lua: MakeSmallBurnable(SMALL/MED_BURNTIME), MakeSmallPropagator.
export const BURNABLE_ITEM_DEFINITIONS: Readonly<Record<string, { burnTime: number; burnTimeVariance?: number; tags: readonly string[];
  fxLevel?: 2 | 3; igniteSound?: SoundEventPath; loopSound?: SoundEventPath; explosive?: true }>> = {
  cutgrass: { burnTime: 30 * .25, tags: ['cattoy', 'renewable', 'cutgrass'] },
  log: { burnTime: 30 * .5, tags: ['log'] },
  livinglog: { burnTime: 30 * .5, tags: [], igniteSound: 'dontstarve/creatures/leif/livinglog_burn' }, // onignite scream.
  papyrus: { burnTime: 30 * .25, tags: ['cattoy', 'bookcabinet_item'] }, // papyrus.lua MakeSmallBurnable(SMALL_BURNTIME).
  featherpencil: { burnTime: 30 * .25, tags: ['cattoy'] },
  bathbomb: { burnTime: 30 * .5, tags: [] }, // bathbomb.lua MakeSmallBurnable(MED_BURNTIME), MakeSmallPropagator.
  poop: { burnTime: 30 * .5, tags: [] }, // poop.lua MakeSmallBurnable(MED_BURNTIME).
  fence_item: { burnTime: 30 * .5, tags: [] }, // fence.lua MakeInvItem: MakeSmallBurnable(MED_BURNTIME), MakeSmallPropagator.
  // gunpowder.lua MakeSmallBurnable(3 + math.random() * 3); SetOnBurntFn(nil) leaves removal to the explosive component.
  gunpowder: { burnTime: 3, burnTimeVariance: 3, tags: ['molebait', 'explosive'], explosive: true,
    loopSound: 'dontstarve/common/blackpowder_fuse_LP' },
  rock_avocado_fruit_ripe: { burnTime: 7.5, tags: ['molebait', 'cookable'] },
  rock_avocado_fruit_ripe_cooked: { burnTime: 7.5, tags: [] },
  rock_avocado_fruit_sprout: { burnTime: 7.5, tags: ['deployedplant'] },
  dug_rock_avocado_bush: { burnTime: 30, tags: ['deployedplant'], fxLevel: 3 },
  dug_berrybush: { burnTime: 30, tags: ['deployedplant'], fxLevel: 3 },
  dug_monkeytail: { burnTime: 30, tags: ['deployedplant'], fxLevel: 3 },
  dug_grass: { burnTime: 30, tags: ['deployedplant'], fxLevel: 3 }, // plantables.lua LARGE_BURNTIME.
  dug_sapling: { burnTime: 30, tags: ['deployedplant'], fxLevel: 3 },
  dug_sapling_moon: { burnTime: 30, tags: ['deployedplant'], fxLevel: 3 },
  book_silviculture: { burnTime: 30 * .5, tags: [] }, // books.lua tags belong to configureBookEntity.
  book_rain: { burnTime: 30 * .5, tags: [] },
  book_moon: { burnTime: 30 * .5, tags: [] },
};
const ASH_MAX_STACK = 40; // ash.lua: TUNING.STACK_SIZE_SMALLITEM

/** The inst owns the burning clock and persistence; its world spawns the ash and finds the fire's neighbours. */
export class BurnableItemController {
  private readonly burntState = createSignal(false);
  readonly burnt = readonlySignal(this.burntState);
  readonly burnable: Burnable;
  readonly propagator: Propagator;
  private world?: Pick<ItemPrefabWorld, 'spawnGroundItem'>;
  private removed = false;
  private readonly entity: ItemEntity;
  /** Whether the components keep their own game-time clock, as an item outside any world does. */
  readonly ownsClock: boolean;

  constructor(entity: ItemEntity) {
    this.entity = entity;
    for (const tag of BURNABLE_ITEM_DEFINITIONS[entity.prefab].tags) entity.addTag(tag);
    const scheduler = entity.components.perishable.scheduler;
    this.ownsClock = !scheduler;
    this.burnable = addComponent(entity, 'burnable', Burnable, scheduler);
    const { burnTime, burnTimeVariance = 0, explosive } = BURNABLE_ITEM_DEFINITIONS[entity.prefab];
    this.burnable.SetBurnTime(burnTime + Math.random() * burnTimeVariance);
    // MakeSmallPropagator: the neighbours are the propagators FindEntities finds in range.
    this.propagator = addComponent(entity, 'propagator', Propagator, 'small', radius => FindEntities(entity.getPosition(), radius)
      .filter(inst => inst.components.propagator && !inst.isRemoved && !inst.hasTag('INLIMBO')) as unknown as BurnableInst[],
    TILE_SIZE / 4, scheduler);
    this.burnable.SetOnIgniteFn(() => { entity.persists = false; }); // DefaultBurnFn
    this.burnable.SetOnExtinguishFn(() => { entity.persists = true; }); // DefaultExtinguishFn
    if (!explosive) this.burnable.SetOnBurntFn(() => {
      const count = Math.min(ASH_MAX_STACK, entity.components.stackable.count);
      const position = entity.transform.position.clone();
      // DefaultBurntFn creates one ash stack at the original inst's position, then removes the inst.
      const spawnGroundItem = this.world?.spawnGroundItem;
      if (!spawnGroundItem) throw new Error('Burning item requires a world to spawn ash');
      spawnGroundItem({ ...catalog.items.ash, itemId: 'ash', count }, position);
      this.burntState.set(true);
      entity.remove();
    });
  }
  bind(world: Pick<ItemPrefabWorld, 'spawnGroundItem'>): void {
    this.world = world;
    this.propagator.setWorldContent(getBoundWatchWorldContent());
  }
  /** Advances the components' own clock; a world's scheduler advances them otherwise. */
  OnUpdate(dt: number): void {
    if (this.removed || this.entity.isRemoved || this.entity.components.inventoryitem.owner) return;
    this.burnable.Update(dt);
    this.propagator.Update(dt);
  }
  dispose(): void {
    if (this.removed) return;
    this.removed = true;
    this.burnable.SetOnExtinguishFn(undefined);
    this.burnable.dispose(); this.propagator.dispose();
    this.world = undefined;
  }
}

export function configureBurnableItemEntity(entity: ItemEntity): void {
  if (!Object.hasOwn(BURNABLE_ITEM_DEFINITIONS, entity.prefab)) return;
  entity.component('burnable_item', () => new BurnableItemController(entity));
}

/**
 * MakeSmallBurnable's presentation on the item: Burnable:SpawnFX's fire is the item's child, declared as an effect
 * that is active while the item burns; its display shows it with the item. Sound and light follow the same burning signal.
 */
export function bindBurnableItem(inst: ItemEntity, world: ItemPrefabWorld, fxLevel: 2 | 3 = BURNABLE_ITEM_DEFINITIONS[inst.prefab].fxLevel ?? 2): void {
  const { igniteSound, loopSound } = BURNABLE_ITEM_DEFINITIONS[inst.prefab];
  configureBurnableItemEntity(inst);
  const controller = inst.getComponent<BurnableItemController>('burnable_item')!;
  controller.bind(world);
  if (controller.ownsClock) inst.onRemove(world.componentUpdates.register(controller));
  const fireSource = world.sprites.archive({ animationArchive: 'fire.zip', buildArchives: ['fire.zip'], bank: 'fire' }, { dynamicParent: true });
  // fire.lua: the burning fx entity, drawn by its own display as a child of the item; tags FX and HASHEATER.
  const fire = createArchiveEntity('fire', fireSource, { name: `level${fxLevel}`, billboard: true }, 'fire', undefined, inst.status);
  for (const tag of ['FX', 'HASHEATER']) fire.instance.addTag(tag);
  fire.instance.persists = false;
  let sound: SoundHandle | undefined;
  let loop: SoundHandle | undefined;
  let burningNow = false;
  const clearBurning = () => {
    burningNow = false;
    sound?.stop(); sound = undefined;
    loop?.stop(); loop = undefined;
    inst.light.set(null);
  };
  const syncBurning = (burning: boolean) => {
    if (burning) {
      burningNow = true;
      sound = PlaySound('dontstarve/common/campfire', inst.position);
      if (loopSound) loop = PlaySound(loopSound, inst.position);
      inst.light.set({ colour: [1, 1, 192 / 255], radius: (fxLevel + 1) * (TILE_SIZE / 4), intensity: .8, falloff: .33 });
    } else {
      const wasBurning = burningNow;
      clearBurning();
      if (wasBurning) PlaySound('dontstarve/common/fireOut', inst.position);
    }
  };
  inst.sprite.attachFx('fire', { sprite: fire.instance.sprite, display: fire.display, active: controller.burnable.burning, sortLayer: 2 });
  const stopBurning = controller.burnable.burning.subscribe(syncBurning);
  syncBurning(controller.burnable.IsBurning());
  // inst:ListenForEvent("onignite", ...) fires only on a new ignition, not when a burning save is restored.
  const stopIgnite = igniteSound ? inst.ListenForEvent('onignite', () => { PlaySound(igniteSound, inst.position); }) : undefined;
  inst.onRemove(() => {
    stopBurning(); stopIgnite?.();
    clearBurning();
    inst.sprite.detachFx('fire'); fire.instance.remove(); fire.display.dispose();
  });
}

/** The MakeSmallBurnable items without a module of their own. */
export function burnableItemPrefabs(world: ItemPrefabWorld, exclude: readonly string[]): Record<string, ItemPrefabDefinition> {
  return Object.fromEntries(Object.keys(BURNABLE_ITEM_DEFINITIONS).filter(id => !exclude.includes(id) && Object.hasOwn(GROUND_ART_DEFINITIONS, id))
    .map(id => [id, groundItemPrefab(id, world, { configure: inst => bindBurnableItem(inst, world) })]));
}
