// src/main.ts

import './style.css';
import {
  INVENTORY_RECIPES,
  mountGameUi,
  type CraftRequestDetail,
  type InventorySlotChangeDetail,
} from '@three-roaming/ui';
import type { WilsonAnimationController } from '@three-roaming/wilson';
import { preloadImageArchive } from '@three-roaming/wilson/imageAtlas';
import { createAnimationUpdater } from './animation';
import { player, playerBody, setPlayerNormal } from './player';
import {
  INVENTORY_ITEM_DEFINITIONS,
  InventoryStore,
  type InventorySlotRef,
} from './inventory';

void preloadImageArchive(`${import.meta.env.BASE_URL}dst/data/databundles/images.zip`).catch(() => undefined);
const gameUi = mountGameUi({ assetBaseUrl: `${import.meta.env.BASE_URL}dst/data/ui/` });
export const inventory = new InventoryStore(INVENTORY_ITEM_DEFINITIONS);
const playerAnimation = player.userData.animationController as WilsonAnimationController | undefined;

function syncHandEquipment(): void {
  const handItem = inventory.get({ group: 'equipment', kind: 'hand' });
  playerAnimation?.setCarryItem(handItem?.itemId === 'torch' ? 'torch' : null);
}

function syncInventorySlot(ref: InventorySlotRef): void {
  const stack = inventory.get(ref);
  if (!stack) {
    gameUi.inventoryBar.setSlot(ref, null);
    return;
  }

  const spec = inventory.getItemSpec(stack.itemId);
  gameUi.inventoryBar.setSlot(ref, {
    id: stack.itemId,
    name: spec.name,
    count: stack.count,
    maxStack: spec.maxStack,
    icon: spec.icon,
    ...(spec.atlas ? { atlas: spec.atlas } : {}),
    ...(spec.equippable ? { equippable: spec.equippable } : {}),
  });
}

function syncCraftingInventory(): void {
  gameUi.crafting.setInventoryCounts(inventory.counts());
}

inventory.refs().forEach(syncInventorySlot);
syncCraftingInventory();
syncHandEquipment();
inventory.subscribe((changedSlots) => {
  changedSlots.forEach(syncInventorySlot);
  syncCraftingInventory();
  if (changedSlots.some((ref) => ref.group === 'equipment' && ref.kind === 'hand')) {
    syncHandEquipment();
  }
});

interface PendingInventoryOperation {
  decrease?: InventorySlotChangeDetail;
  increase?: InventorySlotChangeDetail;
}

const pendingInventoryOperations = new Map<number, PendingInventoryOperation>();

function receiveInventorySlotChange(
  direction: 'decrease' | 'increase',
  detail: InventorySlotChangeDetail,
): void {
  if (!Number.isSafeInteger(detail.amount) || detail.amount <= 0) return;
  const operation = pendingInventoryOperations.get(detail.operationId) ?? {};
  operation[direction] = detail;
  pendingInventoryOperations.set(detail.operationId, operation);

  if (!operation.decrease || !operation.increase) {
    queueMicrotask(() => {
      if (pendingInventoryOperations.get(detail.operationId) === operation
        && (!operation.decrease || !operation.increase)) {
        pendingInventoryOperations.delete(detail.operationId);
      }
    });
    return;
  }

  pendingInventoryOperations.delete(detail.operationId);
  if (operation.decrease.itemId !== operation.increase.itemId
    || operation.decrease.amount !== operation.increase.amount) {
    return;
  }

  inventory.applySlotChanges([
    {
      slot: operation.decrease.slot,
      itemId: operation.decrease.itemId,
      delta: -operation.decrease.amount,
    },
    {
      slot: operation.increase.slot,
      itemId: operation.increase.itemId,
      delta: operation.increase.amount,
    },
  ]);
}

gameUi.inventoryBar.addEventListener('game:inventory-slot-decrease', (event) => {
  receiveInventorySlotChange(
    'decrease',
    (event as CustomEvent<InventorySlotChangeDetail>).detail,
  );
});
gameUi.inventoryBar.addEventListener('game:inventory-slot-increase', (event) => {
  receiveInventorySlotChange(
    'increase',
    (event as CustomEvent<InventorySlotChangeDetail>).detail,
  );
});
gameUi.crafting.addEventListener('game:craft-request', (event) => {
  const { recipeId } = (event as CustomEvent<CraftRequestDetail>).detail;
  const recipe = INVENTORY_RECIPES[recipeId];
  if (recipe) inventory.craft(recipe);
});

import * as THREE from 'three';

import * as CANNON from "cannon-es";
// --- 1. 初始化物理世界 ---
const world = new CANNON.World({
  gravity: new CANNON.Vec3(0, -9.82, 0), // 设置重力
});

// --- 2. 创建物理地面 ---
const groundMaterial = new CANNON.Material("ground");
const groundBody = new CANNON.Body({
  mass: 0, // 质量为0代表静态物体，不会掉落
  shape: new CANNON.Plane(),
  material: groundMaterial,
});
// Cannon 的 Plane 默认面向 Z 轴，需要旋转使其平躺在地面
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);
import {
  ground, boxes, setTreeNormals

} from './building';
import { animate, backTasks, middleTasks } from './animate';
import { camera } from './camera';
import { pigKingBody, pigKingFloor, pigKingStandee, setPigKingNormal } from './pigking';
import { renderer, scene } from './universal';
scene.background = new THREE.Color(0xbfd1e5);

scene.add(ground);
scene.add(pigKingFloor);
scene.add(pigKingStandee);
// scene.add(boxes);
boxes.forEach(box => {
  scene.add(box);
})


// import { input } from './InputManager';
import { updateMovement } from './updatePlayerMovement';

world.addBody(playerBody);

scene.add(player);

import { pigBody, pig, updatePigPosition } from './pig';
import { setupPigInteraction } from './pigInteraction';
world.addBody(pigBody);
scene.add(pig);
const updatePigInteraction = setupPigInteraction(camera, renderer, pig, player);
world.addBody(pigKingBody);
function getVelocity() {
  const velocity = new THREE.Vector3(0, 0, 16);
  const originLength = velocity.length();
  return originLength
}

const updatePlayerMovement = updateMovement(camera, player, playerBody);


const updateAnimationListener = createAnimationUpdater(player);

const cameraDirection = new THREE.Vector3();

middleTasks.push((dt: number) => {
  updatePlayerMovement(getVelocity(), dt);
  updatePigPosition();

});
middleTasks.push(updateAnimationListener);
import CannonDebugger from 'cannon-es-debugger';
const isGitHubPages = window.location.hostname.endsWith('github.io');
if (!isGitHubPages) {
  const cannonDebugger = CannonDebugger(scene, world, {
    color: 0x00ff00, // 物理碰撞体将显示为绿色线框
  });
  backTasks.push(() => {
    // 在 animate 循环中更新 debugger
    cannonDebugger.update();
  });
}

backTasks.push(() => {
  camera.getWorldDirection(cameraDirection);
  setPlayerNormal(cameraDirection);
  setPigKingNormal(cameraDirection);
  setTreeNormals(cameraDirection);
  updatePigInteraction();
});

animate(world, camera);
