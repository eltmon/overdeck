import { HOOKS, ROLE_COLORS, type HookFamilyKey } from './model';

interface ConfluenceHelpProps {
  eventsPerMin: number;
  onClose: () => void;
}

const HELP_ROLES = ['plan', 'work', 'worker', 'review', 'test', 'ship', 'strike', 'flywheel', 'sequencer'] as const;
const HELP_HOOKS: HookFamilyKey[][] = [
  ['tool_read', 'tool_write', 'tool_exec'],
  ['tool_web', 'tool_agent', 'lifecycle'],
];

function RoleLegend({ role }: { role: (typeof HELP_ROLES)[number] }) {
  const color = ROLE_COLORS[role];
  return (
    <>
      <span className="legend-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <span className="legend-lbl">{role}</span>
    </>
  );
}

function HookLegend({ hook }: { hook: HookFamilyKey }) {
  const { color, label } = HOOKS[hook];
  return (
    <>
      <span className="legend-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <span className="legend-lbl">{label}</span>
    </>
  );
}

export function ConfluenceHelp({ eventsPerMin, onClose }: ConfluenceHelpProps) {
  return (
    <div
      className="confluence-help"
      role="dialog"
      aria-modal="true"
      aria-label="Confluence field guide"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="h-panel">
        <div className="h-head">
          <span className="h-title">CONFLUENCE — FIELD GUIDE</span>
          <span className="h-sub">River × Spectrum Deck · everything on this canvas, decoded</span>
          <button className="h-close" type="button" title="Close (Esc)" aria-label="Close field guide" onClick={onClose}>✕</button>
        </div>
        <div className="h-grid">
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-blue)' }}>The River</h4>
            <p>The pipeline is a luminous canal flowing <b>left → right</b> through stage columns: PLAN · WORK · REVIEW · TEST · MERGE. Scrolling chevrons show flow direction; the number under each stage is its live orb count (MERGE shows its queue depth). A stage-gradient <b>waveform ribbon</b> rides the river — its amplitude is total system event energy. Stage transitions flash a blue <b>gate ring</b> at the column boundary.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-blue)' }}>Issue Orbs &amp; Model Glyphs</h4>
            <p>Every glowing orb is one <b>issue</b>. <b>Core color = role</b>; <b>ring = project</b> (cyan for PAN, magenta for MIN, one fixed color for each other issue prefix); <b>size + glow = the issue&apos;s real hook-event rate</b> over the last 60 seconds; the <b>letter in the core is the model family</b>: S sonnet · O opus · H haiku · F fable · G gpt · E gemini · X grok · Z glm · Q qwen · L quantum-llama · M muse · N minimax/mimo · I mistral · K kimi; any other model shows its first letter. The label shows the id. The tag line under it shows the state, or <b>role · n ev/m</b> (that issue&apos;s hook events in the last 60 seconds), or <b>role · quiet</b> when there were none.</p>
            <div className="h-demo">{HELP_ROLES.map((role) => <RoleLegend key={role} role={role} />)}</div>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-blue)' }}>Motion</h4>
            <p>Calm orbs drift gently around their anchor. <b>An orb with a high event rate orbits in fast little circles.</b> Each orb has its own vertical slot in its stage column, so labels do not print over each other. Fading comet-trails show where an orb has been. When an issue advances stage, its orb swims right through a gate flash, leaving a wake.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-blue)' }}>Hook Sparks</h4>
            <p>Each burst of sparks is a <b>harness hook event</b> — one per tool call or lifecycle beat. Color tells you the family:</p>
            {HELP_HOOKS.map((hooks) => (
              <div className="h-demo" key={hooks.join('-')}>{hooks.map((hook) => <HookLegend key={hook} hook={hook} />)}</div>
            ))}
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-amber)' }}>Agent Micro-States</h4>
            <p><b>Amber dashed ring</b> = waiting on a permission or question. <b>White inner arc</b> = thinking. <b>Orb contracts + orange ring</b> = context compaction (PreCompact → PostCompact). <b>Rising $</b> = cost events feeding the $/min meter. <b>Red flickering ring + error sparks</b> = the workspace stack broke underneath the agent.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-amber)' }}>Review Convoys</h4>
            <p>An issue in review is a <b>nucleus with orbiting satellites</b>: <b>S</b>ecurity · <b>C</b>orrectness · <b>P</b>erformance · <b>R</b>equirements · <b>Σ</b>ynthesis. An arc flashes when that reviewer posts a verdict. A satellite <b>spiraling in from far orbit</b> is a convoy forming — it settles into orbit when its reviewer session is live.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-amber)' }}>The Shelf &amp; Governor Tides</h4>
            <p>When the scheduler or the memory governor yields an agent, an <b>amber tide sweeps the river</b> and rings the yielded orb as it settles on the ⏸ SHELF with its reason attached. The tide names no beneficiary. Operator holds and paused agents wait on the shelf too, with the pause reason beside the orb (the full reason is in the hover card). A green ring marks an orb leaving the shelf.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: '#9fc7ff' }}>Frost &amp; The Doldrums</h4>
            <p>Frost follows real idle time. An active orb starts to frost after <b>8 idle minutes</b> and is fully frosted at 34. At <b>30 minutes</b> with no activity the data marks the issue stale and its orb settles in the ❄ DOLDRUMS with its idle age. When the data says a stale issue is <b>active again</b>, a burst of ice marks the orb as it returns to its stage column. One hook event alone does not thaw an orb.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: '#bfe3ff' }}>The Stall Sweeper</h4>
            <p>Parked issues settle in the Doldrums with <b>orbit-tinted frost</b> (slate operator-gate, ash zombie-session, ice idle-running) and an orbit tag with the park age under the id. When a sweeper scan reports a changed parked population, an <b>ice-blue lantern beam sweeps the Doldrums</b>, glinting every frozen orb it passes. An orb only a human can release fires a slow-rising <b>⚑ signal flare</b>. The 🧹 PARKED top-bar stat is the true census.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-text-primary)' }}>Merge Portal &amp; Red Rings</h4>
            <p>The white slit at the right edge is <b>main</b>. An issue reaching MERGE waits in the queue; once it is <b>merged</b>, its orb accelerates through the portal as a comet, and the burst is the merge landing. An issue that leaves MERGE without merging fades out. A <b>✗ blinking red ring</b> in a stage column means the issue is <b>stuck, unpushed work</b> or hit an <b>API error</b>; the label says which.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-purple)' }}>Flywheel Sun &amp; Sequencer</h4>
            <p>The purple sun top-left is the <b>flywheel</b>; the double-ringed metronome beside it is the <b>sequencer</b>. Each one pulses and spins only while it is running. When it is not running it is drawn dim and still.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-blue)' }}>Conversation Constellation</h4>
            <p>One twinkling star per live <b>conv-* conversation</b> session — ambient human-agent work happening outside the pipeline river.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-green)' }}>Hook Bus · Dark Fiber</h4>
            <p>The left rail lists <b>all 21 harness hook events</b>. Wired hooks flash their LED and count every firing. <b>Dotted names are dark fiber</b> — hooks that exist upstream (SubagentStart/Stop, InstructionsLoaded, SessionEnd …) but are not wired into Overdeck yet. Wire one and its LED lights up.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-green)' }}>Hook Telemetry</h4>
            <p>The bottom strip is a <b>logic-analyzer for the harness</b>: one labeled channel per wired hook (same order and colors as the hook bus), sharing a <b>60-second time axis</b> — the right edge is now. Every tick is a real event; bursts stack taller and brighter; the number on each channel is its rate over the window, and a dim channel means <b>zero events</b> — quiet failure/permission rows are good news. The cyan band on top is <b>aggregate events/s</b> with its 60 s history and peak. Role counts sit to its right.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-blue)' }}>Top Bar</h4>
            <p>Clock · <b>events/s</b> (pulses on change) · an <b>ECG of events/min</b> · <b>VEL</b> stage transitions per hour · CPU/MEM meters · a <b>PSI</b> memory-pressure meter (amber/red only on real stalls or swap traffic; swap fill is hover detail) · load · merge queue depth · <b>$/min spend</b> · merges today · tokens today · ❄ stale count · 🧹 parked census · oldest-idle · active-agents pill · <b>? HELP</b> · fullscreen <b>⛶</b>.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-blue)' }}>Sidebar</h4>
            <p>The activity feed narrates events as they fire (dot color = source kind). <b>Hovering a feed row flashes the matching orb</b> on stage and shows the full message; clicking it opens that issue&apos;s rail. The donut is the live role mix; gauges are host CPU/MEM and memory PSI. The donut and role counts include only agents the terminal backend actually hosts.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-amber)' }}>Data Honesty</h4>
            <p>The <b>cast is real</b>: every orb is a tracker issue, and its stage, convoy, yield, attention and timestamps come from the dashboard read models. The <b>motion is real</b>: hook sparks, micro-states, cost rises, stage transitions and river energy come from the live domain-event stream. <b>The canvas never writes an orb&apos;s state, and no displayed age or rate is stored:</b> ages are computed from timestamps when drawn, and rates are counted from the last 60 seconds of events. <b>Provenance:</b> dashboard snapshot + /ws/rpc domain events; the current 60-second window contains {eventsPerMin} events.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-blue)' }}>Keys &amp; Mouse</h4>
            <p><kbd>h</kbd> / <kbd>?</kbd> this guide · <kbd>Esc</kbd> close panels · <kbd>f</kbd> fullscreen · <b>hover</b> an orb or feed row for vitals · <b>click</b> either for the issue rail (with live links into the dashboard and tracker).</p>
          </div>
        </div>
        <div className="h-foot">
          <span><kbd>h</kbd>/<kbd>?</kbd> toggle</span>
          <span><kbd>Esc</kbd> close</span>
          <span><kbd>f</kbd> fullscreen</span>
          <span>live provenance · dashboard snapshot + /ws/rpc</span>
          <span>confluence = river (PAN-3441) × spectrum deck (PAN-3443)</span>
        </div>
      </div>
    </div>
  );
}
