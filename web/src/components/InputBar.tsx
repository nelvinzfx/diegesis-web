/**
 * Bottom input bar: auto-growing textarea, Enter sends, Shift+Enter adds a
 * newline, Esc aborts a running stream. The send button becomes a red stop
 * button while generating. Editing an existing turn re-runs from that turn.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { CornerDownLeft, Square, X } from 'lucide-react';

import { cn } from '../lib/cn';
import { useActiveCampaign } from '../state/ActiveCampaignContext';

export function InputBar(): ReactNode {
  const { send, stop, streaming, editingTurnIndex, clearEditingTurn, turns } =
    useActiveCampaign();
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const seededEditRef = useRef<number | null>(null);

  const busy = streaming !== null;

  // Seed the textarea when edit+resend is requested from a turn toolbar.
  useEffect(() => {
    if (editingTurnIndex === null) return;
    if (seededEditRef.current === editingTurnIndex) return;
    const turn = turns.find((t) => t.index === editingTurnIndex);
    if (turn !== undefined) {
      setText(turn.playerInput);
      seededEditRef.current = editingTurnIndex;
      textareaRef.current?.focus();
    }
  }, [editingTurnIndex, turns]);

  // Auto-grow up to ~10 lines.
  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const cancelEdit = (): void => {
    seededEditRef.current = null;
    clearEditingTurn();
    setText('');
  };

  const submit = (): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || busy) return;
    const target = editingTurnIndex;
    seededEditRef.current = null;
    clearEditingTurn();
    setText('');
    void send(trimmed, target).then(() => {
      if (target === null || target === undefined) return;
      // After an edit+resend run completes, drop the stale edit seed so a
      // second edit of the same turn re-seeds correctly.
      seededEditRef.current = null;
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape' && busy) {
      event.preventDefault();
      stop();
    }
  };

  return (
    <div className="shrink-0 border-t border-line bg-bg px-6 py-4">
      <div className="mx-auto max-w-[720px]">
        {editingTurnIndex !== null && (
          <div className="mb-2 flex items-center gap-2 text-xs text-text-mid">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent-amber">
              Edit turn {editingTurnIndex}
            </span>
            <span className="text-text-low">sending reruns the story from this point</span>
            <button
              type="button"
              onClick={cancelEdit}
              aria-label="Cancel edit"
              className="ml-auto flex h-5 w-5 items-center justify-center rounded text-text-low transition-colors hover:bg-surface-2 hover:text-text-hi"
            >
              <X size={12} />
            </button>
          </div>
        )}
        <div
          className={cn(
            'flex min-h-[56px] items-center gap-2 rounded-2xl border border-line bg-surface-1 px-4 py-3 transition-colors focus-within:border-line-strong',
          )}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              busy ? 'The stage is busy...' : 'What do you do?'
            }
            disabled={busy && streaming?.phase === 'sending'}
            className="max-h-[240px] flex-1 resize-none bg-transparent text-sm leading-relaxed text-text-hi outline-none placeholder:text-text-low disabled:opacity-60"
          />
          {busy ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop generation"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-red text-black transition-colors hover:bg-accent-red/85"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              aria-label="Send action"
              disabled={text.trim().length === 0}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-text-hi text-black transition-colors hover:bg-text-hi/85 disabled:pointer-events-none disabled:bg-surface-3 disabled:text-text-low"
            >
              <CornerDownLeft size={15} strokeWidth={2} />
            </button>
          )}
        </div>
        <p className="mt-1.5 hidden font-mono text-[10px] uppercase tracking-[0.14em] text-text-low sm:block">
          Enter to send · Shift+Enter newline{busy ? ' · Esc to stop' : ''}
        </p>
      </div>
    </div>
  );
}
