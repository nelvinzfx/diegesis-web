/**
 * BYOK settings page, provider-first.
 *
 * ONE global provider choice (openai-compat | anthropic) picked via two big
 * selector cards; only the active provider's connection fields render below.
 * Models are plain id strings under the flat schema. The GET view never
 * echoes keys (only *Set flags), so key inputs start empty; a field left
 * empty is OMITTED from the PUT payload and the stored key survives.
 *
 * HeroUI v3 components (Card, Chip, Input, InputGroup, Button) styled with
 * the Diegesis tokens per docs/ui-theme.md: hairlines, four radii, lucide.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Button, Card, Chip, Input, InputGroup } from '@heroui/react';
import { CheckCircle2, Cpu, Eye, EyeOff, Globe, Save } from 'lucide-react';

import { InlineNote, PageHeader, SectionLabel } from '../components/common';
import { buildSettingsPayload, updateSettings, type SettingsFormState } from '../lib/api';
import type { PublicSettingsView, SettingsProvider } from '../lib/types';
import { useActiveCampaign } from '../state/ActiveCampaignContext';

const MIN_TOKENS = 512;
const EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;

const FIELD_CLASSES =
  'h-9 w-full rounded-lg border border-line bg-surface-1 px-3 text-sm text-text-hi ' +
  'transition-colors placeholder:text-text-low focus:border-line-strong';

interface FormStrings {
  provider: SettingsProvider;
  openaiBaseUrl: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  thinkModel: string;
  writeModel: string;
  language: string;
  thinkingEffort: string;
  writeMaxTokens: string;
  contextWindowTokens: string;
}

function seedForm(s: PublicSettingsView): FormStrings {
  return {
    provider: s.provider,
    openaiBaseUrl: s.openaiBaseUrl,
    openaiApiKey: '',
    anthropicApiKey: '',
    thinkModel: s.thinkModel,
    writeModel: s.writeModel,
    language: s.language,
    thinkingEffort: s.thinkingEffort,
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

/** One of the two big provider selector cards. */
function ProviderCard({
  title,
  description,
  icon: Icon,
  selected,
  onSelect,
}: {
  title: string;
  description: string;
  icon: typeof Globe;
  selected: boolean;
  onSelect: () => void;
}): ReactNode {
  return (
    <Card
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`cursor-pointer gap-2 rounded-xl p-4 shadow-none outline-none transition-colors ${
        selected
          ? 'border border-line-strong bg-surface-2'
          : 'border border-line bg-surface-1 opacity-70 hover:opacity-100'
      }`}
    >
      <div className="flex items-center justify-between">
        <Icon
          size={18}
          strokeWidth={1.75}
          className={selected ? 'text-text-hi' : 'text-text-low'}
        />
        {selected && (
          <CheckCircle2 size={15} strokeWidth={1.75} className="text-text-hi" />
        )}
      </div>
      <div className={`text-sm font-medium ${selected ? 'text-text-hi' : 'text-text-mid'}`}>
        {title}
      </div>
      <p className="text-[11px] leading-relaxed text-text-low">{description}</p>
    </Card>
  );
}

/** Password input with visibility toggle and a "key set" status chip. */
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
          <Chip
            className={`rounded-full border bg-transparent px-2 py-0 font-mono text-[10px] uppercase tracking-[0.14em] ${
              isSet ? 'border-line text-text-low' : 'border-accent-amber/40 text-accent-amber'
            }`}
          >
            {isSet ? 'key set' : 'not set'}
          </Chip>
        )}
      </div>
      <InputGroup
        fullWidth
        className="rounded-lg border border-line bg-surface-1 shadow-none focus-within:border-line-strong"
      >
        <InputGroup.Input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-label={label}
          className="h-9 py-0 text-sm text-text-hi placeholder:text-text-low"
        />
        <InputGroup.Suffix className="border-l-0 px-1">
          <button
            type="button"
            aria-label={visible ? 'Hide key' : 'Show key'}
            onClick={() => setVisible((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-low transition-colors hover:bg-surface-2 hover:text-text-mid"
          >
            {visible ? (
              <EyeOff size={14} strokeWidth={1.75} />
            ) : (
              <Eye size={14} strokeWidth={1.75} />
            )}
          </button>
        </InputGroup.Suffix>
      </InputGroup>
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
      <Input
        value={value}
        inputMode="numeric"
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        aria-invalid={error || undefined}
        fullWidth
        className={`${FIELD_CLASSES} ${error ? 'border-accent-red/60' : ''}`}
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
    writeMaxTokens: boolean;
    contextWindowTokens: boolean;
  }

  const errors = useMemo<FieldErrors>(() => {
    if (form === null) {
      return { writeMaxTokens: false, contextWindowTokens: false };
    }
    return {
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

  const invalid = errors.writeMaxTokens || errors.contextWindowTokens;
  const openai = form.provider === 'openai-compat';

  const save = async (): Promise<void> => {
    if (invalid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload: SettingsFormState = {
        provider: form.provider,
        openaiBaseUrl: form.openaiBaseUrl.trim(),
        // Empty key fields stay out of the payload entirely.
        openaiApiKey: form.openaiApiKey,
        anthropicApiKey: form.anthropicApiKey,
        thinkModel: form.thinkModel.trim(),
        writeModel: form.writeModel.trim(),
        language: form.language.trim(),
        thinkingEffort: form.thinkingEffort,
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

      {/* Provider */}
      <section className="pt-6 first:pt-0">
        <SectionLabel>Provider</SectionLabel>
        <div
          role="radiogroup"
          aria-label="Provider"
          className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <ProviderCard
            title="OpenAI compatible"
            description="Any /v1 chat completions endpoint: OpenAI, gateways, local servers."
            icon={Globe}
            selected={openai}
            onSelect={() => set({ provider: 'openai-compat' })}
          />
          <ProviderCard
            title="Anthropic compatible"
            description="Claude models through the official Anthropic API."
            icon={Cpu}
            selected={!openai}
            onSelect={() => set({ provider: 'anthropic' })}
          />
        </div>

        {/* Active provider connection: only its fields exist in the DOM. */}
        <Card
          key={form.provider}
          className="mt-3 gap-4 rounded-xl border border-line bg-surface-1 p-4 shadow-none"
        >
          {openai ? (
            <>
              <label className="block">
                <span className="mb-1.5 block text-xs text-text-mid">Base URL</span>
                <Input
                  value={form.openaiBaseUrl}
                  onChange={(e) => set({ openaiBaseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  spellCheck={false}
                  fullWidth
                  className={FIELD_CLASSES}
                />
              </label>
              <KeyField
                label="OpenAI API key"
                value={form.openaiApiKey}
                onChange={(v) => set({ openaiApiKey: v })}
                placeholder={
                  settings?.openaiKeySet ? 'Leave empty to keep the stored key' : 'sk-...'
                }
                isSet={settings === null ? null : settings.openaiKeySet}
              />
            </>
          ) : (
            <KeyField
              label="Anthropic API key"
              value={form.anthropicApiKey}
              onChange={(v) => set({ anthropicApiKey: v })}
              placeholder={
                settings?.anthropicKeySet ? 'Leave empty to keep the stored key' : 'sk-ant-...'
              }
              isSet={settings === null ? null : settings.anthropicKeySet}
            />
          )}
          <p className="text-[11px] leading-relaxed text-text-low">
            Keys are redacted server side and never echoed back. Leave the key field empty to
            keep the stored value; type to replace it.
          </p>
        </Card>
      </section>

      {/* Models */}
      <section className="pt-8">
        <SectionLabel>Models</SectionLabel>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs text-text-mid">Think model</span>
            <Input
              value={form.thinkModel}
              onChange={(e) => set({ thinkModel: e.target.value })}
              placeholder="model id"
              aria-label="Think model id"
              spellCheck={false}
              fullWidth
              className={FIELD_CLASSES}
            />
            <p className="mt-1 text-[11px] text-text-low">Used for planning and routing.</p>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-text-mid">Write model</span>
            <Input
              value={form.writeModel}
              onChange={(e) => set({ writeModel: e.target.value })}
              placeholder="model id"
              aria-label="Write model id"
              spellCheck={false}
              fullWidth
              className={FIELD_CLASSES}
            />
            <p className="mt-1 text-[11px] text-text-low">Writes the scene prose.</p>
          </label>
        </div>
      </section>

      {/* Story */}
      <section className="pt-8">
        <SectionLabel>Story</SectionLabel>
        <div className="mt-3 flex flex-col gap-1.5">
          <label className="block">
            <span className="mb-1.5 block text-xs text-text-mid">Language</span>
            <Input
              value={form.language}
              onChange={(e) => set({ language: e.target.value })}
              placeholder="English"
              fullWidth
              className={FIELD_CLASSES}
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
        <div className="mt-3 grid grid-cols-2 gap-3">
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
          <Button
            variant="primary"
            size="sm"
            isDisabled={invalid || saving}
            onClick={() => void save()}
            className="h-9 gap-1.5 rounded-lg bg-text-hi px-3 text-sm font-medium text-black hover:bg-text-hi/85"
          >
            <Save size={14} strokeWidth={1.75} />
            Save
          </Button>
          {savedAt !== null && <InlineNote tone="success">Settings saved.</InlineNote>}
          {saveError !== null && <InlineNote tone="error">{saveError}</InlineNote>}
        </div>
      </div>
    </>
  );
}
