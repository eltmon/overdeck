import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * TestRemovalWaiverControl (PAN-4438) — the operator-only waiver control for
 * the test-skip gate's `removed-test` rule, rendered under a failing
 * `test-skip` gate in VerificationGatesPanel. Grants through
 * `POST /api/issues/:id/test-removal-waiver`, the same door as
 * `pan review waive-test-removal`. Granting does not re-run verification;
 * the operator runs `pan review request <id>` afterward.
 */

interface TestRemovalWaiver {
  sha: string;
  reason: string;
  at: string;
  by?: string;
}

interface TestRemovalWaiverResponse {
  issueId: string;
  head: string | null;
  headShort: string | null;
  waiver: TestRemovalWaiver | null;
  active: boolean;
}

function queryKeyFor(issueId: string) {
  return ['test-removal-waiver', issueId] as const;
}

export function TestRemovalWaiverControl({ issueId }: { issueId: string }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery<TestRemovalWaiverResponse>({
    queryKey: queryKeyFor(issueId),
    queryFn: async () => {
      const res = await fetch(`/api/issues/${encodeURIComponent(issueId)}/test-removal-waiver`);
      if (!res.ok) throw new Error(`GET test-removal-waiver → ${res.status}`);
      return res.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${encodeURIComponent(issueId)}/test-removal-waiver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, head: data?.head }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `POST test-removal-waiver → ${res.status}`);
      return body as { waiver: TestRemovalWaiver; headShort: string };
    },
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: queryKeyFor(issueId) });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  const loaded = data !== undefined;
  const head = data?.head ?? null;
  const headShort = data?.headShort ?? null;
  const active = data?.active === true;
  const waiver = data?.waiver ?? null;
  const grantDisabled = reason.trim() === '' || head === null || mutation.isPending;

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 6 }}>
        Operator waiver — removed tests
      </div>
      {!loaded
        ? <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 6 }}>Loading…</div>
        : head
          ? <div data-testid="waiver-head" style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 6 }}>
              Pins to {headShort}
            </div>
          : <div style={{ fontSize: 11, color: 'var(--destructive)', marginBottom: 6 }}>
              Head unavailable — cannot grant
            </div>}
      <textarea
        data-testid="waiver-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why the removed tests are gone and nothing replaces them"
        rows={2}
        style={{
          width: '100%',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 12,
          color: 'var(--foreground)',
          background: 'var(--muted)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: 6,
          resize: 'vertical',
        }}
      />
      <div style={{ marginTop: 6 }}>
        <button
          data-testid="waiver-grant"
          disabled={grantDisabled}
          onClick={() => mutation.mutate()}
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono, monospace)',
            padding: '4px 10px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            background: 'var(--muted)',
            color: 'var(--foreground)',
            cursor: grantDisabled ? 'not-allowed' : 'pointer',
            opacity: grantDisabled ? 0.5 : 1,
          }}
        >
          Grant
        </button>
      </div>
      {error && (
        <div style={{ fontSize: 11, color: 'var(--destructive)', marginTop: 6 }}>{error}</div>
      )}
      {active && waiver && (
        <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 8 }}>
          <div>Waiver granted by {waiver.by ?? 'operator'} at {waiver.at} for {headShort}: {waiver.reason}</div>
          <div style={{ marginTop: 4 }}>Re-run verification: Request review, or pan review request {issueId}.</div>
        </div>
      )}
    </div>
  );
}
