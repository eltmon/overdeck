/**
 * PAN-3090 follow-up — terminal excerpt under the generic question card.
 *
 * A pane-detected question (`paneQuestion`) and every payload shape the rich
 * card declines carry no structured question text, so the generic card told
 * the operator "it needs one decision" while showing nothing to decide on.
 * This block fetches the tail of the agent's terminal output — the same
 * screen the question is sitting on (GET /api/agents/:id/output, which falls
 * back to the saved output log when the session is gone) — so the decision is
 * visible next to the composer that answers it. Renders nothing while
 * loading, on error, or when the tail is empty.
 */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SIMPLE_STRINGS } from '../../lib/simple/strings';

const S = SIMPLE_STRINGS.issue;

const TAIL_LINES = 40;

export function SimpleTerminalExcerpt({ agentId }: { agentId: string }) {
  const { data } = useQuery({
    queryKey: ['simple-terminal-excerpt', agentId],
    queryFn: async (): Promise<string> => {
      const res = await fetch(`/api/agents/${agentId}/output?lines=${TAIL_LINES}`);
      if (!res.ok) return '';
      const body = (await res.json()) as { output?: string };
      return (body.output ?? '').replace(/\s+$/, '');
    },
    // The excerpt lives only while the agent is blocked, but the screen can
    // still change (the question redraws, the operator answers elsewhere) —
    // keep it honest without hammering the capture endpoint.
    refetchInterval: 15_000,
  });

  // The newest content — the question — sits at the bottom of the tail.
  const preRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [data]);

  if (!data) return null;
  return (
    <div className="w-full">
      <div className="text-[11px] text-muted-foreground">{S.screenExcerptLabel}</div>
      <pre
        ref={preRef}
        className="mt-1.5 max-h-52 overflow-y-auto whitespace-pre-wrap break-words rounded-[10px] bg-accent px-3.5 py-3 font-mono text-[11.5px] leading-relaxed text-foreground"
      >
        {data}
      </pre>
    </div>
  );
}
