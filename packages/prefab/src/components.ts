import type { ItemEntity, InventoryStack, ItemSlot } from '@dontstarve-web/inventory';
import { Burnable } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import { Container } from '../../componets/src/container';
import { Workable, type WorkableInst } from '../../componets/src/workable';
import type { PrefabInstance } from './prefabInstance';

/** EntityScript:AddComponent: constructors only; prefab settings stay with the prefab. */
const constructors = {
  burnable: Burnable,
  propagator: Propagator,
  container: Container<InventoryStack, ItemEntity, ItemSlot>,
  workable: Workable,
};

export type ComponentName = keyof typeof constructors;
type Owner = Pick<PrefabInstance, 'components' | 'onRemove' | 'isRemoved'>;
type Args<Name extends ComponentName> = ConstructorParameters<typeof constructors[Name]> extends [unknown, ...infer Rest] ? Rest : never;
type Host<Name extends ComponentName> = Owner & ConstructorParameters<typeof constructors[Name]>[0];
type Component<Name extends ComponentName, Inst> = Name extends 'workable'
  ? Workable<Inst & WorkableInst> : InstanceType<typeof constructors[Name]>;
type Lifecycle = { dispose(): void; OnRemoveEntity?(): void; OnRemoveFromEntity?(): void };

// Only subscription cancellation lives here; inst.components is the component registry.
const removals = new WeakMap<Owner, Map<ComponentName, () => void>>();

export function addComponent<Name extends ComponentName, Inst extends Host<Name>>(
  inst: Inst, name: Name, ...args: Args<Name>
): Component<Name, Inst> {
  if (inst.isRemoved) throw new Error(`Cannot add ${name} to a removed entity`);
  const components = inst.components as Partial<Record<Name, Component<Name, Inst>>>;
  const existing = components[name];
  if (existing) return existing;
  // The key keeps constructor arguments and result linked at the public call site.
  const Constructor = constructors[name] as unknown as new (inst: Inst, ...args: Args<Name>) => Component<Name, Inst>;
  const component = new Constructor(inst, ...args);
  components[name] = component;
  let callbacks = removals.get(inst);
  if (!callbacks) removals.set(inst, callbacks = new Map());
  callbacks.set(name, inst.onRemove(() => removeComponent(inst, name)));
  return component;
}

/** RemoveComponent deletes the registration before invoking the component's teardown. */
export function removeComponent(inst: Owner, name: ComponentName): void {
  const component: Lifecycle | undefined = inst.components[name];
  if (!component) return;
  delete inst.components[name];
  const callbacks = removals.get(inst);
  callbacks?.get(name)?.();
  callbacks?.delete(name);
  if (callbacks?.size === 0) removals.delete(inst);
  if (inst.isRemoved && component.OnRemoveEntity) component.OnRemoveEntity();
  else if (component.OnRemoveFromEntity) component.OnRemoveFromEntity();
  else component.dispose();
}
