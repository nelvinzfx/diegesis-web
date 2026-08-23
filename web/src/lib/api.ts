/**
 * Typed fetch wrappers for the Diegesis server API plus the two streaming
 * endpoints (turn + plan) built on lib/sse.ts.
 */

import { sseFetch, type SseFetchResult } from './sse';
import type {
  Campaign,
  MemoryEntry,
  Npc,
  NpcAgency,
  PublicSettingsView,
  StageModelSelection,
  Turn,
} from './types';

const BASE = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Shared non-2xx handling: throws ApiError with the server's error code. */
async function ensureOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  let code: string | null = null;
  let detail = `${response.status} ${response.statusText}`;
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    if (typeof body.error === 'string') {
      code = body.error;
      detail = typeof body.message === 'string' ? `${body.error}: ${body.message}` : body.error;
    }
  } catch {
    // non-JSON error body; keep default detail
  }
  throw new ApiError(response.status, code, detail);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers:
      init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  await ensureOk(response);
  return (await response.json()) as T;
}

// ---- Settings ---------------------------------------------------------------

export function getSettings(): Promise<PublicSettingsView> {
  return request<PublicSettingsView>('/settings');
}

export function updateSettings(
  patch: Partial<Omit<PublicSettingsView, 'openaiKeySet' | 'anthropicKeySet'>>,
): Promise<PublicSettingsView> {
  return request<PublicSettingsView>('/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

/**
 * Editable settings form state. Key fields use '' to mean "keep the stored
 * key": the public GET view never echoes secrets, so an untouched key input
 * must be OMITTED from the PUT payload (the server also treats empty-string
 * keys as "unchanged", but omitting is the honest shape).
 */
export interface SettingsFormState {
  openaiBaseUrl: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  thinkModel: StageModelSelection;
  writeModel: StageModelSelection;
  language: string;
  thinkingEffort: string;
  writeMaxTokens: number;
  contextWindowTokens: number;
}

export function buildSettingsPayload(form: SettingsFormState): Record<string, unknown> {
  return {
    openaiBaseUrl: form.openaiBaseUrl,
    ...(form.openaiApiKey.length > 0 ? { openaiApiKey: form.openaiApiKey } : {}),
    ...(form.anthropicApiKey.length > 0 ? { anthropicApiKey: form.anthropicApiKey } : {}),
    thinkModel: form.thinkModel,
    writeModel: form.writeModel,
    language: form.language,
    thinkingEffort: form.thinkingEffort,
    writeMaxTokens: form.writeMaxTokens,
    contextWindowTokens: form.contextWindowTokens,
  };
}

// ---- Campaigns --------------------------------------------------------------

export interface CampaignInput {
  title?: string;
  premise?: string;
  sessionPlan?: string;
  playerPersona?: string;
  sceneState?: { location: string; presentNpcIds: string[] };
}

export function listCampaigns(): Promise<Campaign[]> {
  return request<{ campaigns: Campaign[] }>('/campaigns').then((r) => r.campaigns);
}

export function getCampaign(id: string): Promise<Campaign> {
  return request<Campaign>(`/campaigns/${encodeURIComponent(id)}`);
}

export function createCampaign(input: CampaignInput): Promise<Campaign> {
  return request<Campaign>('/campaigns', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** PUT preserves untouched fields (turns, memories, id, createdAt). */
export function updateCampaign(id: string, patch: CampaignInput): Promise<Campaign> {
  return request<Campaign>(`/campaigns/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export function deleteCampaign(id: string): Promise<void> {
  return request<{ ok: boolean }>(`/campaigns/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }).then(() => undefined);
}

export function switchToCampaign(id: string): Promise<Campaign> {
  return getCampaign(id);
}

// ---- Turns ------------------------------------------------------------------

export function listTurns(campaignId: string): Promise<Turn[]> {
  return request<{ turns: Turn[] }>(
    `/campaigns/${encodeURIComponent(campaignId)}/turns`,
  ).then((r) => r.turns);
}

/** Android truncation semantics: deletes that turn and every later one. */
export function deleteTurnFrom(campaignId: string, index: number): Promise<void> {
  return request<{ ok: boolean }>(
    `/campaigns/${encodeURIComponent(campaignId)}/turns/${index}`,
    { method: 'DELETE' },
  ).then(() => undefined);
}

export interface TurnStreamParams {
  playerInput: string;
  /** Regenerate / edit+resend target; null appends a new turn. */
  targetTurnIndex: number | null;
  onStage: (line: string) => void;
  onReasoning: (text: string) => void;
  onToken: (text: string) => void;
}

export type TurnStreamResult = SseFetchResult & {
  /** done.turn when received; callers should still re-list turns to be safe. */
  turn: unknown | null;
};

export async function streamTurn(
  campaignId: string,
  params: TurnStreamParams,
  signal?: AbortSignal,
): Promise<TurnStreamResult> {
  const result = await sseFetch(`/api/campaigns/${encodeURIComponent(campaignId)}/turns`, {
    method: 'POST',
    body: JSON.stringify({
      playerInput: params.playerInput,
      ...(params.targetTurnIndex !== null ? { targetTurnIndex: params.targetTurnIndex } : {}),
    }),
    signal,
    onEvent: (event, data) => {
      const d = (data ?? {}) as Record<string, unknown>;
      if (event === 'stage' && typeof d.line === 'string') params.onStage(d.line);
      else if (event === 'reasoning' && typeof d.text === 'string') params.onReasoning(d.text);
      else if (event === 'token' && typeof d.text === 'string') params.onToken(d.text);
    },
  });
  const terminalTurn =
    result.terminal?.event === 'done' &&
    typeof result.terminal.data === 'object' &&
    result.terminal.data !== null &&
    'turn' in (result.terminal.data as Record<string, unknown>)
      ? (result.terminal.data as Record<string, unknown>)['turn']
      : null;
  return { ...result, turn: terminalTurn };
}

/** Session-plan generation stream (campaign-new / campaign-edit planning UI). */
export async function streamPlan(
  campaignId: string,
  input: { title?: string; premise?: string; playerPersona?: string },
  handlers: {
    onStage: (line: string) => void;
    onReasoning: (text: string) => void;
    onToken: (text: string) => void;
  },
  signal?: AbortSignal,
): Promise<SseFetchResult> {
  return sseFetch(`/api/campaigns/${encodeURIComponent(campaignId)}/plan`, {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
    onEvent: (event, data) => {
      const d = (data ?? {}) as Record<string, unknown>;
      if (event === 'stage' && typeof d.line === 'string') handlers.onStage(d.line);
      else if (event === 'reasoning' && typeof d.text === 'string')
        handlers.onReasoning(d.text);
      else if (event === 'token' && typeof d.text === 'string') handlers.onToken(d.text);
    },
  });
}

// ---- NPCs -------------------------------------------------------------------

export function listNpcs(campaignId: string): Promise<Npc[]> {
  return request<{ npcs: Npc[] }>(
    `/campaigns/${encodeURIComponent(campaignId)}/npcs`,
  ).then((r) => r.npcs);
}

export interface NpcInput {
  name?: string;
  description?: string;
  personality?: string;
  voiceExamples?: string[];
  agency?: Partial<NpcAgency>;
  trackers?: Record<string, number>;
}

export function createNpc(campaignId: string, input: NpcInput): Promise<Npc> {
  return request<Npc>(`/campaigns/${encodeURIComponent(campaignId)}/npcs`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateNpc(campaignId: string, npcId: string, input: NpcInput): Promise<Npc> {
  return request<Npc>(
    `/campaigns/${encodeURIComponent(campaignId)}/npcs/${encodeURIComponent(npcId)}`,
    { method: 'PUT', body: JSON.stringify(input) },
  );
}

export function deleteNpc(campaignId: string, npcId: string): Promise<void> {
  return request<{ ok: boolean }>(
    `/campaigns/${encodeURIComponent(campaignId)}/npcs/${encodeURIComponent(npcId)}`,
    { method: 'DELETE' },
  ).then(() => undefined);
}

/** Import from a character-card JSON string (card v2 / v3). */
export function importNpcJson(campaignId: string, json: string): Promise<Npc> {
  return request<Npc>(`/campaigns/${encodeURIComponent(campaignId)}/npcs/import`, {
    method: 'POST',
    body: JSON.stringify({ json }),
  });
}

/** Import from raw PNG bytes carrying an embedded `chara` tEXt chunk. */
export async function importNpcPngBytes(campaignId: string, bytes: Uint8Array): Promise<Npc> {
  const response = await fetch(
    `${BASE}/campaigns/${encodeURIComponent(campaignId)}/npcs/import`,
    {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: bytes as unknown as BodyInit,
    },
  );
  await ensureOk(response);
  return (await response.json()) as Npc;
}

// ---- Memories ---------------------------------------------------------------

export function listMemories(campaignId: string): Promise<MemoryEntry[]> {
  return request<{ memories: MemoryEntry[] }>(
    `/campaigns/${encodeURIComponent(campaignId)}/memories`,
  ).then((r) => r.memories);
}

/** Entries have no stable id; the server addresses them by line index. */
export function deleteMemoryAt(campaignId: string, memoryId: number): Promise<void> {
  return request<{ ok: boolean }>(
    `/campaigns/${encodeURIComponent(campaignId)}/memories/${memoryId}`,
    { method: 'DELETE' },
  ).then(() => undefined);
}

export function clearMemories(campaignId: string): Promise<void> {
  return request<{ ok: boolean }>(
    `/campaigns/${encodeURIComponent(campaignId)}/memories`,
    { method: 'DELETE' },
  ).then(() => undefined);
}

// ---- Prompt templates -------------------------------------------------------

export interface PromptStage {
  key: string;
  description: string;
  variables: string[];
  default: string;
  override: string | null;
}

export interface PromptPreview {
  stage: string;
  system: string;
  user: string;
  meta: {
    turnsIncluded: number;
    turnsDropped: number;
    presentNpcs: string[];
  };
}

export function listPromptTemplates(): Promise<PromptStage[]> {
  return request<PromptStage[]>('/prompt-templates');
}

/** Empty template clears the override (server treats '' as reset). */
export function savePromptTemplate(key: string, template: string): Promise<void> {
  return request<{ ok: boolean }>(`/prompt-templates/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ template }),
  }).then(() => undefined);
}

export function resetPromptTemplate(key: string): Promise<void> {
  return request<{ ok: boolean }>(`/prompt-templates/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  }).then(() => undefined);
}

export function previewPrompt(
  campaignId: string,
  stage: string,
  playerInput: string,
): Promise<PromptPreview> {
  const params = new URLSearchParams({ stage });
  if (playerInput.trim().length > 0) params.set('playerInput', playerInput.trim());
  return request<PromptPreview>(
    `/campaigns/${encodeURIComponent(campaignId)}/prompt-preview?${params.toString()}`,
  );
}
