/**
 * Memory browser: the raw facts the engine extracts each turn, scoped to the
 * campaign or a single NPC. Entries carry no stable id; DELETE addresses them
 * by line index (the server shifts indices, so we always re-list after).
 */

import { useState, type ReactNode } from 'react';

import { Brain, Trash2 } from 'lucide-react';

import { Chip, ConfirmAction, PageHeader, SectionLabel } from '../components/common';
import * as api from '../lib/api';
import type { MemoryEntry } from '../lib/types';
import { useActiveCampaign } from '../state/ActiveCampaignContext';

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function MemoryCard({
  memory,
  memoryId,
  npcName,
  onDeleted,
}: {
  memory: MemoryEntry;
  memoryId: number;
  npcName: string | null;
  onDeleted: () => void;
}): ReactNode {
  const { campaign, refreshMemories } = useActiveCampaign();
  const [error, setError] = useState<string | null>(null);

  const remove = async (): Promise<void> => {
    if (campaign === null) return;
    setError(null);
    try {
      await api.deleteMemoryAt(campaign.id, memoryId);
      await refreshMemories();
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="group rounded-xl border border-line bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-text-hi">{memory.fact}</p>
        <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <ConfirmAction
            label="Delete memory"
            variant="icon"
            message="Delete this memory?"
            onConfirm={() => void remove()}
          />
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {memory.scope === 'npc' ? (
          <Chip tone="cyan">{npcName ?? memory.npc_id ?? 'NPC'}</Chip>
        ) : (
          <Chip>Campaign</Chip>
        )}
        <span className="font-mono text-[11px] text-text-low">turn {memory.turn}</span>
        <span className="ml-auto font-mono text-[11px] text-text-low">
          {formatDate(memory.ts)}
        </span>
      </div>
      {error !== null && <p className="mt-2 text-xs text-accent-red">{error}</p>}
    </div>
  );
}

export function MemoriesPage(): ReactNode {
  const { memories, memoriesLoading, campaign, refreshMemories, npcNameById } =
    useActiveCampaign();
  const [clearError, setClearError] = useState<string | null>(null);

  if (campaign === null) {
    return (
      <>
        <PageHeader title="Memories" />
        <p className="text-sm text-text-low">Create a campaign first.</p>
      </>
    );
  }

  const clearAll = async (): Promise<void> => {
    setClearError(null);
    try {
      await api.clearMemories(campaign.id);
      await refreshMemories();
    } catch (e) {
      setClearError(e instanceof Error ? e.message : String(e));
    }
  };

  // Newest first; ids are line indices in the stored order.
  const ordered = memories.map((memory, index) => ({ memory, id: index })).reverse();

  return (
    <>
      <PageHeader
        title="Memories"
        description="What the story remembers. Extracted automatically each turn."
      />

      {memories.length > 0 && (
        <div className="flex items-center justify-between pb-4">
          <SectionLabel>{memories.length} remembered</SectionLabel>
          <ConfirmAction
            label="Clear all"
            icon={Trash2}
            confirmLabel="Clear"
            message="Delete every memory for this campaign? NPC-scoped memories included."
            onConfirm={() => void clearAll()}
          />
        </div>
      )}

      <div className="flex flex-col gap-3 pb-4">
        {memoriesLoading && memories.length === 0 && (
          <p className="text-xs text-text-low">Loading...</p>
        )}

        {!memoriesLoading && memories.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-line py-16 text-center">
            <Brain size={28} strokeWidth={1.5} className="text-text-low" />
            <p className="text-xs text-text-low">
              Nothing remembered yet. Memories appear as turns unfold.
            </p>
          </div>
        )}

        {ordered.map(({ memory, id }) => (
          <MemoryCard
            key={id}
            memory={memory}
            memoryId={id}
            npcName={memory.npc_id !== null ? (npcNameById[memory.npc_id] ?? null) : null}
            onDeleted={() => undefined}
          />
        ))}
      </div>

      {clearError !== null && <p className="pb-4 text-xs text-accent-red">{clearError}</p>}
    </>
  );
}
