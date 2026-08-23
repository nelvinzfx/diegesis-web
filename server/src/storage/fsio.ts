/**
 * Storage plumbing shared by every storage class: a tiny single-writer
 * promise-chain mutex and atomic file primitives (.tmp + rename), per
 * docs/storage.md write rules.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Single-writer mutex: serializes mutations through a promise chain. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** Per-key mutex map (e.g. one writer per campaign). */
export class KeyedMutex {
  private readonly locks = new Map<string, Mutex>();

  for(key: string): Mutex {
    let lock = this.locks.get(key);
    if (!lock) {
      lock = new Mutex();
      this.locks.set(key, lock);
    }
    return lock;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Atomic write: `<file>.tmp` then rename over the target. Never in place. */
export async function atomicWriteText(file: string, text: string): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}

/** Pretty-printed (2 spaces) so files stay human-readable — a feature. */
export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await atomicWriteText(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonOrNull<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Append one JSON line; caller is expected to hold the relevant mutex. */
export async function appendJsonLine(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  await fs.appendFile(file, `${JSON.stringify(value)}\n`, 'utf8');
}

export async function readJsonLines<T>(file: string): Promise<T[]> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // Tolerate a torn/partial trailing line rather than failing the read.
    }
  }
  return out;
}
