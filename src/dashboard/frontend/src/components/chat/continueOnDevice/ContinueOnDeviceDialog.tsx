/**
 * "Continue on another device" (PAN-4455 FR-3, D-1, D-2): one dialog with two
 * tabs, opened from either conversation menu through `openContinueOnDevice()`.
 * The host is mounted once in `main.tsx`, so the dialog outlives the menu.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Modal } from '../../shared/Modal';
import formStyles from '../../shared/ModalForm.module.css';
import { ANYWHERE_STATUS_QUERY_KEY, loadAnywhereStatus, type AnywhereStatus } from '../../Settings/anywhere/anywhereApi';
import { HANDOFF_HARNESSES, useContinueOnDeviceStore, type ContinueTarget } from './continueOnDeviceStore';
import { HandOffTab } from './HandOffTab';
import { OpenOnScreenTab } from './OpenOnScreenTab';

type Tab = 'screen' | 'handoff';

/** D-2: hand off when no other device can reach this machine but the vault can carry the conversation. */
export function defaultContinueTab(status: AnywhereStatus, target: ContinueTarget): Tab {
  const reachable = status.addresses.some((address) => !address.loopback);
  return !reachable && status.vault.state === 'ready' && HANDOFF_HARNESSES.has(target.harness) ? 'handoff' : 'screen';
}

export function ContinueOnDeviceDialogHost() {
  const target = useContinueOnDeviceStore((s) => s.target);
  const close = useContinueOnDeviceStore((s) => s.close);
  if (!target) return null;
  return <ContinueOnDeviceDialog target={target} onClose={close} />;
}

const TAB_LABELS: Record<Tab, string> = {
  screen: 'Open on another screen',
  handoff: 'Hand off to another machine',
};

export function ContinueOnDeviceDialog({ target, onClose }: { target: ContinueTarget; onClose: () => void }) {
  const { data: status, error, isLoading } = useQuery({ queryKey: ANYWHERE_STATUS_QUERY_KEY, queryFn: loadAnywhereStatus });
  const [tab, setTab] = useState<Tab | null>(null);

  // The default tab is chosen once, when the status first arrives; a click wins after that.
  useEffect(() => {
    if (status && tab === null) setTab(defaultContinueTab(status, target));
  }, [status, tab, target]);

  const active = tab ?? (status ? defaultContinueTab(status, target) : 'screen');

  return (
    <Modal title="Continue on another device" description={target.title} size="narrow" onClose={onClose}>
      <div className={`${formStyles.content} space-y-4`} data-component="continue-on-device-dialog">
        <div role="tablist" className="flex gap-1 border-b border-border">
          {(['screen', 'handoff'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active === key}
              onClick={() => setTab(key)}
              className={`px-2.5 py-1.5 text-xs transition-colors -mb-px border-b-2 ${
                active === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {TAB_LABELS[key]}
            </button>
          ))}
        </div>

        {isLoading ? (
          <p className={formStyles.status}>Loading…</p>
        ) : error ? (
          <p className={formStyles.error}>{(error as Error).message}</p>
        ) : status ? (
          active === 'screen' ? <OpenOnScreenTab target={target} status={status} /> : <HandOffTab target={target} status={status} />
        ) : null}
      </div>
    </Modal>
  );
}
