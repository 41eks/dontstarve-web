import { describe, expect, it } from 'vitest';
import { LazySignal, createRenderEffect, watchSignal } from '../src';

describe('LazySignal', () => {
  it('holds a plain value until a change declares it, then runs its listeners once in order', () => {
    const value = new LazySignal(0);
    const calls: string[] = [];
    value.whenDeclared(() => calls.push('first'));
    const stopCancelled = value.whenDeclared(() => calls.push('cancelled'));
    value.whenDeclared(() => calls.push(`second sees ${value.peek()}`));
    stopCancelled();

    // An unchanged write declares nothing.
    value.set(0);
    expect(value.declared).toBe(false);
    expect(calls).toEqual([]);

    value.set(2);
    expect(value.declared).toBe(true);
    expect(calls).toEqual(['first', 'second sees 2']);
    // A listener registered after declaration runs at once; later writes run none again.
    value.whenDeclared(() => calls.push('late'));
    value.set(3);
    expect(calls).toEqual(['first', 'second sees 2', 'late']);
    expect(value.peek()).toBe(3);
  });

  it('declares on a read of its signal, and subscribers from a listener follow every later write', () => {
    const lazy = new LazySignal('a');
    const seen: string[] = [];
    const cleanups: (() => void)[] = [];
    lazy.whenDeclared(() => {
      const local = watchSignal(lazy.signal, stop => cleanups.push(stop));
      cleanups.push(createRenderEffect(() => seen.push(local.get())));
    });
    expect(lazy.peek()).toBe('a');

    const read = new LazySignal(1);
    expect(read.signal.get()).toBe(1);
    expect(read.declared).toBe(true);

    lazy.set('b');
    lazy.set('c');
    expect(seen).toEqual(['b', 'c']);
    cleanups.forEach(stop => stop());
    lazy.set('d');
    expect(seen).toEqual(['b', 'c']);
  });
});
