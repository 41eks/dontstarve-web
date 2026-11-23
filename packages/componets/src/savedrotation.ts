/** savedrotation.lua's OnSave record. */
export interface SavedRotationSaveData {
  rotation: number;
}

/** What savedrotation.lua reads from its inst: Transform:GetRotation / SetRotation (degrees) and DoTaskInTime. */
export interface SavedRotationInst {
  readonly transform: { readonly rotation: number };
  setRotation(degrees: number): void;
  DoTaskInTime(time: number, fn: () => void): unknown;
}

/**
 * components/savedrotation.lua. The engine's Transform:LoadRotation, which only differs from SetRotation for platform
 * followers (boats are not ported), is the inst's SetRotation.
 */
export class SavedRotation {
  private readonly inst: SavedRotationInst;
  dodelayedpostpassapply = false;

  constructor(inst: SavedRotationInst) {
    this.inst = inst;
  }

  OnSave(): SavedRotationSaveData | undefined {
    const rotation = this.inst.transform.rotation;
    return rotation !== 0 ? { rotation } : undefined;
  }

  /** EntityScript:LoadPostPass hands each component its saved record once every saved entity exists. */
  LoadPostPass(_newents: unknown, data: Partial<SavedRotationSaveData>): void {
    this.inst.setRotation(data.rotation ?? 0);
    if (this.dodelayedpostpassapply) {
      this.ApplyPostPassRotation(data.rotation ?? 0);
    }
  }

  ApplyPostPassRotation(angle: number): void {
    this.inst.DoTaskInTime(0, () => this.inst.setRotation(angle));
  }
}
