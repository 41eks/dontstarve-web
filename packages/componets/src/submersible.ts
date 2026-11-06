/** submersible.lua's saved field; this port has no sinking or underwater salvage. */
export class Submersible {
  /** Set by OnSink's `data.force_no_repositioning`; read by Submerge, which is not ported. */
  force_no_repositioning = false;

  constructor(_inst: object) {}

  OnSave(): { force_no_repositioning: boolean } { return { force_no_repositioning: this.force_no_repositioning }; }

  OnLoad(data: { force_no_repositioning?: boolean }): void { this.force_no_repositioning = data.force_no_repositioning ?? false; }
}
