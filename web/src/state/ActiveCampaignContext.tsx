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
import type {
  Campaign,
  MemoryEntry,
  Npc,
  PublicSettingsView,
  TrackerState,
  Turn,
} from '../lib/types';

export type ViewId =
  | 'story'
  | 'npcs'
  | 'memories'
  | 'prompts'
  | 'settings'
  | 'campaign-new'
  | 'campaign-edit';

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
  setView: (view: ViewId, opts?: { campaignId?: string }) => void;
  /** Target campaign for the campaign-edit view; may differ from active. */
  viewCampaignId: string | null;

  campaigns: Campaign[];
  campaignsLoading: boolean;
  campaign: Campaign | null;
  switchCampaign: (id: string) => void;

  turns: Turn[];
  turnsLoading: boolean;
  /** Re-reads the authoritative turn list (used after playing the opening). */
  refreshTurns: () => Promise<void>;

  /** NPC roster of the active campaign (phase 4 manager). */
  npcs: Npc[];
  npcsLoading: boolean;
  refreshNpcs: () => Promise<void>;
  /** Resolves presentNpcIds / memory scope ids to display names. */
  npcNameById: Record<string, string>;

  /**
   * Re-reads the live status board from the server (used after a manual
   * edit save) and patches the active campaign in memory.
   */
  refreshTracker: () => Promise<void>;

  /** Raw memory log of the active campaign (newest last). */
  memories: MemoryEntry[];
  memoriesLoading: boolean;
  refreshMemories: () => Promise<void>;

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
  refreshSettings: () => Promise<void>;

  /** Inserts or replaces a campaign in the local list (after POST / PUT). */
  upsertCampaignLocal: (campaign: Campaign) => void;
  /** Drops a campaign locally and re-targets the active one if needed. */
  forgetCampaign: (id: string) => void;
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
  const [viewCampaignId, setViewCampaignId] = useState<string | null>(null);
  const [npcs, setNpcs] = useState<Npc[]>([]);
  const [npcsLoading, setNpcsLoading] = useState(false);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
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

  // ---- npcs + memories ----------------------------------------------------

  useEffect(() => {
    if (campaignId === null) {
      setNpcs([]);
      return;
    }
    let cancelled = false;
    setNpcsLoading(true);
    api
      .listNpcs(campaignId)
      .then((list) => {
        if (!cancelled) setNpcs(list);
      })
      .catch(() => {
        if (!cancelled) setNpcs([]);
      })
      .finally(() => {
        if (!cancelled) setNpcsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  useEffect(() => {
    if (campaignId === null) {
      setMemories([]);
      return;
    }
    let cancelled = false;
    setMemoriesLoading(true);
    api
      .listMemories(campaignId)
      .then((list) => {
        if (!cancelled) setMemories(list);
      })
      .catch(() => {
        if (!cancelled) setMemories([]);
      })
      .finally(() => {
        if (!cancelled) setMemoriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const refreshNpcs = useCallback(async () => {
    if (campaignId === null) return;
    try {
      setNpcs(await api.listNpcs(campaignId));
    } catch {
      // transient network hiccup; keep the current view of npcs
    }
  }, [campaignId]);

  const refreshMemories = useCallback(async () => {
    if (campaignId === null) return;
    try {
      setMemories(await api.listMemories(campaignId));
    } catch {
      // transient network hiccup; keep the current view of memories
    }
  }, [campaignId]);

  // ---- narrative status board ---------------------------------------------

  const patchTrackerState = useCallback(
    (id: string, trackerState: TrackerState | null) => {
      setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, trackerState } : c)));
    },
    [],
  );

  const refreshTracker = useCallback(async () => {
    if (campaignId === null) return;
    try {
      const trackerState = await api.getTracker(campaignId);
      // null = never generated; keep whatever is already on screen.
      if (trackerState !== null) patchTrackerState(campaignId, trackerState);
    } catch {
      // transient network hiccup; keep the current board
    }
  }, [campaignId, patchTrackerState]);

  const refreshSettings = useCallback(async () => {
    try {
      setSettings(await api.getSettings());
    } catch {
      // keep the current view of settings on failure
    }
  }, []);

  // ---- streaming ----------------------------------------------------------

  const runStream = useCallback(
    async (playerInput: string, targetTurnIndex: number | null) => {
      if (abortRef.current !== null) return;
      if (campaignId === null) {
        setStreamError('No campaign selected. Create or switch to one from the rail first.');
        return;
      }
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
          // Live status board: patch the campaign so the inspector's Status
          // section updates instantly without a refetch.
          const board = (result.terminal.data as Record<string, unknown>)['trackerState'];
          if (board !== undefined && board !== null && typeof board === 'object') {
            patchTrackerState(campaignId, board as TrackerState);
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
    [campaignId, refreshTurns, patchTrackerState],
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

  const setViewTargeted = useCallback(
    (next: ViewId, opts?: { campaignId?: string }) => {
      setView(next);
      setViewCampaignId(opts?.campaignId ?? null);
    },
    [],
  );

  const upsertCampaignLocal = useCallback((updated: Campaign) => {
    setCampaigns((prev) =>
      prev.some((c) => c.id === updated.id)
        ? prev.map((c) => (c.id === updated.id ? updated : c))
        : [...prev, updated],
    );
  }, []);

  const forgetCampaign = useCallback((id: string) => {
    setCampaigns((prev) => {
      const next = prev.filter((c) => c.id !== id);
      setCampaignId((current) => {
        if (current !== id) return current;
        const fallback = next[0]?.id ?? null;
        if (fallback !== null) {
          storeCampaignId(fallback);
        } else {
          try {
            window.localStorage.removeItem(ACTIVE_CAMPAIGN_KEY);
          } catch {
            // storage disabled
          }
        }
        return fallback;
      });
      return next;
    });
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

  const npcNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const npc of npcs) map[npc.id] = npc.name;
    return map;
  }, [npcs]);
  const apiKeyMissing =
    settings !== null && !settings.openaiKeySet && !settings.anthropicKeySet;

  const value = useMemo<ActiveCampaignValue>(
    () => ({
      view,
      setView: setViewTargeted,
      viewCampaignId,
      campaigns,
      campaignsLoading,
      campaign,
      switchCampaign,
      turns,
      turnsLoading,
      refreshTurns,
      npcs,
      npcsLoading,
      refreshNpcs,
      npcNameById,
      memories,
      memoriesLoading,
      refreshMemories,
      refreshTracker,
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
      refreshSettings,
      upsertCampaignLocal,
      forgetCampaign,
    }),
    [
      view,
      setViewTargeted,
      viewCampaignId,
      campaigns,
      campaignsLoading,
      campaign,
      switchCampaign,
      turns,
      turnsLoading,
      refreshTurns,
      npcs,
      npcsLoading,
      refreshNpcs,
      npcNameById,
      memories,
      memoriesLoading,
      refreshMemories,
      refreshTracker,
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
      refreshSettings,
      upsertCampaignLocal,
      forgetCampaign,
    ],
  );

  return <ActiveCampaignContext.Provider value={value}>{children}</ActiveCampaignContext.Provider>;
}

export function useActiveCampaign(): ActiveCampaignValue {
  const ctx = useContext(ActiveCampaignContext);
  if (ctx === null) throw new Error('useActiveCampaign must be used inside ActiveCampaignProvider');
  return ctx;
}
