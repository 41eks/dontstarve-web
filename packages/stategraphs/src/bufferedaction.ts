import { getActionString } from './actions.ts';

/** books.lua def fields read by SGwilson's book2 state. */
export interface BookDef {
  /** books.lua `fx`: the fx.lua prefab components/book.lua spawns at the reader after a successful read. */
  readonly fx?: string;
  readonly fx_over_prefab?: string;
  readonly fx_under_prefab?: string;
  readonly layer_sound?: { readonly frame?: number; readonly sound: string };
}

/** Entity metadata read by Lua-style action destination functions. */
export interface BufferedActionObject {
  readonly prefab?: string;
  readonly spelltype?: string;
  readonly castsound?: string;
  /** staff.lua inst.projectiledelay: seconds a launched projectile stays hidden. */
  readonly projectiledelay?: number;
  readonly fxcolour?: readonly [number, number, number];
  /** pickable.lua quickpick field, read by the SGwilson PICK deststate. */
  readonly quickpick?: boolean;
  /** books.lua inst.def / swap_build / swap_prefix and the item's skin build. */
  readonly def?: BookDef;
  readonly swap_build?: string;
  readonly swap_prefix?: string;
  readonly skinBuild?: string;
  getDisplayName?(): string;
  /** entityscript.lua PushEvent, for example SGwilson's startlongaction on the target. */
  PushEvent?(name: string, data?: unknown): void;
  hasTag(tag: string): boolean;
}

export interface BufferedActionObjects {
  readonly invobject?: BufferedActionObject;
  readonly target?: BufferedActionObject;
  /** bufferedaction.lua pos, distance, arrivedist and forced. */
  readonly pos?: { readonly x: number; readonly y: number; readonly z: number };
  readonly distance?: number;
  readonly arrivedist?: number;
  readonly forced?: boolean;
}

/** The actor owns one pending action; animation states choose when to execute it. */
export class BufferedAction<Action extends string = string> {
  readonly action: Action;
  readonly invobject: BufferedActionObject | undefined;
  readonly target: BufferedActionObject | undefined;
  readonly pos: BufferedActionObjects['pos'];
  readonly distance: number | undefined;
  readonly arrivedist: number | undefined;
  readonly forced: boolean | undefined;
  private readonly execute: () => void | boolean;
  private readonly valid: () => boolean;
  private onsuccess: (() => void)[] = [];
  private onfail: (() => void)[] = [];

  constructor(
    action: Action, execute: () => void | boolean, valid: () => boolean = () => true,
    objects: BufferedActionObjects = {},
  ) {
    this.action = action;
    this.invobject = objects.invobject;
    this.target = objects.target;
    this.pos = objects.pos;
    this.distance = objects.distance;
    this.arrivedist = objects.arrivedist;
    this.forced = objects.forced;
    this.execute = execute;
    this.valid = valid;
  }

  isValid(): boolean { return this.valid(); }
  getActionString(): string { return getActionString(this); }
  /** BufferedAction:Do runs the action, then Succeed() or Fail() notifies the pushing behaviour. */
  do(): boolean {
    if (!this.isValid()) return false;
    const success = this.execute() !== false;
    if (success) this.succeed();
    else this.fail();
    return success;
  }

  addFailAction(fn: () => void): void { this.onfail.push(fn); }
  addSuccessAction(fn: () => void): void { this.onsuccess.push(fn); }

  succeed(): void {
    const callbacks = this.onsuccess;
    this.onsuccess = [];
    this.onfail = [];
    for (const callback of callbacks) callback();
  }

  fail(): void {
    const callbacks = this.onfail;
    this.onsuccess = [];
    this.onfail = [];
    for (const callback of callbacks) callback();
  }
}
