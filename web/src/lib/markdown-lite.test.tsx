/**
 * Markdown-lite formatter tests: bold, italic, literal asterisks, and the
 * guarantee that output is nodes (React escapes; no HTML pass-through).
 */

import { describe, expect, it } from 'vitest';
import { isValidElement } from 'react';

import { formatInline } from './markdown-lite';

function textOf(nodes: ReturnType<typeof formatInline>): string {
  return nodes
    .map((node) => {
      if (typeof node === 'string') return node;
      if (isValidElement<{ children?: unknown }>(node)) return String(node.props.children);
      return '';
    })
    .join('');
}

describe('formatInline', () => {
  it('renders bold segments as <strong>', () => {
    const nodes = formatInline('He said **no** twice.');
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toBe('He said ');
    const strong = nodes[1];
    expect(isValidElement(strong) && strong.type === 'strong').toBe(true);
    expect(textOf(nodes)).toBe('He said no twice.');
  });

  it('renders italic segments as <em>', () => {
    const nodes = formatInline('A *quiet* room.');
    const em = nodes[1];
    expect(isValidElement(em) && em.type === 'em').toBe(true);
    expect(textOf(nodes)).toBe('A quiet room.');
  });

  it('handles bold and italic in one paragraph', () => {
    const nodes = formatInline('**Loud** and *soft*.');
    const [first, , third] = [nodes[0], nodes[1], nodes[2]];
    expect(isValidElement(first) && first.type === 'strong').toBe(true);
    expect(isValidElement(third) && third.type === 'em').toBe(true);
    expect(textOf(nodes)).toBe('Loud and soft.');
  });

  it('leaves stray asterisks and empty emphasis literal', () => {
    expect(formatInline('2 * 3 = 6')).toEqual(['2 * 3 = 6']);
    expect(formatInline('a ** b')).toEqual(['a ** b']);
    expect(formatInline('****')).toEqual(['****']);
  });

  it('never emits raw HTML (angle brackets stay text)', () => {
    const nodes = formatInline('<script>alert(1)</script> **x**');
    expect(nodes[0]).toBe('<script>alert(1)</script> ');
    expect(textOf(nodes)).toBe('<script>alert(1)</script> x');
  });

  it('returns the whole string when there is no emphasis', () => {
    expect(formatInline('plain text')).toEqual(['plain text']);
    expect(formatInline('')).toEqual([]);
  });
});
