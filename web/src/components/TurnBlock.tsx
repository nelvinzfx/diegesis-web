/**
 * A single story turn: player "action cue" block above, generated scene
 * prose below, variant switcher and hover toolbar on the side.
 * Web-native layout, deliberately not the Android chat-bubble shape.
 */

import { useState, type ReactNode } from 'react';

import {
  ChevronLeft,
  ChevronRight,
  Copy,
  PencilLine,
  RotateCcw,
  Trash2,
} from 'lucide-react';

import { cn } from '../lib/cn';
import type { Turn, TurnVariant } from '../lib/types';
import { useActiveCampaign } from '../state/ActiveCampaignContext';
import { IconActionButton } from './common';
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
  const { regenerate, beginEditResend, deleteFrom, cycleVariant, variantByTurn, streaming } =
    useActiveCampaign();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const busy = streaming !== null;

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
          label="Edit and resend"
          disabled={busy}
          onPress={() => beginEditResend(turn.index)}
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

      {/* Action cue: player input */}
      <div className="ml-4 border-l-2 border-line-strong pl-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-low">You</span>
        <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-text-mid">
          {turn.playerInput}
        </p>
      </div>

      {/* Scene prose */}
      <div className="dg-prose mt-4">
        {live ? (
          <StreamingProse text={streaming?.prose ?? ''} />
        ) : (
          <StaticProse text={variant?.sceneOutput ?? ''} interrupted={variant?.interrupted ?? false} />
        )}
      </div>

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
          {p}
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

function StreamingProse({ text }: { text: string }): ReactNode {
  const paragraphs = text.split(/\n{2,}/);
  const last = paragraphs.length - 1;
  return (
    <>
      {paragraphs.map((p, i) =>
        i === last ? (
          <p key={i} className="whitespace-pre-wrap">
            {p}
            <span className="dg-caret" aria-hidden="true" />
          </p>
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {p}
          </p>
        ),
      )}
    </>
  );
}
