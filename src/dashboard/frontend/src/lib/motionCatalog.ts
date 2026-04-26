/**
 * Motion Catalog — domain event → animation mapping for the Command Deck (PAN-830).
 *
 * Principle: every domain event triggers its prescribed motion within 200ms.
 * Animations are CSS-driven on prop changes, triggered by store updates from
 * EventRouter's domain-event subscription.
 *
 * ┌─────────────────────────────┬──────────────────────────┬────────────────────┐
 * │ Domain Event                │ Affected Component       │ Animation          │
 * ├─────────────────────────────┼──────────────────────────┼────────────────────┤
 * │ agent.started               │ FeatureItem, ZoneB       │ StatusDot → active │
 * │ agent.stopped               │ FeatureItem, ZoneB       │ StatusDot → ended  │
 * │ agent.status_changed        │ ZoneB, FeatureItem       │ StatusDot class    │
 * │ agent.status_changed (error)│ ZoneB                    │ Red shake (kf-error-shake) │
 * │ agent.activity_changed      │ ZoneB (ToolFlash)        │ ToolFlash crossfade│
 * │ agent.thinking_started      │ ZoneB                    │ StatusDot thinking + ribbon │
 * │ agent.waiting_started       │ ZoneB                    │ StatusDot waiting + ribbon  │
 * │ pipeline.status_changed     │ ZoneA (pipeline dots)    │ Dot color change   │
 * │ merge.ready                 │ FeatureItem, KanbanBoard │ Ready-to-merge     │
 * │ specialist.started          │ FeatureItem, OverviewTab │ New row + spinner  │
 * │ specialist.completed        │ FeatureItem              │ Status ended       │
 * │ issues.snapshot             │ KanbanBoard, CommandDeck │ Full board render  │
 * │ issue.statusChanged         │ FeatureItem, KanbanBoard │ Row flash + move   │
 * │ activity.entry              │ ActivityPanel            │ anim-row-flash     │
 * │ cost.event_recorded         │ OverviewTab (LiveCounter)│ Number pulse       │
 * │ session_tree.delta          │ FeatureItem, SessionNode │ Row flash on change│
 * └─────────────────────────────┴──────────────────────────┴────────────────────┘
 *
 * Implementation: EventRouter subscribes to `subscribeDomainEvents` and applies
 * events to the Zustand store. Components consume the store via selectors.
 * React re-renders trigger CSS keyframe animations automatically.
 *
 * ZoneB reads `agentRuntimeById` from the store so runtime events
 * (activity_changed, thinking_started, waiting_started) drive motion props
 * within 200ms without intermediate event-bus wiring (PAN-847).
 *
 * The `useLiveFlash` hook (./useLiveFlash.ts) adds an explicit `anim-row-flash`
 * class for 600ms when a watched value changes, ensuring the motion is visible
 * even when the pure prop change doesn't trigger a distinct animation.
 */

export type MotionEventType =
  | 'agent.started'
  | 'agent.stopped'
  | 'agent.status_changed'
  | 'agent.activity_changed'
  | 'agent.thinking_started'
  | 'agent.waiting_started'
  | 'pipeline.status_changed'
  | 'merge.ready'
  | 'specialist.started'
  | 'specialist.completed'
  | 'issues.snapshot'
  | 'issue.statusChanged'
  | 'activity.entry'
  | 'cost.event_recorded'
  | 'session_tree.delta';

export interface MotionEntry {
  event: MotionEventType;
  component: string;
  animation: string;
  cssClass?: string;
}

export const MOTION_CATALOG: readonly MotionEntry[] = [
  { event: 'agent.started', component: 'FeatureItem / ZoneB', animation: 'StatusDot pulse active', cssClass: 'anim-alive-dot-active' },
  { event: 'agent.stopped', component: 'FeatureItem / ZoneB', animation: 'StatusDot dim to ended', cssClass: '' },
  { event: 'agent.status_changed', component: 'ZoneB / FeatureItem', animation: 'StatusDot class swap', cssClass: '' },
  { event: 'agent.status_changed', component: 'ZoneB', animation: 'Red shake on error', cssClass: 'kf-error-shake' },
  { event: 'agent.activity_changed', component: 'ZoneB', animation: 'ToolFlash crossfade', cssClass: '' },
  { event: 'agent.thinking_started', component: 'ZoneB', animation: 'StatusDot thinking glow + ribbon', cssClass: 'anim-alive-dot-thinking' },
  { event: 'agent.waiting_started', component: 'ZoneB', animation: 'StatusDot waiting glow + ribbon', cssClass: 'anim-alive-dot-waiting' },
  { event: 'pipeline.status_changed', component: 'ZoneA', animation: 'Pipeline dot color shift', cssClass: '' },
  { event: 'merge.ready', component: 'FeatureItem / KanbanBoard', animation: 'Ready-to-merge shimmer', cssClass: 'badge-shimmer-rtm' },
  { event: 'specialist.started', component: 'FeatureItem / OverviewTab', animation: 'New row + spinner appear', cssClass: 'anim-alive-dot-active' },
  { event: 'specialist.completed', component: 'FeatureItem', animation: 'Status dot ended', cssClass: '' },
  { event: 'issues.snapshot', component: 'KanbanBoard / CommandDeck', animation: 'Full board re-render', cssClass: '' },
  { event: 'issue.statusChanged', component: 'FeatureItem / KanbanBoard', animation: 'Row flash + column move', cssClass: 'anim-row-flash' },
  { event: 'activity.entry', component: 'ActivityPanel / OverviewTab', animation: 'Row flash', cssClass: 'anim-row-flash' },
  { event: 'cost.event_recorded', component: 'OverviewTab (LiveCounter)', animation: 'Number pulse', cssClass: '' },
  { event: 'session_tree.delta', component: 'FeatureItem / SessionNode', animation: 'Row flash on change', cssClass: 'anim-row-flash' },
];
