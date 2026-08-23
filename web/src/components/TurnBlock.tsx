/**
 * A single story turn: player "action cue" block above, generated scene
 * prose below, variant switcher and hover toolbar on the side.
 * Web-native layout, deliberately not the Android chat-bubble shape.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Loader2,
  PencilLine,
  RotateCcw,
  Trash2,
} from 'lucide-react';

import { cn } from '../lib/cn';
import { formatInline } from '../lib/markdown-lite';
import type { Turn, TurnVariant } from '../lib/types';
import { useActiveCampaign } from '../state/ActiveCampaignContext';
import { IconActionButton, PrimaryButton, SecondaryButton } from './common';
import { toast } from '@heroui/react';
import { ReasoningStream, StageProgress } from './InspectorPanel';
import { Popover } from '@heroui/react';

export function TurnBlock({
  turn,
  variant,
  live,
  isSelected,
  onSelect,
}: {
  turn: Turn;
  /** Displayed persisted variant; null while the first variant streams. */
  variant: TurnVariant | null;
  /** True when this exact turn is currently generating. */
  live: boolean;
  isSelected: boolean;
  onSelect: () => void;
}): ReactNode {
  const { regenerate, send, editTurn, deleteFrom, cycleVariant, variantByTurn, streaming } =
    useActiveCampaign();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftCue, setDraftCue] = useState('');
  const [draftProse, setDraftProse] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = streaming !== null;

  const enterEdit = (): void => {
    setDraftCue(turn.playerInput);
    setDraftProse(variant?.sceneOutput ?? '');
    setEditing(true);
  };

  const saveEdit = async (): Promise<void> => {
    const cue = draftCue.trim();
    if (turn.playerInput.trim().length > 0 && cue.length === 0) {
      toast.warning('The action text cannot be empty.');
      return;
    }
    setSaving(true);
    const proseDirty = variant !== null && draftProse !== variant.sceneOutput;
    const ok = await editTurn(turn.index, {
      ...(turn.playerInput.trim().length > 0 ? { playerInput: cue } : {}),
      ...(proseDirty && variant !== null
        ? { variantId: variant.id, sceneOutput: draftProse }
        : {}),
    });
    setSaving(false);
    if (ok) setEditing(false);
  };

  const saveAndRerun = async (): Promise<void> => {
    const cue = draftCue.trim();
    if (cue.length === 0) {
      toast.warning('The action text cannot be empty.');
      return;
    }
    setSaving(true);
    if (variant !== null && draftProse !== variant.sceneOutput) {
      const ok = await editTurn(turn.index, {
        variantId: variant.id,
        sceneOutput: draftProse,
      });
      if (!ok) {
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    setEditing(false);
    void send(cue, turn.index);
  };

  const shownCount = turn.variants.length + (live && variant === null ? 1 : 0);
  const currentIdx = Math.min(variantByTurn[turn.index] ?? 0, Math.max(0, turn.variants.length - 1));

  return (
    <article
      onClick={onSelect}
      className={cn(
        'group relative cursor-pointer rounded-lg py-1 transition-colors',
        isSelected ? 'bg-surface-1 shadow-[inset_2px_0_0_0] shadow-accent-amber' : '',
      )}
    >
      {/* Hover toolbar */}
      <div className="absolute -top-1 right-0 z-10 hidden items-center gap-0.5 rounded-lg bg-bg/90 px-1 group-hover:flex">
        <IconActionButton
          icon={RotateCcw}
          label="Regenerate"
          disabled={busy}
          onPress={() => void regenerate(turn.index)}
        />
        <IconActionButton
          icon={PencilLine}
          label="Edit turn"
          disabled={busy}
          onPress={enterEdit}
        />
        <IconActionButton
          icon={Copy}
          label="Copy scene"
          onPress={() => {
            const text = live ? '' : (variant?.sceneOutput ?? '');
            if (text.length > 0) void navigator.clipboard.writeText(text);
          }}
        />
        <Popover isOpen={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <Popover.Trigger>
            <span>
              <IconActionButton icon={Trash2} label="Delete turn and later" tone="danger" disabled={busy} />
            </span>
          </Popover.Trigger>
          <Popover.Content aria-label="Confirm delete">
            <div className="w-60 p-3">
              <p className="text-sm text-text-hi">Delete this turn?</p>
              <p className="mt-1 text-xs leading-relaxed text-text-mid">
                This turn and every later turn are removed, matching the campaign file format.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-lg px-2.5 py-1 text-xs text-text-mid transition-colors hover:bg-surface-2 hover:text-text-hi"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingDelete(false);
                    void deleteFrom(turn.index);
                  }}
                  className="rounded-lg bg-accent-red px-2.5 py-1 text-xs font-medium text-black transition-colors hover:bg-accent-red/85"
                >
                  Delete
                </button>
              </div>
            </div>
          </Popover.Content>
        </Popover>
      </div>

      {editing ? (
        <div className="mt-2 space-y-3 rounded-xl border border-line bg-surface-1 p-3">
          {turn.playerInput.trim().length > 0 && (
            <label className="block">
              <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-text-low">
                Your action
              </span>
              <textarea
                value={draftCue}
                onChange={(e) => setDraftCue(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-sm leading-relaxed text-text-hi outline-none transition-colors focus:border-line-strong"
              />
            </label>
          )}
          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-text-low">
              Scene
            </span>
            <textarea
              value={draftProse}
              onChange={(e) => setDraftProse(e.target.value)}
              rows={7}
              className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-sm leading-relaxed text-text-hi outline-none transition-colors focus:border-line-strong"
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <SecondaryButton disabled={saving} onPress={() => setEditing(false)}>
              Cancel
            </SecondaryButton>
            {turn.playerInput.trim().length > 0 && (
              <SecondaryButton disabled={saving} onPress={() => void saveAndRerun()}>
                Save and rerun
              </SecondaryButton>
            )}
            <PrimaryButton disabled={saving} onPress={() => void saveEdit()}>
              {saving ? 'Saving...' : 'Save'}
            </PrimaryButton>
          </div>
        </div>
      ) : null}

      {/* Action cue: player input. Turn 0 (the opening scene) has none —
          skip the cue entirely instead of rendering an empty YOU line. */}
      {!editing && turn.playerInput.trim().length > 0 && (
        <div className="ml-4 border-l-2 border-line-strong pl-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-low">You</span>
          <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-text-mid">
            {turn.playerInput}
          </p>
        </div>
      )}

      {!editing && live && <LivePipeline />}

      {/* Scene prose */}
      {!editing && (
      <div className="dg-prose mt-4 border-l-2 border-line pl-4">
        {live ? (
          <StreamingProse text={streaming?.prose ?? ''} />
        ) : (
          <StaticProse text={variant?.sceneOutput ?? ''} interrupted={variant?.interrupted ?? false} />
        )}
      </div>
      )}

      {/* Variant switcher */}
      {shownCount > 1 && (
        <div className="mt-3 flex items-center gap-1 text-text-low">
          <IconActionButton
            icon={ChevronLeft}
            label="Previous variant"
            disabled={busy || currentIdx <= 0}
            onPress={() => cycleVariant(turn.index, -1)}
          />
          <span className="font-mono text-[11px]" role="status">
            {currentIdx + 1}/{turn.variants.length}
          </span>
          <IconActionButton
            icon={ChevronRight}
            label="Next variant"
            disabled={busy || currentIdx >= turn.variants.length - 1}
            onPress={() => cycleVariant(turn.index, 1)}
          />
        </div>
      )}
    </article>
  );
}

function StaticProse({ text, interrupted }: { text: string; interrupted: boolean }): ReactNode {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {formatInline(p)}
        </p>
      ))}
      {interrupted && (
        <span className="mt-2 inline-flex items-center rounded-lg border-l-2 border-accent-amber bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-amber">
          Interrupted
        </span>
      )}
    </>
  );
}

/**
 * Live pipeline block inside the streaming turn: the inspector's LIVE view,
 * inline, so phones see it without opening the panel. Expanded by default
 * while the model works; collapses to a one-line header once prose starts
 * flowing (unless the user manually toggled it).
 */
function LivePipeline(): ReactNode {
  const { streaming } = useActiveCampaign();
  const [expanded, setExpanded] = useState(true);
  const userToggled = useRef(false);
  const proseStarted = (streaming?.prose ?? '').length > 0;

  useEffect(() => {
    if (proseStarted && !userToggled.current) setExpanded(false);
  }, [proseStarted]);

  const lines = streaming?.stageLines ?? [];
  const latest = lines[lines.length - 1] ?? 'Starting pipeline...';
  const reasoning = streaming?.reasoning ?? '';

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-line bg-surface-1">
      <button
        type="button"
        onClick={() => {
          userToggled.current = true;
          setExpanded((e) => !e);
        }}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Loader2 size={13} className="shrink-0 animate-spin text-text-mid" />
        <span className="min-w-0 flex-1 truncate text-xs text-text-mid">{latest}</span>
        {expanded ? (
          <ChevronUp size={13} className="shrink-0 text-text-low" />
        ) : (
          <ChevronDown size={13} className="shrink-0 text-text-low" />
        )}
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-line px-3 py-2.5">
          <StageProgress lines={lines} />
          {reasoning.length > 0 && <ReasoningStream text={reasoning} />}
        </div>
      )}
    </div>
  );
}

function StreamingProse({ text }: { text: string }): ReactNode {
  const paragraphs = text.split(/\n{2,}/);
  const last = paragraphs.length - 1;
  return (
    <>
      {paragraphs.map((p, i) =>
        i === last ? (
          <p key={i} className="whitespace-pre-wrap">
            {formatInline(p)}
            <span className="dg-caret" aria-hidden="true" />
          </p>
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {formatInline(p)}
          </p>
        ),
      )}
    </>
  );
}
