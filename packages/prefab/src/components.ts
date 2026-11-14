/** EntityScript:AddComponent / RemoveComponent. inst.components is the component registry. */
type Owner = { readonly components: object; onRemove(remove: () => void): () => void; readonly isRemoved: boolean };
type Lifecycle = { dispose?(): void; OnRemoveEntity?(): void; OnRemoveFromEntity?(): void };
export type ComponentName<Inst extends Owner> = keyof Inst['components'] & string;
type Declared<Inst extends Owner, Name extends ComponentName<Inst>> = NonNullable<Inst['components'][Name]>;

// Only the entity-removal subscription lives here; inst.components holds the components themselves.
const removals = new WeakMap<Owner, Map<string, () => void>>();
/** Components the entity's removal already tore down; a later RemoveComponent only unregisters them. */
const tornDown = new WeakSet<object>();

/**
 * inst:AddComponent(name): `new Component(inst, ...args)` is stored under the name the entity declares for it, as
 * `require("components/" .. name)` resolves the class in Lua. An existing component is returned unchanged. When the
 * entity is removed its components get OnRemoveEntity (or their task teardown) and stay on `inst.components`.
 */
export function addComponent<Inst extends Owner, Name extends ComponentName<Inst>, T extends Declared<Inst, Name>, A extends unknown[]>(
  inst: Inst, name: Name, Component: new (inst: Inst, ...args: A) => T, ...args: A
): T {
  if (inst.isRemoved) throw new Error(`Cannot add ${name} to a removed entity`);
  // inst.components[name], the registry the entity declares by name.
  const existing: unknown = Reflect.get(inst.components, name);
  if (existing) return existing as T;
  const component = new Component(inst, ...args);
  Reflect.set(inst.components, name, component);
  let callbacks = removals.get(inst);
  if (!callbacks) removals.set(inst, callbacks = new Map());
  const entityCallbacks = callbacks;
  callbacks.set(name, inst.onRemove(() => {
    entityCallbacks.delete(name);
    const removed: Lifecycle = component;
    tornDown.add(removed);
    if (removed.OnRemoveEntity) removed.OnRemoveEntity();
    else if (removed.OnRemoveFromEntity) removed.OnRemoveFromEntity();
    else removed.dispose?.();
  }));
  return component;
}

/** RemoveComponent deletes the registration before invoking the component's OnRemoveFromEntity (or its teardown). */
export function removeComponent<Inst extends Owner>(inst: Inst, name: ComponentName<Inst>): void {
  const registered: unknown = Reflect.get(inst.components, name);
  if (!registered || typeof registered !== 'object') return;
  const component: Lifecycle = registered;
  Reflect.deleteProperty(inst.components, name);
  const callbacks = removals.get(inst);
  callbacks?.get(name)?.();
  callbacks?.delete(name);
  if (callbacks?.size === 0) removals.delete(inst);
  if (tornDown.has(component)) return;
  if (inst.isRemoved && component.OnRemoveEntity) component.OnRemoveEntity();
  else if (component.OnRemoveFromEntity) component.OnRemoveFromEntity();
  else component.dispose?.();
}
