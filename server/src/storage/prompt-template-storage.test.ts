import { afterAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { PromptTemplateStorage } from './prompt-template-storage.js';

const roots: string[] = [];

async function fresh(): Promise<PromptTemplateStorage> {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'diegesis-prompts-'));
  roots.push(root);
  return new PromptTemplateStorage(root);
}

afterAll(async () => {
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe('PromptTemplateStorage', () => {
  it('defaults to empty overrides when no file exists', async () => {
    const storage = await fresh();
    expect(await storage.load()).toEqual({});
    expect(await storage.get('scene')).toBeNull();
  });

  it('round-trips an override to prompt-templates.json', async () => {
    const storage = await fresh();
    await storage.set('scene', 'Custom narrator for {{playerInput}}');
    expect(await storage.load()).toEqual({ scene: 'Custom narrator for {{playerInput}}' });
    expect(await storage.get('scene')).toBe('Custom narrator for {{playerInput}}');
  });

  it('clearing writes the key out of the file (back to default)', async () => {
    const storage = await fresh();
    await storage.set('plot', 'override');
    await storage.set('scene', 'override-2');
    await storage.set('plot', null);
    expect(await storage.get('plot')).toBeNull();
    expect(await storage.get('scene')).toBe('override-2');
  });

  it('persists across instances over the same data root', async () => {
    const root = await fs.mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'diegesis-prompts-'));
    roots.push(root);
    const first = new PromptTemplateStorage(root);
    await first.set('title', 'Name this story in {{language}}');
    const second = new PromptTemplateStorage(root);
    expect(await second.get('title')).toBe('Name this story in {{language}}');
    const raw = JSON.parse(await fs.readFile(path.join(root, 'prompt-templates.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(raw['title']).toBe('Name this story in {{language}}');
  });
});
