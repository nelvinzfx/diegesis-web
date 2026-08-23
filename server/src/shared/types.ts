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

// ---- Narrative status board (per-campaign, web-only) ------------------------

/** One character's reader-facing snapshot on the status board. */
export interface TrackerEntry {
  look: string;
  condition: string;
  carrying: string;
}

/**
 * The live status board rewritten by the 'tracker-update' stage after every
 * turn. npcs is keyed by NPC ID and only ever contains NPCs present in the
 * latest scene. player is the player persona's entry (display name comes
 * from the persona; the UI falls back to "You"). null on Campaign = the
 * board was never generated. NOTE: unrelated to Npc.trackers (numeric
 * per-NPC stats updated by memory-extraction).
 */
export interface TrackerState {
  dateTime: string;
  location: string;
  atmosphere: string;
  player: TrackerEntry | null;
  npcs: Record<string, TrackerEntry & { innerVoice?: string }>;
  /** Turn index that last wrote this board; null for a hand-seeded board. */
  updatedAtTurn: number | null;
}

export function emptyTrackerState(): TrackerState {
  return { dateTime: '', location: '', atmosphere: '', player: null, npcs: {}, updatedAtTurn: null };
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
  /**
   * The card's first_mes: prose shown as the opening scene when this NPC
   * leads the story. Empty string for cards without one and for NPCs created
   * before the field existed (storage normalizes missing -> '').
   */
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
  /**
   * Editable opening scene text. Turn 0 is created from it when the story
   * begins. Empty string for campaigns created before the field existed
   * (storage normalizes missing -> '').
   */
  openingMessage: string;
  sceneState: SceneState;
  /** Live narrative status board; null = never generated. */
  trackerState: TrackerState | null;
  thinkModel: StageModelSelection | null;
  writeModel: StageModelSelection | null;
  createdAt: number;
  updatedAt: number;
}

// ---- AppSettings.kt ---------------------------------------------------------

/**
 * ONE global provider choice for both pipeline stages. 'openai-compat' covers
 * any /v1 chat-completions endpoint (base URL configurable); 'anthropic'
 * always uses the SDK-default base URL.
 */
export type SettingsProvider = 'openai-compat' | 'anthropic';

export const SETTINGS_PROVIDERS: readonly SettingsProvider[] = ['openai-compat', 'anthropic'];

export function isSettingsProvider(value: unknown): value is SettingsProvider {
  return value === 'openai-compat' || value === 'anthropic';
}

export const APP_SETTINGS_DEFAULTS = {
  provider: 'openai-compat' as SettingsProvider,
  thinkModel: 'gpt-4o-mini',
  writeModel: 'gpt-4o',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiApiKey: '',
  anthropicApiKey: '',
  language: 'English',
  thinkingEffort: 'medium',
  writeMaxTokens: 8192,
  contextWindowTokens: 32768,
} as const;

export interface AppSettings {
  /** Global provider for BOTH think and write stages. */
  provider: SettingsProvider;
  /** Model id only; provider comes from `provider`. */
  thinkModel: string;
  writeModel: string;
  /** Used only when provider = 'openai-compat'. */
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
  return { ...APP_SETTINGS_DEFAULTS };
}

/** Factory helpers mirroring the Kotlin default arguments. */

export function defaultSceneState(): SceneState {
  return { location: '', presentNpcIds: [] };
}

export function defaultNpcAgency(): NpcAgency {
  return { goal: '', stance: '', will_act_on: '' };
}
