/**
 * A Lua component callback (`SetXxxFn(fn)` / `self.xxxfn(self.inst, ...)`), with the arguments in the source's order.
 *
 * Method syntax keeps the parameters bivariant: a prefab registers `Component<..., ConcreteInst>` while the
 * component registry declares `components.<name>` with the component's wider host type, and a strictly
 * contravariant callback field would make those two instantiations unassignable.
 */
export type LuaFn<Args extends readonly unknown[], R = void> = { fn(...args: Args): R }['fn'];
