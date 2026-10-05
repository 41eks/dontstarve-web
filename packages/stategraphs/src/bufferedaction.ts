/** The actor owns one pending action; animation states choose when to execute it. */
export class BufferedAction<Action extends string = string> {
  readonly action: Action;
  private readonly execute: () => void | boolean;
  private readonly valid: () => boolean;

  constructor(action: Action, execute: () => void | boolean, valid: () => boolean = () => true) {
    this.action = action;
    this.execute = execute;
    this.valid = valid;
  }

  isValid(): boolean { return this.valid(); }
  do(): boolean {
    if (!this.isValid()) return false;
    return this.execute() !== false;
  }
}
