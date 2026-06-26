import { useEffect, useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';

// PAN-2059: the operator pickup controls — Plan → Release, AI objection, Ready /
// Park / Blocks-main, planning mode, and the pickup gate — for ONE issue. This is
// the single implementation shared by the Backlog Sequencer drawer, the issue
// cockpit panel, and the issue overlay, so the three surfaces can never drift.
// Self-contained: it fetches /api/backlog/issue-state and owns its mutations,
// invalidating both its own cache and ['backlog-sequence'] so every surface stays
// in sync after a change.

export interface PipelineState {
  ready: boolean; planned: boolean; parked: boolean; vetoed: boolean;
  blocksMain: boolean; inPipeline: boolean; released: boolean; objection: boolean;
  gate: 'auto' | 'promote' | 'vetoed';
}
interface IssueStateResponse {
  issueId: string; state: PipelineState; gate: string; planning: string | null; inSequence: boolean;
}

function isIssueStateResponse(value: unknown): value is IssueStateResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<IssueStateResponse>;
  return (
    typeof candidate.issueId === 'string' &&
    !!candidate.state &&
    typeof candidate.state === 'object' &&
    typeof (candidate.state as Partial<PipelineState>).ready === 'boolean' &&
    typeof (candidate.state as Partial<PipelineState>).planned === 'boolean' &&
    typeof (candidate.state as Partial<PipelineState>).parked === 'boolean' &&
    typeof (candidate.state as Partial<PipelineState>).blocksMain === 'boolean' &&
    typeof (candidate.state as Partial<PipelineState>).released === 'boolean' &&
    typeof (candidate.state as Partial<PipelineState>).objection === 'boolean' &&
    typeof candidate.gate === 'string' &&
    (typeof candidate.planning === 'string' || candidate.planning === null) &&
    typeof candidate.inSequence === 'boolean'
  );
}

const SECTION_LABEL: CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted-foreground)', marginBottom: 7 };
const SECTION_HINT: CSSProperties = { fontSize: 12, color: 'var(--muted-foreground)', marginTop: 7, lineHeight: 1.45 };

const PLAN_HINT: Record<string, string> = {
  interactive: 'Interactive: a human drives planning — a HARD gate. The Flywheel surfaces it as needs-you and never auto-runs it.',
  skip: 'Skip: no planning — pan start --auto straight to work (trivial/tiny/urgent).',
  auto: 'Auto: the AI plans it end-to-end (pan plan --auto).',
};
const GATE_HINT: Record<string, string> = {
  ready: 'Promote: jump the queue ahead of rank (and auto-plan it if it has no spec yet).',
  blocked: 'Vetoed: an absolute NO — never auto-picked, planned, or struck, even to unblock the pipeline.',
  auto: 'Auto: normal eligibility (Ready · Planned · Released · not parked · not vetoed).',
};

function SegControl({ value, options, onChange }: {
  value: string; options: Array<{ value: string; label: string; activeColor?: string }>; onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
      {options.map((opt) => {
        const isActive = value === opt.value;
        return (
          <button key={opt.value} onClick={() => onChange(opt.value)} style={{
            flex: 1, padding: '3px 6px', fontSize: 10, fontWeight: isActive ? 700 : 400, border: 'none', cursor: 'pointer',
            background: isActive ? (opt.activeColor ?? '#3b82f6') : 'var(--color-surface)', color: isActive ? '#fff' : 'var(--color-fg-muted)', transition: 'all 0.15s',
          }}>{opt.label}</button>
        );
      })}
    </div>
  );
}

function ToggleRow({ label, hint, on, color, onChange }: {
  label: string; hint: string; on: boolean; color: string; onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, margin: '9px 0' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 10, color: 'var(--muted-foreground)', lineHeight: 1.4, marginTop: 2 }}>{hint}</div>
      </div>
      <button onClick={() => onChange(!on)} aria-pressed={on} style={{
        flexShrink: 0, width: 38, height: 22, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative',
        background: on ? `color-mix(in srgb, ${color} 60%, transparent)` : 'var(--input)', transition: 'background 0.15s',
      }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.4)' }} />
      </button>
    </div>
  );
}

export function PickupGateControls({ issueId, onOpenIssueBrowser }: {
  issueId: string;
  /** Optional: open the issue (e.g. on GitHub) to read the full objection write-up. */
  onOpenIssueBrowser?: (issueId: string) => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<IssueStateResponse>({
    queryKey: ['backlog-issue-state', issueId],
    queryFn: async () => {
      const r = await fetch(`/api/backlog/issue-state?issueId=${encodeURIComponent(issueId)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body: unknown = await r.json();
      if (!isIssueStateResponse(body)) throw new Error('Invalid pickup state response');
      return body;
    },
    staleTime: 10_000,
  });

  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [parked, setParked] = useState(false);
  const [blocksMain, setBlocksMain] = useState(false);
  const [released, setReleased] = useState(false);
  const [objection, setObjection] = useState(false);
  const [gate, setGate] = useState('auto');
  const [planning, setPlanning] = useState('auto');

  useEffect(() => {
    if (!data) return;
    const s = data.state;
    setReady(s.ready); setParked(s.parked); setBlocksMain(s.blocksMain);
    setReleased(s.released); setObjection(s.objection);
    setGate(data.gate || 'auto'); setPlanning(data.planning || 'auto');
  }, [data]);

  const planned = !!data?.state.planned;
  const inSequence = !!data?.inSequence;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['backlog-issue-state', issueId] });
    qc.invalidateQueries({ queryKey: ['backlog-sequence'] });
  }

  async function toggleLabel(field: 'ready' | 'parked' | 'blocksMain' | 'released' | 'objection', value: boolean) {
    if (field === 'ready') setReady(value);
    if (field === 'parked') setParked(value);
    if (field === 'blocksMain') setBlocksMain(value);
    if (field === 'released') setReleased(value);
    if (field === 'objection') setObjection(value);
    setBusy(true);
    try {
      await fetch('/api/backlog/sequence/labels', {
        method: 'POST', headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ issueId, [field]: value }),
      });
      invalidate();
    } finally { setBusy(false); }
  }

  async function startPlanning(mode: 'auto' | 'interactive') {
    setBusy(true);
    try {
      await fetch(`/api/issues/${issueId}/start-planning`, {
        method: 'POST', headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ auto: mode === 'auto', autoStart: false }),
      }).catch(() => {});
      invalidate();
    } finally { setBusy(false); }
  }

  async function acceptObjectionAndPark() {
    await toggleLabel('objection', false);
    await toggleLabel('parked', true);
  }

  async function gateChange(v: string) {
    setGate(v); setBusy(true);
    try {
      await fetch('/api/backlog/sequence/gate', {
        method: 'POST', headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ issueId, gate: v }),
      });
      invalidate();
    } finally { setBusy(false); }
  }

  async function planningChange(v: string) {
    setPlanning(v); setBusy(true);
    try {
      await fetch('/api/backlog/sequence/planning', {
        method: 'POST', headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ issueId, planning: v }),
      });
      invalidate();
    } finally { setBusy(false); }
  }

  // Plan → Release action buttons.
  const BTN_BASE: CSSProperties = { fontSize: 11, fontWeight: 500, padding: '5px 11px', borderRadius: 7, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--accent)', color: 'var(--foreground)' };
  const BTN_PRIMARY: CSSProperties = { ...BTN_BASE, border: 'none', background: 'var(--primary)', color: 'var(--primary-foreground)' };
  const BTN_DANGER: CSSProperties = { ...BTN_BASE, border: '1px solid color-mix(in srgb, var(--destructive) 50%, transparent)', background: 'color-mix(in srgb, var(--destructive) 8%, transparent)', color: 'var(--destructive-foreground)' };
  const BTN_LINK: CSSProperties = { fontSize: 11, background: 'none', border: 'none', color: 'var(--muted-foreground)', textDecoration: 'underline', cursor: 'pointer', padding: 2 };
  const stateChip = (tone: 'planned' | 'released'): CSSProperties => ({
    fontSize: 10, fontWeight: 500, padding: '1px 7px', borderRadius: 5, border: '1px solid', whiteSpace: 'nowrap',
    ...(tone === 'released'
      ? { color: 'var(--success-foreground)', borderColor: 'color-mix(in srgb, var(--success) 40%, transparent)', background: 'color-mix(in srgb, var(--success) 12%, transparent)' }
      : { color: 'var(--info-foreground)', borderColor: 'color-mix(in srgb, var(--info) 34%, transparent)', background: 'color-mix(in srgb, var(--info) 9%, transparent)' }),
  });

  if (isLoading) return <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>Loading pickup state…</div>;
  if (error || !data) return <div style={{ fontSize: 11, color: 'var(--destructive-foreground)' }}>{error ? String(error) : 'No pickup state'}</div>;

  return (
    <div style={{ color: 'var(--foreground)' }}>
      {/* Plan → Release pickup flow + AI objection */}
      <div style={{ marginBottom: 13 }}>
        <div style={SECTION_LABEL}>Plan → Release · operator (PAN-2059) {busy && '…'}</div>
        {objection ? (
          <div style={{ border: '1px solid color-mix(in srgb, var(--destructive) 34%, transparent)', background: 'color-mix(in srgb, var(--destructive) 6%, transparent)', borderRadius: 9, padding: '10px 11px' }}>
            <div style={{ fontSize: 11.5, color: 'var(--destructive-foreground)', marginBottom: 6 }}>🛑 Held for review — AI objection</div>
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)', lineHeight: 1.5, marginBottom: 9 }}>
              The planning agent objects to this work (doesn&apos;t make sense / would worsen the product / superseded).{' '}
              {onOpenIssueBrowser && (
                <button style={{ ...BTN_LINK, padding: 0 }} onClick={() => onOpenIssueBrowser(issueId)}>View the write-up on the issue ↗</button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={BTN_DANGER} onClick={() => toggleLabel('objection', false)} disabled={busy}>Override → Plan anyway</button>
              <button style={BTN_BASE} onClick={acceptObjectionAndPark} disabled={busy}>Accept &amp; park</button>
            </div>
          </div>
        ) : !planned ? (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={BTN_PRIMARY} onClick={() => startPlanning('auto')} disabled={busy}>Plan (Auto)</button>
              <button style={BTN_BASE} onClick={() => startPlanning('interactive')} disabled={busy}>⚑ Plan (Interactive)</button>
            </div>
            <div style={SECTION_HINT}>Generates the vBRIEF + beads. Auto runs end-to-end and stops before pickup; Interactive opens a Q&amp;A session. The plan must be Released before an agent can pick it up.</div>
          </>
        ) : !released ? (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={stateChip('planned')}>✓ planned</span>
              <button style={BTN_PRIMARY} onClick={() => toggleLabel('released', true)} disabled={busy}>Release ▶</button>
              <button style={BTN_LINK} onClick={() => startPlanning('auto')} disabled={busy}>Re-plan</button>
            </div>
            <div style={SECTION_HINT}>Plan ready — review it, then <b>Release</b> for pickup. <b>Not pickable until released.</b></div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={stateChip('released')}>▶ released · pickable</span>
              <button style={BTN_LINK} onClick={() => toggleLabel('released', false)} disabled={busy}>Recall</button>
            </div>
            <div style={SECTION_HINT}>Released — eligible for pickup. Recall pulls it back to planned (held).</div>
          </>
        )}
      </div>

      {/* Pipeline state — operator label toggles */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 13, marginBottom: 13 }}>
        <div style={SECTION_LABEL}>Pipeline state · operator controls {busy && '…'}</div>
        <ToggleRow label="Ready" color="var(--success)" on={ready}
          hint="Definition of Ready — when off, the Flywheel won't auto-pick it (the entry gate)."
          onChange={(v) => toggleLabel('ready', v)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '9px 0' }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>Planned</span>
          <span style={{
            fontSize: 10, fontWeight: 500, padding: '1px 6px', borderRadius: 5, border: '1px solid',
            ...(planned
              ? { color: 'var(--info-foreground)', borderColor: 'color-mix(in srgb, var(--info) 34%, transparent)', background: 'color-mix(in srgb, var(--info) 9%, transparent)' }
              : { color: 'var(--warning-foreground)', borderColor: 'color-mix(in srgb, var(--warning) 34%, transparent)', background: 'color-mix(in srgb, var(--warning) 9%, transparent)' }),
          }}>{planned ? '✓ has spec + beads' : '✗ no spec'}</span>
          <span style={{ fontSize: 10, color: 'var(--muted-foreground)' }}>derived</span>
        </div>
        <ToggleRow label="Blocks main 🔴" color="var(--destructive)" on={blocksMain}
          hint="Flywheel prioritizes / strikes it even with auto-pickup off (never if vetoed)."
          onChange={(v) => toggleLabel('blocksMain', v)} />
        <ToggleRow label="Park" color="var(--warning)" on={parked}
          hint="Defer — needs human design/discussion; excluded from auto-pickup, reversible."
          onChange={(v) => toggleLabel('parked', v)} />
      </div>

      {/* Planning policy + Pickup gate live in sequence.md — only when the issue is ranked. */}
      {inSequence ? (
        <>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 13, marginBottom: 13 }}>
            <div style={SECTION_LABEL}>Planning · AI-suggested, operator-overridable</div>
            <SegControl value={planning} options={[
              { value: 'skip', label: 'Skip' },
              { value: 'auto', label: 'Auto' },
              { value: 'interactive', label: '⚑ Interactive', activeColor: '#b45309' },
            ]} onChange={planningChange} />
            <div style={SECTION_HINT}>{PLAN_HINT[planning] ?? ''}</div>
          </div>
          <div style={{ marginBottom: 4 }}>
            <div style={SECTION_LABEL}>Pickup gate · operator {busy && '…'}</div>
            <SegControl value={gate} options={[
              { value: 'auto', label: 'Auto' },
              { value: 'ready', label: '📌 Promote', activeColor: '#15803d' },
              { value: 'blocked', label: '⛔ Vetoed', activeColor: '#b91c1c' },
            ]} onChange={gateChange} />
            <div style={SECTION_HINT}>{GATE_HINT[gate] ?? ''}</div>
          </div>
        </>
      ) : (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 13, fontSize: 11, color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
          Not in the ranked backlog yet — the planning-mode and promote/veto gate appear once a sequencer pass ranks it. The actions above still apply.
        </div>
      )}
    </div>
  );
}
