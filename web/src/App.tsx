import { useState } from 'react';
import { Button } from '@heroui/react';

interface Swatch {
  token: string;
  value: string;
  className: string;
}

const surfaces: Swatch[] = [
  { token: 'bg', value: '#000000', className: 'bg-bg border border-line' },
  { token: 'surface-1', value: '#0A0A0A', className: 'bg-surface-1' },
  { token: 'surface-2', value: '#111113', className: 'bg-surface-2' },
  { token: 'surface-3', value: '#17171A', className: 'bg-surface-3' },
];

const lines: Swatch[] = [
  { token: 'line', value: 'rgba(255,255,255,0.08)', className: 'bg-line' },
  { token: 'line-strong', value: 'rgba(255,255,255,0.14)', className: 'bg-line-strong' },
];

const texts: Swatch[] = [
  { token: 'text-hi', value: '#FAFAFA', className: 'bg-text-hi' },
  { token: 'text-mid', value: '#A1A1AA', className: 'bg-text-mid' },
  { token: 'text-low', value: '#52525B', className: 'bg-text-low' },
];

const accents: Swatch[] = [
  { token: 'accent-amber (mechanics)', value: '#FFB020', className: 'bg-accent-amber' },
  { token: 'accent-cyan (NPC)', value: '#22D3EE', className: 'bg-accent-cyan' },
  { token: 'accent-red (danger)', value: '#F87171', className: 'bg-accent-red' },
  { token: 'accent-green (success)', value: '#34D399', className: 'bg-accent-green' },
];

function SwatchRow({ swatch }: { swatch: Swatch }) {
  return (
    <div className="flex items-center gap-4 py-2.5">
      <span className={`h-5 w-5 shrink-0 rounded-sm ${swatch.className}`} />
      <code className="font-mono text-sm text-text-hi">{swatch.token}</code>
      <span className="ml-auto font-mono text-xs text-text-low">{swatch.value}</span>
    </div>
  );
}

function TokenGroup({ title, swatches }: { title: string; swatches: Swatch[] }) {
  return (
    <section aria-label={title}>
      <h2 className="pb-2 font-mono text-[11px] tracking-widest uppercase text-text-low">
        {title}
      </h2>
      <div className="divide-y divide-line">
        {swatches.map((s) => (
          <SwatchRow key={s.token} swatch={s} />
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [presses, setPresses] = useState(0);

  return (
    <div className="min-h-full bg-bg">
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="font-mono text-[11px] tracking-widest uppercase text-text-low">
          phase 0 scaffold
        </p>
        <h1 className="pt-2 text-3xl font-semibold tracking-tight text-text-hi">
          Diegesis
        </h1>
        <p className="max-w-md pt-2 text-sm leading-relaxed text-text-mid">
          GM campaign narrative engine. Five-stage pipeline with a hard
          visibility invariant: the scene only ever sees what the player
          character has witnessed.
        </p>

        <div className="mt-10 rounded-lg bg-surface-1 border border-line p-6 space-y-8">
          <TokenGroup title="Surfaces" swatches={surfaces} />
          <TokenGroup title="Hairlines" swatches={lines} />
          <TokenGroup title="Text" swatches={texts} />
          <TokenGroup title="Semantic accents" swatches={accents} />
        </div>

        <footer className="mt-10 flex items-center gap-4">
          <Button onPress={() => setPresses((n) => n + 1)}>
            HeroUI button works
          </Button>
          <span className="font-mono text-xs text-text-low" role="status">
            presses: {presses}
          </span>
        </footer>
      </main>
    </div>
  );
}
