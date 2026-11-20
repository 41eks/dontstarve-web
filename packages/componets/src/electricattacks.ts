/**
 * components/electricattacks.lua: a boolean SourceModifierList of what makes the entity's attacks electric. When the
 * last source is removed the component removes itself (`removeFromEntity` is inst:RemoveComponent("electricattacks")).
 * Combat reading it for electric damage is not ported.
 */
export class ElectricAttacks {
  private readonly sources = new Set<object>();
  private readonly removeFromEntity: () => void;

  constructor(_inst: object, removeFromEntity: () => void) {
    this.removeFromEntity = removeFromEntity;
  }

  AddSource(source: object): void { this.sources.add(source); }

  RemoveSource(source: object): void {
    this.sources.delete(source);
    if (this.sources.size === 0) { this.removeFromEntity(); }
  }

  /** _sources:Get(): whether any source is set. */
  HasSources(): boolean { return this.sources.size > 0; }
}
