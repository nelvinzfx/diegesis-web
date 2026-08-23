/**
 * Campaign persistence: data/campaigns/<campaignId>/campaign.json.
 * Format mirrors the Android app exactly (docs/storage.md).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Campaign } from '../shared/types.js';
import { atomicWriteJson, ensureDir, readJsonOrNull } from './fsio.js';

export class CampaignStorage {
  constructor(private readonly dataRoot: string) {}

  private campaignDir(campaignId: string): string {
    return path.join(this.dataRoot, 'campaigns', campaignId);
  }

  private get campaignsRoot(): string {
    return path.join(this.dataRoot, 'campaigns');
  }

  private get file(): (campaignId: string) => string {
    return (campaignId) => path.join(this.campaignDir(campaignId), 'campaign.json');
  }

  /** All campaigns, oldest first. */
  async list(): Promise<Campaign[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.campaignsRoot);
    } catch {
      return [];
    }
    const out: Campaign[] = [];
    for (const entry of entries) {
      const campaign = await readJsonOrNull<Campaign>(this.file(entry));
      if (campaign && typeof campaign.id === 'string') out.push(normalizeCampaign(campaign));
    }
    out.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    return out;
  }

  async get(campaignId: string): Promise<Campaign | null> {
    const campaign = await readJsonOrNull<Campaign>(this.file(campaignId));
    return campaign === null ? null : normalizeCampaign(campaign);
  }

  async save(campaign: Campaign): Promise<void> {
    await ensureDir(this.campaignDir(campaign.id));
    await atomicWriteJson(this.file(campaign.id), campaign);
  }

  /** Removes the whole campaign folder (npcs, turns, memories included). */
  async delete(campaignId: string): Promise<boolean> {
    const dir = this.campaignDir(campaignId);
    if (!(await pathExistsDir(dir))) return false;
    await fs.rm(dir, { recursive: true, force: true });
    return true;
  }
}

/**
 * Backfills openingMessage ('' default) on campaign files written before the
 * field existed, so callers never see undefined.
 */
export function normalizeCampaign(campaign: Campaign): Campaign {
  return typeof campaign.openingMessage === 'string' ? campaign : { ...campaign, openingMessage: '' };
}

async function pathExistsDir(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
