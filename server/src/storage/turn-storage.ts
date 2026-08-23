/**
 * Turn persistence: data/campaigns/<campaignId>/turns/<zero-padded index>.json.
 *
 * One file per turn; immutable once written except variants[] growth (append
 * only). Deletes truncate: removing turn N also removes every turn > N —
 * state is derived, same semantics as the Android app.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Turn, TurnVariant } from '../shared/types.js';
import { atomicWriteJson, KeyedMutex, readJsonOrNull } from './fsio.js';

const PAD = 6;

export class TurnStorage {
  private readonly locks = new KeyedMutex();

  constructor(private readonly dataRoot: string) {}

  private turnsDir(campaignId: string): string {
    return path.join(this.dataRoot, 'campaigns', campaignId, 'turns');
  }

  private turnFile(campaignId: string, index: number): string {
    return path.join(this.turnsDir(campaignId), `${String(index).padStart(PAD, '0')}.json`);
  }

  async listIndices(campaignId: string): Promise<number[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.turnsDir(campaignId));
    } catch {
      return [];
    }
    const out: number[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const index = Number.parseInt(entry.slice(0, -'.json'.length), 10);
      if (Number.isInteger(index)) out.push(index);
    }
    out.sort((a, b) => a - b);
    return out;
  }

  async list(campaignId: string): Promise<Turn[]> {
    const indices = await this.listIndices(campaignId);
    const out: Turn[] = [];
    for (const index of indices) {
      const turn = await this.get(campaignId, index);
      if (turn) out.push(turn);
    }
    return out;
  }

  async get(campaignId: string, index: number): Promise<Turn | null> {
    const turn = await readJsonOrNull<Turn>(this.turnFile(campaignId, index));
    // Variants written before the tension field existed load with it as null.
    if (turn !== null) {
      for (const variant of turn.variants) {
        if (variant.tension === undefined) variant.tension = null;
      }
    }
    return turn;
  }

  async save(campaignId: string, turn: Turn): Promise<void> {
    await this.locks.for(campaignId).run(async () => {
      await this.saveLocked(campaignId, turn);
    });
  }

  /** Appends a variant to an existing turn. Throws when the turn is missing. */
  async appendVariant(campaignId: string, index: number, variant: TurnVariant): Promise<void> {
    await this.locks.for(campaignId).run(async () => {
      const existing = await this.get(campaignId, index);
      if (!existing) throw new Error(`Turn ${index} not found in campaign ${campaignId}`);
      existing.variants.push(variant);
      await this.saveLocked(campaignId, existing);
    });
  }

  /**
   * Truncation like the Android app: deletes turn `fromIndex` and every turn
   * after it. Returns the indices removed.
   */
  async deleteFrom(campaignId: string, fromIndex: number): Promise<number[]> {
    return this.locks.for(campaignId).run(async () => {
      const indices = await this.listIndices(campaignId);
      const doomed = indices.filter((i) => i >= fromIndex);
      for (const index of doomed) {
        await fs.rm(this.turnFile(campaignId, index), { force: true });
      }
      return doomed;
    });
  }

  async deleteAll(campaignId: string): Promise<void> {
    await this.locks.for(campaignId).run(async () => {
      await fs.rm(this.turnsDir(campaignId), { recursive: true, force: true });
    });
  }

  private async saveLocked(campaignId: string, turn: Turn): Promise<void> {
    await atomicWriteJson(this.turnFile(campaignId, turn.index), turn);
  }
}
