import { getActionString } from './actions.ts';

/** Entity metadata read by Lua-style action destination functions. */
export interface BufferedActionObject {
  readonly prefab?: string;
  readonly spelltype?: string;
  getDisplayName?(): string;
  hasTag(tag: string): boolean;
}

export interface BufferedActionObjects {
  readonly invobject?: BufferedActionObject;
  readonly target?: BufferedActionObject;
}

/** The actor owns one pending action; animation states choose when to execute it. */
export class BufferedAction<Action extends string = string> {
  readonly action: Action;
  readonly invobject: BufferedActionObject | undefined;
  readonly target: BufferedActionObject | undefined;
  private readonly execute: () => void | boolean;
  private readonly valid: () => boolean;

  constructor(
    action: Action, execute: () => void | boolean, valid: () => boolean = () => true,
    objects: BufferedActionObjects = {},
  ) {
    this.action = action;
    this.invobject = objects.invobject;
    this.target = objects.target;
    this.execute = execute;
    this.valid = valid;
  }

  isValid(): boolean { return this.valid(); }
  getActionString(): string { return getActionString(this); }
  do(): boolean {
    if (!this.isValid()) return false;
    return this.execute() !== false;
  }
}
