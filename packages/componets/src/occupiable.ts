import { createSignal, readonlySignal } from '../../signals/src';

export interface OccupiableInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
}

/** What components/occupiable.lua reads from an occupant: tags, events and the occupier component. */
export interface OccupantItem {
  readonly isRemoved: boolean;
  hasTag(tag: string): boolean;
  ListenForEvent(name: string, listener: (data: unknown) => void): () => void;
  getComponent<T extends { dispose(): void }>(name: string): T | undefined;
  /** occupier:Remove(): the occupant is destroyed after it perished. */
  destroy(): void;
}

/** components/occupier.lua: only remembers the cage that owns the occupant. */
export class Occupier<Owner = unknown> {
  private ownerRef: Owner | undefined;
  /** Lua's occupier.onoccupied(occupier, cage). */
  onoccupied?: (cage: Owner | undefined) => void;
  GetOwner(): Owner | undefined { return this.ownerRef; }
  SetOwner(owner: Owner | undefined): void { this.ownerRef = owner; }
  dispose(): void { this.ownerRef = undefined; this.onoccupied = undefined; }
}

/** components/occupiable.lua: one occupant that leaves when it perishes, is removed or is harvested. */
export class Occupiable<Item extends OccupantItem, Inst extends OccupiableInst = OccupiableInst> {
  private readonly occupantState = createSignal<Item | undefined>(undefined);
  /** The current occupant; absent after Harvest and after the occupant leaves for any reason. */
  readonly occupant = readonlySignal(this.occupantState);
  private stopListening: (() => void) | undefined;
  private type: string | undefined;
  onoccupied?: (inst: Inst, occupant: Item) => void;
  onemptied?: (inst: Inst) => void;
  onperishfn?: (inst: Inst, occupant: Item) => void;
  private readonly inst: Inst;

  constructor(inst: Inst) {
    this.inst = inst;
  }

  get occupanttype(): string | undefined { return this.type; }
  set occupanttype(value: string | undefined) {
    const old = this.type;
    this.type = value;
    if (this.occupantState.peek()) return;
    if (old !== undefined) this.inst.removeTag(`${old}_occupiable`);
    if (value !== undefined) this.inst.addTag(`${value}_occupiable`);
  }

  IsOccupied(): boolean { return this.occupantState.peek() !== undefined; }
  GetOccupant(): Item | undefined { return this.occupantState.peek(); }

  CanOccupy(occupier: Item): boolean {
    return !this.IsOccupied() && this.type !== undefined && occupier.hasTag(this.type)
      && occupier.getComponent('occupier') !== undefined;
  }

  /** The caller has already removed the item from its previous owner (inventoryitem:RemoveFromOwner). */
  Occupy(occupier: Item | undefined): boolean {
    const occupierComponent = occupier?.getComponent<Occupier<Inst>>('occupier');
    if (this.IsOccupied() || !occupier || !occupierComponent || occupier.isRemoved) return false;
    // occupiableonperish / occupiableonremove are registered after the callbacks, as in Lua.
    this.setOccupant(occupier);
    occupierComponent.SetOwner(this.inst);
    occupierComponent.onoccupied?.(this.inst);
    this.onoccupied?.(this.inst, occupier);
    const stopPerish = occupier.ListenForEvent('perished', () => {
      stop();
      this.onemptied?.(this.inst);
      this.onperishfn?.(this.inst, occupier);
      this.setOccupant(undefined);
      occupier.destroy();
    });
    const stopRemove = occupier.ListenForEvent('onremove', () => {
      stop();
      this.onemptied?.(this.inst);
      this.setOccupant(undefined);
    });
    const stop = () => { stopPerish(); stopRemove(); if (this.stopListening === stop) this.stopListening = undefined; };
    this.stopListening = stop;
    return true;
  }

  /** The occupant leaves alive; the caller gives it to the harvester. */
  Harvest(): Item | undefined {
    const item = this.occupantState.peek();
    if (!item) return undefined;
    item.getComponent<Occupier<Inst>>('occupier')?.SetOwner(undefined);
    this.stopListening?.();
    this.setOccupant(undefined);
    this.onemptied?.(this.inst);
    return item;
  }

  dispose(): void {
    this.stopListening?.();
    if (this.type !== undefined) this.inst.removeTag(`${this.type}_occupiable`);
    this.inst.removeTag('occupied');
    this.occupantState.set(undefined);
  }

  /** onoccupant: the occupied tag replaces the type's _occupiable tag. */
  private setOccupant(item: Item | undefined): void {
    this.occupantState.set(item);
    if (item) {
      this.inst.addTag('occupied');
      if (this.type !== undefined) this.inst.removeTag(`${this.type}_occupiable`);
    } else {
      this.inst.removeTag('occupied');
      if (this.type !== undefined) this.inst.addTag(`${this.type}_occupiable`);
    }
  }
}
