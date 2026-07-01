import type { UatStackState } from './UatStackStatus';

export type UatActionId =
  | 'open-uat'
  | 'open-api'
  | 'logs'
  | 'restart'
  | 'rebuild'
  | 'stop'
  | 'start'
  | 'open-state-dir'
  | 'copy-stack-name'
  | 'reap';

export interface UatAction {
  id: UatActionId;
  label: string;
  icon: string;
  tone?: 'primary' | 'muted' | 'danger';
}

export type UatIssueLifecycle = 'active' | 'idle' | 'merged';

const ACTIONS: Record<UatActionId, UatAction> = {
  'open-uat': { id: 'open-uat', label: 'UAT', icon: 'external-link', tone: 'primary' },
  'open-api': { id: 'open-api', label: 'API', icon: 'external-link' },
  logs: { id: 'logs', label: 'Logs', icon: 'logs' },
  restart: { id: 'restart', label: 'Restart', icon: 'rotate-ccw' },
  rebuild: { id: 'rebuild', label: 'Rebuild', icon: 'hammer' },
  stop: { id: 'stop', label: 'Stop', icon: 'square' },
  start: { id: 'start', label: 'Start', icon: 'play', tone: 'primary' },
  'open-state-dir': { id: 'open-state-dir', label: 'Open state dir', icon: 'folder' },
  'copy-stack-name': { id: 'copy-stack-name', label: 'Copy stack name', icon: 'copy' },
  reap: { id: 'reap', label: 'Reap', icon: 'trash', tone: 'danger' },
};

function action(id: UatActionId, overrides: Partial<UatAction> = {}): UatAction {
  return { ...ACTIONS[id], ...overrides };
}

function withReapLast(actions: UatAction[]): UatAction[] {
  const withoutReap = actions.filter(item => item.id !== 'reap');
  const reap = actions.find(item => item.id === 'reap');
  return reap ? [...withoutReap, { ...reap, tone: 'danger' }] : withoutReap;
}

export function resolveUatActions(
  stackState: UatStackState,
  issueLifecycle: UatIssueLifecycle = 'active',
): { inline: UatAction[]; menu: UatAction[] } {
  const effectiveState = issueLifecycle === 'merged' ? 'stale' : stackState;

  switch (effectiveState) {
    case 'healthy':
      return {
        inline: [action('open-uat'), action('open-api')],
        menu: withReapLast([
          action('open-uat'),
          action('open-api'),
          action('logs', { label: 'View logs' }),
          action('restart'),
          action('rebuild'),
          action('stop'),
          action('open-state-dir'),
          action('copy-stack-name'),
          action('reap'),
        ]),
      };
    case 'starting':
      return {
        inline: [action('logs')],
        menu: withReapLast([
          action('open-uat'),
          action('open-api'),
          action('logs', { label: 'View logs' }),
          action('restart'),
          action('rebuild'),
          action('stop'),
          action('open-state-dir'),
          action('copy-stack-name'),
          action('reap'),
        ]),
      };
    case 'unhealthy':
      return {
        inline: [action('logs', { tone: 'primary' }), action('rebuild')],
        menu: withReapLast([
          action('open-uat'),
          action('open-api'),
          action('logs', { label: 'View logs', tone: 'primary' }),
          action('rebuild'),
          action('restart'),
          action('stop'),
          action('open-state-dir'),
          action('copy-stack-name'),
          action('reap'),
        ]),
      };
    case 'stopped':
      return {
        inline: [action('start'), action('reap')],
        menu: withReapLast([
          action('logs', { label: 'View logs' }),
          action('rebuild'),
          action('open-state-dir'),
          action('copy-stack-name'),
          action('reap'),
        ]),
      };
    case 'stale':
      return {
        inline: [action('reap', { label: 'Reap workspace', tone: 'primary' })],
        menu: withReapLast([
          action('logs', { label: 'View logs' }),
          action('start'),
          action('open-state-dir'),
          action('copy-stack-name'),
          action('reap', { label: 'Reap workspace' }),
        ]),
      };
  }
}
