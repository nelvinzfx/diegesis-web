/**
 * Right inspector panel: the transparency feature. IDLE mode shows pipeline
 * details of the selected turn; LIVE mode shows stage progress, the live
 * reasoning stream (pause on scroll up) and the stage event log.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  Activity,
  Check,
  Club,
  Diamond,
  Heart,
  Loader2,
  PencilLine,
  Spade,
} from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

import * as api from '../lib/api';
import { cn } from '../lib/cn';
import type {
  MechanicResult,
  RouterDecision,
  TrackerEntry,
  TrackerState,
  TurnVariant,
} from '../lib/types';
import { useActiveCampaign } from '../state/ActiveCampaignContext';
import { IconActionButton, PrimaryButton, SecondaryButton, SectionLabel, TextArea } from './common';

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
        <StatusSection />
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
      <StatusSection />
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

// ---- status board -----------------------------------------------------------

/** Live narrative status board; shown in BOTH idle and live inspector modes. */
function StatusSection(): ReactNode {
  const { campaign, streaming, npcNameById, refreshTracker } = useActiveCampaign();
  const [editing, setEditing] = useState(false);
  const trackerState = campaign?.trackerState ?? null;
  // Subtle live note only once the pipeline actually reached the tracker stage.
  const trackerUpdating =
    streaming !== null && streaming.stageLines.some((line) => line.startsWith('tracker:'));

  return (
    <section>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-low">
          <Activity size={12} strokeWidth={1.75} />
          Status
        </div>
        {trackerState !== null && !editing && (
          <IconActionButton
            icon={PencilLine}
            label="Edit status board"
            onPress={() => setEditing(true)}
          />
        )}
      </div>

      {editing && trackerState !== null ? (
        <StatusEditor
          board={trackerState}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void refreshTracker();
          }}
        />
      ) : trackerState === null ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-text-low">
          <Activity size={13} className="shrink-0" />
          Status appears after the first turn.
        </p>
      ) : (
        <StatusBoard
          board={trackerState}
          npcNameById={npcNameById}
          playerPersona={campaign?.playerPersona ?? ''}
          updating={trackerUpdating}
        />
      )}
    </section>
  );
}

const TRACKER_HEADER_ROWS: Array<[keyof Pick<TrackerState, 'dateTime' | 'location' | 'atmosphere'>, string]> = [
  ['dateTime', 'Date & Time'],
  ['location', 'Location'],
  ['atmosphere', 'Atmosphere'],
];

function TrackerField({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <p className="text-xs leading-relaxed">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-low">{label}: </span>
      <span className="text-text-mid">{value}</span>
    </p>
  );
}

function TrackerEntryRows({ entry }: { entry: TrackerEntry & { innerVoice?: string } }): ReactNode {
  return (
    <div className="mt-0.5 space-y-0.5">
      <TrackerField label="Look" value={entry.look} />
      <TrackerField label="Condition" value={entry.condition} />
      <TrackerField label="Carrying" value={entry.carrying} />
    </div>
  );
}

function StatusBoard({
  board,
  npcNameById,
  playerPersona,
  updating,
}: {
  board: TrackerState;
  npcNameById: Record<string, string>;
  playerPersona: string;
  updating: boolean;
}): ReactNode {
  const playerName = (() => {
    const first = playerPersona.trim().split(/\s+/)[0];
    return first !== undefined && first.length > 0 ? first : 'You';
  })();
  const npcEntries = Object.entries(board.npcs);
  const innerVoices = npcEntries.filter(([, entry]) => {
    const voice = entry.innerVoice;
    return typeof voice === 'string' && voice.trim().length > 0;
  });

  return (
    <div className="mt-2">
      {updating && (
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-low">
          Updating...
        </p>
      )}

      <div className="space-y-0.5">
        {TRACKER_HEADER_ROWS.map(([key, label]) => (
          <TrackerField key={key} label={label} value={board[key]} />
        ))}
      </div>

      {board.player !== null && (
        <div className="mt-3 border-l-2 border-accent-amber pl-3">
          <p className="text-xs text-text-hi">{playerName}</p>
          <TrackerEntryRows entry={board.player} />
        </div>
      )}

      {npcEntries.map(([id, entry]) => (
        <div key={id} className="mt-3">
          <p className="truncate text-xs text-accent-cyan" title={npcNameById[id] ?? id}>
            {npcNameById[id] !== undefined ? npcNameById[id] : id}
          </p>
          <TrackerEntryRows entry={entry} />
        </div>
      ))}

      {innerVoices.length > 0 && (
        <div className="mt-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-low">
            Inner Voices
          </p>
          <div className="mt-1 space-y-0.5">
            {innerVoices.map(([id, entry]) => (
              <p key={id} className="text-xs italic leading-relaxed text-text-mid">
                <span className="not-italic text-accent-cyan">
                  {npcNameById[id] !== undefined ? npcNameById[id] : id}:
                </span>{' '}
                {entry.innerVoice}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EditorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}): ReactNode {
  return (
    <label className="block">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-low">{label}</span>
      <TextArea
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5"
      />
    </label>
  );
}

function StatusEditor({
  board,
  onCancel,
  onSaved,
}: {
  board: TrackerState;
  onCancel: () => void;
  onSaved: () => void;
}): ReactNode {
  const { campaign } = useActiveCampaign();
  const [draft, setDraft] = useState<TrackerState>(
    () => JSON.parse(JSON.stringify(board)) as TrackerState,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (mutate: (draft: TrackerState) => void): void => {
    setDraft((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as TrackerState;
      mutate(next);
      return next;
    });
  };

  const save = async (): Promise<void> => {
    if (campaign === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateTracker(campaign.id, draft);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-3">
      {error !== null && <ErrorBanner message={error} />}
      {TRACKER_HEADER_ROWS.map(([key, label]) => (
        <EditorField
          key={key}
          label={label}
          value={draft[key]}
          onChange={(next) => update((d) => (d[key] = next))}
        />
      ))}

      {draft.player !== null && (
        <div className="border-l-2 border-accent-amber pl-3">
          <p className="mb-1 text-xs text-text-hi">Player</p>
          <div className="space-y-2">
            {(['look', 'condition', 'carrying'] as const).map((field) => (
              <EditorField
                key={field}
                label={field}
                value={draft.player![field]}
                onChange={(next) => update((d) => (d.player !== null ? (d.player[field] = next) : undefined))}
              />
            ))}
          </div>
        </div>
      )}

      {Object.keys(draft.npcs).map((id) => (
        <div key={id}>
          <p className="mb-1 text-xs text-accent-cyan">{id}</p>
          <div className="space-y-2">
            {(['look', 'condition', 'carrying'] as const).map((field) => (
              <EditorField
                key={field}
                label={field}
                value={draft.npcs[id]![field]}
                onChange={(next) => update((d) => (d.npcs[id]![field] = next))}
              />
            ))}
            <EditorField
              label="Inner voice"
              value={draft.npcs[id]!.innerVoice ?? ''}
              onChange={(next) => update((d) => (d.npcs[id]!.innerVoice = next.length > 0 ? next : undefined))}
            />
          </div>
        </div>
      ))}

      <div className="flex items-center justify-end gap-2">
        <SecondaryButton onPress={onCancel} disabled={saving}>
          Cancel
        </SecondaryButton>
        <PrimaryButton onPress={() => void save()} disabled={saving}>
          Save
        </PrimaryButton>
      </div>
    </div>
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
        <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-1 p-3 font-mono text-[11px] leading-relaxed text-text-mid">
          {text}
        </pre>
      )}
    </section>
  );
}

// ---- NPCs -------------------------------------------------------------------

function NpcSection({ presentNpcIds }: { presentNpcIds: string[] }): ReactNode {
  const { npcNameById } = useActiveCampaign();
  return (
    <Section title={`Present NPCs (${presentNpcIds.length})`}>
      {presentNpcIds.length === 0 ? (
        <p className="text-xs text-text-low">None recorded.</p>
      ) : (
        <ul className="space-y-1">
          {presentNpcIds.map((id) => {
            const name = npcNameById[id];
            return (
              <li key={id} className="flex items-center gap-2 text-accent-cyan">
                <span className="h-1 w-1 shrink-0 rounded-full bg-current" />
                <span
                  className="truncate text-[11px]"
                  title={name ?? id}
                >
                  {name !== undefined ? name : id}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ---- LIVE -------------------------------------------------------------------

export function StageProgress({ lines }: { lines: string[] }): ReactNode {
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
export function ReasoningStream({ text }: { text: string }): ReactNode {
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
        className="mt-2 h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-surface-1 p-3 font-mono text-[11px] leading-relaxed text-text-mid"
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
