import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleX, Loader2, Circle } from 'lucide-react';
import styles from '../styles/command-deck.module.css';

/**
 * VerificationGatesPanel (PAN-2665) — the Test/Lint tree node's live view.
 * Polls /api/issues/:id/verification (the incrementally written per-workspace
 * verification artifact) so the operator watches gates complete in real time:
 * completed gates show pass/fail + duration, the in-flight gate spins, and a
 * failing gate's captured output renders below the table.
 */

interface GateRecord {
  name: string;
  passed: boolean;
  required: boolean;
  durationMs: number;
  output?: string;
  error?: string;
}

interface VerificationResponse {
  issueId: string;
  verificationStatus: string | null;
  artifact: {
    ranAt: string;
    outcome: 'running' | 'passed' | 'failed';
    currentGate?: string;
    failedCheck?: string;
    gates: GateRecord[];
  } | null;
}

function isLive(data: VerificationResponse | undefined): boolean {
  return data?.verificationStatus === 'running' || data?.artifact?.outcome === 'running';
}

export function VerificationGatesPanel({ issueId, fallbackTranscript }: { issueId: string; fallbackTranscript?: string }) {
  const { data, isLoading } = useQuery<VerificationResponse>({
    queryKey: ['verification', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${encodeURIComponent(issueId)}/verification`);
      if (!res.ok) throw new Error('Failed to fetch verification state');
      return res.json() as Promise<VerificationResponse>;
    },
    refetchInterval: (query) => (isLive(query.state.data) ? 2_500 : 15_000),
  });

  if (isLoading) {
    return <div className={styles.sessionPanelEmpty}>Loading verification state…</div>;
  }

  const artifact = data?.artifact;
  if (!artifact) {
    return (
      <div className={styles.sessionPanelTranscript} style={{ padding: 16 }}>
        {fallbackTranscript ? (
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{fallbackTranscript}</pre>
        ) : (
          <div className={styles.sessionPanelEmpty}>
            No gate run recorded yet. Details appear when verification next runs.
          </div>
        )}
      </div>
    );
  }

  const live = isLive(data);
  const heading = live
    ? `Quality gates running${artifact.currentGate ? ` — ${artifact.currentGate}` : ''}…`
    : `Quality gates ${artifact.outcome}`;
  const headingColor = live
    ? 'var(--info)'
    : artifact.outcome === 'passed'
      ? 'var(--success)'
      : 'var(--destructive)';
  const failing = artifact.gates.filter((gate) => !gate.passed && (gate.output || gate.error));

  return (
    <div className={styles.sessionPanelTranscript} style={{ padding: 16, overflowY: 'auto' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: headingColor, marginBottom: 2 }}>
        {heading}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 10 }}>
        Last run: {new Date(artifact.ranAt).toLocaleString()}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {artifact.gates.map((gate) => (
          <div key={gate.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}>
            {gate.passed
              ? <CircleCheck size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
              : <CircleX size={13} style={{ color: 'var(--destructive)', flexShrink: 0 }} />}
            <span>{gate.name}</span>
            <span style={{ color: 'var(--muted-foreground)' }}>{(gate.durationMs / 1000).toFixed(1)}s</span>
            {!gate.required && <span style={{ color: 'var(--muted-foreground)', fontSize: 10 }}>optional</span>}
          </div>
        ))}
        {live && artifact.currentGate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}>
            <Loader2 size={13} className="animate-spin" style={{ color: 'var(--info)', flexShrink: 0 }} />
            <span>{artifact.currentGate}</span>
            <span style={{ color: 'var(--muted-foreground)' }}>running…</span>
          </div>
        )}
        {live && !artifact.currentGate && artifact.gates.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <Circle size={13} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
            <span style={{ color: 'var(--muted-foreground)' }}>Preparing workspace…</span>
          </div>
        )}
      </div>
      {failing.map((gate) => (
        <div key={`out-${gate.name}`} style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--destructive)', marginBottom: 4 }}>
            {gate.name} output
          </div>
          <pre style={{
            whiteSpace: 'pre-wrap',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 11,
            lineHeight: 1.5,
            background: 'var(--muted)',
            borderRadius: 'var(--radius)',
            padding: 10,
            margin: 0,
            maxHeight: 320,
            overflowY: 'auto',
          }}>{(gate.output || gate.error || '').trim()}</pre>
        </div>
      ))}
    </div>
  );
}
