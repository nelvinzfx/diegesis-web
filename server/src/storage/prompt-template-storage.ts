/**
 * Prompt template overrides: data/prompt-templates.json.
 *
 * Shape { [stageKey]: string } — only overridden stages appear in the file.
 * An empty file (or missing file) means every stage uses its shipped default.
 */

import path from 'node:path';
import { atomicWriteJson, ensureDir, Mutex, readJsonOrNull } from './fsio.js';

export type PromptTemplateOverrides = Record<string, string>;

export class PromptTemplateStorage {
  private readonly mutex = new Mutex();

  constructor(private readonly dataRoot: string) {}

  private get file(): string {
    return path.join(this.dataRoot, 'prompt-templates.json');
  }

  async load(): Promise<PromptTemplateOverrides> {
    return (await readJsonOrNull<PromptTemplateOverrides>(this.file)) ?? {};
  }

  async get(stageKey: string): Promise<string | null> {
    const overrides = await this.load();
    const value = overrides[stageKey];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  /** Null template removes the override (back to default). */
  async set(stageKey: string, template: string | null): Promise<void> {
    await this.mutex.run(async () => {
      const current = await this.load();
      if (template === null) {
        delete current[stageKey];
      } else {
        current[stageKey] = template;
      }
      await ensureDir(this.dataRoot);
      await atomicWriteJson(this.file, current);
    });
  }
}
