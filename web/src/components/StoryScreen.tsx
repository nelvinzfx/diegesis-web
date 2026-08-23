/**
 * The story screen: reading column (transcript + input bar) plus inspector
 * toggle handling lives in the shell; this composes the center stage.
 */

import type { ReactNode } from 'react';

import { InputBar } from './InputBar';
import { Transcript } from './Transcript';

export function StoryScreen(): ReactNode {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Transcript />
      <InputBar />
    </div>
  );
}
