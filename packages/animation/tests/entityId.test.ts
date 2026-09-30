import { afterEach, describe, expect, it, vi } from 'vitest';
import { newEntityId } from '../../prefab/src/saveRecord';

afterEach(() => vi.unstubAllGlobals());

describe('persistent entity IDs', () => {
  it('generates an ID without requiring crypto.randomUUID', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(17) });
    expect(newEntityId()).toBe('e_' + '11'.repeat(16));
  });

  it('keeps IDs distinct even if browser crypto is entirely unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    const ids = Array.from({ length: 100 }, newEntityId);
    expect(new Set(ids).size).toBe(100);
    expect(ids.every((id) => /^e_[a-zA-Z0-9_]+$/.test(id))).toBe(true);
  });
});
