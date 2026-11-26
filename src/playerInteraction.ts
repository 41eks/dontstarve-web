import { Vector3 } from 'three';
import type { InventoryStore } from '@dontstarve-web/inventory';
import type { BookWorld } from '@dontstarve-web/prefab/books';
import { addComponent, removeComponent } from '@dontstarve-web/prefab/components';
import {
  hasPlayerInventory,
  type PlayerInstance,
  type PlayerWithInventory,
} from '@dontstarve-web/prefab/player_common';
import { TILE_SIZE } from '@dontstarve-web/prefab/tile';
import type { WorldContext } from '@dontstarve-web/prefab/worldContext';
import { isWorldFx } from '@dontstarve-web/prefab/world_fx';
import { PlayerController, type PlayerLocomotor } from '@dontstarve-web/stategraphs';
import { Combat } from '../packages/componets/src/combat';
import { Reader } from '../packages/componets/src/reader';
import { Talker } from '../packages/componets/src/talker';
import { createDeployMap } from '../packages/prefab/src/deployMap';
import { DeployPlacer } from '../packages/prefab/src/deployPlacer';
import { equippedActionEntity } from '../packages/stategraphs/src/componentactions';
import { registerFrontTask } from './animate';
import { IsAutopaused } from './autopause';
import { bindWorldControls, input } from './InputManager';
import type { startScene } from './scene';

type SceneResources = Awaited<ReturnType<typeof startScene>>;

export function bindPlayerComponents(
  player: PlayerInstance,
  root: WorldContext['scene'],
  {
    scheduler,
    weather,
    moon,
    worldFx,
    getWatchWorldContent,
  }: Pick<SceneResources, 'scheduler' | 'weather' | 'moon' | 'worldFx' | 'getWatchWorldContent'>,
  retain: (dispose: () => void) => void,
): Talker {
  const bookWorld: BookWorld = {
    root,
    scheduler,
    weather,
    moon,
    getWatchWorldContent,
    spawnFx(prefab, reader) {
      const { x, z } = reader.getPosition();
      if (isWorldFx(prefab)) {
        worldFx.spawn(prefab, new Vector3(x, 0, z));
      }
    },
  };
  addComponent(player, 'reader', Reader<PlayerInstance, BookWorld>, bookWorld);
  retain(() => removeComponent(player, 'reader'));

  const talker = addComponent(player, 'talker', Talker, scheduler);
  retain(() => removeComponent(player, 'talker'));
  return talker;
}

/** Adapt the controller's constructor to EntityScript:AddComponent's owner-first signature. */
class PlayerControllerComponent extends PlayerController {
  constructor(
    player: PlayerWithInventory,
    view: WorldContext,
    locomotor: PlayerLocomotor,
    handEquipment: InventoryStore['handEquipment'],
    isActionInterrupting: () => boolean,
    controls: ConstructorParameters<typeof PlayerController>[6],
  ) {
    super(view, player.sg, locomotor, handEquipment, player, isActionInterrupting, controls);
  }
}

interface PlayerInteractionOptions {
  view: WorldContext;
  playerEntity: PlayerInstance;
  locomotor: PlayerLocomotor;
  inventory: InventoryStore;
  isActionInterrupting: () => boolean;
  turfMap: Parameters<typeof createDeployMap>[0]['turf'];
}

export function bindPlayerInteraction(
  { view, playerEntity, locomotor, inventory, isActionInterrupting, turfMap }: PlayerInteractionOptions,
  {
    registry,
    prefabs,
    farmMap,
    buildingPlacement,
    scheduler,
  }: Pick<SceneResources, 'registry' | 'prefabs' | 'farmMap' | 'buildingPlacement' | 'scheduler'>,
  retain: (dispose: () => void) => void,
): void {
  if (!hasPlayerInventory(playerEntity)) {
    throw new Error('The player acts with its inventory');
  }
  const previousFrameTask = view.registerFrameTask;
  view.registerFrameTask = registerFrontTask;
  retain(() => {
    if (view.registerFrameTask === registerFrontTask) {
      view.registerFrameTask = previousFrameTask;
    }
  });

  const handEquipment = inventory.handEquipment;
  const controller = addComponent(
    playerEntity,
    'playercontroller',
    PlayerControllerComponent,
    view,
    locomotor,
    handEquipment,
    isActionInterrupting,
    { isPaused: IsAutopaused, isInputBlocked: () => input.isBlocked(), placement: buildingPlacement },
  );
  let stopWorldControls: (() => void) | undefined;
  retain(() => {
    try {
      stopWorldControls?.();
    } finally {
      if (playerEntity.components.playercontroller === controller) {
        removeComponent(playerEntity, 'playercontroller');
      }
    }
  });
  stopWorldControls = bindWorldControls(view.renderer.domElement, controller);

  // SGwilson.lua fishing states reach inst.components.inventory:GetEquippedItem(HANDS).components.fishingrod.
  const heldRod = () =>
    (
      equippedActionEntity(handEquipment.value)?.components as
        | { fishingrod?: import('../packages/componets/src/fishingrod').FishingRod }
        | undefined
    )?.fishingrod;
  const fishingHost = {
    waitForFish: () => heldRod()?.WaitForFish(),
    collect: () => heldRod()?.Collect(),
    loseRod: () => {
      heldRod()?.Release();
      (handEquipment.value?.entity as { remove?(): boolean } | undefined)?.remove?.();
    },
  };
  playerEntity.fishingHost = fishingHost;
  retain(() => {
    if (playerEntity.fishingHost === fishingHost) {
      playerEntity.fishingHost = undefined;
    }
  });

  // player_common.lua: combat with UNARMED_DAMAGE, WILSON_ATTACK_PERIOD and DEFAULT_ATTACK_RANGE.
  const combat = addComponent(
    playerEntity,
    'combat',
    Combat,
    () => scheduler.now,
    () => equippedActionEntity(handEquipment.value)?.components.weapon,
  );
  retain(() => removeComponent(playerEntity, 'combat'));
  combat.SetDefaultDamage(10);
  combat.SetAttackPeriod(0.4);
  combat.SetRange(TILE_SIZE / 2);

  // TheWorld.Map for ACTIONS.DEPLOY and the deployable items' placer.
  const deployMap = createDeployMap({
    turf: turfMap,
    ents: prefabs,
    worldEvents: view.worldEvents,
    farm: farmMap,
    getCameraHeading: () => view.cameraHeading.value,
    spawnPrefab: (prefab, position, skinId) => registry.SpawnPrefab(prefab, position, skinId),
  });
  playerEntity.Map = deployMap;
  let deployPlacer: DeployPlacer | undefined;
  retain(() => {
    try {
      deployPlacer?.dispose();
    } finally {
      if (playerEntity.Map === deployMap) {
        playerEntity.Map = undefined;
      }
    }
  });
  deployPlacer = new DeployPlacer(view, deployMap, () => inventory.GetActiveItem());
}
