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

// ---- Narrative status board (per-campaign, web-only) ------------------------

export interface TrackerEntry {
  look: string;
  condition: string;
  carrying: string;
}

/** Live narrative status board; null on Campaign = never generated. */
export interface TrackerState {
  dateTime: string;
  location: string;
  atmosphere: string;
  player: TrackerEntry | null;
  npcs: Record<string, TrackerEntry & { innerVoice?: string }>;
  updatedAtTurn: number | null;
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
  /** Card first_mes: shown as the opening scene when this NPC leads. */
  firstMessage: string;
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
  /** Editable opening scene text; turn 0 is created from it. */
  openingMessage: string;
  sceneState: SceneState;
  trackerState: TrackerState | null;
  thinkModel: StageModelSelection | null;
  writeModel: StageModelSelection | null;
  createdAt: number;
  updatedAt: number;
}

// ---- Settings (public view: keys are never echoed back) ---------------------

/** ONE global provider choice; campaign-level overrides keep the object shape. */
export type SettingsProvider = 'openai-compat' | 'anthropic';

export interface PublicSettingsView {
  provider: SettingsProvider;
  /** Model id only; provider comes from `provider`. */
  thinkModel: string;
  writeModel: string;
  /** Used only when provider = 'openai-compat'. */
  openaiBaseUrl: string;
  /** Always "" in the public view; use the *Set flags instead. */
  openaiApiKey: string;
  anthropicApiKey: string;
  openaiKeySet: boolean;
  anthropicKeySet: boolean;
  language: string;
  thinkingEffort: string;
  writeMaxTokens: number;
  contextWindowTokens: number;
}
