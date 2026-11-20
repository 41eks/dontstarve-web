export interface HerdMemberInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
}

/**
 * components/herdmember.lua, minimal: the `herdmember` tag that follows `enabled`, the herd prefab and the herd the
 * member belongs to. Herds are not ported: OnInit's CreateHerd (spawning `herdprefab` after 8.1 seconds) and Leave are
 * not, so GetHerd stays nil unless SetHerd is called.
 */
export class HerdMember<Herd = object> {
  herd?: Herd;
  herdprefab = 'beefaloherd';
  private enabledState = true;
  private readonly inst: HerdMemberInst;

  constructor(inst: HerdMemberInst) {
    this.inst = inst;
    inst.addTag('herdmember');
  }

  get enabled(): boolean { return this.enabledState; }
  set enabled(enabled: boolean) {
    this.enabledState = enabled;
    if (enabled) { this.inst.addTag('herdmember'); } else { this.inst.removeTag('herdmember'); }
  }

  SetHerd(herd: Herd | undefined): void { this.herd = herd; }
  SetHerdPrefab(prefab: string): void { this.herdprefab = prefab; }
  GetHerd(): Herd | undefined { return this.herd; }
  Enable(enabled: boolean): void { this.enabled = enabled; }

  OnRemoveFromEntity(): void { this.inst.removeTag('herdmember'); }
}
