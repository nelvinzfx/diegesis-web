# UI and theme

Dark-only. Pure black canvas, structure from layout and hairlines.

## Philosophy

Structure comes from **layout, spacing, and hairlines**, not from big
grey surfaces or colored chrome. Vercel-style: content floats on pure
black; a single white-alpha border separates panels; elevation is
expressed by slightly lighter surface steps, used sparingly. Accents
are semantic only: color always means something (mechanics, NPC,
danger, success) — it is never decoration.

## Token table (single source of truth)

Defined once as CSS variables (`web/src/index.css`, `--dg-*`) and
exposed as Tailwind v4 `@theme` tokens. HeroUI's dark theme variables
are remapped onto these same tokens.

| Token | CSS var | Value | Use |
|---|---|---|---|
| `bg` | `--dg-bg` | `#000000` | page + app canvas, PURE black |
| `surface-1` | `--dg-surface-1` | `#0A0A0A` | cards |
| `surface-2` | `--dg-surface-2` | `#111113` | overlays, popovers |
| `surface-3` | `--dg-surface-3` | `#17171A` | inputs, hover fills |
| `line` | `--dg-line` | `rgba(255,255,255,0.08)` | default hairline borders/separators |
| `line-strong` | `--dg-line-strong` | `rgba(255,255,255,0.14)` | emphasized hairlines, focus edges |
| `text-hi` | `--dg-text-hi` | `#FAFAFA` | primary text |
| `text-mid` | `--dg-text-mid` | `#A1A1AA` | secondary text |
| `text-low` | `--dg-text-low` | `#52525B` | muted text, placeholders |
| `accent-amber` | `--dg-accent-amber` | `#FFB020` | mechanics/dice only |
| `accent-cyan` | `--dg-accent-cyan` | `#22D3EE` | NPC-related UI only |
| `accent-red` | `--dg-accent-red` | `#F87171` | danger/destructive only |
| `accent-green` | `--dg-accent-green` | `#34D399` | success/confirmation only |

Tailwind utilities generated from these: `bg-bg`, `bg-surface-1`,
`border-line`, `border-line-strong`, `text-text-hi`, `text-text-mid`,
`text-text-low`, `text-accent-amber`, etc.

## Rules

- Dark mode only. No theme toggle, no light palette anywhere.
- Borders are WHITE ALPHA hairlines only (`line` / `line-strong`).
  Never solid grey borders (`border-zinc-*`, `border-neutral-*`,
  `gray-*` are banned in component code).
- Backgrounds never lighter than `surface-3`.
- Accent colors appear only when semantically justified (dice badge =
  amber, NPC chip = cyan, delete = red, saved = green).
- No em-dashes in UI copy. Use commas, colons, or separate sentences.
- Primary action buttons: white fill on black text (HeroUI accent
  remapped accordingly), not a brand color.

## HeroUI integration

HeroUI v3 is CSS-variable themed. `index.css` imports
`@heroui/styles` after `tailwindcss`, then `[data-theme="dark"]`
overrides map HeroUI semantics onto Diegesis tokens:
`--background` -> `bg`, `--foreground` -> `text-hi`, `--surface` ->
`surface-1`, `--overlay` -> `surface-2`, `--field-background` ->
`surface-1`, `--border`/`--separator` -> `line`, `--accent` ->
white-on-black primary, `--success`/`--warning`/`--danger` ->
green/amber/red. The app root sets `class="dark" data-theme="dark"`;
there is no runtime switching code.

## Component conventions
### Radius scale (locked)

Exactly four radii exist in the app. Never introduce `rounded-sm`,
`rounded-md`, or raw pixel values.

| Class | Radius | Used for |
| --- | --- | --- |
| `rounded-2xl` | 16px | the story input bar shell only (hero element) |
| `rounded-xl` | 12px | cards, panels, page sections, popover surfaces, toolbar group containers |
| `rounded-lg` | 8px | buttons, icon buttons, inputs (controls sit one radius step inside their container) |
| `rounded-full` | pill | chips, circular icon buttons (send/stop), pills, dots |


- Cards: `bg-surface-1`, `border border-line`, radius `rounded-lg`,
  no shadows on static layouts (shadows reserved for true overlays).
- Separators between list rows: `divide-y divide-line` or explicit
  `<div className="h-px bg-line">`, not heavier rules.
- Page gutter: generous padding; content max-width for reading views.
- Text hierarchy by token + size only; no bold-everything.
