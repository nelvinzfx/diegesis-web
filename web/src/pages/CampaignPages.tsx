/**
 * Campaign create + edit pages. Both share the same field layout and the
 * plan-generation SSE preview; the edit page adds plan regeneration (with
 * confirm) and a danger zone for deleting the campaign.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Loader2, Save, Sparkles, Square } from 'lucide-react';

import {
  ConfirmAction,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  TextArea,
  TextInput,
} from '../components/common';
import * as api from '../lib/api';
import { usePlanStream, type PlanStreamState } from '../lib/usePlanStream';
import type { Campaign } from '../lib/types';
import { useActiveCampaign } from '../state/ActiveCampaignContext';

interface FormValues {
  title: string;
  premise: string;
  persona: string;
  location: string;
}

const EMPTY_FORM: FormValues = { title: '', premise: '', persona: '', location: '' };

// ---- shared field block ------------------------------------------------------

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-text-mid">{label}</span>
      {children}
    </label>
  );
}

function CampaignFields({
  values,
  onChange,
}: {
  values: FormValues;
  onChange: (next: FormValues) => void;
}): ReactNode {
  const set = (patch: Partial<FormValues>): void => onChange({ ...values, ...patch });
  return (
    <div className="flex flex-col gap-4">
      <Field label="Title">
        <TextInput
          value={values.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="The Ashen Coast"
        />
      </Field>
      <Field label="Premise">
        <TextArea
          value={values.premise}
          rows={3}
          onChange={(e) => set({ premise: e.target.value })}
          placeholder="Where the story begins and what is at stake..."
        />
      </Field>
      <Field label="Player persona">
        <TextArea
          value={values.persona}
          rows={3}
          onChange={(e) => set({ persona: e.target.value })}
          placeholder="Who the player is in this world..."
        />
      </Field>
      <Field label="Initial location">
        <TextInput
          value={values.location}
          onChange={(e) => set({ location: e.target.value })}
          placeholder="A rain-soaked harbour town"
        />
      </Field>
    </div>
  );
}

/** Live plan stream preview with reasoning collapsible + stop control. */
function PlanPreview({
  plan,
  onStop,
}: {
  plan: PlanStreamState;
  onStop: () => void;
}): ReactNode {
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="flex items-center justify-between">
        <SectionLabel>Session plan · live</SectionLabel>
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop planning"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-red text-black transition-colors hover:bg-accent-red/85"
        >
          <Square size={12} fill="currentColor" />
        </button>
      </div>
      <pre className="dg-prose mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words font-sans">
        {plan.prose.length > 0 ? plan.prose : '...'}
      </pre>
      {plan.reasoning.length > 0 && <ReasoningCollapsible text={plan.reasoning} />}
      {plan.stageLines.length > 0 && (
        <ul className="mt-3 space-y-1">
          {plan.stageLines.map((line, i) => (
            <li key={i} className="font-mono text-[11px] leading-relaxed text-text-low">
              {line}
            </li>
          ))}
        </ul>
      )}
      {plan.error !== null && (
        <p className="mt-3 border-l-2 border-accent-red px-3 py-2 text-xs leading-relaxed text-accent-red">
          {plan.error}
        </p>
      )}
    </div>
  );
}

function ReasoningCollapsible({ text }: { text: string }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
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
        <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-text-mid">
          {text}
        </pre>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="pt-6 first:pt-0">
      <SectionLabel>{title}</SectionLabel>
      <div className="mt-3">{children}</div>
    </section>
  );
}

// ---- campaign-new ------------------------------------------------------------

export function CampaignNewPage(): ReactNode {
  const { setView, switchCampaign, upsertCampaignLocal } = useActiveCampaign();
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<{ title?: string; premise?: string }>({});
  const [planText, setPlanText] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { plan, startPlan, stopPlan } = usePlanStream();

  const validate = (): boolean => {
    const next: { title?: string; premise?: string } = {};
    if (values.title.trim().length === 0) next.title = 'Title is required.';
    if (values.premise.trim().length === 0) next.premise = 'Premise is required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  /** Creates the campaign once (with current fields), returns its id. */
  const ensureCreated = async (): Promise<string | null> => {
    if (createdId !== null) return createdId;
    const created = await api.createCampaign({
      title: values.title.trim(),
      premise: values.premise.trim(),
      playerPersona: values.persona.trim(),
      sceneState: { location: values.location.trim(), presentNpcIds: [] },
    });
    setCreatedId(created.id);
    upsertCampaignLocal(created);
    return created.id;
  };

  const generatePlan = async (): Promise<void> => {
    if (!validate() || busy || plan.streaming) return;
    setSaveError(null);
    let id: string | null = null;
    try {
      id = await ensureCreated();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (id === null) return;
    await startPlan(
      id,
      { title: values.title.trim(), premise: values.premise.trim(), playerPersona: values.persona.trim() },
      (prose) => setPlanText(prose),
    );
  };

  const save = async (): Promise<void> => {
    if (!validate() || busy || plan.streaming) return;
    setBusy(true);
    setSaveError(null);
    try {
      const input = {
        title: values.title.trim(),
        premise: values.premise.trim(),
        playerPersona: values.persona.trim(),
        sessionPlan: planText,
        sceneState: { location: values.location.trim(), presentNpcIds: [] as string[] },
      };
      const saved =
        createdId === null
          ? await api.createCampaign(input)
          : await api.updateCampaign(createdId, input);
      upsertCampaignLocal(saved);
      switchCampaign(saved.id);
      setView('story');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="New campaign"
        description="Set the stage, optionally draft a session plan, then start the story."
      />

      <Section title="Campaign">
        <CampaignFields values={values} onChange={setValues} />
        {errors.title !== undefined && (
          <p className="mt-2 text-xs text-accent-red">{errors.title}</p>
        )}
        {errors.premise !== undefined && (
          <p className="mt-2 text-xs text-accent-red">{errors.premise}</p>
        )}
      </Section>

      <Section title="Session plan">
        <div className="flex items-center gap-2">
          <SecondaryButton onPress={() => void generatePlan()} disabled={busy || plan.streaming}>
            {plan.streaming ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} strokeWidth={1.75} className="text-accent-amber" />
            )}
            Generate plan
          </SecondaryButton>
          {plan.streaming && (
            <SecondaryButton onPress={stopPlan}>Stop</SecondaryButton>
          )}
        </div>

        {plan.streaming ? (
          <div className="mt-3">
            <PlanPreview plan={plan} onStop={stopPlan} />
          </div>
        ) : (
          <div className="mt-3">
            <TextArea
              value={planText}
              rows={10}
              onChange={(e) => setPlanText(e.target.value)}
              placeholder={'Session plan (markdown). Generate one above or write your own.'}
            />
            {plan.error !== null && (
              <p className="mt-2 text-xs text-accent-red">{plan.error}</p>
            )}
          </div>
        )}
      </Section>

      {saveError !== null && <p className="mt-4 text-xs text-accent-red">{saveError}</p>}

      <div className="sticky bottom-0 -mx-6 mt-8 flex items-center gap-2 border-t border-line bg-bg px-6 py-4">
        <PrimaryButton onPress={() => void save()} disabled={busy || plan.streaming}>
          <Save size={14} strokeWidth={1.75} />
          Save
        </PrimaryButton>
        <SecondaryButton onPress={() => setView('story')} disabled={busy}>
          Cancel
        </SecondaryButton>
        <span className="ml-auto text-xs text-text-low">
          {createdId !== null ? 'Draft saved on the server' : ''}
        </span>
      </div>
    </>
  );
}

// ---- campaign-edit -----------------------------------------------------------

export function CampaignEditPage(): ReactNode {
  const { viewCampaignId, campaigns, setView, switchCampaign, upsertCampaignLocal, forgetCampaign } =
    useActiveCampaign();
  const targetId = viewCampaignId ?? campaigns[0]?.id ?? null;

  // Prefill from the local list immediately, then re-read authoritative state.
  const initial = targetId === null ? null : (campaigns.find((c) => c.id === targetId) ?? null);
  const [loaded, setLoaded] = useState<Campaign | null>(initial);
  const [values, setValues] = useState<FormValues>(() =>
    initial === null
      ? EMPTY_FORM
      : {
          title: initial.title,
          premise: initial.premise,
          persona: initial.playerPersona,
          location: initial.sceneState.location,
        },
  );
  const [planText, setPlanText] = useState(initial?.sessionPlan ?? '');
  const [errors, setErrors] = useState<{ title?: string; premise?: string }>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Once the user edits anything the authoritative re-read must not clobber it.
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (targetId === null) return;
    let cancelled = false;
    api
      .getCampaign(targetId)
      .then((fresh) => {
        if (cancelled) return;
        setLoaded(fresh);
        if (!dirtyRef.current) {
          setValues(toForm(fresh));
          setPlanText(fresh.sessionPlan);
        }
      })
      .catch(() => {
        // keep the local-list prefill on failure
      });
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  const changeValues = (next: FormValues): void => {
    dirtyRef.current = true;
    setValues(next);
  };

  const { plan, startPlan, stopPlan } = usePlanStream();

  if (targetId === null || loaded === null) {
    return (
      <>
        <PageHeader title="Edit campaign" />
        <p className="text-sm text-text-low">That campaign no longer exists.</p>
      </>
    );
  }

  const validate = (): boolean => {
    const next: { title?: string; premise?: string } = {};
    if (values.title.trim().length === 0) next.title = 'Title is required.';
    if (values.premise.trim().length === 0) next.premise = 'Premise is required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const regenerate = async (): Promise<void> => {
    if (!validate() || busy || plan.streaming) return;
    setSaveError(null);
    await startPlan(
      loaded.id,
      { title: values.title.trim(), premise: values.premise.trim(), playerPersona: values.persona.trim() },
      (prose) => setPlanText(prose),
    );
  };

  const save = async (): Promise<void> => {
    if (!validate() || busy || plan.streaming) return;
    setBusy(true);
    setSaveError(null);
    try {
      // PUT preserves turns / memories / id / createdAt server-side.
      const saved = await api.updateCampaign(loaded.id, {
        title: values.title.trim(),
        premise: values.premise.trim(),
        playerPersona: values.persona.trim(),
        sessionPlan: planText,
        sceneState: {
          location: values.location.trim(),
          presentNpcIds: loaded.sceneState.presentNpcIds,
        },
      });
      upsertCampaignLocal(saved);
      switchCampaign(saved.id);
      setView('story');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await api.deleteCampaign(loaded.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      return;
    }
    forgetCampaign(loaded.id);
    setView('story');
  };

  return (
    <>
      <PageHeader
        title="Edit campaign"
        description="Changes keep every turn and memory already recorded."
      />

      <Section title="Campaign">
        <CampaignFields values={values} onChange={changeValues} />
        {errors.title !== undefined && (
          <p className="mt-2 text-xs text-accent-red">{errors.title}</p>
        )}
        {errors.premise !== undefined && (
          <p className="mt-2 text-xs text-accent-red">{errors.premise}</p>
        )}
      </Section>

      <Section title="Session plan">
        {plan.streaming ? (
          <PlanPreview plan={plan} onStop={stopPlan} />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <ConfirmAction
                label="Regenerate plan"
                icon={Sparkles}
                tone="neutral"
                confirmLabel="Overwrite"
                message="Generating a new plan overwrites the current session plan text."
                onConfirm={() => void regenerate()}
                disabled={busy}
              />
              {planText !== loaded.sessionPlan && loaded.sessionPlan.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPlanText(loaded.sessionPlan)}
                  className="text-xs text-text-low transition-colors hover:text-text-mid hover:underline"
                >
                  Restore saved plan
                </button>
              )}
            </div>
            <div className="mt-3">
              <TextArea
                value={planText}
                rows={10}
                onChange={(e) => setPlanText(e.target.value)}
              />
              {plan.error !== null && (
                <p className="mt-2 text-xs text-accent-red">{plan.error}</p>
              )}
            </div>
          </>
        )}
      </Section>

      {saveError !== null && <p className="mt-4 text-xs text-accent-red">{saveError}</p>}

      <div className="sticky bottom-0 -mx-6 mt-8 flex items-center gap-2 border-t border-line bg-bg px-6 py-4">
        <PrimaryButton onPress={() => void save()} disabled={busy || plan.streaming}>
          <Save size={14} strokeWidth={1.75} />
          Save
        </PrimaryButton>
        <SecondaryButton onPress={() => setView('story')} disabled={busy}>
          Cancel
        </SecondaryButton>
      </div>

      <section className="pt-8">
        <SectionLabel>Danger zone</SectionLabel>
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-accent-red/25 p-4">
          <p className="text-xs leading-relaxed text-text-mid">
            Deleting removes the campaign with all of its turns, memories and NPCs.
          </p>
          <div>
            <ConfirmAction
              label="Delete campaign"
              message={`Delete "${loaded.title || 'Untitled'}" permanently?`}
              confirmLabel="Delete"
              onConfirm={() => void remove()}
              disabled={busy}
            />
          </div>
        </div>
      </section>
    </>
  );
}

function toForm(c: Campaign): FormValues {
  return {
    title: c.title,
    premise: c.premise,
    persona: c.playerPersona,
    location: c.sceneState.location,
  };
}
