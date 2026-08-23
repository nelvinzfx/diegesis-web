/**
 * Opening-scene SSE runner shared by the campaign-new and campaign-edit
 * pages. Accumulates prose / reasoning / stage lines; the server does NOT
 * persist the draft (the client saves it via PUT campaign), so stop/abort
 * simply keeps whatever prose arrived.
 */

import { useCallback, useRef, useState } from 'react';

import * as api from './api';

export interface OpeningStreamState {
  streaming: boolean;
  prose: string;
  reasoning: string;
  stageLines: string[];
  error: string | null;
}

const IDLE: OpeningStreamState = {
  streaming: false,
  prose: '',
  reasoning: '',
  stageLines: [],
  error: null,
};

export function useOpeningStream(): {
  opening: OpeningStreamState;
  startOpening: (
    campaignId: string,
    onDone: (prose: string, errorMessage: string | null) => void,
  ) => Promise<void>;
  stopOpening: () => void;
} {
  const [opening, setOpening] = useState<OpeningStreamState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const stopOpening = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const startOpening = useCallback(
    async (
      campaignId: string,
      onDone: (prose: string, errorMessage: string | null) => void,
    ): Promise<void> => {
      if (abortRef.current !== null) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setOpening({ streaming: true, prose: '', reasoning: '', stageLines: [], error: null });

      let prose = '';
      let terminalError: string | null = null;
      try {
        const result = await api.streamOpening(
          campaignId,
          {
            onStage: (line) =>
              setOpening((prev) => ({ ...prev, stageLines: [...prev.stageLines, line] })),
            onReasoning: (text) =>
              setOpening((prev) => ({ ...prev, reasoning: prev.reasoning + text })),
            onToken: (text) => {
              prose += text;
              setOpening((prev) => ({ ...prev, prose: prev.prose + text }));
            },
          },
          controller.signal,
        );
        if (
          !controller.signal.aborted &&
          result.terminal?.event === 'error' &&
          typeof result.terminal.data === 'object' &&
          result.terminal.data !== null &&
          typeof (result.terminal.data as Record<string, unknown>)['message'] === 'string'
        ) {
          terminalError = (result.terminal.data as Record<string, unknown>)['message'] as string;
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          terminalError = error instanceof Error ? error.message : String(error);
        }
      }

      abortRef.current = null;
      setOpening((prev) => ({ ...prev, streaming: false, error: terminalError }));
      onDone(prose, terminalError);
    },
    [],
  );

  return { opening, startOpening, stopOpening };
}
