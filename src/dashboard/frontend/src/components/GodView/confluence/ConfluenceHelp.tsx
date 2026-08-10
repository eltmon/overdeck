import { HOOKS, ROLE_COLORS, type HookFamilyKey } from './model';

interface ConfluenceHelpProps {
  eventsPerMin: number;
  onClose: () => void;
}

const HELP_ROLES = ['plan', 'work', 'review', 'test', 'ship', 'strike', 'flywheel', 'sequencer'] as const;
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
            <p>The pipeline is a luminous canal flowing <b>left → right</b> through stage columns: PLAN · WORK · REVIEW · TEST · VERIFY · MERGE. Scrolling chevrons show flow direction; the number under each stage is its live orb count (MERGE shows its queue depth). A stage-gradient <b>waveform ribbon</b> rides the river — its amplitude is total system event energy. Stage transitions flash a blue <b>gate ring</b> at the column boundary.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-blue)' }}>Issue Orbs &amp; Model Glyphs</h4>
            <p>Every glowing orb is one <b>issue</b>. <b>Core color = role</b>; <b>ring = project</b> (cyan overdeck, magenta Mind Your Now); <b>size + glow = activity heat</b>; the <b>letter in the core is the model</b>: S sonnet · G gpt · O opus · F fable · K kimi-k3. Label below shows the id, and the tag line under it the live hook rate or state.</p>
            <div className="h-demo">{HELP_ROLES.map((role) => <RoleLegend key={role} role={role} />)}</div>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-blue)' }}>Motion</h4>
            <p>Calm orbs drift gently around their anchor. <b>Hot orbs orbit in frantic little circles</b>. Fading comet-trails show where an orb has been. When an issue advances stage, its orb swims right through a gate flash, leaving a wake.</p>
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
            <p>When the preemptive scheduler or memory governor needs a slot, an <b>amber tide sweeps the river</b> and the yielded orb sinks onto the ⏸ SHELF with its reason attached. A green flash marks an agent resumed into the freed slot.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: '#9fc7ff' }}>Frost &amp; The Doldrums</h4>
            <p>An orb that stops emitting events <b>frosts over in place</b> — colors desaturate to ice, a frost crown grows, snow falls. Fully frozen orbs <b>sink into the ❄ DOLDRUMS</b> with idle-age labels (10h … 24d). Any activity thaws an orb in a burst of steam and floats it back to WORK.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: '#bfe3ff' }}>The Stall Sweeper</h4>
            <p>Parked issues (stuck flags, failed merges, gates, zombies) settle in the Doldrums with <b>orbit-tinted frost</b> — amber stuck, orange UAT, pink merge-failed, purple conflicts, ash zombie, ice idle — and an orbit tag under the id. When the parked population changes, an <b>ice-blue lantern beam sweeps the Doldrums</b>, glinting every orb the scan touched. A swept orb <b>thaws back up into the river</b>; an orb only a human can release fires a slow-rising <b>⚑ signal flare</b>. The 🧹 PARKED top-bar stat is the true census.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-text-primary)' }}>Merge Portal &amp; Wrecks</h4>
            <p>The white slit at the right edge is <b>main</b>. An issue reaching MERGE dwells briefly in the queue, then accelerates through the portal as a comet — the burst is the merge landing. <b>✗ blinking pink hulls are merge-failed wrecks</b> awaiting a human tow.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-purple)' }}>Flywheel Sun &amp; Sequencer</h4>
            <p>The purple sun top-left is the <b>flywheel orchestrator</b>; a ring pulse means it dispatched new work, and moments later a fresh orb enters PLAN from the sun. The double-ringed metronome beside it is the <b>sequencer</b>, evaluating admission priorities.</p>
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
            <p>Clock · <b>events/s</b> (pulses on change) · an <b>ECG of events/min</b> · CPU/MEM/SWAP meters · load · beads <b>WIP/BLOCKED/READY</b> · merge queue depth · <b>$/min spend</b> · merges today · tokens today · ❄ stale count · oldest-idle · active-agents pill · <b>? HELP</b> · fullscreen <b>⛶</b>.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-blue)' }}>Sidebar</h4>
            <p>The activity feed narrates events as they fire (dot color = source kind). <b>Hovering a feed row flashes the matching orb</b> on stage and shows the full message; clicking it opens that issue&apos;s rail. The donut is the live role mix; gauges are host CPU/MEM/SWAP.</p>
          </div>
          <div className="h-card">
            <h4 style={{ color: 'var(--gv-amber)' }}>Data Honesty</h4>
            <p>The <b>cast is real</b> — every orb, stage, convoy, yield, wreck, and idle age comes from the current dashboard issue, agent, review, and workspace-health read models. The <b>motion is real</b> — hook sparks, micro-states, cost rises, stage transitions, and river energy come from the live domain-event stream. <b>Provenance:</b> dashboard snapshot + /ws/rpc domain events; the current 60-second window contains {eventsPerMin} events.</p>
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
