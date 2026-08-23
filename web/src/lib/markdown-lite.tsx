/**
 * Markdown-lite for scene prose: bold (**x**), italic (*x*), and line breaks.
 * NOTHING else — no links, no HTML, no headers. Output is plain React nodes,
 * so everything is auto-escaped by React; there is no injection surface.
 */

import type { ReactNode } from 'react';

/**
 * Format one paragraph of prose into React nodes. Callers keep splitting on
 * blank lines themselves (paragraph layout is a layout concern); this handles
 * inline emphasis inside a paragraph.
 */
export function formatInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let key = 0;

  // Tokenize: **bold** first (longer delimiter wins), then *italic*.
  // The regexes require non-empty content and no leading/trailing delimiter
  // bleed, so stray asterisks render literally.
  const pattern = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    if (match[1] !== undefined) {
      nodes.push(<strong key={key++}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      nodes.push(<em key={key++}>{match[2]}</em>);
    }
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
