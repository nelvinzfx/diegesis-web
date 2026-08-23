/**
 * Prompt template editor: one card per pipeline stage with the shipped
 * default (collapsible), an override textarea, and a live preview panel that
 * shows the EXACT system+user pair the stage would send for the active
 * campaign right now (no AI call).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { ChevronDown, ChevronRight, Eye } from 'lucide-react';

import {
  Chip,
  InlineNote,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  TextArea,
  TextInput,
} from '../components/common';
import { cn } from '../lib/cn';
import * as api from '../lib/api';
import type { PromptPreview, PromptStage } from '../lib/api';
import { useActiveCampaign } from '../state/ActiveCampaignContext';

const STAGE_LABELS: Record<string, string> = {
  router: 'Router',
  plot: 'Plot',
  agency: 'Agency',
  scene: 'Scene',
  'memory-extraction': 'Memory extraction',
  'session-plan': 'Session plan',
  title: 'Auto title',
};

/** {{variable}} tokens referenced by a template body. */
function referencedVariables(template: string): Set<string> {
  const found = new Set<string>();
  for (const match of template.matchAll(/\{\{(\w+)\}\}/g)) found.add(match[1]);
  return found;
}

function StageCard({ stage, onSaved }: { stage: PromptStage; onSaved: () => void }): ReactNode {
  const { campaign } = useActiveCampaign();
  const [draft, setDraft] = useState(stage.override ?? '');
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [note, setNote] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [previewInput, setPreviewInput] = useState('');
  const [preview, setPreview] = useState<PromptPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  // Re-sync the textarea when the server state changes under us (reset/save).
  useEffect(() => {
    setDraft(stage.override ?? '');
  }, [stage.override]);

  const missingVariables = useMemo(() => {
    if (draft.trim().length === 0) return [];
    const used = referencedVariables(draft);
    return stage.variables.filter((variable) => !used.has(variable));
  }, [draft, stage.variables]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      await api.savePromptTemplate(stage.key, draft);
      setNote({
        tone: 'success',
        text: draft.trim().length === 0 ? 'Override cleared.' : 'Override saved.',
      });
      onSaved();
    } catch (e) {
      setNote({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const reset = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      await api.resetPromptTemplate(stage.key);
      setDraft('');
      setNote({ tone: 'success', text: 'Reset to default.' });
      onSaved();
    } catch (e) {
      setNote({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async (): Promise<void> => {
    if (campaign === null) return;
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      setPreview(await api.previewPrompt(campaign.id, stage.key, previewInput));
    } catch (e) {
      setPreview(null);
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-text-hi">{STAGE_LABELS[stage.key] ?? stage.key}</h2>
        {stage.override !== null && <Chip tone="amber">overridden</Chip>}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-text-low">{stage.description}</p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {stage.variables.map((variable) => (
          <span
            key={variable}
            className="inline-flex items-center rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-text-low"
          >
            {'{{'}
            {variable}
            {'}}'}
          </span>
        ))}
      </div>

      {/* Collapsible default */}
      <button
        type="button"
        onClick={() => setDefaultOpen((o) => !o)}
        aria-expanded={defaultOpen}
        className="mt-3 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-low transition-colors hover:text-text-mid"
      >
        {defaultOpen ? (
          <ChevronDown size={12} strokeWidth={1.75} />
        ) : (
          <ChevronRight size={12} strokeWidth={1.75} />
        )}
        Default template
      </button>
      {defaultOpen && (
        <pre className="mt-2 max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-3 font-mono text-[12px] leading-relaxed text-text-low">
          {stage.default}
        </pre>
      )}

      {/* Override editor */}
      <div className="mt-3">
        <SectionLabel>Override</SectionLabel>
        <TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Leave empty to use the default template"
          className="mt-1.5 min-h-[160px] font-mono text-[13px] leading-relaxed"
          spellCheck={false}
        />
        {draft.trim().length > 0 && missingVariables.length > 0 && (
          <p className="mt-1.5 font-mono text-[11px] text-text-low">
            hint: this stage also provides{' '}
            {missingVariables.map((v) => `{{${v}}}`).join(', ')}
          </p>
        )}
        <div className="mt-2.5 flex items-center gap-2">
          <PrimaryButton onPress={() => void save()} disabled={busy}>
            Save
          </PrimaryButton>
          {stage.override !== null && (
            <SecondaryButton onPress={() => void reset()} disabled={busy}>
              Reset
            </SecondaryButton>
          )}
        </div>
        {note !== null && (
          <div className="mt-2">
            <InlineNote tone={note.tone}>{note.text}</InlineNote>
          </div>
        )}
      </div>

      {/* Preview panel */}
      <div className="mt-4 border-t border-line pt-3">
        <SectionLabel>Live preview</SectionLabel>
        {campaign === null ? (
          <p className="mt-1.5 text-xs text-text-low">
            No active campaign. Create one to preview the exact request.
          </p>
        ) : (
          <>
            <div className="mt-1.5 flex items-center gap-2">
              <TextInput
                value={previewInput}
                onChange={(e) => setPreviewInput(e.target.value)}
                placeholder="sample action"
                className="flex-1"
              />
              <SecondaryButton onPress={() => void runPreview()} disabled={previewBusy}>
                <Eye size={14} strokeWidth={1.75} />
                Preview
              </SecondaryButton>
            </div>
            {previewError !== null && (
              <div className="mt-2">
                <InlineNote tone="error">{previewError}</InlineNote>
              </div>
            )}
            {preview !== null && (
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip>{preview.meta.turnsIncluded} turns included</Chip>
                  {preview.meta.turnsDropped > 0 && (
                    <Chip tone="amber">{preview.meta.turnsDropped} trimmed</Chip>
                  )}
                  {preview.meta.presentNpcs.map((name) => (
                    <Chip key={name} tone="cyan">
                      {name}
                    </Chip>
                  ))}
                </div>
                <div>
                  <SectionLabel>System</SectionLabel>
                  <pre className="mt-1.5 max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-3 font-mono text-[12px] leading-relaxed text-text-mid">
                    {preview.system}
                  </pre>
                </div>
                <div>
                  <SectionLabel>User</SectionLabel>
                  <pre className="mt-1.5 max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-3 font-mono text-[12px] leading-relaxed text-text-mid">
                    {preview.user}
                  </pre>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function PromptsPage(): ReactNode {
  const [stages, setStages] = useState<PromptStage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    try {
      setStages(await api.listPromptTemplates());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <>
      <PageHeader
        title="Prompts"
        description="Every prompt the pipeline sends, editable. Preview shows the exact request for the active campaign."
      />
      {error !== null && <InlineNote tone="error">{error}</InlineNote>}
      {stages === null && error === null && (
        <p className="text-sm text-text-low">Loading templates...</p>
      )}
      <div className={cn('flex flex-col gap-4', stages === null && 'hidden')}>
        {(stages ?? []).map((stage) => (
          <StageCard key={stage.key} stage={stage} onSaved={() => void load()} />
        ))}
      </div>
    </>
  );
}
