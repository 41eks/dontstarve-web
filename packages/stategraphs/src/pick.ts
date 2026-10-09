import type * as THREE from 'three';
import type { ActionWorldContext } from './actionContext.ts';
import type { BufferedActionObject } from './bufferedaction.ts';
import type { MouseActionCandidate } from './playeractionpicker.ts';
import { PlayerActionPicker } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';

/** The actor supplies inventory reception; products belong to the pickable component. */
export interface PickDoer {
  giveItem(itemId: string, count: number, sourcePosition: THREE.Vector3): boolean;
}

export interface PickableComponent {
  readonly canBePicked: boolean;
  pick(doer: PickDoer): boolean;
}

interface PickTarget extends BufferedActionObject {
  readonly model: THREE.Object3D;
  readonly component: PickableComponent;
}

function canPick(target: PickTarget): boolean {
  // componentactions.lua SCENE.pickable and actions.lua PICK.validfn.
  return target.hasTag('pickable') && !target.hasTag('fire') && !target.hasTag('intense')
    && target.component.canBePicked;
}

/** Scene PICK actions are discovered from components and tags, independent of prefab IDs. */
export function getPickActions(scene: THREE.Scene): MouseActionCandidate[] {
  const actions: MouseActionCandidate[] = [];
  scene.traverse(model => {
    const component: PickableComponent | undefined = model.userData.components?.pickable;
    if (!component) return;
    const target: PickTarget = {
      model, component, prefab: model.userData.prefab,
      hasTag: tag => model.userData.tags?.includes(tag) ?? false,
    };
    actions.push({ action: { action: 'PICK', target }, button: 'left', model, available: canPick(target) });
  });
  return actions;
}

/** Common PICK input; prefabs have no pointer listeners or product-specific host callbacks. */
export class PickActionController {
  private readonly picker: PlayerActionPicker;
  private readonly unregister: () => void;
  private disposed = false;
  private readonly world: ActionWorldContext;
  private readonly doer: PickDoer;
  private readonly onPicked: () => void;

  constructor(world: ActionWorldContext, doer: PickDoer, onPicked: () => void = () => {}) {
    this.world = world;
    this.doer = doer;
    this.onPicked = onPicked;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    this.unregister = this.picker.register(() => getPickActions(world.scene));
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.disposed || event.button !== 0 || event.defaultPrevented) return;
    this.picker.pointer.trackPointer(event);
    const action = this.picker.getMouseActions().left;
    if (action?.action !== 'PICK' || !action.target) return;
    const target = action.target as PickTarget;
    if (!canPick(target)) return;
    event.preventDefault();
    if (target.component.pick(this.doer)) {
      this.world.actionEvents?.emit('action:begin', { owner: this, action: 'PICK' });
      this.onPicked();
    }
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unregister();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    if (this.picker !== this.world.mouseActions) this.picker.dispose();
  }
}
