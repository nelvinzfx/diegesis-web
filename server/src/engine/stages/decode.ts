/**
 * Stage decoders shared by the pipeline stages.
 *
 * The Kotlin stages use kotlinx Json { ignoreUnknownKeys = true; isLenient } —
 * unknown keys are ignored, and each model's default arguments fill in
 * anything absent. These decoders mirror that: they THROW on structurally
 * invalid payloads (so AiCaller burns its retry / falls back) but tolerate
 * missing optional fields exactly as the Kotlin models do.
 */

export function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected a JSON object');
  }
  return value as Record<string, unknown>;
}

export function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string') throw new Error(`missing required string field "${key}"`);
  return v;
}

export function optString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new Error(`field "${key}" must be a string`);
  return v;
}

export function stringOrDefault(obj: Record<string, unknown>, key: string, fallback: string): string {
  const v = optString(obj, key);
  return v === undefined ? fallback : v;
}

export function boolOrDefault(obj: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = obj[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'boolean') throw new Error(`field "${key}" must be a boolean`);
  return v;
}

export function intOrDefault(obj: Record<string, unknown>, key: string, fallback: number): number {
  const v = obj[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`field "${key}" must be an integer`);
  return Math.trunc(v);
}

export function arrayOrEmpty(obj: Record<string, unknown>, key: string): unknown[] {
  const v = obj[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error(`field "${key}" must be an array`);
  return v;
}
