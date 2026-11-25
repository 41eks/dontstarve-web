import { Vector3 } from 'three';
import type { InventoryStore, ItemEntity } from '@dontstarve-web/inventory';
import type { ScreenProjection } from '@dontstarve-web/display';
import { PLAYER_COLLIDER_RADIUS, type PlayerInstance } from '@dontstarve-web/prefab/player_common';
import type { WorldContext } from '@dontstarve-web/prefab/worldContext';
import type { EventEmitter, GetWatchWorldContent } from '@dontstarve-web/signals';
import type { PlayerActionEvents, PlayerLocomotor } from '@dontstarve-web/stategraphs';
import { createFollowText, type mountGameUi, type SlotItem } from '@dontstarve-web/ui';
import { registerFrontTask } from './animate';
import type { turfMap } from './building';
import { createContainerPanels } from './containerPanels';
import { setupEmoteWheel } from './emoteWheel';
import { bindInventoryContextMenu } from './inventoryContextMenu';
import { inventoryReceiveEffect } from './inventoryReceive';
import { bindPlayerComponents, bindPlayerInteraction } from './playerInteraction';
import type { startScene } from './scene';

interface ApplicationBindingsOptions {
  gameUi: ReturnType<typeof mountGameUi>;
  view: WorldContext;
  screenProjection: Pick<ScreenProjection, 'GetScreenPos'>;
  inventory: InventoryStore;
  playerEntity: PlayerInstance;
  locomotor: PlayerLocomotor;
  inventorySlotItem: (entity: ItemEntity) => SlotItem;
  actionEvents: EventEmitter<PlayerActionEvents>;
  isActionInterrupting: () => boolean;
  updateCursor: () => void;
  getWatchWorldContent: GetWatchWorldContent;
  turfMap: typeof turfMap;
}

type SceneResources = Pick<
  Awaited<ReturnType<typeof startScene>>,
  | 'registry'
  | 'prefabs'
  | 'buildingPlacement'
  | 'farmMap'
  | 'worldFx'
  | 'scheduler'
  | 'weather'
  | 'moon'
  | 'getWatchWorldContent'
  | 'disposalEvents'
>;

/** Panels receive container events while the scene restores. Bind actions and frames after the inventory loads. */
export function createApplicationBindings(options: ApplicationBindingsOptions) {
  const { gameUi, view, screenProjection, inventory, playerEntity, actionEvents, updateCursor } = options;
  const panels = createContainerPanels(options);
  const statusHud = gameUi.statusHud;
  const stopActions: (() => void)[] = [];
  let stopHud: (() => void) | undefined;
  let stopReceived: (() => void) | undefined;
  let stopFollowTextFrame: (() => void) | undefined;
  let followText: ReturnType<typeof createFollowText> | undefined;
  let stopSceneDispose: (() => void) | undefined;
  let disposed = false;

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    stopSceneDispose?.();
    const errors: unknown[] = [];
    for (const stop of [
      panels.dispose,
      stopHud,
      () => statusHud.dispose(),
      stopReceived,
      stopFollowTextFrame,
      () => followText?.dispose(),
      ...stopActions,
    ]) {
      try {
        stop?.();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      throw new AggregateError(errors, 'Unable to release application bindings');
    }
  }

  return {
    onContainerInteraction: panels.onContainerInteraction,
    bindScene(scene: SceneResources): void {
      if (disposed || stopSceneDispose) {
        throw new Error('Application bindings can only attach to one scene');
      }
      stopSceneDispose = scene.disposalEvents.on('dispose', dispose);
      panels.bindActions(scene.buildingPlacement);
      stopReceived = inventory.subscribeReceived((received, source) => {
        if (source) {
          inventoryReceiveEffect(
            gameUi,
            screenProjection.GetScreenPos(new Vector3(source.x, source.y, source.z)),
          )(received);
        }
      });

      const retain = (stop: () => void) => {
        stopActions.push(stop);
      };
      const talker = bindPlayerComponents(playerEntity, view.scene, scene, retain);
      const text = createFollowText({
        camera: view.camera,
        canvas: view.renderer.domElement,
        target: view.player,
        height: PLAYER_COLLIDER_RADIUS * 3.6 + 1,
        line: talker.line,
      });
      followText = text;
      bindPlayerInteraction(options, scene, retain);
      retain(setupEmoteWheel(gameUi.emoteWheel, playerEntity, actionEvents, updateCursor));
      retain(bindInventoryContextMenu(gameUi.inventoryBar.contextMenu, inventory, playerEntity, actionEvents));
      stopHud = registerFrontTask(dt => statusHud.advanceAnimation(dt));
      stopFollowTextFrame = registerFrontTask(() => text.update());
    },
    dispose,
  };
}
