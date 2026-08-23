/**
 * Typed fetch wrappers for the Diegesis server API plus the two streaming
 * endpoints (turn + plan) built on lib/sse.ts.
 */

import { sseFetch, type SseFetchResult } from './sse';
import type {
  Campaign,
  MemoryEntry,
  Npc,
  PublicSettingsView,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers:
      init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  if (!response.ok) {
    let code: string | null = null;
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (typeof body.error === 'string') {
        code = body.error;
        detail = body.error;
      }
    } catch {
      // non-JSON error body; keep default detail
    }
    throw new ApiError(response.status, code, detail);
  }
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

// ---- Campaigns --------------------------------------------------------------

export function listCampaigns(): Promise<Campaign[]> {
  return request<{ campaigns: Campaign[] }>('/campaigns').then((r) => r.campaigns);
}

export function getCampaign(id: string): Promise<Campaign> {
  return request<Campaign>(`/campaigns/${encodeURIComponent(id)}`);
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

/** Session-plan generation stream (used by phase 4 planning UI). */
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

/**
 * Import an NPC from a PNG card (base64 data URL in the `png` JSON field).
 * Exposed for the phase 4 NPC manager.
 */
export function importNpcPng(campaignId: string, pngDataUrl: string): Promise<Npc> {
  return request<Npc>(`/campaigns/${encodeURIComponent(campaignId)}/npcs/import`, {
    method: 'POST',
    body: JSON.stringify({ png: pngDataUrl }),
  });
}

// ---- Memories ---------------------------------------------------------------

export function listMemories(campaignId: string): Promise<MemoryEntry[]> {
  return request<{ memories: MemoryEntry[] }>(
    `/campaigns/${encodeURIComponent(campaignId)}/memories`,
  ).then((r) => r.memories);
}
