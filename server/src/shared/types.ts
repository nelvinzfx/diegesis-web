/**
 * Shared data models for the Diegesis engine.
 *
 * Ported 1:1 from the frozen Android app's kotlinx-serialization models
 * (data/model/*.kt). JSON field names MUST match the Android serialization
 * exactly so campaign data files are portable between the two apps.
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

export type OutcomeTier = 'critical_success' | 'success' | 'partial' | 'failure';

export interface MechanicResult {
  skill: string;
  dc: number;
  modifier: number;
  drawn: DrawnCard[];
  value: number;
  tier: string; // "critical_success" | "success" | "partial" | "failure"
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
  scope: string; // "campaign" | "npc"
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
  /**
   * Terse one-line pipeline events recorded by the orchestrator, e.g.
   * "plot: fallback used (json parse failed)".
   */
  stageEvents: string[];
  /** Model reasoning streamed during the scene stage; null when none. */
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

// ---- AppSettings.kt ---------------------------------------------------------

export const APP_SETTINGS_DEFAULTS = {
  thinkModel: { provider: 'openai-compat', model: 'gpt-4o-mini' },
  writeModel: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiApiKey: '',
  anthropicApiKey: '',
  language: 'English',
  thinkingEffort: 'medium',
  writeMaxTokens: 8192,
  contextWindowTokens: 32768,
} as const;

export interface AppSettings {
  thinkModel: StageModelSelection;
  writeModel: StageModelSelection;
  openaiBaseUrl: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  /** Story output language; the writer follows it regardless of source material. */
  language: string;
  /** One of "low" | "medium" | "high" | "xhigh"; normalized at use sites. */
  thinkingEffort: string;
  writeMaxTokens: number;
  contextWindowTokens: number;
}

export function defaultAppSettings(): AppSettings {
  return {
    thinkModel: { ...APP_SETTINGS_DEFAULTS.thinkModel },
    writeModel: { ...APP_SETTINGS_DEFAULTS.writeModel },
    openaiBaseUrl: APP_SETTINGS_DEFAULTS.openaiBaseUrl,
    openaiApiKey: APP_SETTINGS_DEFAULTS.openaiApiKey,
    anthropicApiKey: APP_SETTINGS_DEFAULTS.anthropicApiKey,
    language: APP_SETTINGS_DEFAULTS.language,
    thinkingEffort: APP_SETTINGS_DEFAULTS.thinkingEffort,
    writeMaxTokens: APP_SETTINGS_DEFAULTS.writeMaxTokens,
    contextWindowTokens: APP_SETTINGS_DEFAULTS.contextWindowTokens,
  };
}

/** Factory helpers mirroring the Kotlin default arguments. */

export function defaultSceneState(): SceneState {
  return { location: '', presentNpcIds: [] };
}

export function defaultNpcAgency(): NpcAgency {
  return { goal: '', stance: '', will_act_on: '' };
}
