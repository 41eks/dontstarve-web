import * as THREE from 'three';
import { createEffect, type ReadonlySignal } from '@dontstarve-web/signals';

export interface FollowTextOptions {
  camera: THREE.Camera;
  canvas: Pick<HTMLCanvasElement, 'getBoundingClientRect'>;
  target: THREE.Object3D;
  /** World units above the target's foot point. */
  height: number;
  line: ReadonlySignal<string | undefined>;
}

export interface FollowText {
  readonly element: HTMLDivElement;
  update(): void;
  dispose(): void;
}

/** widgets/followtext.lua for a talker's line: the string, kept above its entity on screen. */
export function createFollowText({ camera, canvas, target, height, line }: FollowTextOptions): FollowText {
  const element = document.createElement('div');
  element.className = 'follow-text';
  element.hidden = true;
  document.body.append(element);
  Object.assign(element.style, {
    position: 'fixed', left: '0', top: '0', pointerEvents: 'none', zIndex: '5', whiteSpace: 'pre-line', textAlign: 'center',
    color: '#fff', font: '24px serif', textShadow: '0 0 3px #000, 0 1px 2px #000', transform: 'translate(-50%, -100%)',
  });
  const point = new THREE.Vector3();
  const update = () => {
    if (element.hidden) { return; }
    point.copy(target.position);
    point.y += height;
    point.project(camera);
    const bounds = canvas.getBoundingClientRect();
    element.style.left = `${bounds.left + (point.x + 1) * bounds.width / 2}px`;
    element.style.top = `${bounds.top + (1 - point.y) * bounds.height / 2}px`;
  };
  const stop = createEffect(() => {
    const text = line.get();
    element.hidden = text === undefined;
    element.textContent = text ?? '';
    update();
  });
  return { element, update, dispose() { stop(); element.remove(); } };
}
