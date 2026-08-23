/**
 * Left nav rail: app identity, active campaign summary, primary nav,
 * campaign switcher at the bottom. ~220px expanded, 56px icon-only.
 */

import { useState, type ReactNode } from 'react';

import { BookOpen, Braces, Brain, ChevronsLeft, PencilLine, Plus, Settings, Users } from 'lucide-react';

import { cn } from '../lib/cn';
import type { ViewId } from '../state/ActiveCampaignContext';
import { useActiveCampaign } from '../state/ActiveCampaignContext';

interface NavItem {
  id: ViewId;
  label: string;
  icon: typeof BookOpen;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'story', label: 'Story', icon: BookOpen },
  { id: 'npcs', label: 'NPCs', icon: Users },
  { id: 'memories', label: 'Memories', icon: Brain },
  { id: 'prompts', label: 'Prompts', icon: Braces },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function RailNav({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}): ReactNode {
  const { view, setView, campaign, campaigns, switchCampaign, campaignsLoading } =
    useActiveCampaign();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-line bg-bg transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-[220px]',
      )}
    >
      {/* Identity */}
      <div className={cn('flex items-center gap-2 px-4 pt-5 pb-4', collapsed && 'px-0 justify-center')}>
        {!collapsed && (
          <>
            <span className="text-[17px] font-semibold tracking-tight text-text-hi">Diegesis</span>
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Collapse sidebar"
              className="ml-auto flex h-6 w-6 items-center justify-center rounded-lg text-text-low transition-colors hover:bg-surface-2 hover:text-text-mid"
            >
              <ChevronsLeft size={14} />
            </button>
          </>
        )}
        {collapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Expand sidebar"
            className="flex h-7 w-7 items-center justify-center rounded-lg font-semibold text-text-mid transition-colors hover:bg-surface-2 hover:text-text-hi"
          >
            D
          </button>
        )}
      </div>

      {/* Active campaign */}
      {!collapsed && (
        <div className="px-4 pb-3">
          <p className="truncate text-sm text-text-mid" title={campaign?.title ?? ''}>
            {campaign?.title ?? (campaignsLoading ? 'Loading...' : 'No campaign')}
          </p>
          {campaign !== null && campaign.sceneState.location.length > 0 && (
            <p className="mt-0.5 truncate text-xs text-text-low">{campaign.sceneState.location}</p>
          )}
        </div>
      )}

      {/* Nav items */}
      <ul className={cn('flex flex-col gap-0.5 px-2', collapsed && 'px-1.5')}>
        {NAV_ITEMS.map((item) => {
          const active = view === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setView(item.id)}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                  collapsed && 'justify-center px-0 py-2',
                  active
                    ? 'bg-surface-1 text-text-hi shadow-[inset_2px_0_0_0] shadow-line-strong'
                    : 'text-text-mid hover:bg-surface-1 hover:text-text-hi',
                )}
              >
                <item.icon size={16} strokeWidth={1.75} />
                {!collapsed && item.label}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex-1" />

      {/* Campaign switcher */}
      <div className={cn('border-t border-line p-2', collapsed && 'px-1.5')}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => setView('campaign-new')}
              aria-label="New campaign"
              title="New campaign"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-low transition-colors hover:bg-surface-1 hover:text-text-mid"
            >
              <Plus size={15} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => setSwitcherOpen((o) => !o)}
              aria-label="Switch campaign"
              aria-expanded={switcherOpen}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-surface-1',
                switcherOpen ? 'bg-surface-1 text-text-hi' : 'text-text-low hover:text-text-mid',
              )}
            >
              <span className="font-mono text-xs">{campaigns.length}</span>
            </button>
            {switcherOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close campaign switcher"
                  onClick={() => setSwitcherOpen(false)}
                  className="fixed inset-0 z-40 cursor-default"
                />
                <div className="fixed bottom-16 left-16 z-50 w-56 overflow-hidden rounded-xl border border-line bg-surface-1 p-1.5">
                  <ul className="max-h-60 overflow-y-auto">
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          setSwitcherOpen(false);
                          setView('campaign-new');
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-text-low transition-colors hover:bg-surface-2 hover:text-text-hi"
                      >
                        <Plus size={13} strokeWidth={1.75} />
                        New campaign
                      </button>
                    </li>
                    {campaigns.map((c) => {
                      const active = c.id === campaign?.id;
                      return (
                        <li key={c.id} className="group flex items-center">
                          <button
                            type="button"
                            onClick={() => {
                              setSwitcherOpen(false);
                              switchCampaign(c.id);
                            }}
                            className={cn(
                              'min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                              active
                                ? 'bg-surface-2 text-text-hi shadow-[inset_2px_0_0_0] shadow-line-strong'
                                : 'text-text-mid hover:bg-surface-2 hover:text-text-hi',
                            )}
                          >
                            {c.title || 'Untitled'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSwitcherOpen(false);
                              setView('campaign-edit', { campaignId: c.id });
                            }}
                            aria-label={`Edit ${c.title || 'Untitled'}`}
                            className="ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-text-low transition-colors hover:bg-surface-3 hover:text-text-hi"
                          >
                            <PencilLine size={12} strokeWidth={1.75} />
                          </button>
                        </li>
                      );
                    })}
                    {campaigns.length === 0 && (
                      <li className="px-2.5 py-1.5 text-xs text-text-low">None yet</li>
                    )}
                  </ul>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setSwitcherOpen((o) => !o)}
              className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-text-low transition-colors hover:bg-surface-1 hover:text-text-mid"
              aria-expanded={switcherOpen}
            >
              Campaigns ({campaigns.length})
            </button>
            {switcherOpen && (
              <ul className="mt-1 max-h-48 overflow-y-auto">
                <li>
                  <button
                    type="button"
                    onClick={() => setView('campaign-new')}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-text-low transition-colors hover:bg-surface-1 hover:text-text-hi"
                  >
                    <Plus size={13} strokeWidth={1.75} />
                    New
                  </button>
                </li>
                {campaigns.map((c) => {
                  const active = c.id === campaign?.id;
                  return (
                    <li key={c.id} className="group flex items-center">
                      <button
                        type="button"
                        onClick={() => switchCampaign(c.id)}
                        className={cn(
                          'min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                          active
                            ? 'bg-surface-1 text-text-hi shadow-[inset_2px_0_0_0] shadow-line-strong'
                            : 'text-text-mid hover:bg-surface-1 hover:text-text-hi',
                        )}
                      >
                        {c.title || 'Untitled'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setView('campaign-edit', { campaignId: c.id })}
                        aria-label={`Edit ${c.title || 'Untitled'}`}
                        title="Edit campaign"
                        className="ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-text-low opacity-0 transition-opacity hover:bg-surface-2 hover:text-text-hi focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <PencilLine size={12} strokeWidth={1.75} />
                      </button>
                    </li>
                  );
                })}
                {campaigns.length === 0 && (
                  <li className="px-2.5 py-1.5 text-xs text-text-low">None yet</li>
                )}
              </ul>
            )}
          </>
        )}
      </div>
    </nav>
  );
}
