/** bathbomb.lua: the item advertises ACTIONS.BATHBOMB through its tag. */
export class BathBomb {
  private readonly inst: { addTag(tag: string): void; removeTag(tag: string): void };
  constructor(inst: { addTag(tag: string): void; removeTag(tag: string): void }) { this.inst = inst; inst.addTag('bathbomb'); }
  OnRemoveFromEntity(): void { this.inst.removeTag('bathbomb'); }
  dispose(): void { this.OnRemoveFromEntity(); }
}
