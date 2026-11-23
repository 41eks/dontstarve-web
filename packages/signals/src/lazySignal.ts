import { createSignal, readonlySignal, type ReadonlySignal, type Signal } from './signal';

/**
 * A value that holds no signal until it is declared, for entity features most entities never use (inst.Physics,
 * inst.Light, inst.MiniMapEntity, attached FX). Before that, `peek()` and `set()` work on a plain field.
 *
 * The first `set()` that changes the value, or the first read of `signal`, declares it: the signal is created with the
 * current value and the `whenDeclared` listeners run once, in registration order. A listener registered after that
 * runs at once. Consumers that only follow a declared value subscribe from their listener (with `watchSignal` as
 * usual), so an undeclared value has no subscribers either.
 */
export class LazySignal<T> {
  #value: T;
  #signal: Signal<T> | undefined;
  #readonly: ReadonlySignal<T> | undefined;
  #listeners: (() => void)[] | undefined;

  constructor(initial: T) {
    this.#value = initial;
  }

  get declared(): boolean {
    return this.#signal !== undefined;
  }

  peek(): T {
    return this.#signal ? this.#signal.peek() : this.#value;
  }

  /** Writes the signal once declared; before that, a changed value declares it. */
  set(value: T): void {
    if (this.#signal) {
      this.#signal.set(value);
      return;
    }
    if (value === this.#value) {
      return;
    }
    this.#value = value;
    this.#declare();
  }

  /** The value's signal, declared now if it was not. */
  get signal(): ReadonlySignal<T> {
    this.#declare();
    return this.#readonly!;
  }

  /** Runs `listener` once the value is declared (at once if it already is); the returned stop cancels a pending one. */
  whenDeclared(listener: () => void): () => void {
    if (this.#signal) {
      listener();
      return () => {};
    }
    const listeners = (this.#listeners ??= []);
    listeners.push(listener);
    return () => {
      const index = this.#listeners?.indexOf(listener) ?? -1;
      if (index >= 0) {
        this.#listeners!.splice(index, 1);
      }
    };
  }

  #declare(): void {
    if (this.#signal) {
      return;
    }
    this.#signal = createSignal(this.#value);
    this.#readonly = readonlySignal(this.#signal);
    const listeners = this.#listeners;
    this.#listeners = undefined;
    for (const listener of listeners ?? []) {
      listener();
    }
  }
}
