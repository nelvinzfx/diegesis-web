/** Phase 4 placeholder pages for NPCs, Memories and Settings. */

import type { LucideIcon } from 'lucide-react';
import { Brain, Settings, Users } from 'lucide-react';

import type { ReactNode } from 'react';

import type { ViewId } from '../state/ActiveCampaignContext';

const PAGES: Record<Exclude<ViewId, 'story'>, { icon: LucideIcon; sentence: string }> = {
  npcs: {
    icon: Users,
    sentence: 'NPC cards, agency states and trackers arrive with the phase 4 campaign manager.',
  },
  memories: {
    icon: Brain,
    sentence: 'Campaign and NPC memory browsing arrives with the phase 4 campaign manager.',
  },
  settings: {
    icon: Settings,
    sentence: 'API keys, model selection and context limits become editable here in phase 4.',
  },
};

export function PlaceholderPage({ view }: { view: Exclude<ViewId, 'story'> }): ReactNode {
  const page = PAGES[view];
  const Icon = page.icon;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Icon size={28} strokeWidth={1.5} className="text-text-low" />
      <p className="text-sm capitalize text-text-hi">{view}</p>
      <p className="max-w-xs text-xs leading-relaxed text-text-low">{page.sentence}</p>
    </div>
  );
}
