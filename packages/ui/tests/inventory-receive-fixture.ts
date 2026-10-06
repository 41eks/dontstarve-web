import * as THREE from 'three';
import { mountGameUi, INVENTORY_RECIPES } from '../src';
import { createInventoryStore } from '../../../src/inventory';
import { GroundItemManager } from '../../../src/groundItems';
import { inventoryReceiveEffect, projectInventorySource } from '../../../src/inventoryReceive';
import { inventorySlotAddress } from '@dontstarve-web/inventory';

export async function createReceiveFixture() {
  const { inventoryBar } = mountGameUi({ assetBaseUrl: '/dst/data/ui/' });
  const inventory = createInventoryStore();
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 12, 20);
  camera.lookAt(0, 0, 0);
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 480;
  Object.assign(canvas.style, { position: 'fixed', left: '40px', top: '60px', width: '320px', height: '240px' });
  document.body.append(canvas);
  const sync = (address: ReturnType<typeof inventorySlotAddress>) => {
    const stack = inventory.get(address);
    if (!stack) { inventoryBar.setSlot(address, null); return; }
    inventoryBar.setSlot(address, { ...inventory.getStackSpec(stack), id: stack.itemId, count: stack.count,
      ...(stack.skinId === undefined ? {} : { skinId: stack.skinId }) });
  };
  inventory.addresses().forEach(sync);
  inventory.subscribe((addresses) => addresses.forEach(sync));
  const scene = new THREE.Scene();
  const ground = new GroundItemManager(scene, camera, { domElement: canvas } as unknown as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', (item, _action, source) => inventory.add(item.itemId, item.count, item.skinId,
      inventoryReceiveEffect(inventoryBar, camera, canvas, source)), '/dst/data/anim', new THREE.Group(), undefined,
    { isNight: () => true, getPlayerPositions: () => [] });
  return {
    inventory, inventoryBar,
    add(itemId: string, count: number, x = 0, z = 0, skinId?: string) {
      const position = new THREE.Vector3(x, 0, z);
      const source = projectInventorySource(position, camera, canvas);
      const ok = inventory.add(itemId, count, skinId, inventoryReceiveEffect(inventoryBar, camera, canvas, position));
      return { ok, source };
    },
    craft() {
      return inventory.craft(INVENTORY_RECIPES.rope, undefined,
        inventoryReceiveEffect(inventoryBar, camera, canvas, new THREE.Vector3()));
    },
    async capture() {
      const position = new THREE.Vector3(4, 0, 3);
      const spec = inventory.getItemSpec('fireflies');
      await ground.spawnFromSave('e_flight_fireflies', { itemId: 'fireflies', count: 1, ...spec }, position);
      const source = projectInventorySource(position, camera, canvas);
      const ok = ground.netCaptureTargets[0].capture();
      return { ok, source, remaining: ground.exportRecords().length };
    },
    remove(index: number) {
      const slot = inventorySlotAddress(index);
      const stack = inventory.get(slot)!;
      inventory.applySlotChanges([{ slot, itemId: stack.itemId, skinId: stack.skinId, delta: -stack.count }]);
    },
    dispose() { ground.dispose(); inventoryBar.remove(); canvas.remove(); },
  };
}
