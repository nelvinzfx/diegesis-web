/**
 * ActiveCampaignContext: all story-screen state (turns, variant selection,
 * streaming state machine, stage/reasoning buffers) in hooks + context only.
 *
 * Story state machine per run:
 *   idle -> sending -> streaming -> done (variant persisted)
 *                                   -> interrupted (abort keeps partial)
 *                                   -> error (red inline banner, partial kept)
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import * as api from '../lib/api';
import type { Campaign, PublicSettingsView, Turn } from '../lib/types';

export type ViewId = 'story' | 'npcs' | 'memories' | 'settings';

export interface StreamState {
  phase: 'sending' | 'streaming';
  /** Turn being regenerated / re-run from; null when appending a new turn. */
  targetTurnIndex: number | null;
  playerInput: string;
  prose: string;
  stageLines: string[];
  reasoning: string;
}

interface ActiveCampaignValue {
  view: ViewId;
  setView: (view: ViewId) => void;

  campaigns: Campaign[];
  campaignsLoading: boolean;
  campaign: Campaign | null;
  switchCampaign: (id: string) => void;

  turns: Turn[];
  turnsLoading: boolean;

  selectedTurnIndex: number | null;
  selectTurn: (index: number | null) => void;

  /** Currently displayed variant index per turn index. */
  variantByTurn: Record<number, number>;
  cycleVariant: (turnIndex: number, delta: number) => void;

  streaming: StreamState | null;
  /** Pipeline / API error message for the inspector's red inline banner. */
  streamError: string | null;
  dismissStreamError: () => void;

  /**
   * Sends a player action. Pass a turn index as targetTurnIndex to re-run
   * FROM that turn (regenerate / edit+resend); omit to append a new turn.
   */
  send: (input: string, targetTurnIndex?: number | null) => Promise<void>;
  regenerate: (turnIndex: number) => Promise<void>;
  /** Seeds the input bar with the turn's player input for editing + resend. */
  beginEditResend: (turnIndex: number) => void;
  editingTurnIndex: number | null;
  clearEditingTurn: () => void;
  deleteFrom: (turnIndex: number) => Promise<void>;
  stop: () => void;

  settings: PublicSettingsView | null;
  apiKeyMissing: boolean;
}

const ActiveCampaignContext = createContext<ActiveCampaignValue | null>(null);

const ACTIVE_CAMPAIGN_KEY = 'diegesis.activeCampaignId';

function readStoredCampaignId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_CAMPAIGN_KEY);
  } catch {
    return null;
  }
}

function storeCampaignId(id: string): void {
  try {
    window.localStorage.setItem(ACTIVE_CAMPAIGN_KEY, id);
  } catch {
    // storage disabled; active campaign just won't persist
  }
}

export function ActiveCampaignProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewId>('story');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [turnsLoading, setTurnsLoading] = useState(false);
  const [selectedTurnIndex, setSelectedTurnIndex] = useState<number | null>(null);
  const [variantByTurn, setVariantByTurn] = useState<Record<number, number>>({});
  const [streaming, setStreaming] = useState<StreamState | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [settings, setSettings] = useState<PublicSettingsView | null>(null);
  const [editingTurnIndex, setEditingTurnIndex] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ---- bootstrap ----------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, s] = await Promise.all([
          api.listCampaigns().catch(() => [] as Campaign[]),
          api.getSettings().catch(() => null),
        ]);
        if (cancelled) return;
        setCampaigns(list);
        setSettings(s);
        const stored = readStoredCampaignId();
        const next =
          stored !== null && list.some((c) => c.id === stored)
            ? stored
            : (list[0]?.id ?? null);
        setCampaignId(next);
      } finally {
        if (!cancelled) setCampaignsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- turns loading ------------------------------------------------------

  useEffect(() => {
    if (campaignId === null) {
      setTurns([]);
      return;
    }
    let cancelled = false;
    setTurnsLoading(true);
    api
      .listTurns(campaignId)
      .then((t) => {
        if (!cancelled) {
          setTurns(t);
          setVariantByTurn({});
          setSelectedTurnIndex(null);
        }
      })
      .catch(() => {
        if (!cancelled) setTurns([]);
      })
      .finally(() => {
        if (!cancelled) setTurnsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const refreshTurns = useCallback(async () => {
    if (campaignId === null) return;
    try {
      setTurns(await api.listTurns(campaignId));
    } catch {
      // transient network hiccup; keep the current view of turns
    }
  }, [campaignId]);

  // ---- streaming ----------------------------------------------------------

  const runStream = useCallback(
    async (playerInput: string, targetTurnIndex: number | null) => {
      if (campaignId === null || abortRef.current !== null) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setStreamError(null);
      setEditingTurnIndex(null);
      setStreaming({
        phase: 'sending',
        targetTurnIndex,
        playerInput,
        prose: '',
        stageLines: [],
        reasoning: '',
      });

      const patch = (fn: (prev: StreamState) => StreamState): void => {
        setStreaming((prev) => (prev === null ? prev : fn(prev)));
      };

      try {
        const result = await api.streamTurn(
          campaignId,
          {
            playerInput,
            targetTurnIndex,
            onStage: (line) =>
              patch((prev) => ({
                ...prev,
                phase: 'streaming',
                stageLines: [...prev.stageLines, line],
              })),
            onReasoning: (text) =>
              patch((prev) => ({
                ...prev,
                phase: 'streaming',
                reasoning: prev.reasoning + text,
              })),
            onToken: (text) =>
              patch((prev) => ({ ...prev, phase: 'streaming', prose: prev.prose + text })),
          },
          controller.signal,
        );
        if (
          !controller.signal.aborted &&
          result.terminal?.event === 'error' &&
          typeof result.terminal.data === 'object' &&
          result.terminal.data !== null &&
          typeof (result.terminal.data as Record<string, unknown>)['message'] === 'string'
        ) {
          setStreamError((result.terminal.data as Record<string, unknown>)['message'] as string);
        }
        if (
          !controller.signal.aborted &&
          result.terminal?.event === 'done' &&
          typeof result.terminal.data === 'object' &&
          result.terminal.data !== null
        ) {
          const t = (result.terminal.data as Record<string, unknown>)['campaignTitle'];
          if (typeof t === 'string' && t.length > 0) {
            setCampaigns((prev) =>
              prev.map((c) => (c.id === campaignId ? { ...c, title: t } : c)),
            );
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setStreamError(error instanceof Error ? error.message : String(error));
        }
      }

      abortRef.current = null;
      // The server persists whatever it got (interrupted partial included),
      // so always re-read the authoritative list before clearing stream UI.
      await refreshTurns();
      setStreaming(null);
    },
    [campaignId, refreshTurns],
  );

  const send = useCallback(
    async (input: string, targetTurnIndex?: number | null) => {
      await runStream(input.trim(), targetTurnIndex ?? null);
    },
    [runStream],
  );

  const regenerate = useCallback(
    async (turnIndex: number) => {
      const turn = turns.find((t) => t.index === turnIndex);
      if (turn === undefined) return;
      await runStream(turn.playerInput, turnIndex);
    },
    [runStream, turns],
  );

  const beginEditResend = useCallback((turnIndex: number) => {
    setSelectedTurnIndex(turnIndex);
    setEditingTurnIndex(turnIndex);
  }, []);

  const clearEditingTurn = useCallback(() => setEditingTurnIndex(null), []);

  const deleteFrom = useCallback(
    async (turnIndex: number) => {
      if (campaignId === null) return;
      try {
        await api.deleteTurnFrom(campaignId, turnIndex);
      } catch (error) {
        setStreamError(error instanceof Error ? error.message : String(error));
        return;
      }
      setSelectedTurnIndex(null);
      await refreshTurns();
    },
    [campaignId, refreshTurns],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ---- misc ---------------------------------------------------------------

  const switchCampaign = useCallback((id: string) => {
    storeCampaignId(id);
    setCampaignId(id);
  }, []);

  const cycleVariant = useCallback((turnIndex: number, delta: number) => {
    setVariantByTurn((prev) => {
      const next = Math.max(0, (prev[turnIndex] ?? 0) + delta);
      return next === (prev[turnIndex] ?? 0) ? prev : { ...prev, [turnIndex]: next };
    });
  }, []);

  const campaign = useMemo(
    () => campaigns.find((c) => c.id === campaignId) ?? null,
    [campaigns, campaignId],
  );
  const apiKeyMissing =
    settings !== null && !settings.openaiKeySet && !settings.anthropicKeySet;

  const value = useMemo<ActiveCampaignValue>(
    () => ({
      view,
      setView,
      campaigns,
      campaignsLoading,
      campaign,
      switchCampaign,
      turns,
      turnsLoading,
      selectedTurnIndex,
      selectTurn: setSelectedTurnIndex,
      variantByTurn,
      cycleVariant,
      streaming,
      streamError,
      dismissStreamError: () => setStreamError(null),
      send,
      regenerate,
      beginEditResend,
      editingTurnIndex,
      clearEditingTurn,
      deleteFrom,
      stop,
      settings,
      apiKeyMissing,
    }),
    [
      view,
      campaigns,
      campaignsLoading,
      campaign,
      switchCampaign,
      turns,
      turnsLoading,
      selectedTurnIndex,
      variantByTurn,
      cycleVariant,
      streaming,
      streamError,
      send,
      regenerate,
      beginEditResend,
      editingTurnIndex,
      clearEditingTurn,
      deleteFrom,
      stop,
      settings,
      apiKeyMissing,
    ],
  );

  return <ActiveCampaignContext.Provider value={value}>{children}</ActiveCampaignContext.Provider>;
}

export function useActiveCampaign(): ActiveCampaignValue {
  const ctx = useContext(ActiveCampaignContext);
  if (ctx === null) throw new Error('useActiveCampaign must be used inside ActiveCampaignProvider');
  return ctx;
}
