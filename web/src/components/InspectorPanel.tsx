/**
 * Right inspector panel: the transparency feature. IDLE mode shows pipeline
 * details of the selected turn; LIVE mode shows stage progress, the live
 * reasoning stream (pause on scroll up) and the stage event log.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  Check,
  Club,
  Diamond,
  Heart,
  Loader2,
  Spade,
} from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

import { cn } from '../lib/cn';
import type { MechanicResult, RouterDecision, TurnVariant } from '../lib/types';
import { useActiveCampaign } from '../state/ActiveCampaignContext';
import { SectionLabel } from './common';

const SUIT_ICONS: Record<string, LucideIcon> = {
  spades: Spade,
  clubs: Club,
  diamonds: Diamond,
  hearts: Heart,
};

const FOLLOW_THRESHOLD_PX = 32;

export function InspectorPanel(): ReactNode {
  const { streaming, streamError, dismissStreamError } = useActiveCampaign();

  if (streaming !== null) {
    return (
      <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
        <SectionLabel>Pipeline · live</SectionLabel>
        {streamError !== null && <ErrorBanner message={streamError} onDismiss={dismissStreamError} />}
        <StageProgress lines={streaming.stageLines} />
        <ReasoningStream text={streaming.reasoning} />
        <StageLog lines={streaming.stageLines} />
      </div>
    );
  }
  return <IdleInspector />;
}

// ---- IDLE -------------------------------------------------------------------

function IdleInspector(): ReactNode {
  const {
    turns,
    selectedTurnIndex,
    variantByTurn,
    streaming,
    setView,
  } = useActiveCampaign();

  if (selectedTurnIndex === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm text-text-mid">Select a turn to inspect its pipeline.</p>
        <p className="text-xs text-text-low">
          Synopsis, mechanics, stage events, thinking and trackers appear here.
        </p>
      </div>
    );
  }

  const turn = turns.find((t) => t.index === selectedTurnIndex);
  if (turn === undefined) {
    return (
      <div className="p-6 text-sm text-text-low">That turn no longer exists.</div>
    );
  }

  const variant: TurnVariant | null =
    turn.variants.length > 0
      ? turn.variants[Math.min(variantByTurn[turn.index] ?? 0, turn.variants.length - 1)]
      : null;

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4 pb-8">
      <SectionLabel>
        Turn {turn.index} · variant {Math.min(variantByTurn[turn.index] ?? 0, Math.max(0, turn.variants.length - 1)) + 1}
      </SectionLabel>

      {variant === null ? (
        <p className="text-xs text-text-low">No persisted variant yet.</p>
      ) : (
        <>
          <Section title="Synopsis">
            <p className="text-sm leading-relaxed text-text-mid">{variant.synopsis || '(none)'}</p>
            {variant.interrupted && (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-amber">
                Interrupted
              </p>
            )}
          </Section>

          <RouterSection decision={variant.routerDecision} results={variant.mechanicResults} />

          {variant.stageEvents.length > 0 && (
            <Section title="Stage events">
              <ul className="space-y-1">
                {variant.stageEvents.map((line, i) => (
                  <li key={i} className="font-mono text-[11px] leading-relaxed text-text-mid">
                    {line}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {variant.reasoning !== null && variant.reasoning.length > 0 && (
            <ThinkingSection text={variant.reasoning} />
          )}
        </>
      )}

      <NpcSection presentNpcIds={variant?.presentNpcIds ?? []} />

      {!streaming && (
        <button
          type="button"
          onClick={() => setView('settings')}
          className="self-start text-xs text-text-low underline-offset-2 transition-colors hover:text-text-mid hover:underline"
        >
          Model settings
        </button>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section>
      <SectionLabel>{title}</SectionLabel>
      <div className="mt-2">{children}</div>
    </section>
  );
}

// ---- router + mechanics -----------------------------------------------------

function tierColor(tier: string): string {
  switch (tier) {
    case 'critical_success':
      return 'text-accent-amber';
    case 'success':
      return 'text-accent-green';
    case 'partial':
      return 'text-text-mid';
    case 'failure':
      return 'text-accent-red';
    default:
      return 'text-text-mid';
  }
}

function RouterSection({
  decision,
  results,
}: {
  decision: RouterDecision | null;
  results: MechanicResult[];
}): ReactNode {
  if (decision === null) return null;
  return (
    <Section title="Router decision">
      <ul className="space-y-1 text-xs text-text-mid">
        <li>check required: {decision.needs_check ? 'yes' : 'no'}</li>
        <li>agency update: {decision.run_agency_update ? 'yes' : 'no'}</li>
        {decision.lore_query !== null && decision.lore_query.length > 0 && (
          <li>lore query: {decision.lore_query}</li>
        )}
        {decision.checks.map((c, i) => (
          <li key={i}>
            check: {c.skill} dc {c.dc} mod {c.modifier >= 0 ? `+${c.modifier}` : c.modifier}
            {c.advantage !== 0 && ` adv ${c.advantage}`}
          </li>
        ))}
      </ul>

      {results.length > 0 && (
        <div className="mt-3 space-y-3">
          {results.map((r, i) => (
            <div key={i} className="border-l border-line pl-3">
              <p className="flex items-center gap-2 text-xs text-text-hi">
                <span>{r.skill}</span>
                <span className={cn('font-mono text-[11px]', tierColor(r.tier))}>{r.tier}</span>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                {r.drawn.map((card, j) => {
                  const Icon = SUIT_ICONS[card.suit.toLowerCase()] ?? Spade;
                  return (
                    <span key={j} className="flex items-center gap-1 text-[11px] text-text-mid">
                      <Icon size={12} className="text-accent-amber" />
                      {card.name}
                    </span>
                  );
                })}
                <span className="font-mono text-[11px] text-accent-amber">= {r.value}</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---- thinking ---------------------------------------------------------------

function ThinkingSection({ text }: { text: string }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-text-low transition-colors hover:text-text-mid"
      >
        Thinking
        <span className="font-mono normal-case tracking-normal">{open ? '[hide]' : '[show]'}</span>
      </button>
      {open && (
        <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-surface-1 p-3 font-mono text-[11px] leading-relaxed text-text-mid">
          {text}
        </pre>
      )}
    </section>
  );
}

// ---- NPCs -------------------------------------------------------------------

function NpcSection({ presentNpcIds }: { presentNpcIds: string[] }): ReactNode {
  // NPC names resolve in phase 4 once the NPC store is wired into the client;
  // until then ids are shown as-is so the data path stays honest.
  return (
    <Section title={`Present NPCs (${presentNpcIds.length})`}>
      {presentNpcIds.length === 0 ? (
        <p className="text-xs text-text-low">None recorded.</p>
      ) : (
        <ul className="space-y-1">
          {presentNpcIds.map((id) => (
            <li key={id} className="flex items-center gap-2 text-xs" style={{ color: '#22D3EE' }}>
              <span className="h-1 w-1 rounded-full bg-current" />
              <span className="truncate font-mono text-[11px]" title={id}>
                {id}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---- LIVE -------------------------------------------------------------------

function StageProgress({ lines }: { lines: string[] }): ReactNode {
  if (lines.length === 0) {
    return (
      <p className="flex items-center gap-2 text-xs text-text-mid">
        <Loader2 size={13} className="animate-spin text-text-mid" />
        Starting pipeline...
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {lines.map((line, i) => {
        const done = i < lines.length - 1;
        return (
          <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
            {done ? (
              <Check size={13} className="mt-0.5 shrink-0 text-accent-green" />
            ) : (
              <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin text-text-mid" />
            )}
            <span className={done ? 'text-text-low' : 'text-text-hi'}>{line}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Live reasoning stream: monospace, capped height, pauses when scrolled up. */
function ReasoningStream({ text }: { text: string }): ReactNode {
  const boxRef = useRef<HTMLPreElement>(null);
  const followingRef = useRef(true);

  useEffect(() => {
    const el = boxRef.current;
    if (el !== null && followingRef.current) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <section className="min-w-0">
      <SectionLabel>Thinking · live</SectionLabel>
      <pre
        ref={boxRef}
        onScroll={() => {
          const el = boxRef.current;
          if (el === null) return;
          followingRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
        }}
        className="mt-2 h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-surface-1 p-3 font-mono text-[11px] leading-relaxed text-text-mid"
      >
        {text.length > 0 ? text : '...'}
      </pre>
    </section>
  );
}

function StageLog({ lines }: { lines: string[] }): ReactNode {
  return (
    <Section title="Stage events">
      {lines.length === 0 ? (
        <p className="text-xs text-text-low">None yet.</p>
      ) : (
        <ul className="space-y-1">
          {lines.map((line, i) => (
            <li key={i} className="font-mono text-[11px] leading-relaxed text-text-mid">
              {line}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}): ReactNode {
  return (
    <div className="border-l-2 border-accent-red bg-surface-1 px-3 py-2">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-xs leading-relaxed text-accent-red">{message}</p>
        {onDismiss !== undefined && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss error"
            className="shrink-0 text-xs text-text-low transition-colors hover:text-text-mid"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
