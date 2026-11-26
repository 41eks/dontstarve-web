import { createSignal, type Signal, type SignalListener } from './signal';
import { signalMemoryProbe } from './signalMemoryProbe.ts';

/**
 * A signal that holds a plain value until it is declared, for entity features most entities never use (inst.Physics,
 * inst.Light, inst.MiniMapEntity, attached FX). Before that, `peek()` and `set()` work on a plain field.
 *
 * The first `set()` that changes the value, or the first `get()` or `subscribe()`, declares it: the inner signal is
 * created with the current value and the `whenDeclared` listeners run once, in registration order. A listener
 * registered after that runs at once. Consumers that only follow a declared value subscribe from their listener (with
 * `watchSignal` as usual), so an undeclared value has no subscribers either.
 *
 * Like every signal, its methods live on the prototype and are not bound: call them on the LazySignal, never pass a
 * destructured `get`.
 */
export class LazySignal<T> implements Signal<T> {
  #value: T;
  #signal: Signal<T> | undefined;
  #listeners: (() => void)[] | undefined;

  constructor(initial: T) {
    this.#value = initial;
    signalMemoryProbe()?.('lazy', this);
  }

  get declared(): boolean {
    return this.#signal !== undefined;
  }

  peek(): T {
    return this.#signal ? this.#signal.peek() : this.#value;
  }

  /** A read declares the value, so a tracked read links the effect to its signal. */
  get(): T {
    return this.#declare().get();
  }

  subscribe(listener: SignalListener<T>): () => void {
    return this.#declare().subscribe(listener);
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

  #declare(): Signal<T> {
    if (this.#signal) {
      return this.#signal;
    }
    const signal = (this.#signal = createSignal(this.#value));
    const listeners = this.#listeners;
    this.#listeners = undefined;
    for (const listener of listeners ?? []) {
      listener();
    }
    return signal;
  }
}
