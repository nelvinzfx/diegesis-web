/**
 * Memory persistence: data/campaigns/<campaignId>/memories.jsonl.
 *
 * Append-only extraction output. Appends and rewrites go through a
 * single-writer mutex per campaign (same reason the Android MemoryStorage
 * had one: concurrent pipeline stages can race on the file).
 */

import path from 'node:path';
import type { MemoryEntry } from '../shared/types.js';
import {
  appendJsonLine,
  atomicWriteText,
  ensureDir,
  KeyedMutex,
  readJsonLines,
} from './fsio.js';

export class MemoryStorage {
  private readonly locks = new KeyedMutex();

  constructor(private readonly dataRoot: string) {}

  private memoryFile(campaignId: string): string {
    return path.join(this.dataRoot, 'campaigns', campaignId, 'memories.jsonl');
  }

  async list(campaignId: string): Promise<MemoryEntry[]> {
    return readJsonLines<MemoryEntry>(this.memoryFile(campaignId));
  }

  async append(campaignId: string, entry: MemoryEntry): Promise<void> {
    await this.locks.for(campaignId).run(async () => {
      await appendJsonLine(this.memoryFile(campaignId), entry);
    });
  }

  /**
   * Rewrites the file without the entry at `lineIndex` (zero-based line
   * number — JSONL entries carry no id of their own).
   */
  async deleteAt(campaignId: string, lineIndex: number): Promise<boolean> {
    return this.locks.for(campaignId).run(async () => {
      const entries = await readJsonLines<MemoryEntry>(this.memoryFile(campaignId));
      if (lineIndex < 0 || lineIndex >= entries.length) return false;
      const kept = entries.filter((_, i) => i !== lineIndex);
      await rewrite(this.memoryFile(campaignId), kept);
      return true;
    });
  }

  async deleteAll(campaignId: string): Promise<void> {
    await this.locks.for(campaignId).run(async () => {
      await rewrite(this.memoryFile(campaignId), []);
    });
  }
}

async function rewrite(file: string, entries: MemoryEntry[]): Promise<void> {
  await ensureDir(path.dirname(file));
  const text = entries.map((e) => JSON.stringify(e)).join('\n');
  await atomicWriteText(file, entries.length > 0 ? `${text}\n` : '');
}
