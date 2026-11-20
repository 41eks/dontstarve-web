import { GetDescription, GetString, type SpeakerInst } from './stringutil';

/** The components Inspectable:GetStatus and GetDescription ask about, when the inst has them. */
interface StatusComponents {
  readonly health?: { IsDead(): boolean };
  readonly sleeper?: { IsAsleep(): boolean };
  readonly burnable?: { IsBurning(): boolean; IsSmoldering?(): boolean };
  readonly pickable?: { IsBarren(): boolean; readonly canBePicked: boolean };
  readonly inventoryitem?: { readonly owner?: unknown };
  readonly occupiable?: { IsOccupied?(): boolean };
}

export interface InspectableInst {
  readonly prefab?: string;
  readonly nameoverride?: string;
  addTag(tag: string): void;
  removeTag(tag: string): void;
  hasTag?(tag: string): boolean;
  readonly components?: object;
}

/** components/inspectable.lua: what an entity says it is when a player examines it. */
export class Inspectable {
  private readonly inst: InspectableInst;
  /** inspectable.description: a fixed line in place of the character's speech. */
  description?: string;
  /** inspectable.getstatus(inst, viewer). */
  getstatus?: (inst?: unknown, viewer?: unknown) => string | undefined;
  /** inspectable.descriptionfn(inst, viewer): the line, when it depends on the viewer. */
  descriptionfn?: (viewer: never) => string | undefined;
  /** The inspect string name, not the display name of the object. */
  nameoverride?: string;
  /** inspectable.noanim: the speaker stays in its pose. */
  noanim?: boolean;
  constructor(inst: InspectableInst) { this.inst = inst; inst.addTag('inspectable'); }
  SetDescription(description: string | undefined): void { this.description = description; }
  SetNameOverride(nameoverride: string | undefined): void { this.nameoverride = nameoverride; }
  OnRemoveFromEntity(): void { this.inst.removeTag('inspectable'); }

  /** Inspectable:GetStatus, for the components the game has: diseaseable and witherable are not ported. */
  GetStatus(viewer?: object): string | undefined {
    if (this.inst === viewer) { return undefined; }
    const { health, sleeper, burnable, pickable, inventoryitem, occupiable } = (this.inst.components ?? {}) as StatusComponents;
    return this.getstatus?.(this.inst, viewer) || (health?.IsDead() ? 'DEAD' : undefined)
      || (sleeper?.IsAsleep() ? 'SLEEPING' : undefined)
      || (burnable?.IsBurning() ? 'BURNING' : undefined)
      || (pickable ? pickable.IsBarren() ? 'BARREN' : !pickable.canBePicked ? 'PICKED' : undefined : undefined)
      || (inventoryitem?.owner ? 'HELD' : undefined)
      || (occupiable?.IsOccupied?.() ? 'OCCUPIED' : undefined)
      || (this.inst.hasTag?.('burnt') ? 'BURNT' : undefined);
  }

  /** Inspectable:GetDescription. CanEntitySeeTarget's darkness branch has no port of its light query. */
  GetDescription(viewer: SpeakerInst): string | undefined {
    if (this.inst === viewer) { return undefined; }
    const desc = this.descriptionfn ? this.descriptionfn(viewer as never) : this.description;
    if (desc === undefined || viewer.hasTag('playerghost') || viewer.hasTag('mime')) {
      return GetDescription(viewer, this.inst, this.GetStatus(viewer));
    }
    return (this.inst.components as StatusComponents | undefined)?.burnable?.IsSmoldering?.() ? GetString(viewer, 'DESCRIBE_SMOLDERING') : desc;
  }
}
