import { WhileNode, type BehaviourNode } from './behaviourtree';
import { AvoidElectricFence } from './behaviours/avoidelectricfence';
import { Panic } from './behaviours/panic';
import type { BrainInst } from './types';

/** brains/braincommon.lua: only the panic triggers shared by the ported brains. */
export function ShouldTriggerPanic(inst: BrainInst): boolean {
  const { health, hauntable } = inst.components;
  return !!(health && (health.takingfiredamage || (health.GetLunarBurnFlags?.() ?? 0) !== 0)) || !!hauntable?.panic;
}

export function PanicTrigger(inst: BrainInst): BehaviourNode {
  return WhileNode(() => ShouldTriggerPanic(inst), 'PanicTrigger', new Panic(inst));
}

export function ShouldAvoidElectricFence(inst: BrainInst): boolean { return inst.panic_electric_field !== undefined; }

export function ElectricFencePanicTrigger(inst: BrainInst): BehaviourNode {
  return WhileNode(() => ShouldAvoidElectricFence(inst), 'ElectricShock', new AvoidElectricFence(inst));
}
