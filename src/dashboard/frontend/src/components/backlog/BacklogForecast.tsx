import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

// PAN-2005: the Pickup Forecast view. Renders the order the Flywheel will actually
// pick up work (waves + lanes) from GET /api/backlog/forecast, which is computed by
// the shared pickup module (single source of truth — never diverges from the Flywheel).

export interface PipelineState {
  ready: boolean; planned: boolean; parked: boolean; vetoed: boolean;
  blocksMain: boolean; inPipeline: boolean; released: boolean; objection: boolean;
  gate: 'auto' | 'promote' | 'vetoed';
}
export interface ForecastNode {
  issue: string; rank: number; size: string; state: PipelineState;
  title: string; importance: string; score: number; why: string;
}
export interface LaneBlock extends ForecastNode { lane: number; start: number; end: number; }
export interface ForecastStats {
  total: number; inFlight: number; ready: number; planned: number; released: number;
  objection: number; pickable: number; needsPlanning: number; needsRelease: number;
  parked: number; vetoed: number; blocksMain: number;
}
export interface ForecastResponse {
  n: number; stats: ForecastStats | null; inFlight: ForecastNode[];
  waves: ForecastNode[][]; lanes: { blocks: LaneBlock[]; makespan: number }; cohort: string[];
  epics?: Array<{ issue: string; title: string }>;
  contains?: Array<{ epic: string; child: string }>;
}

export interface WaveEpicGroup {
  epic: string | null;
  cards: ForecastNode[];
}

export function groupWaveByEpic(cards: readonly ForecastNode[], childToEpic: ReadonlyMap<string, string>): WaveEpicGroup[] {
  const usedEpics = new Set<string>();
  const groups: WaveEpicGroup[] = [];
  for (const card of cards) {
    const epic = childToEpic.get(card.issue);
    if (!epic) {
      groups.push({ epic: null, cards: [card] });
      continue;
    }
    if (usedEpics.has(epic)) continue;
    usedEpics.add(epic);
    groups.push({ epic, cards: cards.filter((candidate) => childToEpic.get(candidate.issue) === epic) });
  }
  return groups;
}

const IMP_CLASS: Record<string, string> = { critical: 'crit', high: 'high', medium: 'medium', low: 'low' };

function Chips({ s }: { s: PipelineState }) {
  return (
    <div className="bkf-chips">
      {s.inPipeline && <span className="bkf-chip run"><span className="bkf-dot" />in flight</span>}
      {s.blocksMain && <span className="bkf-chip blocksmain">🔴 blocks main</span>}
      {s.vetoed && <span className="bkf-chip vetoed">⛔ vetoed</span>}
      {s.objection && <span className="bkf-chip objection">🛑 objection</span>}
      {s.parked && <span className="bkf-chip parked">⏸ parked</span>}
      {s.ready && <span className="bkf-chip ready">✓ ready</span>}
      {s.planned && <span className="bkf-chip planned">planned</span>}
      {s.planned && s.released && <span className="bkf-chip released">▶ released</span>}
      {s.planned && !s.released && !s.parked && !s.vetoed && !s.objection && !s.inPipeline && <span className="bkf-chip needsrelease">needs release</span>}
      {!s.planned && !s.parked && !s.vetoed && !s.objection && <span className="bkf-chip needsplan">needs plan</span>}
    </div>
  );
}

function EpicTag({ epicId, epicTitle }: { epicId?: string; epicTitle?: string }) {
  if (!epicId) return null;
  return <span className="bkf-epictag" title={epicTitle || epicId}>▣ {epicId}</span>;
}

function Card({ n, onSelect, epicId, epicTitle }: { n: ForecastNode; onSelect?: (id: string) => void; epicId?: string; epicTitle?: string }) {
  const cls = ['bkf-card', IMP_CLASS[n.importance] ?? 'medium'];
  if (n.state.inPipeline) cls.push('pipe');
  if (n.state.blocksMain) cls.push('blocksmain');
  if (n.state.objection) cls.push('objection');
  if (n.state.parked) cls.push('parked');
  if (n.state.vetoed) cls.push('vetoed');
  return (
    <div className={cls.join(' ')} onClick={() => onSelect?.(n.issue)}>
      <div className="bkf-r1">
        <span className="bkf-rk">#{n.rank}</span>
        <span className="bkf-iid">{n.issue}</span>
        <span className="bkf-sz">{n.size}</span>
      </div>
      <div className="bkf-ttl">{n.title || n.why || n.issue}</div>
      <EpicTag epicId={epicId} epicTitle={epicTitle} />
      <Chips s={n.state} />
    </div>
  );
}

export function BacklogForecast({ className, n = 5, onSelectIssue }: { className?: string; n?: number; onSelectIssue?: (id: string) => void }) {
  const [sub, setSub] = useState<'waves' | 'lanes'>('waves');
  const { data, isLoading, error } = useQuery<ForecastResponse>({
    queryKey: ['backlog-forecast', n],
    queryFn: async () => {
      const res = await fetch(`/api/backlog/forecast?n=${n}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<ForecastResponse>;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading) return <div className={className} style={center}>Loading forecast…</div>;
  if (error || !data) return <div className={className} style={center}>{error ? String(error) : 'No forecast'}</div>;

  const stats = data.stats;
  const unit = Math.max(36, Math.floor(900 / Math.max(data.lanes.makespan, 1)));
  const epics = data.epics ?? [];
  const contains = data.contains ?? [];
  const childToEpic = new Map(contains.map((entry) => [entry.child, entry.epic]));
  const epicTitle = new Map(epics.map((entry) => [entry.issue, entry.title]));

  return (
    <div className={className} style={{ height: '100%', overflow: 'auto', padding: '16px 20px' }}>
      <style>{BKF_CSS}</style>

      {/* stat bar */}
      {stats && (
        <div className="bkf-stats">
          <Stat k="In flight" v={stats.inFlight} c="live" />
          <Stat k="Ready" v={stats.ready} c="go" />
          <Stat k="Planned" v={stats.planned} c="info" />
          <Stat k="Pickable" v={stats.pickable} c="go" />
          <Stat k="Needs planning" v={stats.needsPlanning} c="warn" />
          <Stat k="Needs release" v={stats.needsRelease} c="warn" />
          <Stat k="Released" v={stats.released} c="go" />
          <Stat k="Objection" v={stats.objection} c="danger" />
          <Stat k="Parked" v={stats.parked} c="" />
          <Stat k="Vetoed" v={stats.vetoed} c="" />
          <Stat k="Blocks main" v={stats.blocksMain} c="danger" />
        </div>
      )}

      <div className="bkf-subtabs">
        <button className={sub === 'waves' ? 'on' : ''} onClick={() => setSub('waves')}>Waves</button>
        <button className={sub === 'lanes' ? 'on' : ''} onClick={() => setSub('lanes')}>Lanes</button>
        <span className="bkf-modeled">modeled at {data.n} agents</span>
      </div>

      {sub === 'waves' && (
        <div className="bkf-waves">
          <div className="bkf-wcol now">
            <div className="bkf-wh">▶ Running now <span className="c">{data.inFlight.length}</span></div>
            <div className="bkf-wstack">
              {data.inFlight.map((nn) => {
                const epic = childToEpic.get(nn.issue);
                return <Card key={nn.issue} n={nn} onSelect={onSelectIssue} epicId={epic} epicTitle={epic ? epicTitle.get(epic) : undefined} />;
              })}
              {data.inFlight.length === 0 && <div className="bkf-empty">nothing in flight</div>}
            </div>
          </div>
          {data.waves.map((w, i) => (
            <div key={i} className="bkf-wcol">
              <div className="bkf-wh">Wave <span className="c">{i + 1}</span></div>
              <div className="bkf-wstack">
                {groupWaveByEpic(w, childToEpic).map((group, groupIndex) => (
                  <div key={group.epic ?? `orphan-${group.cards[0]?.issue ?? groupIndex}`} className={group.epic ? 'bkf-epicrun' : undefined}>
                    {group.epic && (
                      <div className="bkf-epichead" title={epicTitle.get(group.epic) || group.epic}>
                        ▣ {group.epic}{epicTitle.get(group.epic) ? ` · ${epicTitle.get(group.epic)}` : ''}
                      </div>
                    )}
                    <div className="bkf-wstack">
                      {group.cards.map((nn) => {
                        const epic = childToEpic.get(nn.issue);
                        return <Card key={nn.issue} n={nn} onSelect={onSelectIssue} epicId={epic} epicTitle={epic ? epicTitle.get(epic) : undefined} />;
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {data.waves.length === 0 && (
            <div className="bkf-emptywaves">
              No auto-pickable work. An issue must be <b>Ready</b> (marked workable), <b>Planned</b> (has a spec + beads),
              <b>and Released</b> (operator reviewed the plan and released it for pickup — PAN-2059) to enter a wave.
              Plan the ones in <b>Needs planning</b>, then <b>Release</b> the ones in <b>Needs release</b>.
            </div>
          )}
        </div>
      )}

      {sub === 'lanes' && (
        <div className="bkf-gantt">
          {data.lanes.blocks.length === 0 && <div className="bkf-empty">No pickable work to schedule.</div>}
          {Array.from({ length: data.n }, (_, lane) => (
            <div key={lane} className="bkf-lane">
              <div className="bkf-ll">agent {lane + 1}</div>
              <div className="bkf-track">
                {data.lanes.blocks.filter((b) => b.lane === lane).map((b) => (
                  <div key={b.issue} className={`bkf-blk ${IMP_CLASS[b.importance] ?? 'medium'}`}
                    style={{ left: b.start * unit, width: (b.end - b.start) * unit - 4 }} title={b.title} onClick={() => onSelectIssue?.(b.issue)}>
                    <div className="bkf-bi">#{b.rank} {b.issue}</div>
                    <EpicTag epicId={childToEpic.get(b.issue)} epicTitle={childToEpic.get(b.issue) ? epicTitle.get(childToEpic.get(b.issue)!) : undefined} />
                    <div className="bkf-bt">{b.title || b.issue}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {data.lanes.blocks.length > 0 && (
            <div className="bkf-makespan">~{data.lanes.makespan} effort-units to clear the ready queue with {data.n} agents</div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ k, v, c }: { k: string; v: number; c: string }) {
  return <div className={`bkf-stat ${c}`}><b>{v}</b><span>{k}</span></div>;
}

const center: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted-foreground)', fontSize: 12 };

const BKF_CSS = `
  .bkf-stats { display:flex; gap:7px; flex-wrap:wrap; margin-bottom:14px; }
  .bkf-stat { display:flex; align-items:baseline; gap:6px; padding:6px 11px; border:1px solid var(--border); border-radius:8px; background:var(--card); font-size:11.5px; color:var(--muted-foreground); }
  .bkf-stat b { font-family:ui-monospace,monospace; font-size:14px; font-weight: 500; color:var(--foreground); }
  .bkf-stat.live b{color:var(--info-foreground);} .bkf-stat.go b{color:var(--success-foreground);} .bkf-stat.warn b{color:var(--warning-foreground);} .bkf-stat.danger b{color:var(--destructive-foreground);} .bkf-stat.info b{color:var(--info-foreground);}
  .bkf-subtabs { display:flex; gap:6px; align-items:center; margin-bottom:14px; }
  .bkf-subtabs button { background:transparent; border:1px solid var(--input); border-radius:8px; color:var(--muted-foreground); font:inherit; font-size:11px; font-weight:500; padding:5px 11px; cursor:pointer; }
  .bkf-subtabs button.on { background:var(--accent); color:var(--foreground); }
  .bkf-modeled { font-size:10.5px; color:var(--muted-foreground); margin-left:6px; }
  .bkf-waves { display:flex; align-items:flex-start; gap:14px; overflow-x:auto; padding-bottom:8px; }
  .bkf-wcol { width:212px; flex:0 0 auto; }
  .bkf-wh { font-size:10.5px; text-transform:uppercase; letter-spacing:.09em; color:var(--muted-foreground); margin-bottom:9px; display:flex; gap:7px; align-items:center; }
  .bkf-wh .c { font-family:ui-monospace,monospace; color:var(--foreground); font-weight: 500; }
  .bkf-wcol.now .bkf-wh { color:var(--info-foreground); }
  .bkf-wstack { display:flex; flex-direction:column; gap:8px; }
  .bkf-epicrun { display:flex; flex-direction:column; gap:7px; }
  .bkf-epichead { font-size:9.5px; font-weight:500; letter-spacing:.04em; color:var(--muted-foreground); border-left:3px solid color-mix(in srgb,var(--primary) 55%,transparent); padding-left:7px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .bkf-empty { font-size:11px; color:var(--muted-foreground); font-style:italic; }
  .bkf-emptywaves { flex:1; font-size:12.5px; color:var(--muted-foreground); line-height:1.6; border:1px dashed var(--border); border-radius:10px; padding:18px; max-width:560px; }
  .bkf-card { background:var(--card); border:1px solid var(--border); border-left:4px solid var(--heat,var(--muted-foreground)); border-radius:9px; padding:8px 10px; display:flex; flex-direction:column; gap:6px; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,.3); }
  .bkf-card:hover { box-shadow:0 5px 16px rgba(0,0,0,.4); }
  .bkf-card.crit{--heat:var(--destructive);} .bkf-card.high{--heat:var(--warning);} .bkf-card.medium{--heat:color-mix(in srgb,var(--color-neutral-400) 80%,transparent);} .bkf-card.low{--heat:color-mix(in srgb,var(--muted-foreground) 55%,transparent);}
  .bkf-card.pipe { box-shadow:0 0 0 1.5px var(--info),0 0 12px color-mix(in srgb,var(--info) 40%,transparent); }
  .bkf-card.blocksmain { box-shadow:0 0 0 1.5px var(--destructive),0 0 12px color-mix(in srgb,var(--destructive) 35%,transparent); }
  .bkf-card.objection { box-shadow:0 0 0 1.5px color-mix(in srgb,var(--destructive) 70%,transparent),0 0 12px color-mix(in srgb,var(--destructive) 30%,transparent); }
  .bkf-card.parked { opacity:.6; border-style:dashed; }
  .bkf-card.vetoed { opacity:.5; filter:grayscale(.5); border-style:dashed; }
  .bkf-r1 { display:flex; align-items:center; gap:6px; }
  .bkf-rk { font-family:ui-monospace,monospace; font-size:10px; font-weight: 500; background:var(--accent); border:1px solid var(--border); border-radius:4px; padding:0 5px; }
  .bkf-iid { font-family:ui-monospace,monospace; font-size:10px; color:var(--muted-foreground); }
  .bkf-sz { margin-left:auto; font-size:8.5px; font-weight: 500; color:var(--muted-foreground); border:1px solid var(--border); border-radius:4px; padding:0 5px; }
  .bkf-ttl { font-size:11px; font-weight:500; line-height:1.3; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; color:var(--foreground); }
  .bkf-epictag { align-self:flex-start; font-size:8.5px; font-weight:500; letter-spacing:.04em; padding:1px 5px; border-radius:4px; border:1px solid color-mix(in srgb,var(--primary) 38%,transparent); color:var(--foreground); background:color-mix(in srgb,var(--primary) 10%,transparent); max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bkf-chips { display:flex; gap:4px; flex-wrap:wrap; }
  .bkf-chip { font-size:8.5px; font-weight: 500; padding:1px 5px; border-radius:4px; border:1px solid; }
  .bkf-chip.run { color:var(--info-foreground); border-color:color-mix(in srgb,var(--info) 32%,transparent); background:color-mix(in srgb,var(--info) 9%,transparent); display:inline-flex; gap:3px; align-items:center; }
  .bkf-chip.ready { color:var(--success-foreground); border-color:color-mix(in srgb,var(--success) 32%,transparent); background:color-mix(in srgb,var(--success) 9%,transparent); }
  .bkf-chip.planned { color:var(--info-foreground); border-color:color-mix(in srgb,var(--info) 30%,transparent); background:color-mix(in srgb,var(--info) 8%,transparent); }
  .bkf-chip.parked { color:var(--warning-foreground); border-color:color-mix(in srgb,var(--warning) 34%,transparent); background:color-mix(in srgb,var(--warning) 9%,transparent); }
  .bkf-chip.vetoed { color:var(--muted-foreground); border-color:var(--border); background:var(--accent); }
  .bkf-chip.blocksmain { color:var(--destructive-foreground); border-color:color-mix(in srgb,var(--destructive) 38%,transparent); background:color-mix(in srgb,var(--destructive) 9%,transparent); }
  .bkf-chip.objection { color:var(--destructive-foreground); border-color:color-mix(in srgb,var(--destructive) 40%,transparent); background:color-mix(in srgb,var(--destructive) 11%,transparent); }
  .bkf-chip.released { color:var(--success-foreground); border-color:color-mix(in srgb,var(--success) 40%,transparent); background:color-mix(in srgb,var(--success) 12%,transparent); }
  .bkf-chip.needsrelease { color:var(--muted-foreground); border-color:color-mix(in srgb,var(--warning) 30%,transparent); background:color-mix(in srgb,var(--warning) 7%,transparent); }
  .bkf-chip.needsplan { color:var(--muted-foreground); border-color:var(--border); background:var(--accent); }
  .bkf-dot { width:5px; height:5px; border-radius:50%; background:currentColor; }
  .bkf-gantt { border:1px solid var(--border); border-radius:12px; background:color-mix(in srgb,var(--background) 92%,var(--color-white)); padding:14px 16px; }
  .bkf-lane { display:flex; align-items:center; height:48px; }
  .bkf-ll { width:82px; flex:0 0 auto; font-family:ui-monospace,monospace; font-size:11px; color:var(--muted-foreground); }
  .bkf-track { position:relative; flex:1; height:100%; border-left:1px dashed var(--border); }
  .bkf-blk { position:absolute; top:6px; min-height:36px; border-radius:8px; border:1px solid var(--border); border-left:4px solid var(--heat,var(--muted-foreground)); background:var(--card); padding:4px 8px; box-sizing:border-box; overflow:hidden; cursor:pointer; }
  .bkf-blk.crit{--heat:var(--destructive);} .bkf-blk.high{--heat:var(--warning);} .bkf-blk.medium{--heat:color-mix(in srgb,var(--color-neutral-400) 80%,transparent);}
  .bkf-bi { font-family:ui-monospace,monospace; font-size:9.5px; color:var(--muted-foreground); }
  .bkf-bt { font-size:10px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .bkf-makespan { margin-top:10px; font-size:11px; color:var(--muted-foreground); }
`;
