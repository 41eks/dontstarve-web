import type { LuaFn } from './luaFn';
/** Lua's `return success, reason`. */
export type BatteryCanBeUsedResult = readonly [success: boolean, reason?: string];

export type BatteryCanBeUsedFn<Inst, User> = LuaFn<[inst: Inst, user: User | undefined, mult?: number], BatteryCanBeUsedResult>;
export type BatteryOnUsedFn<Inst, User> = LuaFn<[inst: Inst, user: User | undefined, mult?: number]>;
export type BatteryResolvePartialChargeMultFn<Inst, User> = LuaFn<[inst: Inst, user: User | undefined, mult: number], number | undefined>;

export interface BatteryInst { addTag(tag: string): void; removeTag(tag: string): void }

/** components/battery.lua: a charged structure that tools and machines can draw power from. */
export class Battery<Inst extends BatteryInst = BatteryInst, User = unknown> {
    private canbeused?: BatteryCanBeUsedFn<Inst, User>;
    private onused?: BatteryOnUsedFn<Inst, User>;
    private resolvepartialchargemult?: BatteryResolvePartialChargeMultFn<Inst, User>;

    private readonly inst: Inst;
    constructor(inst: Inst) {
        this.inst = inst;
        inst.addTag('battery');
    }

    OnRemoveFromEntity(): void { this.inst.removeTag('battery'); }

    SetCanBeUsedFn(fn: BatteryCanBeUsedFn<Inst, User> | undefined): void { this.canbeused = fn; }
    SetOnUsedFn(fn: BatteryOnUsedFn<Inst, User> | undefined): void { this.onused = fn; }
    SetResolvePartialChargeMultFn(fn: BatteryResolvePartialChargeMultFn<Inst, User> | undefined): void { this.resolvepartialchargemult = fn; }

    /** Can return a lower mult if the battery supports partial charge when not enough power is left. */
    ResolvePartialChargeMult(user: User | undefined, mult: number): number {
        return this.resolvepartialchargemult?.(this.inst, user, mult) || mult;
    }

    CanBeUsed(user?: User, mult?: number): BatteryCanBeUsedResult {
        return this.canbeused?.(this.inst, user, mult) ?? [true];
    }

    OnUsed(user?: User, mult?: number): void { this.onused?.(this.inst, user, mult); }
}
