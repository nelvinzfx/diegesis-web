/**
 * NPC persistence: data/campaigns/<campaignId>/npcs/<npcId>.json.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Npc } from '../shared/types.js';
import { atomicWriteJson, ensureDir, readJsonOrNull } from './fsio.js';

export class NpcStorage {
  constructor(private readonly dataRoot: string) {}

  private npcsDir(campaignId: string): string {
    return path.join(this.dataRoot, 'campaigns', campaignId, 'npcs');
  }

  private npcFile(campaignId: string, npcId: string): string {
    return path.join(this.npcsDir(campaignId), `${npcId}.json`);
  }

  async list(campaignId: string): Promise<Npc[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.npcsDir(campaignId));
    } catch {
      return [];
    }
    const out: Npc[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const npc = await readJsonOrNull<Npc>(path.join(this.npcsDir(campaignId), entry));
      if (npc && typeof npc.id === 'string') out.push(normalizeNpc(npc));
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  async get(campaignId: string, npcId: string): Promise<Npc | null> {
    if (!isSafeId(npcId)) return null;
    const npc = await readJsonOrNull<Npc>(this.npcFile(campaignId, npcId));
    return npc === null ? null : normalizeNpc(npc);
  }

  async save(campaignId: string, npc: Npc): Promise<void> {
    await ensureDir(this.npcsDir(campaignId));
    await atomicWriteJson(this.npcFile(campaignId, npc.id), npc);
  }

  async delete(campaignId: string, npcId: string): Promise<boolean> {
    if (!isSafeId(npcId)) return false;
    const file = this.npcFile(campaignId, npcId);
    try {
      await fs.rm(file, { force: true });
      return true;
    } catch {
      return false;
    }
  }
}

/** Guards against traversal via crafted ids. */
export function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id);
}

/**
 * Backfills firstMessage ('' default) on NPC files written before the field
 * existed, so callers never see undefined.
 */
export function normalizeNpc(npc: Npc): Npc {
  return typeof npc.firstMessage === 'string' ? npc : { ...npc, firstMessage: '' };
}
