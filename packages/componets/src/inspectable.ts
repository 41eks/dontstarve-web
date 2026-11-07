export interface InspectableInst { addTag(tag: string): void; removeTag(tag: string): void }

/** components/inspectable.lua: the status and name hooks of an examinable entity; descriptions are not ported. */
export class Inspectable {
  private readonly inst: InspectableInst;
  /** inspectable.getstatus(inst, viewer). */
  getstatus?: (inst?: unknown, viewer?: unknown) => string | undefined;
  /** inspectable.descriptionfn(inst, viewer): the description key, when it depends on the viewer. */
  descriptionfn?: (viewer: never) => string | undefined;
  /** The inspect string name, not the display name of the object. */
  nameoverride?: string;
  constructor(inst: InspectableInst) { this.inst = inst; inst.addTag('inspectable'); }
  SetNameOverride(nameoverride: string | undefined): void { this.nameoverride = nameoverride; }
  OnRemoveFromEntity(): void { this.inst.removeTag('inspectable'); }
}
