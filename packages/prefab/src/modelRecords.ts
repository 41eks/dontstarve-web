import type { Object3D } from 'three';

/** Non-owning lookup for managers whose authoritative records use a Set or array. */
export class ModelRecords<T> {
  private readonly records = new WeakMap<Object3D, T>();
  set(model: Object3D, record: T): void { this.records.set(model, record); }
  select(model: Object3D | undefined, all: Iterable<T>): T[] {
    const record = model && this.records.get(model);
    return model ? record === undefined ? [] : [record] : [...all];
  }
}

export function modelEntries<K extends Object3D, V>(records: Map<K, V>, model?: Object3D): [K, V][] {
  if (!model) return [...records];
  const key = model as K, record = records.get(key);
  return record === undefined ? [] : [[key, record]];
}

export function modelValues<K extends Object3D, V>(records: Map<K, V>, model?: Object3D, all: Iterable<V> = records.values()): V[] {
  if (!model) return [...all];
  const record = records.get(model as K);
  return record === undefined ? [] : [record];
}
