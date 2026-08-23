/**
 * Director's booth shell: left nav rail (collapsible), center reading
 * column, right inspector panel (~340px inline at >=1280px, overlay drawer
 * below). Below 768px the rail collapses to icon-only.
 */

import { useEffect, useState, type ReactNode } from 'react';

import { PanelLeft, PanelRight, X } from 'lucide-react';

import { cn } from './lib/cn';
import { useMediaQuery } from './lib/useMediaQuery';
import { InspectorPanel } from './components/InspectorPanel';
import { PlaceholderPage } from './components/PlaceholderPage';
import { RailNav } from './components/RailNav';
import { StoryScreen } from './components/StoryScreen';
import { ActiveCampaignProvider, useActiveCampaign } from './state/ActiveCampaignContext';

const RAIL_COLLAPSED_KEY = 'diegesis.railCollapsed';

function Shell(): ReactNode {
  const { view, streaming } = useActiveCampaign();
  const wide = useMediaQuery('(min-width: 1280px)');
  const md = useMediaQuery('(min-width: 768px)');
  const [railCollapsedStored, setRailCollapsedStored] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(RAIL_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [inspectorOpen, setInspectorOpen] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(RAIL_COLLAPSED_KEY, railCollapsedStored ? '1' : '0');
    } catch {
      // storage disabled
    }
  }, [railCollapsedStored]);

  const railCollapsed = !md || railCollapsedStored;

  return (
    <div className="flex h-full bg-bg">
      <RailNav collapsed={railCollapsed} onToggleCollapsed={() => setRailCollapsedStored((c) => !c)} />

      {/* Center column */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Floating controls (top-right of the stage area) */}
        <div className="absolute right-3 top-3 z-20 flex items-center gap-1">
          {!md && (
            <button
              type="button"
              aria-label="Expand sidebar"
              onClick={() => setRailCollapsedStored(false)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-low transition-colors hover:bg-surface-2 hover:text-text-mid"
            >
              <PanelLeft size={15} />
            </button>
          )}
          {!wide && (
            <button
              type="button"
              aria-label="Toggle inspector"
              onClick={() => setInspectorOpen((o) => !o)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-surface-2',
                inspectorOpen ? 'bg-surface-2 text-text-hi' : 'text-text-low hover:text-text-mid',
              )}
            >
              <PanelRight size={15} />
            </button>
          )}
        </div>

        {view === 'story' ? <StoryScreen /> : (
          <PlaceholderPage view={view} />
        )}

        {/* Inspector as overlay drawer below 1280px */}
        {!wide && inspectorOpen && (
          <div className="absolute inset-0 z-30">
            <button
              type="button"
              aria-label="Close inspector overlay"
              onClick={() => setInspectorOpen(false)}
              className="absolute inset-0 bg-black/60"
            />
            <aside className="absolute inset-y-0 right-0 flex w-[340px] max-w-[92vw] flex-col border-l border-line bg-bg">
              <DrawerHeader onClose={() => setInspectorOpen(false)} title="Inspector" live={streaming !== null} />
              <div className="min-h-0 flex-1">
                <InspectorPanel />
              </div>
            </aside>
          </div>
        )}
      </main>

      {/* Inspector inline at >=1280px */}
      {wide && (
        <aside className="hidden h-full w-[340px] shrink-0 border-l border-line bg-bg xl:flex xl:flex-col">
          <InlineHeader live={streaming !== null} />
          <div className="min-h-0 flex-1">
            <InspectorPanel />
          </div>
        </aside>
      )}
    </div>
  );
}

function DrawerHeader({ title, onClose, live }: { title: string; onClose: () => void; live: boolean }): ReactNode {
  return (
    <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-low">
        {title}
        {live ? ' · live' : ''}
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close inspector"
        className="flex h-6 w-6 items-center justify-center rounded-md text-text-low transition-colors hover:bg-surface-2 hover:text-text-hi"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function InlineHeader({ live }: { live: boolean }): ReactNode {
  return (
    <div className="shrink-0 px-4 pt-5 pb-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-low">
        Inspector{live ? ' · live' : ''}
      </span>
    </div>
  );
}

export default function App(): ReactNode {
  return (
    <ActiveCampaignProvider>
      <Shell />
    </ActiveCampaignProvider>
  );
}

