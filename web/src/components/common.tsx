/**
 * Small shared UI atoms: tooltip-wrapped icon buttons used across the rail,
 * turn toolbars and the inspector. Hairline styling only, no solid borders.
 */

import type { ReactNode } from 'react';

import { Tooltip } from '@heroui/react';
import type { LucideIcon } from 'lucide-react';

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
