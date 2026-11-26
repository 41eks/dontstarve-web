type SignalMemoryProbe = (kind: 'plain' | 'watched' | 'memo' | 'lazy', ...members: object[]) => void;

/** The CI heap probe runs on its own Vite page. The production build has no signal observer. */
export function signalMemoryProbe(): SignalMemoryProbe | undefined {
  const env = (import.meta as ImportMeta & { env?: { DEV: boolean } }).env;
  return env?.DEV
    ? (globalThis as typeof globalThis & { __signalMemoryProbe?: SignalMemoryProbe }).__signalMemoryProbe
    : undefined;
}
