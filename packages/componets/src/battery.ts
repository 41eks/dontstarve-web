/** Lua's `return success, reason`. */
export type BatteryCanBeUsedResult = readonly [success: boolean, reason?: string];

/** components/battery.lua: a charged structure that tools and machines can draw power from. */
export class Battery<Inst = unknown, User = unknown> {
    private canbeused?: (inst: Inst, user: User | undefined, mult?: number) => BatteryCanBeUsedResult;
    private onused?: (inst: Inst, user: User | undefined, mult?: number) => void;
    private resolvepartialchargemult?: (inst: Inst, user: User | undefined, mult: number) => number | undefined;

    private readonly inst: Inst;
    constructor(inst: Inst) { this.inst = inst; }

    /** AddTag("battery") in the constructor, RemoveTag in OnRemoveFromEntity. */
    HasTag(tag: string): true | undefined { return tag === 'battery' ? true : undefined; }

    SetCanBeUsedFn(fn: Battery<Inst, User>['canbeused']): void { this.canbeused = fn; }
    SetOnUsedFn(fn: Battery<Inst, User>['onused']): void { this.onused = fn; }
    SetResolvePartialChargeMultFn(fn: Battery<Inst, User>['resolvepartialchargemult']): void { this.resolvepartialchargemult = fn; }

    /** Can return a lower mult if the battery supports partial charge when not enough power is left. */
    ResolvePartialChargeMult(user: User | undefined, mult: number): number {
        return this.resolvepartialchargemult?.(this.inst, user, mult) || mult;
    }

    CanBeUsed(user?: User, mult?: number): BatteryCanBeUsedResult {
        return this.canbeused?.(this.inst, user, mult) ?? [true];
    }

    OnUsed(user?: User, mult?: number): void { this.onused?.(this.inst, user, mult); }
}
