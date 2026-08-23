/**
 * The reading column: scrollable transcript of turns plus empty states.
 * Auto-scroll follows the stream but pauses when the user scrolls up,
 * surfacing a "jump to latest" affordance at the bottom while paused.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { AlertTriangle, BookOpen, ChevronsDown, Loader2, Play } from 'lucide-react';

import * as api from '../lib/api';
import type { Turn, TurnVariant } from '../lib/types';
import { useActiveCampaign } from '../state/ActiveCampaignContext';
import { PrimaryButton } from './common';
import { TurnBlock } from './TurnBlock';
import { ErrorBanner } from './InspectorPanel';

const FOLLOW_THRESHOLD_PX = 48;

export function Transcript(): ReactNode {
  const {
    turns,
    streaming,
    selectedTurnIndex,
    selectTurn,
    variantByTurn,
    apiKeyMissing,
    campaign,
    npcs,
    refreshTurns,
    streamError,
    dismissStreamError,
  } = useActiveCampaign();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  const liveTargetIndex = streaming?.targetTurnIndex ?? null;
  const appendingLive = streaming !== null && liveTargetIndex === null;

  // Follow the stream unless the user has scrolled away from the bottom.
  useEffect(() => {
    if (!following) return;
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
    // prose + stage lines both grow during generation
  }, [following, turns.length, streaming?.prose, streaming?.stageLines.length]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
    setFollowing(nearBottom);
  };

  const jumpToLatest = (): void => {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
    setFollowing(true);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain"
      >
        {apiKeyMissing && <ApiKeyWarning />}

        {streamError !== null && (
          <div className="mx-auto max-w-[720px] px-6 pt-4">
            <ErrorBanner message={streamError} onDismiss={dismissStreamError} />
          </div>
        )}

        {turns.length === 0 && !appendingLive ? (
          campaign !== null && hasStoredOpening(campaign, npcs) ? (
            <BeginStoryCard campaignId={campaign.id} onPlayed={refreshTurns} />
          ) : (
            <EmptyTranscript />
          )
        ) : (
          <div className="mx-auto max-w-[720px] space-y-10 px-6 pb-8 pt-6">
            {turns.map((turn) => {
              const liveThisTurn =
                streaming !== null &&
                liveTargetIndex !== null &&
                liveTargetIndex === turn.index;
              const variant = pickVariant(turn, variantByTurn[turn.index] ?? 0, liveThisTurn);
              return (
                <TurnBlock
                  key={`${turn.index}-${turn.createdAt}`}
                  turn={turn}
                  variant={variant}
                  live={liveThisTurn}
                  isSelected={selectedTurnIndex === turn.index}
                  onSelect={() => selectTurn(selectedTurnIndex === turn.index ? null : turn.index)}
                />
              );
            })}
            {appendingLive && <AppendCue />}
          </div>
        )}
      </div>

      {!following && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line-strong bg-surface-2 px-3 py-1.5 text-xs text-text-mid transition-colors hover:text-text-hi"
        >
          <ChevronsDown size={14} />
          Jump to latest
        </button>
      )}
    </div>
  );
}

function pickVariant(turn: Turn, index: number, live: boolean): TurnVariant | null {
  if (live) return null; // prose comes from the stream until persistence lands
  if (turn.variants.length === 0) return null;
  return turn.variants[Math.min(index, turn.variants.length - 1)];
}

function EmptyTranscript(): ReactNode {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 pb-24 text-center">
      <BookOpen size={28} strokeWidth={1.5} className="text-text-low" />
      <p className="text-sm text-text-mid">The stage is empty. Write the first action.</p>
    </div>
  );
}

/** True when the campaign can play an opening: stored message or a present NPC first message. */
function hasStoredOpening(
  campaign: ReturnType<typeof useActiveCampaign>['campaign'],
  npcs: ReturnType<typeof useActiveCampaign>['npcs'],
): boolean {
  if (campaign === null) return false;
  if (campaign.openingMessage.trim().length > 0) return true;
  const present = new Set(campaign.sceneState.presentNpcIds);
  return npcs.some(
    (npc) => present.has(npc.id) && (npc.firstMessage ?? '').trim().length > 0,
  );
}

/** Centered card shown instead of the empty state when an opening exists. */
function BeginStoryCard({
  campaignId,
  onPlayed,
}: {
  campaignId: string;
  onPlayed: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const play = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.playOpening(campaignId);
      await onPlayed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center px-6 pb-24">
      <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-xl border border-line bg-surface-1 p-6 text-center">
        <Play size={28} strokeWidth={1.5} className="text-text-low" />
        <h3 className="text-sm font-medium text-text-hi">Begin the story</h3>
        <p className="text-xs leading-relaxed text-text-mid">
          Play the opening scene, then take your first turn.
        </p>
        <PrimaryButton onPress={() => void play()} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} strokeWidth={1.75} />}
          Play opening
        </PrimaryButton>
        {error !== null && <p className="text-xs text-accent-red">{error}</p>}
      </div>
    </div>
  );
}

/** Placeholder row shown below existing turns while a new turn streams. */
function AppendCue(): ReactNode {
  const { streaming } = useActiveCampaign();
  return (
    <article className="rounded-lg py-1">
      <div className="ml-4 border-l-2 border-line-strong pl-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-low">You</span>
        <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-text-mid">
          {streaming?.playerInput}
        </p>
      </div>
      <div className="dg-prose mt-4">
        <p className="whitespace-pre-wrap">
          {streaming?.prose}
          <span className="dg-caret" aria-hidden="true" />
        </p>
      </div>
    </article>
  );
}

function ApiKeyWarning(): ReactNode {
  const { setView } = useActiveCampaign();
  return (
    <div className="mx-auto max-w-[720px] px-6 pt-6">
      <div className="flex items-center gap-3 border-l-2 border-accent-amber bg-surface-1 px-4 py-3">
        <AlertTriangle size={16} strokeWidth={1.75} className="shrink-0 text-accent-amber" />
        <p className="flex-1 text-sm text-text-mid">Set your API key in Settings first.</p>
        <button
          type="button"
          onClick={() => setView('settings')}
          className="rounded-lg bg-text-hi px-2.5 py-1 text-xs font-medium text-black transition-colors hover:bg-text-hi/85"
        >
          Open Settings
        </button>
      </div>
    </div>
  );
}

