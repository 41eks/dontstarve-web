import { createArchiveSprite, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type * as THREE from 'three';
import { createGroundItemSprite } from './groundItems';
import { configureBurnableItemEntity, createBurnableItemVisual } from './burnableItems';
import { configureFertilizerEntity } from './fertilizers';
import { FliesController, FLIES_SOUND } from './flies';
import { listenInventoryEvents } from './inventoryEvents';
import { PreloadSounds } from './sound';
import type { GroundItemFactory, GroundItemVisual, GroundPrefabContext } from './groundPrefab';

/** poop.lua: ground manure owns a flies child; inventory entry and OnBurn remove that child. */
export function createPoopGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const children = new Map<THREE.Group, { object: THREE.Group; footPosition: THREE.Vector3;
    cameraDepth: number; sortGroup: number; sortLayer: number }>();
  const fires = new Set<ArchiveSprite>();
  const visuals = new Set<GroundItemVisual>();
  return {
    itemIds: ['poop'],
    configureEntity: entity => { configureBurnableItemEntity(entity); configureFertilizerEntity(entity); },
    async create(item) {
      if (!context.scheduler) throw new Error('Poop requires the ground registry game-time scheduler');
      const prepared = await Promise.allSettled([
        createGroundItemSprite(context.assets, 'poop', item.skinId),
        createArchiveSprite(context.assets, { animationArchive: 'flies.zip', buildArchives: ['flies.zip'],
          bank: 'flies', animation: 'swarm_pre', loop: false }, { name: 'flies' }),
        PreloadSounds(FLIES_SOUND),
      ]);
      const failure = prepared.find(result => result.status === 'rejected');
      if (failure) {
        for (const result of prepared) if (result.status === 'fulfilled') result.value?.dispose();
        throw failure.reason;
      }
      const sprite = (prepared[0] as PromiseFulfilledResult<ArchiveSprite>).value;
      const flies = (prepared[1] as PromiseFulfilledResult<ArchiveSprite>).value;
      flies.model.visible = false;
      let visual: GroundItemVisual;
      try { visual = await createBurnableItemVisual(context, 'poop', sprite, fires); }
      catch (error) { sprite.dispose(); flies.dispose(); throw error; }
      let entity: ItemEntity | undefined;
      let controller: FliesController | undefined;
      let stopIgnite: (() => void) | undefined;
      let disposed = false;
      const removeFlies = () => {
        controller?.dispose(); controller = undefined;
        children.delete(flies.model); flies.model.removeFromParent();
        delete sprite.model.userData.flies;
      };
      const spawnFlies = () => {
        if (disposed || controller || !entity || entity.isRemoved || entity.components.inventoryitem.owner) return;
        sprite.model.add(flies.model);
        controller = new FliesController(flies, entity.transform.position, context.scheduler!,
          context.firefliesWorld.getWatchWorldContent);
        children.set(flies.model, { object: flies.model, footPosition: entity.transform.position,
          cameraDepth: 0, sortGroup: sprite.model.id, sortLayer: 2 });
        sprite.model.userData.flies = flies.model;
      };
      const stopInventoryEvents = listenInventoryEvents(sprite.model, {
        ondropped: spawnFlies,
        onputininventory: removeFlies,
        onload: () => { sprite.setAnimation('idle'); spawnFlies(); },
      });
      // Fresh prefab appearance uses dump -> idle, as AnimState:PushAnimation in poop.lua.
      sprite.playOnce('dump', () => { if (!disposed) sprite.setAnimation('idle'); });
      const result: GroundItemVisual = {
        ...visual,
        bindEntity(inst) {
          entity = inst;
          visual.bindEntity?.(inst);
          stopIgnite?.(); stopIgnite = inst.ListenForEvent('onignite', removeFlies);
        },
        update(dt) { visual.update?.(dt); controller?.update(dt); },
        dispose() {
          if (disposed) return;
          disposed = true;
          stopIgnite?.(); stopInventoryEvents(); removeFlies();
          flies.dispose(); visual.dispose();
          visuals.delete(result);
        },
      };
      visuals.add(result);
      return result;
    },
    update(dt, quaternion) { for (const fire of fires) { fire.model.quaternion.copy(quaternion); fire.update(dt); } },
    renderEntities: () => [...children.values(), ...[...fires].map(fire => ({
      object: fire.model, footPosition: fire.model.position, cameraDepth: 0, sortLayer: 2,
    }))],
    dispose() {
      for (const visual of visuals) visual.dispose();
      for (const fire of fires) fire.dispose();
      fires.clear(); children.clear();
    },
  };
}
