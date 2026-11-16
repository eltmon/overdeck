import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { UpdateSnapshot } from '@overdeck/contracts';
import { Modal } from './shared/Modal';
import formStyles from './shared/ModalForm.module.css';

interface UpdateDialogProps {
  isOpen: boolean;
  runningAgentCount: number;
  onClose: () => void;
}

async function requestSnapshot(path: string, method: 'GET' | 'POST'): Promise<UpdateSnapshot> {
  const response = await fetch(path, { method });
  const payload = await response.json() as UpdateSnapshot & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Update request failed (${response.status})`);
  return payload;
}

export function UpdateDialog({ isOpen, runningAgentCount, onClose }: UpdateDialogProps) {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const bridge = window.overdeckBridge;

  const check = useCallback(async () => {
    setActionPending(true);
    try {
      setSnapshot(bridge ? await bridge.checkForUpdates() : await requestSnapshot('/api/update/check', 'POST'));
    } catch (error) {
      setSnapshot((current) => current ? { ...current, phase: 'error', error: error instanceof Error ? error.message : String(error) } : current);
    } finally {
      setActionPending(false);
    }
  }, [bridge]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const initial = bridge ? await bridge.getUpdateStatus() : await requestSnapshot('/api/update/status', 'GET');
        if (!cancelled) setSnapshot(initial);
      } finally {
        if (!cancelled) void check();
      }
    })();
    return () => { cancelled = true; };
  }, [bridge, check, isOpen]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onUpdateStatus(setSnapshot);
  }, [bridge]);

  useEffect(() => {
    if (!isOpen || snapshot?.phase !== 'installing' || bridge) return;
    const timer = window.setInterval(() => {
      void requestSnapshot('/api/update/status', 'GET').then(setSnapshot);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [bridge, isOpen, snapshot?.phase]);

  if (!isOpen) return null;

  const phase = snapshot?.phase ?? 'checking';
  const incompatibleAgents = snapshot?.targetAgentProtocol != null
    && snapshot.targetAgentProtocol !== snapshot.currentAgentProtocol
    && runningAgentCount > 0;
  const isDesktop = snapshot?.installMode === 'desktop' || bridge?.isDesktopApp() === true;
  const actionLabel = phase === 'available'
    ? (isDesktop ? 'Download update' : 'Install update')
    : phase === 'ready'
      ? (incompatibleAgents ? `Waiting for ${runningAgentCount} active agent${runningAgentCount === 1 ? '' : 's'}` : 'Restart and update')
      : phase === 'current'
        ? 'Check again'
        : phase === 'error'
          ? 'Try again'
          : null;

  const runAction = async () => {
    if (phase === 'current' || phase === 'error') return check();
    if (phase === 'ready') {
      if (incompatibleAgents) return;
      if (bridge) bridge.quitAndInstall();
      else await fetch('/api/system/restart-dashboard', { method: 'POST' });
      return;
    }
    if (phase !== 'available') return;
    setActionPending(true);
    try {
      setSnapshot(bridge ? await bridge.downloadUpdate() : await requestSnapshot('/api/update/install', 'POST'));
    } finally {
      setActionPending(false);
    }
  };

  const statusCopy = phase === 'current'
    ? `You’re running the latest ${snapshot?.channel ?? 'stable'} version.`
    : phase === 'ready'
      ? 'The update is ready. Restart Overdeck when you are ready.'
      : phase === 'error'
        ? snapshot?.error ?? 'Overdeck could not check for updates.'
        : phase === 'available'
          ? 'A new version of Overdeck is available.'
          : phase === 'installing'
            ? 'Installing the update and syncing your Overdeck context…'
            : phase === 'downloading'
              ? 'Downloading and verifying the signed update…'
              : 'Checking the stable and canary release channels…';

  return (
    <Modal
      title="Overdeck update"
      description={statusCopy}
      closeLabel="Close updater"
      onClose={onClose}
      footer={
        <>
          <div className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            {phase === 'current' ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Download className="h-4 w-4" />}
            {snapshot?.installMode === 'development' ? 'Development checkout — install manually' : 'Your projects and agent history stay in place'}
          </div>
          <button type="button" onClick={onClose} className={formStyles.button}>Not now</button>
          {actionLabel && snapshot?.installMode !== 'development' && (
            <button type="button" onClick={() => void runAction()} disabled={actionPending || incompatibleAgents} className={formStyles.primaryButton}>
              {(actionPending || ['checking', 'downloading', 'installing'].includes(phase)) ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {actionLabel}
            </button>
          )}
        </>
      }
    >
      <div className={`${formStyles.content} space-y-5`}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-xl border border-border bg-background/50 p-4">
          <div><div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Installed</div><div className="mt-1 font-mono text-sm text-foreground">v{snapshot?.currentVersion ?? '…'}</div></div>
          <ArrowUpRight className="h-4 w-4 text-primary" />
          <div><div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Latest</div><div className="mt-1 font-mono text-sm text-foreground">{snapshot?.targetVersion ? `v${snapshot.targetVersion}` : 'Checking…'}</div></div>
        </div>

        {(phase === 'checking' || phase === 'downloading' || phase === 'installing') && (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-1/2 animate-pulse rounded-full bg-primary" /></div>
        )}

        {incompatibleAgents && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
            This release changes the agent protocol. The update can finish downloading, but Overdeck will wait to restart until all active agents stop.
          </div>
        )}

        {snapshot?.releaseNotes && phase !== 'current' && (
          <div>
            <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-foreground">What’s new</h3>{snapshot.releaseUrl && <a href={snapshot.releaseUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Full release notes</a>}</div>
            <div className="prose prose-sm prose-invert max-h-64 max-w-none overflow-y-auto rounded-xl border border-border bg-background/40 p-4 text-muted-foreground prose-headings:text-foreground prose-a:text-primary">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{snapshot.releaseNotes}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
