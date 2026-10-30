import { findActionEntity } from './actionEntity';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { createSignal, readonlySignal, getBoundWatchWorldContent } from '@dontstarve-web/signals';
import { createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { createArchiveEntity, prefabInstance } from './prefabInstance';
import { Burnable } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import type { BurnableInst } from '../../componets/src/burnable';
import type { GroundPrefabContext, GroundItemVisual } from './groundPrefab';
import type { ResidentGroundItem } from './groundItems';
import type { PrefabDisplay } from '@dontstarve-web/display';
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

interface BurnPresentation {
  context: GroundPrefabContext;
}

/** The inst owns the burning clock and persistence; preparing/replacing art keeps this component. */
export class BurnableItemController {
  private readonly burntState = createSignal(false);
  readonly burnt = readonlySignal(this.burntState);
  readonly burnable: Burnable;
  readonly propagator: Propagator;
  private presentation?: BurnPresentation;
  private removed = false;
  private readonly entity: ItemEntity;

  constructor(entity: ItemEntity) {
    this.entity = entity;
    for (const tag of BURNABLE_ITEM_DEFINITIONS[entity.prefab].tags) entity.addTag(tag);
    this.burnable = new Burnable(entity);
    entity.components.burnable = this.burnable;
    const { burnTime, burnTimeVariance = 0, explosive } = BURNABLE_ITEM_DEFINITIONS[entity.prefab];
    this.burnable.SetBurnTime(burnTime + Math.random() * burnTimeVariance);
    this.propagator = new Propagator(entity, 'small', radius => {
      const origin = entity.getPosition(), neighbours: BurnableInst[] = [];
      this.presentation?.context.scene.traverse(model => {
        const inst = findActionEntity(model) as BurnableInst | undefined;
        if (!inst?.components.propagator || inst.isRemoved || inst.hasTag('INLIMBO')) return;
        const position = inst.getPosition();
        if ((position.x - origin.x) ** 2 + (position.z - origin.z) ** 2 <= radius ** 2) neighbours.push(inst);
      });
      return neighbours;
    }, TILE_SIZE / 4);
    entity.components.propagator = this.propagator;
    this.burnable.SetOnIgniteFn(() => { entity.persists = false; }); // DefaultBurnFn
    this.burnable.SetOnExtinguishFn(() => { entity.persists = true; }); // DefaultExtinguishFn
    if (!explosive) this.burnable.SetOnBurntFn(() => {
      const count = Math.min(ASH_MAX_STACK, entity.components.stackable.count);
      const position = entity.transform.position.clone();
      // DefaultBurntFn creates one ash stack at the original inst's position, then removes the inst.
      const spawnGroundItem = this.presentation?.context.spawnGroundItem;
      if (!spawnGroundItem) throw new Error('Burning item requires a world to spawn ash');
      spawnGroundItem({ ...catalog.items.ash, itemId: 'ash', count }, position);
      this.burntState.set(true);
      entity.remove();
    });
  }
  bind(presentation: BurnPresentation): void {
    this.presentation = presentation;
    this.propagator.setWorldContent(getBoundWatchWorldContent());
  }
  release(presentation: BurnPresentation): void {
    if (this.presentation === presentation) this.presentation = undefined;
  }
  update(dt: number): void {
    if (this.removed || this.entity.isRemoved || this.entity.components.inventoryitem.owner) return;
    this.burnable.Update(dt);
    this.propagator.Update(dt);
  }
  dispose(): void {
    if (this.removed) return;
    this.removed = true;
    this.burnable.SetOnExtinguishFn(undefined);
    this.burnable.dispose(); this.propagator.dispose();
    this.presentation = undefined;
  }
}

export function configureBurnableItemEntity(entity: ItemEntity): void {
  if (!Object.hasOwn(BURNABLE_ITEM_DEFINITIONS, entity.prefab)) return;
  entity.component('burnable_item', () => new BurnableItemController(entity));
}

/**
 * Existing ground art and generic fire FX; the item's own display and the fire's display load their art. The prefab
 * declares the fire as an effect that is active while the item burns; its display shows it as a child of the item, as
 * DST's Burnable:SpawnFX does. Sound and light follow the same burning signal.
 */
export function createBurnableItemVisual(context: GroundPrefabContext,
  itemId: string, base: ResidentGroundItem, displays: Set<PrefabDisplay>, fxLevel: 2 | 3 = 2): GroundItemVisual {
  const { visual, instance, display } = base;
  const { igniteSound, loopSound } = BURNABLE_ITEM_DEFINITIONS[itemId];
  const createFire = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(context.assets, { animationArchive: 'fire.zip',
    buildArchives: ['fire.zip'], bank: 'fire', animation: clip.name, loop: clip.loop }, { name: 'fire', dynamicParent: true });
  // fire.lua: the burning fx entity, drawn by its own display as a child of the item; tags FX and HASHEATER.
  const fire = createArchiveEntity('fire', { create: createFire }, { name: `level${fxLevel}` }, 'fire');
  for (const tag of ['FX', 'HASHEATER']) fire.instance.addTag(tag);
  fire.instance.persists = false;
  const presentation = { context };
  const model = display.model;
  let controller: BurnableItemController | undefined;
  let stopBurning: (() => void) | undefined;
  let stopIgnite: (() => void) | undefined;
  let sound: SoundHandle | undefined;
  let loop: SoundHandle | undefined;
  let burningNow = false;
  let disposed = false;
  const clearBurning = () => {
    burningNow = false;
    sound?.stop(); sound = undefined;
    loop?.stop(); loop = undefined;
    prefabInstance(model)!.light.set(null);
  };
  const syncBurning = (burning: boolean) => {
    if (burning) {
      burningNow = true;
      sound = PlaySound('dontstarve/common/campfire', model.position);
      if (loopSound) loop = PlaySound(loopSound, model.position);
      prefabInstance(model)!.light.set({ colour: [1, 1, 192 / 255], radius: (fxLevel + 1) * (TILE_SIZE / 4), intensity: .8, falloff: .33 });
    } else {
      const wasBurning = burningNow;
      clearBurning();
      if (wasBurning) PlaySound('dontstarve/common/fireOut', model.position);
    }
  };
  displays.add(display);
  return {
    ...visual,
    bindEntity(entity) {
      configureBurnableItemEntity(entity);
      controller = entity.getComponent<BurnableItemController>('burnable_item')!;
      controller.bind(presentation);
      model.userData.burningSignal = controller.burnable.burning;
      model.userData.burntSignal = controller.burnt;
      model.userData.persistenceSignal = entity.persistence;
      instance.sprite.attachFx('fire', { sprite: fire.instance.sprite, display: fire.display, active: controller.burnable.burning, sortLayer: 2 });
      stopBurning = controller.burnable.burning.subscribe(syncBurning);
      syncBurning(controller.burnable.IsBurning());
      // inst:ListenForEvent("onignite", ...) fires only on a new ignition, not when a burning save is restored.
      if (igniteSound) stopIgnite = entity.ListenForEvent('onignite', () => { PlaySound(igniteSound, model.position); });
    },
    update(dt) { controller?.update(dt); },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopBurning?.(); stopIgnite?.(); controller?.release(presentation);
      clearBurning(); displays.delete(display);
      instance.sprite.detachFx('fire'); fire.instance.remove(); fire.display.dispose(); visual.dispose();
    },
  };
}
