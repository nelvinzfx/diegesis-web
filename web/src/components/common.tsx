/**
 * Small shared UI atoms: tooltip-wrapped icon buttons used across the rail,
 * turn toolbars and the inspector. Hairline styling only, no solid borders.
 */

import {
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { Tooltip } from '@heroui/react';
import { AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '../lib/cn';

type IconButtonTone = 'default' | 'danger' | 'active';

const toneClasses: Record<IconButtonTone, string> = {
  default: 'text-text-mid hover:text-text-hi',
  danger: 'text-accent-red hover:text-accent-red/80',
  active: 'text-text-hi bg-surface-3',
};

export function IconActionButton({
  icon: Icon,
  label,
  onPress,
  tone = 'default',
  disabled = false,
  className = '',
}: {
  icon: LucideIcon;
  label: string;
  onPress?: () => void;
  tone?: IconButtonTone;
  disabled?: boolean;
  className?: string;
}): ReactNode {
  return (
    <Tooltip delay={350}>
      <Tooltip.Trigger>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onPress}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40 ${toneClasses[tone]} ${className}`}
        >
          <Icon size={15} strokeWidth={1.75} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}

export function SectionLabel({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-low">
      {children}
    </div>
  );
}

// ---- Phase 4 shared atoms ---------------------------------------------------

/** Big page title + one-line description, top of every non-story page. */
export function PageHeader({ title, description }: { title: string; description?: string }): ReactNode {
  return (
    <div className="pb-6">
      <h1 className="text-lg font-semibold tracking-tight text-text-hi">{title}</h1>
      {description !== undefined && (
        <p className="mt-1 text-xs leading-relaxed text-text-low">{description}</p>
      )}
    </div>
  );
}

const FIELD_CLASSES =
  'w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-text-hi outline-none transition-colors placeholder:text-text-low focus:border-line-strong disabled:opacity-60';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  const { className, ...rest } = props;
  return <input {...rest} className={cn(FIELD_CLASSES, 'h-9 py-0', className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactNode {
  const { className, rows = 3, ...rest } = props;
  return <textarea {...rest} rows={rows} className={cn(FIELD_CLASSES, 'resize-y', className)} />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>): ReactNode {
  const { className, children, ...rest } = props;
  return (
    <select {...rest} className={cn(FIELD_CLASSES, 'h-9 py-0', className)}>
      {children}
    </select>
  );
}

export function PrimaryButton({
  children,
  onPress,
  disabled = false,
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}): ReactNode {
  return (
    <button
      type={type}
      onClick={onPress}
      disabled={disabled}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-lg bg-text-hi px-3 text-sm font-medium text-black transition-colors hover:bg-text-hi/85 disabled:pointer-events-none disabled:bg-surface-3 disabled:text-text-low',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onPress,
  disabled = false,
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}): ReactNode {
  return (
    <button
      type={type}
      onClick={onPress}
      disabled={disabled}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 text-sm text-text-mid transition-colors hover:border-line-strong hover:text-text-hi disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Action guarded by a small confirm popover. Renders either a labelled button
 * or an icon-only trigger; the popover floats below-right with a fixed
 * click-away layer.
 */
export function ConfirmAction({
  label,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  icon,
  variant = 'button',
  tone = 'danger',
  disabled = false,
}: {
  label: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  icon?: LucideIcon;
  variant?: 'button' | 'icon';
  tone?: 'danger' | 'neutral';
  disabled?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const close = (): void => setOpen(false);
  const danger = tone === 'danger';
  const TriggerIcon = icon;

  return (
    <span className="relative inline-flex">
      {variant === 'icon' ? (
        <IconActionButton
          icon={icon ?? Trash2}
          label={label}
          tone={danger ? 'danger' : 'default'}
          disabled={disabled}
          onPress={() => setOpen((o) => !o)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors disabled:pointer-events-none disabled:opacity-40',
            danger
              ? 'border-accent-red/40 text-accent-red hover:bg-accent-red/10'
              : 'border-line bg-surface-2 text-text-mid hover:border-line-strong hover:text-text-hi',
          )}
        >
          {TriggerIcon !== undefined && <TriggerIcon size={14} strokeWidth={1.75} />}
          {label}
        </button>
      )}
      {open && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Dismiss confirmation"
            onClick={close}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div
            role="dialog"
            aria-label={label}
            className="absolute right-0 top-full z-40 mt-2 w-64 rounded-lg border border-line bg-surface-2 p-3 shadow-lg shadow-black/60"
          >
            <p className="text-xs leading-relaxed text-text-mid">{message}</p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-lg px-2.5 py-1.5 text-xs text-text-low transition-colors hover:text-text-mid"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  onConfirm();
                }}
                className={cn(
                  'flex h-8 items-center rounded-lg px-3 text-xs font-medium text-black transition-colors',
                  danger ? 'bg-accent-red hover:bg-accent-red/85' : 'bg-text-hi hover:bg-text-hi/85',
                )}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </>
      )}
    </span>
  );
}

/** Inline status note under forms: green check or red alert. */
export function InlineNote({ tone, children }: { tone: 'success' | 'error'; children: ReactNode }): ReactNode {
  const success = tone === 'success';
  return (
    <p className="flex items-start gap-1.5 text-xs leading-relaxed">
      {success ? (
        <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-accent-green" />
      ) : (
        <AlertCircle size={14} className="mt-0.5 shrink-0 text-accent-red" />
      )}
      <span className={success ? 'text-accent-green' : 'text-accent-red'}>{children}</span>
    </p>
  );
}

/** Small neutral chip (scope badges, tracker chips). */
export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'cyan' | 'amber';
}): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center truncate rounded-md border px-1.5 py-0.5 text-[11px]',
        tone === 'cyan'
          ? 'border-accent-cyan/40 text-accent-cyan'
          : tone === 'amber'
            ? 'border-accent-amber/40 text-accent-amber'
            : 'border-line text-text-mid',
      )}
    >
      {children}
    </span>
  );
}

/** Suit name -> lucide suit icon, amber per the theme rules (mechanics only). */
export function suitLabel(suit: string): string {
  switch (suit.toLowerCase()) {
    case 'spades':
      return 'spade';
    case 'clubs':
      return 'club';
    case 'diamonds':
      return 'diamond';
    case 'hearts':
      return 'heart';
    default:
      return suit;
  }
}
