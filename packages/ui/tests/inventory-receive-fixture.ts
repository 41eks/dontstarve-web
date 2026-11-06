import { performToolWork } from '../../stategraphs/src/componentactions';
import { activePrefabs } from '../../prefab/src/activePrefabs';
import * as THREE from 'three';
import { mountGameUi, INVENTORY_RECIPES } from '../src';
import { createInventoryStore } from '../../../src/inventory';
import { GroundItemManager } from '../../prefab/src/groundItemManager';
import { createWorldState } from '../../../src/worldState';
import { inventoryReceiveEffect } from '../../../src/inventoryReceive';
import { createInventorySlotItem } from '../../../src/inventorySlotItem';
import { ScreenProjection } from '@dontstarve-web/display';
import { backpackContainerId, inventorySlotAddress, INVENTORY_SLOT_COUNT } from '@dontstarve-web/inventory';
import initialWorld from '../../../public/saves/initial-world.json';

export async function createReceiveFixture() {
  const ui = mountGameUi({ assetBaseUrl: '/dst/data/ui/' });
  const { inventoryBar, backpackPanel } = ui;
  const inventory = createInventoryStore();
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 12, 20);
  camera.lookAt(0, 0, 0);
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 480;
  Object.assign(canvas.style, { position: 'fixed', left: '40px', top: '60px', width: '320px', height: '240px' });
  document.body.append(canvas);
  const screenProjection = new ScreenProjection(camera, canvas);
  inventoryBar.bindInventory(inventory, createInventorySlotItem(inventory));
  const scene = new THREE.Scene();
  inventory.subscribeReceived((received, source) => {
    if (source) inventoryReceiveEffect(ui,
      screenProjection.GetScreenPos(new THREE.Vector3(source.x, source.y, source.z)))(received);
  });
  const worldState = createWorldState({ elapsedSeconds: 450, systems: {}, map: { ...initialWorld.world.map, kind: 'generated' } });
  // Keep the capture scene in tickingarea, with the player outside the swarm's hide radius.
  worldState.playerpositions.set([new THREE.Vector3(20, 0, 3)]);
  const ground = new GroundItemManager(scene, camera, { domElement: canvas } as unknown as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', new THREE.Group(), undefined,
    { getWatchWorldContent: worldState.getWatchWorldContent });
  return {
    inventory, inventoryBar, backpackPanel,
    equipBackpack() {
      const backpack = inventory.entities.create({ itemId: 'backpack', count: 1 });
      if (!inventory.Equip(backpack)) throw new Error('Could not equip backpack');
      const containerId = backpackContainerId(backpack.id);
      const container = backpack.components.container!;
      backpackPanel.open({ containerId, slotCount: container.numslots, title: '背包' });
      backpackPanel.bindContainer(container, createInventorySlotItem(inventory));
      const maxStack = inventory.getItemSpec('rocks').maxStack;
      if (!inventory.add('rocks', INVENTORY_SLOT_COUNT * maxStack)) throw new Error('Could not fill inventory');
      // Leave capacity for one item so one receipt spans the main inventory and backpack.
      inventory.applySlotChanges([{ slot: inventorySlotAddress(0), itemId: 'rocks', delta: -1 }]);
      return { containerId, maxStack };
    },
    give(itemId: string, count: number) {
      return inventory.GiveItem(inventory.entities.create({ itemId, count }), new THREE.Vector3(4, 0, 3));
    },
    add(itemId: string, count: number, x = 0, z = 0, skinId?: string) {
      const position = new THREE.Vector3(x, 0, z);
      const source = screenProjection.GetScreenPos(position);
      const ok = inventory.add(itemId, count, skinId, inventoryReceiveEffect(ui, source));
      return { ok, source };
    },
    craft() {
      return inventory.craft(INVENTORY_RECIPES.rope, undefined,
        inventoryReceiveEffect(ui, screenProjection.GetScreenPos(new THREE.Vector3())));
    },
    async capture() {
      const position = new THREE.Vector3(4, 0, 3);
      const spec = inventory.getItemSpec('fireflies');
      await ground.spawnFromSave('e_flight_fireflies', { itemId: 'fireflies', count: 1, ...spec }, position);
      const source = screenProjection.GetScreenPos(position);
      const firefly = activePrefabs.find(entity => entity.hasTag('NET_workable'))!;
      const ok = performToolWork('NET', firefly, { components: { inventory } })
        && (!!firefly.components.inventoryitem?.owner || firefly.isRemoved);
      return { ok, source, remaining: ground.exportRecords().length };
    },
    remove(index: number) {
      const slot = inventorySlotAddress(index);
      const stack = inventory.get(slot)!;
      inventory.applySlotChanges([{ slot, itemId: stack.itemId, skinId: stack.skinId, delta: -stack.count }]);
    },
    dispose() { ground.dispose(); worldState.dispose(); inventoryBar.remove(); backpackPanel.remove(); canvas.remove(); },
  };
}
