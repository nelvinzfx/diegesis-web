/**
 * BYOK settings page. The GET view never echoes keys (only *Set flags), so
 * key inputs start empty; a field left empty is OMITTED from the PUT payload
 * and the stored key survives. The server additionally treats empty-string
 * key fields as "unchanged", but omission is the honest client shape.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Eye, EyeOff, Save } from 'lucide-react';

import {
  InlineNote,
  PageHeader,
  PrimaryButton,
  SectionLabel,
  SelectInput,
  TextInput,
} from '../components/common';
import { buildSettingsPayload, updateSettings, type SettingsFormState } from '../lib/api';
import type { PublicSettingsView } from '../lib/types';
import { useActiveCampaign } from '../state/ActiveCampaignContext';

const MIN_TOKENS = 512;
const EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;

interface FormStrings {
  openaiBaseUrl: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  thinkProvider: string;
  thinkModel: string;
  writeProvider: string;
  writeModel: string;
  language: string;
  thinkingEffort: string;
  thinkMaxTokens: string;
  writeMaxTokens: string;
  contextWindowTokens: string;
}

function seedForm(s: PublicSettingsView): FormStrings {
  return {
    openaiBaseUrl: s.openaiBaseUrl,
    openaiApiKey: '',
    anthropicApiKey: '',
    thinkProvider: s.thinkModel.provider,
    thinkModel: s.thinkModel.model,
    writeProvider: s.writeModel.provider,
    writeModel: s.writeModel.model,
    language: s.language,
    thinkingEffort: s.thinkingEffort,
    thinkMaxTokens: String(s.thinkMaxTokens),
    writeMaxTokens: String(s.writeMaxTokens),
    contextWindowTokens: String(s.contextWindowTokens),
  };
}

/** Integer >= 512 or null when invalid. */
function parseTokenField(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed >= MIN_TOKENS ? parsed : null;
}

function KeyField({
  label,
  value,
  onChange,
  placeholder,
  isSet,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  isSet: boolean | null;
}): ReactNode {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs text-text-mid">{label}</span>
        {isSet !== null && (
          <span
            className={`font-mono text-[10px] uppercase tracking-[0.14em] ${
              isSet ? 'text-text-low' : 'text-accent-amber'
            }`}
          >
            {isSet ? 'key set' : 'not set'}
          </span>
        )}
      </div>
      <div className="relative">
        <TextInput
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="pr-9"
        />
        <button
          type="button"
          aria-label={visible ? 'Hide key' : 'Show key'}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-text-low transition-colors hover:bg-surface-2 hover:text-text-mid"
        >
          {visible ? <EyeOff size={14} strokeWidth={1.75} /> : <Eye size={14} strokeWidth={1.75} />}
        </button>
      </div>
    </div>
  );
}

function TokenField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  error: boolean;
}): ReactNode {
  return (
    <div>
      <TextInput
        value={value}
        inputMode="numeric"
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        aria-invalid={error || undefined}
        className={error ? 'border-accent-red/60' : undefined}
      />
      {error && (
        <p className="mt-1 text-[11px] text-accent-red">Integer of at least {MIN_TOKENS}.</p>
      )}
    </div>
  );
}

export function SettingsPage(): ReactNode {
  const { settings, refreshSettings } = useActiveCampaign();
  const [form, setForm] = useState<FormStrings | null>(
    settings === null ? null : seedForm(settings),
  );
  // Re-seed only while the user has not touched anything.
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (settings === null || dirtyRef.current) return;
    setForm(seedForm(settings));
  }, [settings]);

  const set = (patch: Partial<FormStrings>): void => {
    dirtyRef.current = true;
    setForm((prev) => (prev === null ? prev : { ...prev, ...patch }));
  };

  interface FieldErrors {
    thinkMaxTokens: boolean;
    writeMaxTokens: boolean;
    contextWindowTokens: boolean;
  }

  const errors = useMemo<FieldErrors>(() => {
    if (form === null) {
      return { thinkMaxTokens: false, writeMaxTokens: false, contextWindowTokens: false };
    }
    return {
      thinkMaxTokens: parseTokenField(form.thinkMaxTokens) === null,
      writeMaxTokens: parseTokenField(form.writeMaxTokens) === null,
      contextWindowTokens: parseTokenField(form.contextWindowTokens) === null,
    };
  }, [form]);

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    [],
  );

  if (form === null) {
    return (
      <>
        <PageHeader title="Settings" />
        <p className="text-sm text-text-low">Settings are unavailable right now.</p>
      </>
    );
  }

  const invalid =
    errors.thinkMaxTokens || errors.writeMaxTokens || errors.contextWindowTokens;

  const save = async (): Promise<void> => {
    if (invalid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload: SettingsFormState = {
        openaiBaseUrl: form.openaiBaseUrl.trim(),
        // Empty key fields stay out of the payload entirely.
        openaiApiKey: form.openaiApiKey,
        anthropicApiKey: form.anthropicApiKey,
        thinkModel: { provider: form.thinkProvider, model: form.thinkModel.trim() },
        writeModel: { provider: form.writeProvider, model: form.writeModel.trim() },
        language: form.language.trim(),
        thinkingEffort: form.thinkingEffort,
        thinkMaxTokens: parseTokenField(form.thinkMaxTokens) as number,
        writeMaxTokens: parseTokenField(form.writeMaxTokens) as number,
        contextWindowTokens: parseTokenField(form.contextWindowTokens) as number,
      };
      await updateSettings(buildSettingsPayload(payload) as Parameters<typeof updateSettings>[0]);
      await refreshSettings();
      dirtyRef.current = false;
      setSavedAt(Date.now());
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSavedAt(null), 2500);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Settings"
        description="Bring your own keys. Nothing leaves this server except model calls."
      />

      {/* Providers */}
      <section className="pt-6 first:pt-0">
        <SectionLabel>Providers</SectionLabel>
        <div className="mt-3 flex flex-col gap-4">
          <label className="block">
            <span className="mb-1.5 block text-xs text-text-mid">
              OpenAI-compatible base URL
            </span>
            <TextInput
              value={form.openaiBaseUrl}
              onChange={(e) => set({ openaiBaseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
            />
          </label>
          <KeyField
            label="OpenAI API key"
            value={form.openaiApiKey}
            onChange={(v) => set({ openaiApiKey: v })}
            placeholder={settings?.openaiKeySet ? 'Leave empty to keep the stored key' : 'sk-...'}
            isSet={settings === null ? null : settings.openaiKeySet}
          />
          <KeyField
            label="Anthropic API key"
            value={form.anthropicApiKey}
            onChange={(v) => set({ anthropicApiKey: v })}
            placeholder={
              settings?.anthropicKeySet ? 'Leave empty to keep the stored key' : 'sk-ant-...'
            }
            isSet={settings === null ? null : settings.anthropicKeySet}
          />
          <p className="text-[11px] leading-relaxed text-text-low">
            Keys are redacted server side and never echoed back. Leave a key field empty to keep
            the stored value; type to replace it.
          </p>
        </div>
      </section>

      {/* Models */}
      <section className="pt-8">
        <SectionLabel>Models</SectionLabel>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-3">
            <span className="text-xs font-medium text-text-hi">Think model</span>
            <SelectInput
              value={form.thinkProvider}
              onChange={(e) => set({ thinkProvider: e.target.value })}
              aria-label="Think model provider"
            >
              <option value="openai-compat">openai</option>
              <option value="anthropic">anthropic</option>
            </SelectInput>
            <TextInput
              value={form.thinkModel}
              onChange={(e) => set({ thinkModel: e.target.value })}
              placeholder="model id"
              aria-label="Think model id"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-col gap-3">
            <span className="text-xs font-medium text-text-hi">Write model</span>
            <SelectInput
              value={form.writeProvider}
              onChange={(e) => set({ writeProvider: e.target.value })}
              aria-label="Write model provider"
            >
              <option value="openai-compat">openai</option>
              <option value="anthropic">anthropic</option>
            </SelectInput>
            <TextInput
              value={form.writeModel}
              onChange={(e) => set({ writeModel: e.target.value })}
              placeholder="model id"
              aria-label="Write model id"
              spellCheck={false}
            />
          </div>
        </div>
      </section>

      {/* Story */}
      <section className="pt-8">
        <SectionLabel>Story</SectionLabel>
        <div className="mt-3 flex flex-col gap-1.5">
          <label className="block">
            <span className="mb-1.5 block text-xs text-text-mid">Language</span>
            <TextInput
              value={form.language}
              onChange={(e) => set({ language: e.target.value })}
              placeholder="English"
            />
          </label>
          <p className="text-[11px] leading-relaxed text-text-low">
            Narration language. Dialogue follows each character&apos;s background.
          </p>
        </div>
      </section>

      {/* Thinking effort */}
      <section className="pt-8">
        <SectionLabel>Thinking effort</SectionLabel>
        <div className="mt-3 inline-flex rounded-lg border border-line bg-surface-1 p-1">
          {EFFORTS.map((effort) => {
            const selected = form.thinkingEffort === effort;
            return (
              <button
                key={effort}
                type="button"
                onClick={() => set({ thinkingEffort: effort })}
                aria-pressed={selected}
                className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                  selected
                    ? 'bg-text-hi font-medium text-black'
                    : 'text-text-mid hover:text-text-hi'
                }`}
              >
                {effort}
              </button>
            );
          })}
        </div>
      </section>

      {/* Generation */}
      <section className="pt-8">
        <SectionLabel>Generation</SectionLabel>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs text-text-mid">Think max tokens</span>
            <TokenField
              label="Think max tokens"
              value={form.thinkMaxTokens}
              onChange={(v) => set({ thinkMaxTokens: v })}
              error={errors.thinkMaxTokens}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-text-mid">Write max tokens</span>
            <TokenField
              label="Write max tokens"
              value={form.writeMaxTokens}
              onChange={(v) => set({ writeMaxTokens: v })}
              error={errors.writeMaxTokens}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-text-mid">Context window</span>
            <TokenField
              label="Context window"
              value={form.contextWindowTokens}
              onChange={(v) => set({ contextWindowTokens: v })}
              error={errors.contextWindowTokens}
            />
          </label>
        </div>
      </section>

      {/* Save */}
      <div className="sticky bottom-0 -mx-6 mt-10 border-t border-line bg-bg px-6 py-4">
        <div className="flex items-center gap-4">
          <PrimaryButton onPress={() => void save()} disabled={invalid || saving}>
            <Save size={14} strokeWidth={1.75} />
            Save
          </PrimaryButton>
          {savedAt !== null && <InlineNote tone="success">Settings saved.</InlineNote>}
          {saveError !== null && <InlineNote tone="error">{saveError}</InlineNote>}
        </div>
      </div>
    </>
  );
}
