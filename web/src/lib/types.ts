/**
 * Minimal mirrors of server/src/shared/types.ts (duplicated on purpose:
 * workspaces must not import across the boundary). JSON field names match
 * the frozen Android serialization.
 */

// ---- PipelineModels.kt ------------------------------------------------------

export interface RouterDecision {
  needs_check: boolean;
  checks: MechanicCheck[];
  run_agency_update: boolean;
  lore_query: string | null;
}

export interface MechanicCheck {
  skill: string;
  dc: number;
  modifier: number;
  advantage: number;
}

export interface DrawnCard {
  rank: number;
  suit: string;
  name: string;
}

export interface MechanicResult {
  skill: string;
  dc: number;
  modifier: number;
  drawn: DrawnCard[];
  value: number;
  tier: string;
}

export interface TrackerUpdate {
  npc: string;
  key: string;
  delta: number;
}

export interface PlotOutput {
  synopsis: string;
  present_npcs: string[];
  scene_change: boolean;
  location: string | null;
  tracker_updates: TrackerUpdate[];
}

export interface MemoryEntry {
  scope: string;
  npc_id: string | null;
  fact: string;
  turn: number;
  ts: number;
}

// ---- Turn.kt ----------------------------------------------------------------

export interface TurnVariant {
  id: string;
  synopsis: string;
  sceneOutput: string;
  routerDecision: RouterDecision | null;
  presentNpcIds: string[];
  mechanicResults: MechanicResult[];
  interrupted: boolean;
  timestamp: number;
  stageEvents: string[];
  reasoning: string | null;
}

export interface Turn {
  index: number;
  playerInput: string;
  variants: TurnVariant[];
  createdAt: number;
}

// ---- Npc.kt -----------------------------------------------------------------

export interface NpcAgency {
  goal: string;
  stance: string;
  will_act_on: string;
}

export interface Npc {
  id: string;
  name: string;
  description: string;
  personality: string;
  voiceExamples: string[];
  agency: NpcAgency;
  trackers: Record<string, number>;
  sourceCard: string | null;
}

// ---- Campaign.kt ------------------------------------------------------------

export interface SceneState {
  location: string;
  presentNpcIds: string[];
}

export interface StageModelSelection {
  provider: string;
  model: string;
}

export interface Campaign {
  id: string;
  title: string;
  premise: string;
  sessionPlan: string;
  playerPersona: string;
  sceneState: SceneState;
  thinkModel: StageModelSelection | null;
  writeModel: StageModelSelection | null;
  createdAt: number;
  updatedAt: number;
}

// ---- Settings (public view: keys are never echoed back) ---------------------

export interface PublicSettingsView {
  thinkModel: StageModelSelection;
  writeModel: StageModelSelection;
  openaiBaseUrl: string;
  /** Always "" in the public view; use the *Set flags instead. */
  openaiApiKey: string;
  anthropicApiKey: string;
  openaiKeySet: boolean;
  anthropicKeySet: boolean;
  language: string;
  thinkingEffort: string;
  thinkMaxTokens: number;
  writeMaxTokens: number;
  contextWindowTokens: number;
}
