/**
 * BYOK settings persistence: data/settings.json.
 */

import path from 'node:path';
import type { AppSettings } from '../shared/types.js';
import { atomicWriteJson, readJsonOrNull, ensureDir } from './fsio.js';

/** What's actually on disk: a partial overlay over AppSettings defaults. */
export type StoredSettings = Partial<AppSettings>;

export class SettingsStorage {
  constructor(private readonly dataRoot: string) {}

  private get file(): string {
    return path.join(this.dataRoot, 'settings.json');
  }

  async load(): Promise<StoredSettings | null> {
    return readJsonOrNull<StoredSettings>(this.file);
  }

  async save(settings: StoredSettings): Promise<void> {
    await ensureDir(this.dataRoot);
    await atomicWriteJson(this.file, settings);
  }
}
