export function fail(path: string, message: string): never {
  throw new Error(`Invalid save at ${path}: ${message}`);
}

export function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${path}.${key}`, 'unsupported field');
  }
  return value as Record<string, unknown>;
}

export function array(value: unknown, path: string, max = 10_000): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(path, `expected an array of at most ${max} entries`);
  return value;
}

export function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 256) fail(path, 'expected a nonempty string');
  return value;
}

export function number(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(path, `expected a finite number between ${min} and ${max}`);
  }
  return value;
}

export function integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const result = number(value, path, min, max);
  if (!Number.isSafeInteger(result)) fail(path, 'expected a safe integer');
  return result;
}

export function choice<const T extends readonly (string | number)[]>(value: unknown, path: string, choices: T): T[number] {
  const result = typeof value === 'number' ? number(value, path) : string(value, path);
  if (!choices.includes(result)) fail(path, `expected ${choices.join(', ')}`);
  return result as T[number];
}

export function timestamp(value: unknown, path: string): string {
  const result = string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result)
    || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) {
    fail(path, 'expected a UTC ISO timestamp');
  }
  return result;
}

export function snapshotId(value: unknown, path: string): string {
  const result = string(value, path);
  if (!/^\d{10}$/.test(result)) fail(path, 'expected a ten-digit snapshot ID');
  return result;
}

