/**
 * NPC manager: present-in-scene toggles, the full roster with inline editor,
 * and character-card import (JSON file, PNG card file, or pasted JSON).
 */

import { useRef, useState, type ReactNode } from 'react';

import { CheckCircle2, FileUp, PencilLine, Plus, Sparkles, X } from 'lucide-react';

import {
  ConfirmAction,
  IconActionButton,
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
import type { Npc } from '../lib/types';
import { useActiveCampaign } from '../state/ActiveCampaignContext';

// ---- presence chips ----------------------------------------------------------

function PresenceChips(): ReactNode {
  const { campaign, npcs, npcNameById, upsertCampaignLocal } = useActiveCampaign();
  const [error, setError] = useState<string | null>(null);

  if (campaign === null) return null;
  const present = campaign.sceneState.presentNpcIds;

  // Every known NPC plus any recorded id without a stored card.
  const chipIds = npcs.map((n) => n.id);
  for (const id of present) if (!chipIds.includes(id)) chipIds.push(id);

  const toggle = async (id: string): Promise<void> => {
    if (campaign === null) return;
    const next = present.includes(id)
      ? present.filter((x) => x !== id)
      : [...present, id];
    setError(null);
    try {
      const updated = await api.updateCampaign(campaign.id, {
        sceneState: { location: campaign.sceneState.location, presentNpcIds: next },
      });
      upsertCampaignLocal(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="pt-6 first:pt-0">
      <SectionLabel>Present in scene</SectionLabel>
      <p className="mt-2 text-xs text-text-low">
        Location:{' '}
        <span className="text-text-mid">
          {campaign.sceneState.location.length > 0 ? campaign.sceneState.location : 'unspecified'}
        </span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {chipIds.length === 0 && (
          <p className="text-xs text-text-low">
            No NPCs yet. Add or import one below, then mark who is present.
          </p>
        )}
        {chipIds.map((id) => {
          const isPresent = present.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => void toggle(id)}
              aria-pressed={isPresent}
              title={isPresent ? 'Remove from scene' : 'Add to scene'}
              className={cn(
                'max-w-full truncate rounded-full border px-3 py-1 text-xs transition-colors',
                isPresent
                  ? 'border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan'
                  : 'border-line text-text-mid hover:border-line-strong hover:text-text-hi',
              )}
            >
              {npcNameById[id] ?? id}
            </button>
          );
        })}
      </div>
      {error !== null && (
        <p className="mt-2 text-xs text-accent-red">{error}</p>
      )}
    </section>
  );
}

// ---- npc editor --------------------------------------------------------------

interface TrackerRow {
  key: string;
  value: string;
}

interface EditorState {
  npcId: string | null; // null = creating
  name: string;
  description: string;
  personality: string;
  firstMessage: string;
  voice: string; // one example per line
  goal: string;
  stance: string;
  willActOn: string;
  trackers: TrackerRow[];
}

function editorFromNpc(npc: Npc): EditorState {
  return {
    npcId: npc.id,
    name: npc.name,
    description: npc.description,
    personality: npc.personality,
    firstMessage: npc.firstMessage ?? '',
    voice: npc.voiceExamples.join('\n'),
    goal: npc.agency.goal,
    stance: npc.agency.stance,
    willActOn: npc.agency.will_act_on,
    trackers: Object.entries(npc.trackers).map(([key, value]) => ({
      key,
      value: String(value),
    })),
  };
}

const EMPTY_EDITOR: EditorState = {
  npcId: null,
  name: '',
  description: '',
  personality: '',
  firstMessage: '',
  voice: '',
  goal: '',
  stance: '',
  willActOn: '',
  trackers: [],
};

function NpcEditor({
  state,
  onCancel,
  onSaved,
}: {
  state: EditorState;
  onCancel: () => void;
  onSaved: () => void;
}): ReactNode {
  const { campaign, refreshNpcs } = useActiveCampaign();
  const [form, setForm] = useState<EditorState>(state);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<EditorState>): void =>
    setForm((prev) => ({ ...prev, ...patch }));

  const save = async (): Promise<void> => {
    if (campaign === null || busy) return;
    if (form.name.trim().length === 0) {
      setNameError('Name is required.');
      return;
    }
    setNameError(null);
    setBusy(true);
    setSaveError(null);
    const trackers: Record<string, number> = {};
    for (const row of form.trackers) {
      const key = row.key.trim();
      const value = Number.parseInt(row.value, 10);
      if (key.length > 0 && Number.isInteger(value)) trackers[key] = value;
    }
    const input = {
      name: form.name.trim(),
      description: form.description.trim(),
      personality: form.personality.trim(),
      firstMessage: form.firstMessage.trim(),
      voiceExamples: form.voice
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
      agency: {
        goal: form.goal.trim(),
        stance: form.stance.trim(),
        will_act_on: form.willActOn.trim(),
      },
      trackers,
    };
    try {
      if (form.npcId === null) await api.createNpc(campaign.id, input);
      else await api.updateNpc(campaign.id, form.npcId, input);
      await refreshNpcs();
      onSaved();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line-strong bg-surface-1 p-4">
      <SectionLabel>{form.npcId === null ? 'New NPC' : 'Edit NPC'}</SectionLabel>
      <div className="mt-3 flex flex-col gap-4">
        <label className="block">
          <span className="mb-1.5 block text-xs text-text-mid">Name</span>
          <TextInput
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            aria-invalid={nameError !== null || undefined}
            className={nameError !== null ? 'border-accent-red/60' : undefined}
          />
          {nameError !== null && <p className="mt-1 text-[11px] text-accent-red">{nameError}</p>}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs text-text-mid">Description</span>
          <TextArea
            value={form.description}
            rows={3}
            onChange={(e) => set({ description: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs text-text-mid">Personality</span>
          <TextArea
            value={form.personality}
            rows={3}
            onChange={(e) => set({ personality: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs text-text-mid">
            Voice examples <span className="text-text-low">(one per line)</span>
          </span>
          <TextArea
            value={form.voice}
            rows={3}
            onChange={(e) => set({ voice: e.target.value })}
            placeholder={'Never trust a fair wind.\nPay me first.'}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs text-text-mid">First message</span>
          <TextArea
            value={form.firstMessage}
            rows={4}
            onChange={(e) => set({ firstMessage: e.target.value })}
            placeholder="The prose shown when the story opens with this NPC present."
          />
          <span className="mt-1 block text-[11px] text-text-low">
            Used as the opening scene when this NPC leads the story.
          </span>
        </label>

        <div>
          <span className="mb-1.5 block text-xs text-text-mid">Agency</span>
          <div className="flex flex-col gap-2">
            <TextInput
              value={form.goal}
              onChange={(e) => set({ goal: e.target.value })}
              placeholder="Goal"
            />
            <TextInput
              value={form.stance}
              onChange={(e) => set({ stance: e.target.value })}
              placeholder="Stance toward the player"
            />
            <TextInput
              value={form.willActOn}
              onChange={(e) => set({ willActOn: e.target.value })}
              placeholder="Will act when..."
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs text-text-mid">Trackers</span>
            <button
              type="button"
              onClick={() => set({ trackers: [...form.trackers, { key: '', value: '0' }] })}
              className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-xs text-text-low transition-colors hover:bg-surface-2 hover:text-text-hi"
            >
              <Plus size={12} /> Add tracker
            </button>
          </div>
          {form.trackers.length > 0 && (
            <div className="flex flex-col gap-2">
              {form.trackers.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <TextInput
                    value={row.key}
                    onChange={(e) =>
                      set({
                        trackers: form.trackers.map((r, j) =>
                          j === i ? { ...r, key: e.target.value } : r,
                        ),
                      })
                    }
                    placeholder="name"
                    aria-label={`Tracker ${i + 1} name`}
                  />
                  <TextInput
                    value={row.value}
                    inputMode="numeric"
                    onChange={(e) =>
                      set({
                        trackers: form.trackers.map((r, j) =>
                          j === i ? { ...r, value: e.target.value } : r,
                        ),
                      })
                    }
                    placeholder="0"
                    aria-label={`Tracker ${i + 1} value`}
                    className="w-20 shrink-0"
                  />
                  <IconActionButton
                    icon={X}
                    label={`Remove tracker ${i + 1}`}
                    onPress={() =>
                      set({ trackers: form.trackers.filter((_, j) => j !== i) })
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {saveError !== null && <InlineNote tone="error">{saveError}</InlineNote>}

        <div className="flex items-center gap-2">
          <PrimaryButton onPress={() => void save()} disabled={busy}>
            Save NPC
          </PrimaryButton>
          <SecondaryButton onPress={onCancel} disabled={busy}>
            Cancel
          </SecondaryButton>
        </div>
      </div>
    </div>
  );
}

// ---- npc card ----------------------------------------------------------------

function NpcCard({
  npc,
  editing,
  onEdit,
}: {
  npc: Npc;
  editing: boolean;
  onEdit: () => void;
}): ReactNode {
  const { campaign, refreshNpcs } = useActiveCampaign();
  const [error, setError] = useState<string | null>(null);

  const remove = async (): Promise<void> => {
    if (campaign === null) return;
    setError(null);
    try {
      await api.deleteNpc(campaign.id, npc.id);
      await refreshNpcs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-medium text-text-hi">{npc.name}</h3>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconActionButton icon={PencilLine} label={`Edit ${npc.name}`} tone={editing ? 'active' : 'default'} onPress={onEdit} />
          <ConfirmAction
            label={`Delete ${npc.name}`}
            variant="icon"
            message={`Delete ${npc.name}? This cannot be undone.`}
            onConfirm={() => void remove()}
          />
        </div>
      </div>
      {npc.description.length > 0 && (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-text-mid">
          {npc.description}
        </p>
      )}
      {(npc.agency.goal.length > 0 || npc.agency.stance.length > 0) && (
        <p className="mt-2 text-[11px] leading-relaxed text-text-low">
          {npc.agency.goal.length > 0 && <span>Wants: {npc.agency.goal}. </span>}
          {npc.agency.stance.length > 0 && <span>Stance: {npc.agency.stance}. </span>}
          {npc.agency.will_act_on.length > 0 && <span>Acts when: {npc.agency.will_act_on}.</span>}
        </p>
      )}
      {Object.keys(npc.trackers).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(npc.trackers).map(([key, value]) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 rounded-lg border border-accent-amber/40 px-1.5 py-0.5 text-[11px] text-accent-amber"
            >
              {key} {value}
            </span>
          ))}
        </div>
      )}
      {error !== null && (
        <p className="mt-2 text-xs text-accent-red">{error}</p>
      )}
    </div>
  );
}

// ---- import section ----------------------------------------------------------

function ImportSection({ onImported }: { onImported: (npc: Npc) => void }): ReactNode {
  const { campaign, refreshNpcs } = useActiveCampaign();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pasteJson, setPasteJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<Npc | null>(null);

  const finishImport = async (run: () => Promise<Npc>): Promise<void> => {
    if (campaign === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const npc = await run();
      setImported(npc);
      setPasteJson('');
      setFileName(null);
      await refreshNpcs();
      onImported(npc);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onFile = (file: File): void => {
    setFileName(file.name);
    const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
    void finishImport(async () => {
      if (isPng) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        return api.importNpcPngBytes(campaign?.id ?? '', bytes);
      }
      const text = await file.text();
      return api.importNpcJson(campaign?.id ?? '', text);
    });
  };

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <SectionLabel>Import character card</SectionLabel>
      <div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center">
        <input
          ref={fileRef}
          type="file"
          accept=".json,.png,application/json,image/png"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file !== undefined) onFile(file);
          }}
        />
        <SecondaryButton onPress={() => fileRef.current?.click()} disabled={busy}>
          <FileUp size={14} strokeWidth={1.75} />
          Choose file
        </SecondaryButton>
        <span className="truncate text-xs text-text-low">
          {fileName ?? '.json card or .png with an embedded chara chunk'}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <span className="text-xs text-text-mid">Or paste JSON</span>
        <TextArea
          value={pasteJson}
          rows={4}
          onChange={(e) => setPasteJson(e.target.value)}
          placeholder='{ "name": "...", "description": "..." }'
          spellCheck={false}
        />
        <SecondaryButton
          onPress={() => void finishImport(() => api.importNpcJson(campaign?.id ?? '', pasteJson))}
          disabled={busy || pasteJson.trim().length === 0}
        >
          Import JSON
        </SecondaryButton>
      </div>

      {busy && <p className="mt-3 text-xs text-text-mid">Importing...</p>}
      {error !== null && (
        <p className="mt-3"><InlineNote tone="error">{error}</InlineNote></p>
      )}

      {imported !== null && !busy && (
        <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
          <p className="flex items-center gap-1.5 text-xs text-accent-green">
            <CheckCircle2 size={14} className="shrink-0" />
            Imported as {imported.name}
          </p>
          {imported.description.length > 0 && (
            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-text-mid">
              {imported.description}
            </p>
          )}
          <div className="mt-2 flex items-center gap-1 text-[11px] text-text-low">
            <Sparkles size={12} className="text-accent-amber" />
            Agency and trackers are editable from the roster above.
          </div>
        </div>
      )}
    </div>
  );
}

// ---- page --------------------------------------------------------------------

export function NpcsPage(): ReactNode {
  const { npcs, npcsLoading, campaign } = useActiveCampaign();
  const [editor, setEditor] = useState<{ mode: 'new' } | { mode: 'edit'; npc: Npc } | null>(null);
  const [lastImportedId, setLastImportedId] = useState<string | null>(null);

  if (campaign === null) {
    return (
      <>
        <PageHeader title="NPCs" />
        <p className="text-sm text-text-low">Create a campaign first.</p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="NPCs"
        description="Character cards, agency states and trackers. Present NPCs drive scene awareness each turn."
      />

      <PresenceChips />

      <section className="pt-8">
        <SectionLabel>All NPCs</SectionLabel>
        <div className="mt-3 flex flex-col gap-3">
          {editor?.mode === 'new' ? (
            <NpcEditor
              state={EMPTY_EDITOR}
              onCancel={() => setEditor(null)}
              onSaved={() => setEditor(null)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditor({ mode: 'new' })}
              className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-line py-4 text-sm text-text-low transition-colors hover:border-line-strong hover:text-text-mid"
            >
              <Plus size={15} strokeWidth={1.75} />
              Add NPC
            </button>
          )}

          {npcsLoading && npcs.length === 0 && (
            <p className="text-xs text-text-low">Loading...</p>
          )}

          {npcs.map((npc) =>
            editor?.mode === 'edit' && editor.npc.id === npc.id ? (
              <NpcEditor
                key={npc.id}
                state={editorFromNpc(npc)}
                onCancel={() => setEditor(null)}
                onSaved={() => setEditor(null)}
              />
            ) : (
              <NpcCard
                key={npc.id}
                npc={npc}
                editing={lastImportedId === npc.id}
                onEdit={() => setEditor({ mode: 'edit', npc })}
              />
            ),
          )}

          {!npcsLoading && npcs.length === 0 && editor === null && (
            <p className="text-xs text-text-low">
              No NPCs yet. Add one by hand or import a character card below.
            </p>
          )}
        </div>
      </section>

      <section className="pt-8 pb-4">
        <ImportSection onImported={(npc) => setLastImportedId(npc.id)} />
      </section>
    </>
  );
}
