// A leaf module: PrefabInstance's module needs it, and ItemEntity extends PrefabInstance while that module evaluates.
let sequence = 0;
export function newItemEntityId(): string {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return `e_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  return `e_${Date.now().toString(36)}_${++sequence}_${Math.random().toString(36).slice(2)}`;
}
