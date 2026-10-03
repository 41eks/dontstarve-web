import * as THREE from 'three';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { ICE_BOX_DEFINITION } from '../../prefab/src/icebox';
import { TREASURE_CHEST_DEFINITION } from '../../prefab/src/treasurechest';
import { PointerRaycaster } from '../../prefab/src/pointerRaycaster';
import { DisposeSounds } from '../../prefab/src/sound';
import type { WorldContext } from '../../prefab/src/worldContext';

export async function checkContainerSounds() {
  const sources: AudioBufferSourceNode[] = [];
  let context: AudioContext | undefined;
  const originalCreate = AudioContext.prototype.createBufferSource;
  const originalRaycast = PointerRaycaster.prototype.raycastPointer;
  AudioContext.prototype.createBufferSource = function () {
    context = this;
    const source = originalCreate.call(this);
    sources.push(source);
    return source;
  };
  // Pick the target deterministically; retain real click handling and animation updates.
  PointerRaycaster.prototype.raycastPointer = (objects) =>
    objects[0] ? { object: objects[0], point: new THREE.Vector3() } as THREE.Intersection : undefined;
  const cases = [];
  try {
    for (const [id, definition] of [['icebox', ICE_BOX_DEFINITION], ['treasurechest', TREASURE_CHEST_DEFINITION]] as const) {
      const canvas = document.createElement('canvas');
      const world = {
        scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(),
        camera: new THREE.PerspectiveCamera(), renderer: { domElement: canvas },
      } as unknown as WorldContext;
      const placement = new AnimatedBuildingPlacement(world, { [id]: definition }, () => true);
      const before = sources.length;
      await placement.spawn(id);
      await placement.begin(id);
      placement.cancel();
      const silentSpawnAndPreview = sources.length === before;
      const model = world.scene.children[0];
      const distance = (value: number) => world.player.position.copy(model.position).add(new THREE.Vector3(value, 0, 0));
      const click = () => canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }));
      const finish = () => { for (let i = 0; i < 60; i++) placement.update(1 / 30); };
      distance(11);
      click();
      const silentDistantClick = sources.length === before;
      distance(0);
      click();
      const immediateOpen = sources.length === before + 1;
      click();
      const ignoresOpeningClick = sources.length === before + 1;
      finish();
      const savedOpen = placement.exportRecords()[0].record;
      placement.hammerTargets[0].playHit();
      finish();
      const silentHit = sources.length === before + 1;
      click();
      const immediateClose = sources.length === before + 2;
      click();
      finish();
      const ignoresClosingClick = sources.length === before + 2;
      click();
      finish();
      distance(10);
      placement.update(0);
      const staysOpenAtBoundary = sources.length === before + 3;
      distance(10.01);
      placement.update(0);
      placement.update(0);
      finish();
      const autoCloseOnce = sources.length === before + 4;
      distance(0);
      click();
      distance(11);
      placement.update(0);
      finish();
      const closesDuringOpening = sources.length === before + 6;
      await placement.spawnFromSave(id, savedOpen);
      const silentRestore = sources.length === before + 6;
      cases.push({ id, silentSpawnAndPreview, silentDistantClick, immediateOpen, immediateClose,
        ignoresOpeningClick, ignoresClosingClick, silentHit, staysOpenAtBoundary, autoCloseOnce,
        closesDuringOpening, silentRestore, samples: sources.slice(before).map((source) => ({
          loop: source.loop, channels: source.buffer!.numberOfChannels,
          duration: source.buffer!.length / source.buffer!.sampleRate,
        })) });
    }
    (window as unknown as { containerAudio: (dispose: boolean) => string }).containerAudio = (dispose) => {
      if (dispose) DisposeSounds();
      return context?.state ?? 'missing';
    };
    return cases;
  } finally {
    AudioContext.prototype.createBufferSource = originalCreate;
    PointerRaycaster.prototype.raycastPointer = originalRaycast;
  }
}
