import * as THREE from 'three';
import type { PickableComponent, PickDoer } from '@dontstarve-web/stategraphs/pick';

export interface PickableSaveState {
  picked?: boolean;
  regrowSeconds?: number;
}

/** pickable.lua: SetUp, Pick, Regen and the component-owned pickable tag. */
export class Pickable implements PickableComponent {
  private picked: boolean;
  private remaining?: number;
  private disposed = false;
  private interactable = true;
  private readonly model: THREE.Object3D;
  readonly product: string;
  readonly regenTime: number;
  readonly numToHarvest: number;
  private readonly onPicked: () => void;
  private readonly onRegen: () => void;

  constructor(model: THREE.Object3D, product: string, regenTime: number, numToHarvest = 1,
    onPicked: () => void = () => {}, onRegen: () => void = () => {}, saved?: PickableSaveState) {
    this.model = model;
    this.product = product;
    this.regenTime = regenTime;
    this.numToHarvest = numToHarvest;
    this.onPicked = onPicked;
    this.onRegen = onRegen;
    this.picked = saved?.picked ?? false;
    this.remaining = saved?.regrowSeconds;
    model.userData.components = { ...model.userData.components, pickable: this };
    this.refreshTag();
  }

  get canBePicked(): boolean { return !this.disposed && !this.picked; }
  get canInteractWith(): boolean { return this.interactable; }
  set canInteractWith(value: boolean) {
    this.interactable = value;
    this.refreshTag();
  }
  get remainingSeconds(): number | undefined { return this.remaining; }

  pick(doer: PickDoer): boolean {
    if (!this.canBePicked || !this.canInteractWith || !doer.giveItem(this.product, this.numToHarvest,
      this.model.getWorldPosition(new THREE.Vector3()))) return false;
    this.picked = true;
    this.remaining = this.regenTime;
    this.refreshTag();
    this.onPicked();
    return true;
  }

  update(dt: number): void {
    if (this.disposed || this.remaining === undefined || !Number.isFinite(dt) || dt < 0) return;
    this.remaining -= dt;
    if (this.remaining > 0) return;
    this.remaining = undefined;
    this.picked = false;
    this.refreshTag();
    this.onRegen();
  }

  exportState(): PickableSaveState {
    return this.picked ? { picked: true, regrowSeconds: this.remaining } : {};
  }

  dispose(): void {
    this.disposed = true;
    this.remaining = undefined;
    this.refreshTag();
    if (this.model.userData.components?.pickable === this) delete this.model.userData.components.pickable;
  }

  private refreshTag(): void {
    const tags: string[] = this.model.userData.tags ??= [];
    const index = tags.indexOf('pickable');
    const pickable = this.canBePicked && this.canInteractWith;
    if (pickable && index < 0) tags.push('pickable');
    else if (!pickable && index >= 0) tags.splice(index, 1);
  }
}
