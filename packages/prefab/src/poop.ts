import { createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { createEffect, createSignal, readonlySignal } from '@dontstarve-web/signals';
import { createArchiveEntity } from './prefabInstance';
import { createResidentGroundItem } from './groundItems';
import type { PrefabDisplay } from '@dontstarve-web/display';
import { configureBurnableItemEntity, createBurnableItemVisual } from './burnableItems';
import { configureFertilizerEntity } from './fertilizers';
import { FliesController } from './flies';
import { listenInventoryEvents } from './inventoryEvents';
import type { GroundItemFactory, GroundItemVisual, GroundPrefabContext } from './groundPrefab';

/** poop.lua: ground manure owns a flies child; inventory entry and OnBurn remove that child. */
export function createPoopGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const displays = new Set<PrefabDisplay>();
  const visuals = new Set<GroundItemVisual>();
  return {
    itemIds: ['poop'],
    configureEntity: entity => { configureBurnableItemEntity(entity); configureFertilizerEntity(entity); },
    create(item, inst) {
      if (!context.scheduler) throw new Error('Poop requires the ground registry game-time scheduler');
      const createFlies = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(context.assets, { animationArchive: 'flies.zip',
        buildArchives: ['flies.zip'], bank: 'flies', animation: clip.name, loop: clip.loop }, { name: 'flies', dynamicParent: true });
      const base = createResidentGroundItem(context, { ...item, sprite: inst.sprite });

      const flies = createArchiveEntity('flies', { create: createFlies }, { name: 'swarm_pre' }, 'flies');
      flies.instance.persists = false;
      flies.instance.sprite.setVisible(false);
      // The decorative child must not enlarge the manure's pickup target, whenever its sprite is drawn again.
      const stopRaycast = createEffect(() => {
        flies.instance.sprite.art.get();
        flies.display.model.traverse(object => { object.raycast = () => {}; });
      });
      const releaseFlies = () => { stopRaycast(); flies.instance.remove(); flies.display.dispose(); };
      const model = base.display.model, sprite = base.instance.sprite;
      const visual = createBurnableItemVisual(context, 'poop', base, displays);
      let entity: ItemEntity | undefined;
      let controller: FliesController | undefined;
      let stopIgnite: (() => void) | undefined;
      let disposed = false;
      // flies.lua is a child spawned with the manure: declared once, shown while the manure has its swarm.
      const swarming = createSignal(false);
      sprite.attachFx('flies', { sprite: flies.instance.sprite, display: flies.display, active: readonlySignal(swarming), sortLayer: 2 });
      const removeFlies = () => {
        controller?.dispose(); controller = undefined;
        swarming.set(false);
        delete model.userData.flies;
      };
      const spawnFlies = () => {
        if (disposed || controller || !entity || entity.isRemoved || entity.components.inventoryitem.owner) return;
        controller = new FliesController(flies.instance, entity.transform.position, context.scheduler!,
          context.firefliesWorld.getWatchWorldContent);
        swarming.set(true);
        model.userData.flies = flies.display.model;
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
        dispose() {
          if (disposed) return;
          disposed = true;
          stopIgnite?.(); stopInventoryEvents(); removeFlies();
          sprite.detachFx('flies'); releaseFlies(); visual.dispose();
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
