/** constants.lua UPGRADETYPES, the values the ported prefabs set. */
export const UPGRADETYPES = { DEFAULT: 'default', SPIDER: 'spider', MAST: 'mast', WATERPLANT: 'waterplant' } as const;

/** upgradeable.lua OnSave. */
export interface UpgradeableSave {
  numupgrades: number;
  stage?: number;
}

export interface UpgradeableInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
}

/**
 * components/upgradeable.lua: the stage, its count and the <upgradetype>_upgradeable tag its property setters keep, and
 * OnSave / OnLoad. Not ported: Upgrade, AdvanceStage, onupgradefn / onstageadvancefn / canupgradefn and their setters.
 */
export class Upgradeable {
  private readonly inst: UpgradeableInst;
  private type?: string;
  private stageValue?: number;
  private numstagesValue?: number;
  upgradesperstage = 5;
  numupgrades = 0;

  constructor(inst: UpgradeableInst) {
    this.inst = inst;
    this.upgradetype = UPGRADETYPES.DEFAULT;
    this.stage = 1;
    this.numstages = 3;
  }

  /** upgradetype, with onupgradetype: the tag moves to the new type while the stage can still be upgraded. */
  get upgradetype(): string | undefined {
    return this.type;
  }
  set upgradetype(value: string | undefined) {
    const old = this.type;
    this.type = value;
    if (this.CanUpgrade()) {
      if (old !== undefined) {
        this.inst.removeTag(`${old}_upgradeable`);
      }
      if (value !== undefined) {
        this.inst.addTag(`${value}_upgradeable`);
      }
    }
  }

  get stage(): number | undefined {
    return this.stageValue;
  }
  set stage(value: number | undefined) {
    this.stageValue = value;
    this.onstage();
  }
  get numstages(): number | undefined {
    return this.numstagesValue;
  }
  set numstages(value: number | undefined) {
    this.numstagesValue = value;
    this.onstage();
  }

  /** onstage: AddOrRemoveTag(upgradetype.."_upgradeable", CanUpgrade()). */
  private onstage(): void {
    const tag = `${this.type}_upgradeable`;
    if (this.CanUpgrade()) {
      this.inst.addTag(tag);
    } else {
      this.inst.removeTag(tag);
    }
  }

  /** Upgradeable:CanUpgrade without a canupgradefn: the stage is below numstages. */
  CanUpgrade(): boolean {
    return this.stageValue !== undefined && this.numstagesValue !== undefined && this.stageValue < this.numstagesValue;
  }

  OnSave(): UpgradeableSave {
    return { numupgrades: this.numupgrades, ...(this.stage === undefined ? {} : { stage: this.stage }) };
  }
  OnLoad(data: UpgradeableSave): void {
    this.numupgrades = data.numupgrades;
    this.stage = data.stage;
  }
}
