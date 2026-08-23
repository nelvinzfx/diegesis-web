/**
 * Session-plan SSE runner shared by the campaign-new and campaign-edit pages.
 * Accumulates prose / reasoning / stage lines; keeps partial prose when the
 * stream is stopped or errors (the server persists the partial too).
 */

import { useCallback, useRef, useState } from 'react';

import * as api from './api';

export interface PlanStreamState {
  streaming: boolean;
  prose: string;
  reasoning: string;
  stageLines: string[];
  error: string | null;
}

const IDLE: PlanStreamState = {
  streaming: false,
  prose: '',
  reasoning: '',
  stageLines: [],
  error: null,
};

export function usePlanStream(): {
  plan: PlanStreamState;
  startPlan: (
    campaignId: string,
    input: { title?: string; premise?: string; playerPersona?: string },
    onDone: (prose: string, errorMessage: string | null) => void,
  ) => Promise<void>;
  stopPlan: () => void;
} {
  const [plan, setPlan] = useState<PlanStreamState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const stopPlan = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const startPlan = useCallback(
    async (
      campaignId: string,
      input: { title?: string; premise?: string; playerPersona?: string },
      onDone: (prose: string, errorMessage: string | null) => void,
    ): Promise<void> => {
      if (abortRef.current !== null) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setPlan({ streaming: true, prose: '', reasoning: '', stageLines: [], error: null });

      let prose = '';
      let terminalError: string | null = null;
      try {
        const result = await api.streamPlan(
          campaignId,
          input,
          {
            onStage: (line) =>
              setPlan((prev) => ({ ...prev, stageLines: [...prev.stageLines, line] })),
            onReasoning: (text) =>
              setPlan((prev) => ({ ...prev, reasoning: prev.reasoning + text })),
            onToken: (text) => {
              prose += text;
              setPlan((prev) => ({ ...prev, prose: prev.prose + text }));
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
      setPlan((prev) => ({ ...prev, streaming: false, error: terminalError }));
      onDone(prose, terminalError);
    },
    [],
  );

  return { plan, startPlan, stopPlan };
}
