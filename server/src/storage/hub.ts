/**
 * File-backed implementation of the engine's OrchestratorStores surface —
 * the bridge between phase 1's pure orchestrator and phase 2's storage layer.
 */

import type {
  Campaign,
  MemoryEntry,
  Npc,
  Turn,
  TurnVariant,
} from '../shared/types.js';
import type { OrchestratorStores } from '../engine/orchestrator.js';
import { CampaignStorage } from './campaign-storage.js';
import { MemoryStorage } from './memory-storage.js';
import { NpcStorage } from './npc-storage.js';
import { PromptTemplateStorage } from './prompt-template-storage.js';
import { SettingsStorage } from './settings-storage.js';
import { TurnStorage } from './turn-storage.js';

export interface StorageHub {
  settings: SettingsStorage;
  campaigns: CampaignStorage;
  npcs: NpcStorage;
  turns: TurnStorage;
  memories: MemoryStorage;
  prompts: PromptTemplateStorage;
  stores: OrchestratorStores;
}

export function createStorageHub(dataRoot: string): StorageHub {
  const settings = new SettingsStorage(dataRoot);
  const campaigns = new CampaignStorage(dataRoot);
  const npcs = new NpcStorage(dataRoot);
  const turns = new TurnStorage(dataRoot);
  const memories = new MemoryStorage(dataRoot);
  const prompts = new PromptTemplateStorage(dataRoot);

  const stores: OrchestratorStores = {
    loadCampaign: (id) => campaigns.get(id),
    saveCampaign: (campaign: Campaign) => campaigns.save(campaign),
    listTurnIndices: (id) => turns.listIndices(id),
    loadTurn: (id, index) => turns.get(id, index),
    saveTurn: (id, turn: Turn) => turns.save(id, turn),
    appendVariant: (id, index, variant: TurnVariant) => turns.appendVariant(id, index, variant),
    loadNpc: (campaignId, npcId) => npcs.get(campaignId, npcId),
    saveNpc: (campaignId, npc: Npc) => npcs.save(campaignId, npc),
    loadMemories: (id) => memories.list(id),
    appendMemory: (id, entry: MemoryEntry) => memories.append(id, entry),
  };

  return { settings, campaigns, npcs, turns, memories, prompts, stores };
}
