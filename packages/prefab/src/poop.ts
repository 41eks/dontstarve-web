import { createArchiveSprite, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { createSignal, readonlySignal } from '@dontstarve-web/signals';
import { createResidentGroundItem, type ResidentGroundItem } from './groundItems';
import type { PrefabDisplay } from '@dontstarve-web/display';
import { configureBurnableItemEntity, createBurnableItemVisual } from './burnableItems';
import { configureFertilizerEntity } from './fertilizers';
import { FliesController, FLIES_SOUND } from './flies';
import { listenInventoryEvents } from './inventoryEvents';
import { PreloadSounds } from './sound';
import type { GroundItemFactory, GroundItemVisual, GroundPrefabContext } from './groundPrefab';

/** poop.lua: ground manure owns a flies child; inventory entry and OnBurn remove that child. */
export function createPoopGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const displays = new Set<PrefabDisplay>();
  const visuals = new Set<GroundItemVisual>();
  return {
    itemIds: ['poop'],
    configureEntity: entity => { configureBurnableItemEntity(entity); configureFertilizerEntity(entity); },
    async create(item) {
      if (!context.scheduler) throw new Error('Poop requires the ground registry game-time scheduler');
      const prepared = await Promise.allSettled([
        createResidentGroundItem(context, item),
        createArchiveSprite(context.assets, { animationArchive: 'flies.zip', buildArchives: ['flies.zip'],
          bank: 'flies', animation: 'swarm_pre', loop: false }, { name: 'flies', dynamicParent: true }),
        PreloadSounds(FLIES_SOUND),
      ]);
      const failure = prepared.find(result => result.status === 'rejected');
      if (failure) {
        if (prepared[0].status === 'fulfilled') prepared[0].value.visual.dispose();
        if (prepared[1].status === 'fulfilled') prepared[1].value.dispose();
        throw failure.reason;
      }
      const base = (prepared[0] as PromiseFulfilledResult<ResidentGroundItem>).value;
      const flies = (prepared[1] as PromiseFulfilledResult<ArchiveSprite>).value;
      const model = base.display.model, sprite = base.instance.sprite;
      flies.model.visible = false;
      let visual: GroundItemVisual;
      try { visual = await createBurnableItemVisual(context, 'poop', base, displays); }
      catch (error) { base.visual.dispose(); flies.dispose(); throw error; }
      let entity: ItemEntity | undefined;
      let controller: FliesController | undefined;
      let stopIgnite: (() => void) | undefined;
      let disposed = false;
      // flies.lua is a child spawned with the manure: declared once, shown while the manure has its swarm.
      const swarming = createSignal(false);
      sprite.attachFx('flies', { sprite: flies, active: readonlySignal(swarming), tags: ['NOCLICK', 'DECOR'], sortLayer: 2 });
      const removeFlies = () => {
        controller?.dispose(); controller = undefined;
        swarming.set(false);
        delete model.userData.flies;
      };
      const spawnFlies = () => {
        if (disposed || controller || !entity || entity.isRemoved || entity.components.inventoryitem.owner) return;
        controller = new FliesController(flies, entity.transform.position, context.scheduler!,
          context.firefliesWorld.getWatchWorldContent);
        swarming.set(true);
        model.userData.flies = flies.model;
      };
      const stopInventoryEvents = listenInventoryEvents(model, {
        ondropped: spawnFlies,
        onputininventory: removeFlies,
        onload: () => { sprite.playOnce('idle'); spawnFlies(); },
      });
      // Fresh prefab appearance uses dump -> idle, as AnimState:PushAnimation in poop.lua.
      sprite.playOnce('dump', () => { if (!disposed) sprite.playOnce('idle'); });
      const result: GroundItemVisual = {
        ...visual,
        bindEntity(inst) {
          entity = inst;
          visual.bindEntity?.(inst);
          stopIgnite?.(); stopIgnite = inst.ListenForEvent('onignite', removeFlies);
        },
        update(dt) { visual.update?.(dt); },
        dispose() {
          if (disposed) return;
          disposed = true;
          stopIgnite?.(); stopInventoryEvents(); removeFlies();
          sprite.detachFx('flies'); flies.dispose(); visual.dispose();
          visuals.delete(result);
        },
      };
      visuals.add(result);
      return result;
    },
    renderEntities: () => [...displays].flatMap(display => display.fxRenderEntries),
    dispose() {
      for (const visual of visuals) visual.dispose();
      displays.clear();
    },
  };
}
