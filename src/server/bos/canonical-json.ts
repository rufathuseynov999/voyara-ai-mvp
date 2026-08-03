import { createHash } from 'node:crypto';

function normalise(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical payloads cannot contain non-finite numbers.');
    return value;
  }
  if (Array.isArray(value)) return value.map(normalise);
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.keys(object)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const candidate = object[key];
        if (candidate === undefined) throw new TypeError(`Canonical payload key ${key} is undefined.`);
        result[key] = normalise(candidate);
        return result;
      }, {});
  }
  throw new TypeError(`Unsupported canonical payload type: ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value));
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
